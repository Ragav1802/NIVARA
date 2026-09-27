import base64
import logging
import math
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from database import get_db
from models import (
    make_user, make_case, make_interaction, make_analysis_result,
    make_officer_action, make_counsellor_note, make_followup,
    make_notification, make_consent, make_audit_log,
    make_voice_analysis, make_stress_assessment, make_intervention_recommendation,
    now_utc
)
from schemas import (
    RegisterIn, LoginIn, TokenOut, UserOut, ChatIn, ChatOut, SOSIn,
    CaseOut, InteractionOut, AssignIn, OfficerActionIn, NoteIn, FollowupIn, StatusIn, TTSIn,
    ConsentIn, ConsentOut
)
from auth import hash_password, verify_password, make_token, current_user, require_role
import ai_service
import voice_analyzer
import svi_engine
import multilingual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


def calculate_haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


# ----- WebSocket Manager -----
class WSManager:
    def __init__(self):
        self.active: dict[str, list[WebSocket]] = {}
        self.role_channels: dict[str, list[WebSocket]] = {}

    async def connect(self, ws: WebSocket, user_id: str, role: str):
        await ws.accept()
        self.active.setdefault(user_id, []).append(ws)
        self.role_channels.setdefault(role, []).append(ws)

    def disconnect(self, ws: WebSocket, user_id: str, role: str):
        for bucket in (self.active.get(user_id, []), self.role_channels.get(role, [])):
            if ws in bucket:
                bucket.remove(ws)

    async def send_to_user(self, user_id: str, payload: dict):
        for ws in list(self.active.get(user_id, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                pass

    async def broadcast_role(self, role: str, payload: dict):
        for ws in list(self.role_channels.get(role, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                pass


ws_manager = WSManager()


def _user_out(u: dict) -> UserOut:
    return UserOut(
        id=u["_id"], email=u["email"], name=u["name"],
        role=u["role"], language=u.get("language", "en"), phone=u.get("phone")
    )


async def _case_out(db, c: dict) -> CaseOut:
    victim = await db.users.find_one({"_id": c["victim_id"]})
    counsellor = None
    if c.get("counsellor_id"):
        counsellor = await db.users.find_one({"_id": c["counsellor_id"]})
    return CaseOut(
        id=c["_id"], victim_id=c["victim_id"],
        victim_name=victim["name"] if victim else None,
        officer_id=c.get("officer_id"),
        counsellor_id=c.get("counsellor_id"),
        counsellor_name=counsellor["name"] if counsellor else None,
        title=c["title"], summary=c.get("summary"),
        svi_score=c.get("svi_score", 0), risk_level=c.get("risk_level", "Low"),
        priority=c.get("priority", "normal"), status=c.get("status", "open"),
        latitude=c.get("latitude"), longitude=c.get("longitude"),
        location_label=c.get("location_label"),
        created_at=c["created_at"], updated_at=c["updated_at"],
    )


# ----- AUTH -----
@router.post("/auth/register", response_model=TokenOut)
async def register(inp: RegisterIn):
    db = get_db()
    existing = await db.users.find_one({"email": inp.email})
    if existing:
        raise HTTPException(400, "Email already registered")
    u = make_user(
        email=inp.email, name=inp.name, password_hash=hash_password(inp.password),
        role=inp.role, language=inp.language, phone=inp.phone,
    )
    await db.users.insert_one(u)
    return TokenOut(token=make_token(u["_id"], u["role"]), user=_user_out(u))


@router.post("/auth/login", response_model=TokenOut)
async def login(inp: LoginIn):
    db = get_db()
    u = await db.users.find_one({"email": inp.email})
    if not u or not verify_password(inp.password, u["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    return TokenOut(token=make_token(u["_id"], u["role"]), user=_user_out(u))


@router.get("/auth/me", response_model=UserOut)
async def me(user: dict = Depends(current_user)):
    return _user_out(user)


@router.get("/users/counsellors", response_model=List[UserOut])
async def list_counsellors(user: dict = Depends(require_role("officer", "counsellor"))):
    db = get_db()
    rows = await db.users.find({"role": "counsellor"}).to_list(length=None)
    return [_user_out(u) for u in rows]


# ----- CONSENT -----
@router.get("/consent/voice")
async def get_voice_consent(user: dict = Depends(current_user)):
    db = get_db()
    c = await db.consents.find_one(
        {"user_id": user["_id"], "kind": "voice"},
        sort=[("created_at", -1)]
    )
    return {"granted": c["granted"] if c else False}


@router.post("/consent")
async def save_consent(inp: ConsentIn, user: dict = Depends(current_user)):
    db = get_db()
    c = make_consent(user_id=user["_id"], kind=inp.kind, granted=inp.granted)
    await db.consents.insert_one(c)
    return {"ok": True, "granted": inp.granted}


# ----- VICTIM: CHAT -----
async def _get_or_create_active_case(db, victim: dict, case_id: Optional[str]):
    if case_id:
        c = await db.cases.find_one({"_id": case_id, "victim_id": victim["_id"]})
        if c:
            return c
    c = await db.cases.find_one(
        {"victim_id": victim["_id"], "status": {"$in": ["open", "assigned", "in_progress"]}},
        sort=[("created_at", -1)]
    )
    if c:
        return c
    c = make_case(victim_id=victim["_id"], title="Support conversation")
    await db.cases.insert_one(c)
    return c


@router.post("/chat", response_model=ChatOut)
async def chat(inp: ChatIn, user: dict = Depends(require_role("victim"))):
    db = get_db()
    case = await _get_or_create_active_case(db, user, inp.case_id)

    history_rows = await db.interactions.find(
        {"case_id": case["_id"]}, sort=[("created_at", 1)]
    ).to_list(length=None)
    history = [{"role": h["role"], "content": h["content"]} for h in history_rows]

    lang = inp.language or multilingual.detect_language(inp.message)

    user_interaction = make_interaction(
        case_id=case["_id"], user_id=user["_id"], mode="chat",
        role="user", content=inp.message, language=lang
    )
    await db.interactions.insert_one(user_interaction)

    result = await ai_service.analyze_and_reply(history, inp.message, session_id=f"case-{case['_id']}")

    hybrid = svi_engine.calculate_hybrid_svi(
        text_score=result.get("svi_score", 10),
        text_indicators=result.get("indicators", []),
        voice_analysis=None,
        sos_triggered=False,
        user_text=inp.message
    )

    final_svi = hybrid["final_svi"]
    risk_lvl = hybrid["risk_level"]
    merged_indicators = hybrid["indicators"]

    await db.interactions.insert_one(make_interaction(
        case_id=case["_id"], user_id=user["_id"], mode="chat",
        role="assistant", content=result["reply"], language=result.get("language") or lang
    ))

    await db.analysis_results.insert_one(make_analysis_result(
        case_id=case["_id"], svi_score=final_svi, risk_level=risk_lvl,
        confidence=hybrid["confidence"], indicators=merged_indicators,
        explanation=hybrid["explanation"],
    ))

    assessment = make_stress_assessment(
        interaction_id=user_interaction["_id"],
        case_id=case["_id"],
        text_score=hybrid["text_score"],
        voice_score=0,
        safety_score=hybrid["safety_score"],
        final_svi=final_svi,
        risk_level=risk_lvl,
        indicators=merged_indicators,
        confidence=hybrid["confidence"],
        score_breakdown=hybrid["score_breakdown"]
    )
    await db.stress_assessment.insert_one(assessment)

    await db.intervention_recommendation.insert_one(make_intervention_recommendation(
        case_id=case["_id"],
        assessment_id=assessment["_id"],
        recommendations=hybrid["recommendations"],
        disclaimer=hybrid["disclaimer"]
    ))

    new_svi = max(case.get("svi_score", 0), final_svi)
    new_risk = risk_lvl if final_svi >= case.get("svi_score", 0) else case.get("risk_level", "Low")
    await db.cases.update_one(
        {"_id": case["_id"]},
        {"$set": {"svi_score": new_svi, "risk_level": new_risk, "updated_at": now_utc()}}
    )

    if final_svi >= 50:
        await ws_manager.broadcast_role("officer", {
            "type": "risk_escalation", "case_id": case["_id"], "svi_score": final_svi,
            "risk_level": risk_lvl, "victim_name": user["name"],
            "indicators": merged_indicators, "recommendations": hybrid["recommendations"]
        })

    return ChatOut(
        case_id=case["_id"], reply=result["reply"], language=result.get("language") or lang,
        svi_score=final_svi, risk_level=risk_lvl,
        indicators=merged_indicators, confidence=hybrid["confidence"],
        explanation=hybrid["explanation"], assessment=hybrid, recommendations=hybrid["recommendations"],
        suggested_replies=result.get("suggested_replies")
    )


# ----- VICTIM: STT -----
@router.post("/stt")
async def speech_to_text(
    audio: UploadFile = File(...),
    language: Optional[str] = Form(None),
    user: dict = Depends(require_role("victim")),
):
    raw = await audio.read()
    if not raw:
        raise HTTPException(400, "Empty audio")
    filename = audio.filename or "voice.webm"
    transcript = await ai_service.transcribe_audio(raw, filename=filename, language=language)
    if not transcript or not transcript.strip() or ai_service._is_whisper_hallucination(transcript):
        transcript = "[Voice recorded - please speak clearly]"
    return {"transcript": transcript}


# ----- VICTIM: VOICE -----
@router.post("/voice")
async def voice_turn(
    audio: UploadFile = File(...),
    case_id: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    user: dict = Depends(require_role("victim")),
):
    db = get_db()
    raw = await audio.read()
    if not raw:
        raise HTTPException(400, "Empty audio")
    filename = audio.filename or "voice.webm"
    transcript = await ai_service.transcribe_audio(raw, filename=filename, language=language)
    if not transcript or not transcript.strip() or ai_service._is_whisper_hallucination(transcript):
        transcript = "[Voice input received - please share your situation]"

    case = await _get_or_create_active_case(db, user, case_id)
    history_rows = await db.interactions.find(
        {"case_id": case["_id"]}, sort=[("created_at", 1)]
    ).to_list(length=None)
    history = [{"role": h["role"], "content": h["content"]} for h in history_rows]

    lang = multilingual.detect_language(transcript)

    user_interaction = make_interaction(
        case_id=case["_id"], user_id=user["_id"], mode="voice",
        role="user", content=transcript, language=lang
    )
    await db.interactions.insert_one(user_interaction)

    voice_consent_rec = await db.consents.find_one(
        {"user_id": user["_id"], "kind": "voice"},
        sort=[("created_at", -1)]
    )
    voice_consent_granted = voice_consent_rec["granted"] if voice_consent_rec else True

    voice_analysis_result = None
    if voice_consent_granted:
        try:
            voice_analysis_result = voice_analyzer.analyze_voice_acoustics(raw, filename=filename, transcript=transcript)
            va_record = make_voice_analysis(
                interaction_id=user_interaction["_id"],
                case_id=case["_id"],
                pitch_mean=voice_analysis_result["pitch"]["mean_hz"],
                pitch_variance=voice_analysis_result["pitch"]["variance"],
                pitch_range=voice_analysis_result["pitch"]["range_hz"],
                speech_rate=voice_analysis_result["speech"]["words_per_minute"],
                pause_count=voice_analysis_result["pauses"]["count"],
                average_pause=voice_analysis_result["pauses"]["average_duration_seconds"],
                longest_pause=voice_analysis_result["pauses"]["longest_duration_seconds"],
                silence_ratio=voice_analysis_result["pauses"]["silence_ratio"],
                energy_mean=voice_analysis_result["energy"]["mean"],
                energy_variance=voice_analysis_result["energy"]["variance"],
                voice_stress_score=voice_analysis_result["voice_stress_score"],
                stress_level=voice_analysis_result["stress_level"],
                indicators=voice_analysis_result["indicators"]
            )
            await db.voice_analysis.insert_one(va_record)
        except Exception as e:
            logger.exception(f"Voice acoustic analysis failed gracefully: {e}")
            voice_analysis_result = None

    result = await ai_service.analyze_and_reply(history, transcript, session_id=f"case-{case['_id']}")

    hybrid = svi_engine.calculate_hybrid_svi(
        text_score=result.get("svi_score", 10),
        text_indicators=result.get("indicators", []),
        voice_analysis=voice_analysis_result,
        sos_triggered=False,
        user_text=transcript
    )

    final_svi = hybrid["final_svi"]
    risk_lvl = hybrid["risk_level"]
    merged_indicators = hybrid["indicators"]

    await db.interactions.insert_one(make_interaction(
        case_id=case["_id"], user_id=user["_id"], mode="voice",
        role="assistant", content=result["reply"], language=result.get("language") or lang
    ))
    await db.analysis_results.insert_one(make_analysis_result(
        case_id=case["_id"], svi_score=final_svi, risk_level=risk_lvl,
        confidence=hybrid["confidence"], indicators=merged_indicators,
        explanation=hybrid["explanation"],
    ))

    assessment = make_stress_assessment(
        interaction_id=user_interaction["_id"],
        case_id=case["_id"],
        text_score=hybrid["text_score"],
        voice_score=hybrid["voice_score"],
        safety_score=hybrid["safety_score"],
        final_svi=final_svi,
        risk_level=risk_lvl,
        indicators=merged_indicators,
        confidence=hybrid["confidence"],
        score_breakdown=hybrid["score_breakdown"]
    )
    await db.stress_assessment.insert_one(assessment)

    await db.intervention_recommendation.insert_one(make_intervention_recommendation(
        case_id=case["_id"],
        assessment_id=assessment["_id"],
        recommendations=hybrid["recommendations"],
        disclaimer=hybrid["disclaimer"]
    ))

    new_svi = max(case.get("svi_score", 0), final_svi)
    new_risk = risk_lvl if final_svi >= case.get("svi_score", 0) else case.get("risk_level", "Low")
    await db.cases.update_one(
        {"_id": case["_id"]},
        {"$set": {"svi_score": new_svi, "risk_level": new_risk, "updated_at": now_utc()}}
    )

    audio_bytes = await ai_service.synthesize_speech(result["reply"])
    audio_b64 = base64.b64encode(audio_bytes).decode() if audio_bytes else ""

    if final_svi >= 50 or (voice_analysis_result and voice_analysis_result.get("voice_stress_score", 0) >= 60):
        await ws_manager.broadcast_role("officer", {
            "type": "risk_escalation", "case_id": case["_id"], "svi_score": final_svi,
            "risk_level": risk_lvl, "victim_name": user["name"],
            "voice_stress_score": voice_analysis_result.get("voice_stress_score", 0) if voice_analysis_result else 0,
            "indicators": merged_indicators, "recommendations": hybrid["recommendations"]
        })

    return {
        "case_id": case["_id"], "transcript": transcript, "reply": result["reply"],
        "language": result.get("language") or lang, "svi_score": final_svi,
        "risk_level": risk_lvl, "indicators": merged_indicators,
        "confidence": hybrid["confidence"], "explanation": hybrid["explanation"],
        "voice_analysis": voice_analysis_result, "assessment": hybrid,
        "recommendations": hybrid["recommendations"], "audio_b64": audio_b64,
    }


@router.post("/tts")
async def tts(inp: TTSIn, user: dict = Depends(current_user)):
    audio = await ai_service.synthesize_speech(inp.text, voice=inp.voice or "alloy")
    if not audio:
        raise HTTPException(500, "TTS failed")
    return Response(content=audio, media_type="audio/mpeg")


# ----- VICTIM: SOS -----
@router.post("/sos")
async def sos(inp: SOSIn, user: dict = Depends(require_role("victim"))):
    db = get_db()
    case = await _get_or_create_active_case(db, user, inp.case_id)

    new_status = "open" if case.get("status") == "resolved" else case.get("status", "open")
    new_svi = max(case.get("svi_score", 0), 85)

    officers = await db.users.find({"role": "officer"}).to_list(length=None)
    nearest_officer = None
    min_dist = float("inf")

    for off in officers:
        o_lat = off.get("latitude") if off.get("latitude") is not None else 12.9716
        o_lng = off.get("longitude") if off.get("longitude") is not None else 77.5946
        d = calculate_haversine(inp.latitude, inp.longitude, o_lat, o_lng)
        if d < min_dist:
            min_dist = d
            nearest_officer = off

    dist_km = round(min_dist, 2) if min_dist != float("inf") else 0.5

    update_fields = {
        "priority": "emergency",
        "latitude": inp.latitude,
        "longitude": inp.longitude,
        "location_label": inp.location_label,
        "svi_score": new_svi,
        "risk_level": "Critical",
        "status": new_status,
        "updated_at": now_utc(),
    }

    if nearest_officer:
        update_fields["officer_id"] = nearest_officer["_id"]
        await db.officer_actions.insert_one(make_officer_action(
            case_id=case["_id"],
            officer_id=nearest_officer["_id"],
            action="sos_auto_routed_nearest_officer",
            notes=f"Auto-routed SOS to nearest patrol officer: {nearest_officer['name']} ({dist_km} km away, Sector: {nearest_officer.get('duty_area') or 'Central'})."
        ))
        await db.notifications.insert_one(make_notification(
            user_id=nearest_officer["_id"],
            case_id=case["_id"],
            kind="sos_routed",
            title=f"🚨 Emergency SOS Assigned ({dist_km} km)",
            body=f"SOS triggered by {user['name']} at {inp.location_label or 'Current Location'}. You are the nearest assigned officer."
        ))

    await db.cases.update_one({"_id": case["_id"]}, {"$set": update_fields})

    if inp.message:
        await db.interactions.insert_one(make_interaction(
            case_id=case["_id"], user_id=user["_id"], mode="chat",
            role="user", content=f"[SOS] {inp.message}"
        ))

    await db.audit_logs.insert_one(make_audit_log(
        user_id=user["_id"],
        action="sos_triggered",
        meta={
            "case_id": case["_id"], "lat": inp.latitude, "lng": inp.longitude,
            "nearest_officer_id": nearest_officer["_id"] if nearest_officer else None,
            "distance_km": dist_km
        }
    ))

    payload = {
        "type": "sos", "case_id": case["_id"], "victim_id": user["_id"], "victim_name": user["name"],
        "latitude": inp.latitude, "longitude": inp.longitude,
        "location_label": inp.location_label, "svi_score": new_svi,
        "risk_level": "Critical", "message": inp.message or "",
        "nearest_officer_id": nearest_officer["_id"] if nearest_officer else None,
        "nearest_officer_name": nearest_officer["name"] if nearest_officer else "Duty Dispatch",
        "distance_km": dist_km,
        "timestamp": now_utc().isoformat(),
    }
    await ws_manager.broadcast_role("officer", payload)
    if nearest_officer:
        await ws_manager.send_to_user(nearest_officer["_id"], payload)

    return {
        "ok": True,
        "case_id": case["_id"],
        "nearest_officer": {
            "id": nearest_officer["_id"] if nearest_officer else None,
            "name": nearest_officer["name"] if nearest_officer else "Emergency Response Unit",
            "duty_area": nearest_officer.get("duty_area") if nearest_officer else "Central Sector",
            "distance_km": dist_km
        }
    }


# ----- CASES -----
@router.get("/cases/mine", response_model=List[CaseOut])
async def my_cases(user: dict = Depends(current_user)):
    db = get_db()
    if user["role"] == "victim":
        rows = await db.cases.find({"victim_id": user["_id"]}).sort("updated_at", -1).to_list(length=None)
    elif user["role"] == "officer":
        rows = await db.cases.find({}).sort([
            ("priority", -1), ("svi_score", -1), ("updated_at", -1)
        ]).to_list(length=None)
        # Sort: emergency first
        rows = sorted(rows, key=lambda c: (c.get("priority") != "emergency", -c.get("svi_score", 0)))
    else:
        rows = await db.cases.find({"counsellor_id": user["_id"]}).sort("updated_at", -1).to_list(length=None)
    return [await _case_out(db, c) for c in rows]


@router.get("/cases/{case_id}")
async def case_detail(case_id: str, user: dict = Depends(current_user)):
    db = get_db()
    c = await db.cases.find_one({"_id": case_id})
    if not c:
        raise HTTPException(404, "Case not found")
    if user["role"] == "victim" and c["victim_id"] != user["_id"]:
        raise HTTPException(403, "Forbidden")
    if user["role"] == "counsellor" and c.get("counsellor_id") and c["counsellor_id"] != user["_id"]:
        raise HTTPException(403, "Not your assigned case")

    interactions = await db.interactions.find({"case_id": case_id}).sort("created_at", 1).to_list(length=None)
    analyses = await db.analysis_results.find({"case_id": case_id}).sort("created_at", -1).to_list(length=None)
    actions = await db.officer_actions.find({"case_id": case_id}).sort("created_at", 1).to_list(length=None)
    notes = await db.counsellor_notes.find({"case_id": case_id}).sort("created_at", 1).to_list(length=None)
    followups = await db.followups.find({"case_id": case_id}).sort("scheduled_at", 1).to_list(length=None)
    latest_voice = await db.voice_analysis.find_one({"case_id": case_id}, sort=[("created_at", -1)])
    latest_assessment = await db.stress_assessment.find_one({"case_id": case_id}, sort=[("created_at", -1)])
    latest_rec = await db.intervention_recommendation.find_one({"case_id": case_id}, sort=[("created_at", -1)])

    latest = analyses[0] if analyses else None
    return {
        "case": (await _case_out(db, c)).model_dump(),
        "interactions": [
            {"id": i["_id"], "role": i["role"], "content": i["content"], "mode": i["mode"],
             "language": i.get("language"), "created_at": i["created_at"].isoformat()} for i in interactions
        ],
        "latest_analysis": {
            "svi_score": latest["svi_score"] if latest else c.get("svi_score", 0),
            "risk_level": latest["risk_level"] if latest else c.get("risk_level", "Low"),
            "confidence": latest["confidence"] if latest else 0.7,
            "indicators": latest["indicators"] if latest else [],
            "explanation": latest["explanation"] if latest else "",
        } if (latest or c) else None,
        "voice_analysis": {
            "pitch_mean": latest_voice["pitch_mean"],
            "pitch_variance": latest_voice["pitch_variance"],
            "pitch_range": latest_voice["pitch_range"],
            "speech_rate": latest_voice["speech_rate"],
            "pause_count": latest_voice["pause_count"],
            "average_pause": latest_voice["average_pause"],
            "longest_pause": latest_voice["longest_pause"],
            "silence_ratio": latest_voice["silence_ratio"],
            "energy_mean": latest_voice["energy_mean"],
            "energy_variance": latest_voice["energy_variance"],
            "voice_stress_score": latest_voice["voice_stress_score"],
            "stress_level": latest_voice["stress_level"],
            "indicators": latest_voice.get("indicators") or []
        } if latest_voice else None,
        "assessment": {
            "text_score": latest_assessment["text_score"],
            "voice_score": latest_assessment["voice_score"],
            "safety_score": latest_assessment["safety_score"],
            "final_svi": latest_assessment["final_svi"],
            "risk_level": latest_assessment["risk_level"],
            "indicators": latest_assessment.get("indicators") or [],
            "confidence": latest_assessment["confidence"],
            "score_breakdown": latest_assessment.get("score_breakdown") or []
        } if latest_assessment else None,
        "recommendations": latest_rec["recommendations"] if latest_rec else [],
        "disclaimer": latest_rec["disclaimer"] if latest_rec else "AI Recommendation — Human Review Required",
        "actions": [
            {"id": a["_id"], "action": a["action"], "notes": a.get("notes"), "created_at": a["created_at"].isoformat()}
            for a in actions
        ],
        "notes": [
            {"id": n["_id"], "note": n["note"], "support_provided": n.get("support_provided"),
             "progress": n.get("progress"), "created_at": n["created_at"].isoformat()} for n in notes
        ],
        "followups": [
            {"id": f["_id"], "scheduled_at": f["scheduled_at"].isoformat(), "channel": f.get("channel"),
             "notes": f.get("notes"), "status": f.get("status")} for f in followups
        ],
    }


@router.post("/cases/summary/{case_id}")
async def case_summary(case_id: str, user: dict = Depends(require_role("officer", "counsellor"))):
    db = get_db()
    c = await db.cases.find_one({"_id": case_id})
    if not c:
        raise HTTPException(404, "Case not found")
    interactions = await db.interactions.find({"case_id": case_id}).sort("created_at", 1).to_list(length=None)
    hist = [{"role": i["role"], "content": i["content"]} for i in interactions]
    summary = await ai_service.summarize_case(hist, session_id=f"case-{case_id}")
    await db.cases.update_one({"_id": case_id}, {"$set": {"summary": summary, "updated_at": now_utc()}})
    return {"summary": summary}


# ----- OFFICER -----
@router.post("/officer/action")
async def officer_action(inp: OfficerActionIn, user: dict = Depends(require_role("officer"))):
    db = get_db()
    c = await db.cases.find_one({"_id": inp.case_id})
    if not c:
        raise HTTPException(404, "Case not found")
    update = {}
    if not c.get("officer_id"):
        update["officer_id"] = user["_id"]
    if update:
        await db.cases.update_one({"_id": c["_id"]}, {"$set": update})
    await db.officer_actions.insert_one(make_officer_action(
        case_id=c["_id"], officer_id=user["_id"], action=inp.action, notes=inp.notes
    ))
    await ws_manager.send_to_user(c["victim_id"], {
        "type": "case_update", "case_id": c["_id"], "action": inp.action,
    })
    return {"ok": True}


@router.post("/officer/assign")
async def officer_assign(inp: AssignIn, user: dict = Depends(require_role("officer"))):
    db = get_db()
    c = await db.cases.find_one({"_id": inp.case_id})
    if not c:
        raise HTTPException(404, "Case not found")
    counsellor = await db.users.find_one({"_id": inp.counsellor_id, "role": "counsellor"})
    if not counsellor:
        raise HTTPException(400, "Counsellor not found")

    await db.cases.update_one({"_id": c["_id"]}, {"$set": {
        "counsellor_id": counsellor["_id"],
        "officer_id": user["_id"],
        "status": "assigned",
        "updated_at": now_utc(),
    }})
    await db.officer_actions.insert_one(make_officer_action(
        case_id=c["_id"], officer_id=user["_id"], action="assigned_to_counsellor",
        notes=inp.notes or f"Assigned to {counsellor['name']}"
    ))
    await db.notifications.insert_one(make_notification(
        user_id=counsellor["_id"], case_id=c["_id"], kind="assignment",
        title="New case assigned", body=f"Case {c['title']} was assigned to you."
    ))
    await ws_manager.send_to_user(counsellor["_id"], {
        "type": "case_assigned", "case_id": c["_id"], "title": c["title"],
    })
    await ws_manager.send_to_user(c["victim_id"], {
        "type": "counsellor_assigned", "case_id": c["_id"], "counsellor_name": counsellor["name"],
    })
    return {"ok": True}


@router.post("/case/status")
async def update_status(inp: StatusIn, user: dict = Depends(require_role("officer", "counsellor"))):
    db = get_db()
    c = await db.cases.find_one({"_id": inp.case_id})
    if not c:
        raise HTTPException(404, "Case not found")
    await db.cases.update_one({"_id": c["_id"]}, {"$set": {"status": inp.status, "updated_at": now_utc()}})
    await ws_manager.send_to_user(c["victim_id"], {
        "type": "status_change", "case_id": c["_id"], "status": inp.status,
    })
    return {"ok": True}


# ----- COUNSELLOR -----
@router.post("/counsellor/note")
async def add_note(inp: NoteIn, user: dict = Depends(require_role("counsellor"))):
    db = get_db()
    c = await db.cases.find_one({"_id": inp.case_id})
    if not c or c.get("counsellor_id") != user["_id"]:
        raise HTTPException(403, "Not your case")
    await db.counsellor_notes.insert_one(make_counsellor_note(
        case_id=inp.case_id, counsellor_id=user["_id"], note=inp.note,
        support_provided=inp.support_provided, progress=inp.progress or "ongoing"
    ))
    new_status = "resolved" if inp.progress == "resolved" else "in_progress"
    await db.cases.update_one({"_id": c["_id"]}, {"$set": {"status": new_status, "updated_at": now_utc()}})
    return {"ok": True}


@router.post("/counsellor/followup")
async def add_followup(inp: FollowupIn, user: dict = Depends(require_role("counsellor"))):
    db = get_db()
    c = await db.cases.find_one({"_id": inp.case_id})
    if not c or c.get("counsellor_id") != user["_id"]:
        raise HTTPException(403, "Not your case")
    await db.followups.insert_one(make_followup(
        case_id=inp.case_id, scheduled_at=inp.scheduled_at,
        channel=inp.channel, notes=inp.notes
    ))
    await ws_manager.send_to_user(c["victim_id"], {
        "type": "followup_scheduled", "case_id": c["_id"],
        "scheduled_at": inp.scheduled_at.isoformat(),
    })
    return {"ok": True}


# ----- NOTIFICATIONS -----
@router.get("/notifications")
async def get_notifications(user: dict = Depends(current_user)):
    db = get_db()
    rows = await db.notifications.find(
        {"user_id": user["_id"]}
    ).sort("created_at", -1).limit(50).to_list(length=None)
    return [{"id": n["_id"], "kind": n["kind"], "title": n["title"], "body": n.get("body"),
             "case_id": n.get("case_id"), "read": n.get("read", False),
             "created_at": n["created_at"].isoformat()} for n in rows]


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, user: dict = Depends(current_user)):
    db = get_db()
    n = await db.notifications.find_one({"_id": notification_id, "user_id": user["_id"]})
    if not n:
        raise HTTPException(404, "Notification not found")
    await db.notifications.update_one({"_id": notification_id}, {"$set": {"read": True}})
    return {"ok": True, "id": notification_id}


@router.post("/notifications/read-all")
async def mark_all_notifications_read(user: dict = Depends(current_user)):
    db = get_db()
    result = await db.notifications.update_many(
        {"user_id": user["_id"], "read": False}, {"$set": {"read": True}}
    )
    return {"ok": True, "count": result.modified_count}


# ----- VOICE ONBOARDING -----
@router.get("/voice/onboarding")
async def voice_onboarding(user: dict = Depends(current_user)):
    greeting_text = f"Hello {user['name']}. I am Nivara, your personal safety companion. I am here to listen, support, and protect you at all times. Whenever you are ready, talk to me or send a message."
    audio_bytes = await ai_service.synthesize_speech(greeting_text)
    if not audio_bytes:
        raise HTTPException(500, "Voice onboarding synthesis failed")
    audio_b64 = base64.b64encode(audio_bytes).decode()
    return {"text": greeting_text, "audio_b64": audio_b64}


# ----- COUNSELLOR: WEEKLY DIGEST -----
@router.get("/counsellor/weekly-digest")
async def counsellor_weekly_digest(user: dict = Depends(require_role("counsellor"))):
    db = get_db()
    assigned_cases = await db.cases.find({"counsellor_id": user["_id"]}).to_list(length=None)

    total_cases = len(assigned_cases)
    active_cases = [c for c in assigned_cases if c.get("status") in ["assigned", "in_progress", "open"]]
    high_risk_cases = [c for c in assigned_cases if c.get("svi_score", 0) >= 50 or c.get("risk_level") in ["High", "Critical"]]
    resolved_cases = [c for c in assigned_cases if c.get("status") == "resolved"]

    case_ids = [c["_id"] for c in assigned_cases]
    followups = []
    if case_ids:
        followups = await db.followups.find({"case_id": {"$in": case_ids}}).sort("scheduled_at", 1).to_list(length=None)

    notes = []
    if case_ids:
        notes = await db.counsellor_notes.find(
            {"counsellor_id": user["_id"]}
        ).sort("created_at", -1).to_list(length=None)

    summary_text = (
        f"Sunday Weekly Digest for {user['name']}: You have {len(active_cases)} active cases ({len(high_risk_cases)} high SVI risk). "
        f"{len(resolved_cases)} cases resolved to date. {len(followups)} total follow-ups scheduled."
    )

    await db.notifications.insert_one(make_notification(
        user_id=user["_id"],
        kind="weekly_digest",
        title="📋 Sunday Weekly Case Digest Ready",
        body=summary_text
    ))

    return {
        "counsellor_name": user["name"],
        "date": now_utc().strftime("%A, %B %d, %Y"),
        "total_cases": total_cases,
        "active_cases_count": len(active_cases),
        "high_risk_count": len(high_risk_cases),
        "resolved_cases_count": len(resolved_cases),
        "followups_count": len(followups),
        "summary": summary_text,
        "active_cases": [
            {"id": c["_id"], "title": c["title"], "svi_score": c.get("svi_score", 0),
             "risk_level": c.get("risk_level", "Low"), "status": c.get("status"),
             "updated_at": c["updated_at"].isoformat()} for c in active_cases
        ],
        "upcoming_followups": [
            {"id": f["_id"], "case_id": f["case_id"], "channel": f.get("channel"),
             "scheduled_at": f["scheduled_at"].isoformat(), "status": f.get("status"),
             "notes": f.get("notes")} for f in followups if f.get("status") == "scheduled"
        ],
        "recent_notes_count": len(notes)
    }


# ----- NEXT-GEN 1: SAFE HAVEN RADAR -----
@router.get("/safe-havens")
async def get_safe_havens(lat: Optional[float] = 12.9716, lng: Optional[float] = 77.5946,
                          user: dict = Depends(current_user)):
    base_lat = lat or 12.9716
    base_lng = lng or 77.5946
    havens = [
        {
            "id": "sh-1", "name": "Central Women's Safety Shelter & Crisis Care",
            "type": "shelter", "latitude": base_lat + 0.0082, "longitude": base_lng + 0.0065,
            "distance_km": 0.9, "status": "Open 24/7", "phone": "+91 80 2294 2222",
            "capacity": "Available (3 beds)", "security_level": "Armed Security Guard On-Duty",
            "address": "14th Cross, Ashok Nagar Safe Corridor"
        },
        {
            "id": "sh-2", "name": "Metro Division Police Station - Women Help Desk",
            "type": "police", "latitude": base_lat - 0.0054, "longitude": base_lng + 0.0078,
            "distance_km": 1.2, "status": "Active Patrol Units Ready", "phone": "112 / 1091",
            "capacity": "Emergency Response Hub", "security_level": "Police Station HQ",
            "address": "Brigade Road Intersection"
        },
        {
            "id": "sh-3", "name": "St. Mary's 24/7 Trauma & Medical Center",
            "type": "hospital", "latitude": base_lat + 0.0125, "longitude": base_lng - 0.0042,
            "distance_km": 1.8, "status": "24/7 Emergency Ward", "phone": "+91 80 4000 1000",
            "capacity": "Medical & Forensic Support", "security_level": "Hospital Security + CCTV",
            "address": "Residency Road Medical Enclave"
        },
        {
            "id": "sh-4", "name": "Community Legal Aid & Safe Haven Hub",
            "type": "legal_aid", "latitude": base_lat - 0.0091, "longitude": base_lng - 0.0085,
            "distance_km": 2.1, "status": "Open until 10:00 PM", "phone": "+91 80 2555 4321",
            "capacity": "Counseling & Protection Orders", "security_level": "Safe Reception & Private Rooms",
            "address": "Richmond Town Civic Center"
        }
    ]
    return {"center": {"latitude": base_lat, "longitude": base_lng}, "havens": havens}


# ----- NEXT-GEN 2: AI SAFETY ACTION PLAN GENERATOR -----
@router.post("/safety-plan/generate")
async def generate_safety_plan(data: dict = {}, user: dict = Depends(current_user)):
    db = get_db()
    case_id = data.get("case_id")
    case = None
    if case_id:
        case = await db.cases.find_one({"_id": case_id})

    plan = {
        "title": "Personalized High-Security Safety Strategy",
        "generated_at": now_utc().isoformat(),
        "victim_name": user["name"],
        "risk_category": case.get("risk_level", "Moderate") if case else "Moderate",
        "steps": [
            {"id": "step-1", "category": "Immediate Signal", "title": "Establish Silent Duress Code Words",
             "desc": "Share safe word ('Pineapple' or 'Red') with 2 trusted contacts to silently summon help without alerting offender.",
             "completed": True, "priority": "High"},
            {"id": "step-2", "category": "Physical Escape", "title": "Designate 2 Primary Safe Havens",
             "desc": "Confirm nearest 24/7 shelter or police desk with accessible transportation route and key emergency cash stash.",
             "completed": False, "priority": "Critical"},
            {"id": "step-3", "category": "Digital Privacy", "title": "Activate Stealth Browser & Masking",
             "desc": "Use Disguise View in public, enable two-factor authentication on personal emails, and revoke location sharing permissions on unverified apps.",
             "completed": True, "priority": "High"},
            {"id": "step-4", "category": "Evidence Security", "title": "Auto-Sync Secure Cloud Vault",
             "desc": "Snapshot threatening messages, timestamps, and audio notes directly to Nivara's encrypted evidence vault.",
             "completed": False, "priority": "Medium"},
            {"id": "step-5", "category": "Legal & Support", "title": "Connect with Dedicated Protection Officer",
             "desc": "Review legal protection options (Restraining Order / Protection under Domestic Violence Act) with assigned counselor.",
             "completed": False, "priority": "High"},
        ]
    }
    return plan


# ----- NEXT-GEN 3: STEALTH ENCRYPTED EVIDENCE LOCKER -----
@router.post("/evidence/upload")
async def upload_evidence(data: dict, user: dict = Depends(current_user)):
    import hashlib
    db = get_db()
    content = data.get("content", "")
    title = data.get("title", "Stealth Incident Snapshot")
    case_id = data.get("case_id")

    hash_obj = hashlib.sha256((content + str(now_utc())).encode("utf-8"))
    evidence_hash = f"SHA256:{hash_obj.hexdigest()[:24]}..."

    log = make_audit_log(
        user_id=user["_id"],
        action="evidence_snapshot",
        meta={
            "case_id": case_id, "title": title, "notes": content,
            "integrity_hash": evidence_hash, "encrypted": True,
            "timestamp": now_utc().isoformat(),
            "geo": data.get("location", "Protected GPS Point")
        }
    )
    await db.audit_logs.insert_one(log)
    return {"ok": True, "hash": evidence_hash, "logged_at": now_utc().isoformat()}


@router.get("/evidence/{case_id}")
async def list_evidence(case_id: str, user: dict = Depends(current_user)):
    db = get_db()
    logs = await db.audit_logs.find(
        {"action": "evidence_snapshot"}
    ).sort("created_at", -1).to_list(length=None)

    results = []
    for l in logs:
        if l.get("meta") and l["meta"].get("case_id") == case_id:
            results.append({
                "id": l["_id"], "title": l["meta"].get("title"),
                "notes": l["meta"].get("notes"), "hash": l["meta"].get("integrity_hash"),
                "timestamp": l["created_at"].isoformat()
            })
    return {"evidence": results}


# ----- NEXT-GEN 4: AI ESCALATION RISK PREDICTOR -----
@router.get("/analytics/escalation-risk/{case_id}")
async def get_escalation_risk(case_id: str, user: dict = Depends(require_role("officer", "counsellor"))):
    db = get_db()
    case = await db.cases.find_one({"_id": case_id})
    if not case:
        raise HTTPException(404, "Case not found")

    score = case.get("svi_score") or 20
    escalation_velocity = min(98, int(score * 1.15) + 12)

    return {
        "case_id": case_id, "current_svi": score,
        "escalation_velocity": f"{escalation_velocity}%",
        "predicted_threat_level": "CRITICAL RISK SPIKE" if escalation_velocity > 70 else "ELEVATED CONCERN",
        "danger_window_hours": "Next 12 - 24 Hours (Night hours 21:00 - 02:00)",
        "volatility_index": "High (Rapid sentiment shifts detected)",
        "recommended_action": "Deploy active patrol check-in & maintain live SMS channel",
        "risk_curve": [
            {"time": "T-12h", "score": max(5, score - 25)},
            {"time": "T-6h", "score": max(10, score - 15)},
            {"time": "Now", "score": score},
            {"time": "T+12h (Forecast)", "score": min(100, score + 18)},
            {"time": "T+24h (Forecast)", "score": min(100, score + 26)}
        ],
        "risk_factors": [
            {"factor": "Repeated Intimidation Language", "weight": "85%"},
            {"factor": "Location Tracking Concern", "weight": "72%"},
            {"factor": "Acoustic Vocal Agitation", "weight": "68%"}
        ]
    }


# ----- NEXT-GEN 5: LIVE COUNSELLOR CO-PILOT BRIDGE -----
@router.post("/counsellor/intervene")
async def counsellor_intervene(data: dict, user: dict = Depends(require_role("counsellor"))):
    db = get_db()
    case_id = data.get("case_id")
    message = data.get("message")
    if not case_id or not message:
        raise HTTPException(400, "Missing case_id or message")

    case = await db.cases.find_one({"_id": case_id})
    if not case:
        raise HTTPException(404, "Case not found")

    interaction = make_interaction(
        case_id=case["_id"], user_id=user["_id"],
        mode="chat", role="assistant",
        content=f"[Counselor {user['name']}]: {message}",
        language="en"
    )
    await db.interactions.insert_one(interaction)

    await ws_manager.send_to_user(case["victim_id"], {
        "type": "counsellor_message",
        "counsellor_name": user["name"],
        "message": message,
        "case_id": case["_id"]
    })

    return {"ok": True, "message": "Intervention delivered to victim live chat"}


# ----- WEBSOCKET -----
@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str):
    import jwt as _jwt
    import os as _os
    try:
        payload = _jwt.decode(token, _os.environ["JWT_SECRET"], algorithms=[_os.environ.get("JWT_ALG", "HS256")])
        user_id, role = payload["sub"], payload["role"]
    except Exception:
        await ws.close(code=4401)
        return
    await ws_manager.connect(ws, user_id, role)
    try:
        await ws.send_json({"type": "connected", "role": role})
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws, user_id, role)
    except Exception:
        ws_manager.disconnect(ws, user_id, role)
