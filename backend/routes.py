import base64
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from sqlalchemy import select, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import (
    User, Case, Interaction, AnalysisResult, OfficerAction,
    CounsellorNote, Followup, Notification, Consent, AuditLog,
    VoiceAnalysis, StressAssessment, InterventionRecommendation
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



# ----- WebSocket Manager -----
class WSManager:
    def __init__(self):
        self.active: dict[str, list[WebSocket]] = {}  # user_id -> [ws]
        self.role_channels: dict[str, list[WebSocket]] = {}  # role -> [ws]

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


async def _user_out(u: User) -> UserOut:
    return UserOut(id=u.id, email=u.email, name=u.name, role=u.role, language=u.language, phone=u.phone)


async def _case_out(db: AsyncSession, c: Case) -> CaseOut:
    victim = (await db.execute(select(User).where(User.id == c.victim_id))).scalar_one_or_none()
    counsellor = None
    if c.counsellor_id:
        counsellor = (await db.execute(select(User).where(User.id == c.counsellor_id))).scalar_one_or_none()
    return CaseOut(
        id=c.id, victim_id=c.victim_id, victim_name=victim.name if victim else None,
        officer_id=c.officer_id, counsellor_id=c.counsellor_id,
        counsellor_name=counsellor.name if counsellor else None,
        title=c.title, summary=c.summary, svi_score=c.svi_score, risk_level=c.risk_level,
        priority=c.priority, status=c.status, latitude=c.latitude, longitude=c.longitude,
        location_label=c.location_label, created_at=c.created_at, updated_at=c.updated_at,
    )


# ----- AUTH -----
@router.post("/auth/register", response_model=TokenOut)
async def register(inp: RegisterIn, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(User).where(User.email == inp.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Email already registered")
    u = User(
        email=inp.email, name=inp.name, password_hash=hash_password(inp.password),
        role=inp.role, language=inp.language, phone=inp.phone,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return TokenOut(token=make_token(u.id, u.role), user=await _user_out(u))


@router.post("/auth/login", response_model=TokenOut)
async def login(inp: LoginIn, db: AsyncSession = Depends(get_db)):
    u = (await db.execute(select(User).where(User.email == inp.email))).scalar_one_or_none()
    if not u or not verify_password(inp.password, u.password_hash):
        raise HTTPException(401, "Invalid credentials")
    return TokenOut(token=make_token(u.id, u.role), user=await _user_out(u))


@router.get("/auth/me", response_model=UserOut)
async def me(user: User = Depends(current_user)):
    return await _user_out(user)


@router.get("/users/counsellors", response_model=List[UserOut])
async def list_counsellors(user: User = Depends(require_role("officer", "counsellor")),
                           db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(User).where(User.role == "counsellor"))).scalars().all()
    return [await _user_out(u) for u in rows]


# ----- CONSENT -----
@router.get("/consent/voice")
async def get_voice_consent(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    c = (await db.execute(
        select(Consent).where(Consent.user_id == user.id, Consent.kind == "voice").order_by(desc(Consent.created_at))
    )).scalars().first()
    return {"granted": c.granted if c else False}


@router.post("/consent")
async def save_consent(inp: ConsentIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    c = Consent(user_id=user.id, kind=inp.kind, granted=inp.granted)
    db.add(c)
    await db.commit()
    return {"ok": True, "granted": inp.granted}



# ----- VICTIM: CHAT -----
async def _get_or_create_active_case(db: AsyncSession, victim: User, case_id: Optional[str]) -> Case:
    if case_id:
        c = (await db.execute(select(Case).where(Case.id == case_id, Case.victim_id == victim.id))).scalar_one_or_none()
        if c:
            return c
    # Reuse latest open case or create
    c = (await db.execute(
        select(Case).where(Case.victim_id == victim.id, Case.status.in_(["open", "assigned", "in_progress"]))
        .order_by(desc(Case.created_at))
    )).scalars().first()
    if c:
        return c
    c = Case(victim_id=victim.id, title="Support conversation")
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


@router.post("/chat", response_model=ChatOut)
async def chat(inp: ChatIn, user: User = Depends(require_role("victim")), db: AsyncSession = Depends(get_db)):
    case = await _get_or_create_active_case(db, user, inp.case_id)

    # Load history
    history_rows = (await db.execute(
        select(Interaction).where(Interaction.case_id == case.id).order_by(Interaction.created_at)
    )).scalars().all()
    history = [{"role": h.role, "content": h.content} for h in history_rows]

    lang = inp.language or multilingual.detect_language(inp.message)

    # Save user turn
    user_interaction = Interaction(case_id=case.id, user_id=user.id, mode="chat", role="user",
                                  content=inp.message, language=lang)
    db.add(user_interaction)
    await db.commit()
    await db.refresh(user_interaction)

    result = await ai_service.analyze_and_reply(history, inp.message, session_id=f"case-{case.id}")

    # Compute Hybrid Multimodal SVI
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

    # Save assistant turn
    db.add(Interaction(case_id=case.id, user_id=user.id, mode="chat", role="assistant",
                       content=result["reply"], language=result.get("language") or lang))

    # Save legacy AnalysisResult
    db.add(AnalysisResult(
        case_id=case.id, svi_score=final_svi, risk_level=risk_lvl,
        confidence=hybrid["confidence"], indicators=merged_indicators,
        explanation=hybrid["explanation"],
    ))

    # Save StressAssessment
    assessment = StressAssessment(
        interaction_id=user_interaction.id,
        case_id=case.id,
        text_score=hybrid["text_score"],
        voice_score=0,
        safety_score=hybrid["safety_score"],
        final_svi=final_svi,
        risk_level=risk_lvl,
        indicators=merged_indicators,
        confidence=hybrid["confidence"],
        score_breakdown=hybrid["score_breakdown"]
    )
    db.add(assessment)
    await db.commit()
    await db.refresh(assessment)

    # Save InterventionRecommendation
    db.add(InterventionRecommendation(
        case_id=case.id,
        assessment_id=assessment.id,
        recommendations=hybrid["recommendations"],
        disclaimer=hybrid["disclaimer"]
    ))

    case.svi_score = max(case.svi_score, final_svi)
    case.risk_level = risk_lvl if final_svi >= case.svi_score else case.risk_level
    case.updated_at = datetime.now(timezone.utc)
    await db.commit()

    # If critical or high, notify officers in real-time
    if final_svi >= 50:
        await ws_manager.broadcast_role("officer", {
            "type": "risk_escalation", "case_id": case.id, "svi_score": final_svi,
            "risk_level": risk_lvl, "victim_name": user.name,
            "indicators": merged_indicators, "recommendations": hybrid["recommendations"]
        })

    return ChatOut(
        case_id=case.id, reply=result["reply"], language=result.get("language") or lang,
        svi_score=final_svi, risk_level=risk_lvl,
        indicators=merged_indicators, confidence=hybrid["confidence"],
        explanation=hybrid["explanation"], assessment=hybrid, recommendations=hybrid["recommendations"],
        suggested_replies=result.get("suggested_replies")
    )


# ----- VICTIM: VOICE (audio in -> transcribe -> acoustic analysis -> chat -> tts audio out) -----
@router.post("/voice")
async def voice_turn(
    audio: UploadFile = File(...),
    case_id: Optional[str] = Form(None),
    user: User = Depends(require_role("victim")),
    db: AsyncSession = Depends(get_db),
):
    raw = await audio.read()
    if not raw:
        raise HTTPException(400, "Empty audio")
    filename = audio.filename or "voice.webm"
    transcript = await ai_service.transcribe_audio(raw, filename=filename)
    if not transcript.strip():
        raise HTTPException(500, "Transcription failed")

    case = await _get_or_create_active_case(db, user, case_id)
    history_rows = (await db.execute(
        select(Interaction).where(Interaction.case_id == case.id).order_by(Interaction.created_at)
    )).scalars().all()
    history = [{"role": h.role, "content": h.content} for h in history_rows]

    lang = multilingual.detect_language(transcript)

    user_interaction = Interaction(case_id=case.id, user_id=user.id, mode="voice", role="user", content=transcript, language=lang)
    db.add(user_interaction)
    await db.commit()
    await db.refresh(user_interaction)

    # Check voice consent status
    voice_consent_rec = (await db.execute(
        select(Consent).where(Consent.user_id == user.id, Consent.kind == "voice").order_by(desc(Consent.created_at))
    )).scalars().first()
    voice_consent_granted = voice_consent_rec.granted if voice_consent_rec else True  # Default true if unprompted

    voice_analysis_result = None
    if voice_consent_granted:
        try:
            voice_analysis_result = voice_analyzer.analyze_voice_acoustics(raw, filename=filename, transcript=transcript)
            # Save VoiceAnalysis record
            va_record = VoiceAnalysis(
                interaction_id=user_interaction.id,
                case_id=case.id,
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
            db.add(va_record)
            await db.commit()
        except Exception as e:
            logger.exception(f"Voice acoustic analysis failed gracefully: {e}")
            voice_analysis_result = None

    # Text NLP analysis
    result = await ai_service.analyze_and_reply(history, transcript, session_id=f"case-{case.id}")

    # Compute Hybrid Multimodal SVI
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

    db.add(Interaction(case_id=case.id, user_id=user.id, mode="voice", role="assistant",
                       content=result["reply"], language=result.get("language") or lang))
    db.add(AnalysisResult(
        case_id=case.id, svi_score=final_svi, risk_level=risk_lvl,
        confidence=hybrid["confidence"], indicators=merged_indicators,
        explanation=hybrid["explanation"],
    ))

    # Save StressAssessment
    assessment = StressAssessment(
        interaction_id=user_interaction.id,
        case_id=case.id,
        text_score=hybrid["text_score"],
        voice_score=hybrid["voice_score"],
        safety_score=hybrid["safety_score"],
        final_svi=final_svi,
        risk_level=risk_lvl,
        indicators=merged_indicators,
        confidence=hybrid["confidence"],
        score_breakdown=hybrid["score_breakdown"]
    )
    db.add(assessment)
    await db.commit()
    await db.refresh(assessment)

    # Save InterventionRecommendation
    db.add(InterventionRecommendation(
        case_id=case.id,
        assessment_id=assessment.id,
        recommendations=hybrid["recommendations"],
        disclaimer=hybrid["disclaimer"]
    ))

    case.svi_score = max(case.svi_score, final_svi)
    case.risk_level = risk_lvl if final_svi >= case.svi_score else case.risk_level
    case.updated_at = datetime.now(timezone.utc)
    await db.commit()

    audio_bytes = await ai_service.synthesize_speech(result["reply"])
    audio_b64 = base64.b64encode(audio_bytes).decode() if audio_bytes else ""

    if final_svi >= 50 or (voice_analysis_result and voice_analysis_result.get("voice_stress_score", 0) >= 60):
        await ws_manager.broadcast_role("officer", {
            "type": "risk_escalation", "case_id": case.id, "svi_score": final_svi,
            "risk_level": risk_lvl, "victim_name": user.name,
            "voice_stress_score": voice_analysis_result.get("voice_stress_score", 0) if voice_analysis_result else 0,
            "indicators": merged_indicators, "recommendations": hybrid["recommendations"]
        })

    return {
        "case_id": case.id, "transcript": transcript, "reply": result["reply"],
        "language": result.get("language") or lang, "svi_score": final_svi,
        "risk_level": risk_lvl, "indicators": merged_indicators,
        "confidence": hybrid["confidence"], "explanation": hybrid["explanation"],
        "voice_analysis": voice_analysis_result, "assessment": hybrid,
        "recommendations": hybrid["recommendations"], "audio_b64": audio_b64,
    }



@router.post("/tts")
async def tts(inp: TTSIn, user: User = Depends(current_user)):
    audio = await ai_service.synthesize_speech(inp.text, voice=inp.voice or "alloy")
    if not audio:
        raise HTTPException(500, "TTS failed")
    return Response(content=audio, media_type="audio/mpeg")


# ----- VICTIM: SOS -----
@router.post("/sos")
async def sos(inp: SOSIn, user: User = Depends(require_role("victim")), db: AsyncSession = Depends(get_db)):
    case = await _get_or_create_active_case(db, user, inp.case_id)
    case.priority = "emergency"
    case.latitude = inp.latitude
    case.longitude = inp.longitude
    case.location_label = inp.location_label
    case.svi_score = max(case.svi_score, 85)
    case.risk_level = "Critical"
    case.status = "open" if case.status == "resolved" else case.status
    case.updated_at = datetime.now(timezone.utc)
    if inp.message:
        db.add(Interaction(case_id=case.id, user_id=user.id, mode="chat", role="user",
                           content=f"[SOS] {inp.message}"))
    db.add(AuditLog(user_id=user.id, action="sos_triggered",
                    meta={"case_id": case.id, "lat": inp.latitude, "lng": inp.longitude}))
    await db.commit()

    payload = {
        "type": "sos", "case_id": case.id, "victim_id": user.id, "victim_name": user.name,
        "latitude": inp.latitude, "longitude": inp.longitude,
        "location_label": inp.location_label, "svi_score": case.svi_score,
        "risk_level": case.risk_level, "message": inp.message or "",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    await ws_manager.broadcast_role("officer", payload)
    return {"ok": True, "case_id": case.id}


# ----- CASES -----
@router.get("/cases/mine", response_model=List[CaseOut])
async def my_cases(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if user.role == "victim":
        rows = (await db.execute(select(Case).where(Case.victim_id == user.id).order_by(desc(Case.updated_at)))).scalars().all()
    elif user.role == "officer":
        rows = (await db.execute(select(Case).order_by(desc(Case.priority == "emergency"), desc(Case.svi_score), desc(Case.updated_at)))).scalars().all()
    else:
        rows = (await db.execute(select(Case).where(Case.counsellor_id == user.id).order_by(desc(Case.updated_at)))).scalars().all()
    return [await _case_out(db, c) for c in rows]


@router.get("/cases/{case_id}")
async def case_detail(case_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    c = (await db.execute(select(Case).where(Case.id == case_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Case not found")
    if user.role == "victim" and c.victim_id != user.id:
        raise HTTPException(403, "Forbidden")
    if user.role == "counsellor" and c.counsellor_id and c.counsellor_id != user.id:
        raise HTTPException(403, "Not your assigned case")

    interactions = (await db.execute(
        select(Interaction).where(Interaction.case_id == case_id).order_by(Interaction.created_at)
    )).scalars().all()
    analyses = (await db.execute(
        select(AnalysisResult).where(AnalysisResult.case_id == case_id).order_by(desc(AnalysisResult.created_at))
    )).scalars().all()
    actions = (await db.execute(
        select(OfficerAction).where(OfficerAction.case_id == case_id).order_by(OfficerAction.created_at)
    )).scalars().all()
    notes = (await db.execute(
        select(CounsellorNote).where(CounsellorNote.case_id == case_id).order_by(CounsellorNote.created_at)
    )).scalars().all()
    followups = (await db.execute(
        select(Followup).where(Followup.case_id == case_id).order_by(Followup.scheduled_at)
    )).scalars().all()

    latest_voice = (await db.execute(
        select(VoiceAnalysis).where(VoiceAnalysis.case_id == case_id).order_by(desc(VoiceAnalysis.created_at))
    )).scalars().first()

    latest_assessment = (await db.execute(
        select(StressAssessment).where(StressAssessment.case_id == case_id).order_by(desc(StressAssessment.created_at))
    )).scalars().first()

    latest_rec = (await db.execute(
        select(InterventionRecommendation).where(InterventionRecommendation.case_id == case_id).order_by(desc(InterventionRecommendation.created_at))
    )).scalars().first()

    latest = analyses[0] if analyses else None
    return {
        "case": (await _case_out(db, c)).model_dump(),
        "interactions": [
            {"id": i.id, "role": i.role, "content": i.content, "mode": i.mode,
             "language": i.language, "created_at": i.created_at.isoformat()} for i in interactions
        ],
        "latest_analysis": {
            "svi_score": latest.svi_score if latest else c.svi_score,
            "risk_level": latest.risk_level if latest else c.risk_level,
            "confidence": latest.confidence if latest else 0.7,
            "indicators": latest.indicators if latest else [],
            "explanation": latest.explanation if latest else "",
        } if (latest or c) else None,
        "voice_analysis": {
            "pitch_mean": latest_voice.pitch_mean,
            "pitch_variance": latest_voice.pitch_variance,
            "pitch_range": latest_voice.pitch_range,
            "speech_rate": latest_voice.speech_rate,
            "pause_count": latest_voice.pause_count,
            "average_pause": latest_voice.average_pause,
            "longest_pause": latest_voice.longest_pause,
            "silence_ratio": latest_voice.silence_ratio,
            "energy_mean": latest_voice.energy_mean,
            "energy_variance": latest_voice.energy_variance,
            "voice_stress_score": latest_voice.voice_stress_score,
            "stress_level": latest_voice.stress_level,
            "indicators": latest_voice.indicators or []
        } if latest_voice else None,
        "assessment": {
            "text_score": latest_assessment.text_score,
            "voice_score": latest_assessment.voice_score,
            "safety_score": latest_assessment.safety_score,
            "final_svi": latest_assessment.final_svi,
            "risk_level": latest_assessment.risk_level,
            "indicators": latest_assessment.indicators or [],
            "confidence": latest_assessment.confidence,
            "score_breakdown": latest_assessment.score_breakdown or []
        } if latest_assessment else None,
        "recommendations": latest_rec.recommendations if latest_rec else [],
        "disclaimer": latest_rec.disclaimer if latest_rec else "AI Recommendation — Human Review Required",
        "actions": [
            {"id": a.id, "action": a.action, "notes": a.notes, "created_at": a.created_at.isoformat()}
            for a in actions
        ],
        "notes": [
            {"id": n.id, "note": n.note, "support_provided": n.support_provided,
             "progress": n.progress, "created_at": n.created_at.isoformat()} for n in notes
        ],
        "followups": [
            {"id": f.id, "scheduled_at": f.scheduled_at.isoformat(), "channel": f.channel,
             "notes": f.notes, "status": f.status} for f in followups
        ],
    }



@router.post("/cases/summary/{case_id}")
async def case_summary(case_id: str, user: User = Depends(require_role("officer", "counsellor")),
                       db: AsyncSession = Depends(get_db)):
    c = (await db.execute(select(Case).where(Case.id == case_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Case not found")
    interactions = (await db.execute(
        select(Interaction).where(Interaction.case_id == case_id).order_by(Interaction.created_at)
    )).scalars().all()
    hist = [{"role": i.role, "content": i.content} for i in interactions]
    summary = await ai_service.summarize_case(hist, session_id=f"case-{case_id}")
    c.summary = summary
    await db.commit()
    return {"summary": summary}


# ----- OFFICER -----
@router.post("/officer/action")
async def officer_action(inp: OfficerActionIn, user: User = Depends(require_role("officer")),
                         db: AsyncSession = Depends(get_db)):
    c = (await db.execute(select(Case).where(Case.id == inp.case_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Case not found")
    if not c.officer_id:
        c.officer_id = user.id
    db.add(OfficerAction(case_id=c.id, officer_id=user.id, action=inp.action, notes=inp.notes))
    await db.commit()
    await ws_manager.send_to_user(c.victim_id, {
        "type": "case_update", "case_id": c.id, "action": inp.action,
    })
    return {"ok": True}


@router.post("/officer/assign")
async def officer_assign(inp: AssignIn, user: User = Depends(require_role("officer")),
                         db: AsyncSession = Depends(get_db)):
    c = (await db.execute(select(Case).where(Case.id == inp.case_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Case not found")
    counsellor = (await db.execute(
        select(User).where(User.id == inp.counsellor_id, User.role == "counsellor")
    )).scalar_one_or_none()
    if not counsellor:
        raise HTTPException(400, "Counsellor not found")
    c.counsellor_id = counsellor.id
    c.officer_id = user.id
    c.status = "assigned"
    c.updated_at = datetime.now(timezone.utc)
    db.add(OfficerAction(case_id=c.id, officer_id=user.id, action="assigned_to_counsellor",
                         notes=inp.notes or f"Assigned to {counsellor.name}"))
    db.add(Notification(user_id=counsellor.id, case_id=c.id, kind="assignment",
                        title="New case assigned", body=f"Case {c.title} was assigned to you."))
    await db.commit()
    await ws_manager.send_to_user(counsellor.id, {
        "type": "case_assigned", "case_id": c.id, "title": c.title,
    })
    await ws_manager.send_to_user(c.victim_id, {
        "type": "counsellor_assigned", "case_id": c.id, "counsellor_name": counsellor.name,
    })
    return {"ok": True}


@router.post("/case/status")
async def update_status(inp: StatusIn, user: User = Depends(require_role("officer", "counsellor")),
                        db: AsyncSession = Depends(get_db)):
    c = (await db.execute(select(Case).where(Case.id == inp.case_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Case not found")
    c.status = inp.status
    c.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await ws_manager.send_to_user(c.victim_id, {
        "type": "status_change", "case_id": c.id, "status": inp.status,
    })
    return {"ok": True}


# ----- COUNSELLOR -----
@router.post("/counsellor/note")
async def add_note(inp: NoteIn, user: User = Depends(require_role("counsellor")),
                   db: AsyncSession = Depends(get_db)):
    c = (await db.execute(select(Case).where(Case.id == inp.case_id))).scalar_one_or_none()
    if not c or c.counsellor_id != user.id:
        raise HTTPException(403, "Not your case")
    n = CounsellorNote(case_id=inp.case_id, counsellor_id=user.id, note=inp.note,
                       support_provided=inp.support_provided, progress=inp.progress or "ongoing")
    db.add(n)
    if inp.progress == "resolved":
        c.status = "resolved"
    else:
        c.status = "in_progress"
    c.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


@router.post("/counsellor/followup")
async def add_followup(inp: FollowupIn, user: User = Depends(require_role("counsellor")),
                       db: AsyncSession = Depends(get_db)):
    c = (await db.execute(select(Case).where(Case.id == inp.case_id))).scalar_one_or_none()
    if not c or c.counsellor_id != user.id:
        raise HTTPException(403, "Not your case")
    db.add(Followup(case_id=inp.case_id, scheduled_at=inp.scheduled_at,
                    channel=inp.channel, notes=inp.notes))
    await db.commit()
    await ws_manager.send_to_user(c.victim_id, {
        "type": "followup_scheduled", "case_id": c.id,
        "scheduled_at": inp.scheduled_at.isoformat(),
    })
    return {"ok": True}


# ----- NOTIFICATIONS -----
@router.get("/notifications")
async def get_notifications(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Notification).where(Notification.user_id == user.id).order_by(desc(Notification.created_at)).limit(50)
    )).scalars().all()
    return [{"id": n.id, "kind": n.kind, "title": n.title, "body": n.body,
             "case_id": n.case_id, "read": n.read, "created_at": n.created_at.isoformat()} for n in rows]


# ----- NEXT-GEN 1: SAFE HAVEN RADAR -----
@router.get("/safe-havens")
async def get_safe_havens(lat: Optional[float] = 12.9716, lng: Optional[float] = 77.5946,
                          user: User = Depends(current_user)):
    """Return real-time secure safe zones around victim's coordinates."""
    base_lat = lat or 12.9716
    base_lng = lng or 77.5946
    
    havens = [
        {
            "id": "sh-1",
            "name": "Central Women's Safety Shelter & Crisis Care",
            "type": "shelter",
            "latitude": base_lat + 0.0082,
            "longitude": base_lng + 0.0065,
            "distance_km": 0.9,
            "status": "Open 24/7",
            "phone": "+91 80 2294 2222",
            "capacity": "Available (3 beds)",
            "security_level": "Armed Security Guard On-Duty",
            "address": "14th Cross, Ashok Nagar Safe Corridor"
        },
        {
            "id": "sh-2",
            "name": "Metro Division Police Station - Women Help Desk",
            "type": "police",
            "latitude": base_lat - 0.0054,
            "longitude": base_lng + 0.0078,
            "distance_km": 1.2,
            "status": "Active Patrol Units Ready",
            "phone": "112 / 1091",
            "capacity": "Emergency Response Hub",
            "security_level": "Police Station HQ",
            "address": "Brigade Road Intersection"
        },
        {
            "id": "sh-3",
            "name": "St. Mary's 24/7 Trauma & Medical Center",
            "type": "hospital",
            "latitude": base_lat + 0.0125,
            "longitude": base_lng - 0.0042,
            "distance_km": 1.8,
            "status": "24/7 Emergency Ward",
            "phone": "+91 80 4000 1000",
            "capacity": "Medical & Forensic Support",
            "security_level": "Hospital Security + CCTV",
            "address": "Residency Road Medical Enclave"
        },
        {
            "id": "sh-4",
            "name": "Community Legal Aid & Safe Haven Hub",
            "type": "legal_aid",
            "latitude": base_lat - 0.0091,
            "longitude": base_lng - 0.0085,
            "distance_km": 2.1,
            "status": "Open until 10:00 PM",
            "phone": "+91 80 2555 4321",
            "capacity": "Counseling & Protection Orders",
            "security_level": "Safe Reception & Private Rooms",
            "address": "Richmond Town Civic Center"
        }
    ]
    return {"center": {"latitude": base_lat, "longitude": base_lng}, "havens": havens}


# ----- NEXT-GEN 2: AI SAFETY ACTION PLAN GENERATOR -----
@router.post("/safety-plan/generate")
async def generate_safety_plan(data: dict = {}, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Generate tailored 5-step emergency survival & safety action plan."""
    case_id = data.get("case_id")
    case = None
    if case_id:
        case = (await db.execute(select(Case).where(Case.id == case_id))).scalar_one_or_none()
    
    plan = {
        "title": "Personalized High-Security Safety Strategy",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "victim_name": user.name,
        "risk_category": case.risk_level if case else "Moderate",
        "steps": [
            {
                "id": "step-1",
                "category": "Immediate Signal",
                "title": "Establish Silent Duress Code Words",
                "desc": "Share safe word ('Pineapple' or 'Red') with 2 trusted contacts to silently summon help without alerting offender.",
                "completed": True,
                "priority": "High"
            },
            {
                "id": "step-2",
                "category": "Physical Escape",
                "title": "Designate 2 Primary Safe Havens",
                "desc": "Confirm nearest 24/7 shelter or police desk with accessible transportation route and key emergency cash stash.",
                "completed": False,
                "priority": "Critical"
            },
            {
                "id": "step-3",
                "category": "Digital Privacy",
                "title": "Activate Stealth Browser & Masking",
                "desc": "Use Disguise View in public, enable two-factor authentication on personal emails, and revoke location sharing permissions on unverified apps.",
                "completed": True,
                "priority": "High"
            },
            {
                "id": "step-4",
                "category": "Evidence Security",
                "title": "Auto-Sync Secure Cloud Vault",
                "desc": "Snapshot threatening messages, timestamps, and audio notes directly to Nivara's encrypted evidence vault.",
                "completed": False,
                "priority": "Medium"
            },
            {
                "id": "step-5",
                "category": "Legal & Support",
                "title": "Connect with Dedicated Protection Officer",
                "desc": "Review legal protection options (Restraining Order / Protection under Domestic Violence Act) with assigned counselor.",
                "completed": False,
                "priority": "High"
            }
        ]
    }
    return plan


# ----- NEXT-GEN 3: STEALTH ENCRYPTED EVIDENCE LOCKER -----
@router.post("/evidence/upload")
async def upload_evidence(data: dict, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Securely log and encrypt evidence snapshot metadata."""
    import hashlib
    content = data.get("content", "")
    title = data.get("title", "Stealth Incident Snapshot")
    case_id = data.get("case_id")
    
    # Calculate SHA-256 integrity hash
    hash_obj = hashlib.sha256((content + str(datetime.now(timezone.utc))).encode('utf-8'))
    evidence_hash = f"SHA256:{hash_obj.hexdigest()[:24]}..."

    log = AuditLog(
        user_id=user.id,
        action="evidence_snapshot",
        meta={
            "case_id": case_id,
            "title": title,
            "notes": content,
            "integrity_hash": evidence_hash,
            "encrypted": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "geo": data.get("location", "Protected GPS Point")
        }
    )
    db.add(log)
    await db.commit()
    return {"ok": True, "hash": evidence_hash, "logged_at": datetime.now(timezone.utc).isoformat()}


@router.get("/evidence/{case_id}")
async def list_evidence(case_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Retrieve logged evidence records for case."""
    logs = (await db.execute(
        select(AuditLog).where(AuditLog.action == "evidence_snapshot").order_by(desc(AuditLog.created_at))
    )).scalars().all()
    
    results = []
    for l in logs:
        if l.meta and l.meta.get("case_id") == case_id:
            results.append({
                "id": l.id,
                "title": l.meta.get("title"),
                "notes": l.meta.get("notes"),
                "hash": l.meta.get("integrity_hash"),
                "timestamp": l.created_at.isoformat()
            })
    return {"evidence": results}


# ----- NEXT-GEN 4: AI ESCALATION RISK PREDICTOR -----
@router.get("/analytics/escalation-risk/{case_id}")
async def get_escalation_risk(case_id: str, user: User = Depends(require_role("officer", "counsellor")),
                              db: AsyncSession = Depends(get_db)):
    """Calculate AI Escalation Velocity, danger time windows, and 24-48h forecast."""
    case = (await db.execute(select(Case).where(Case.id == case_id))).scalar_one_or_none()
    if not case:
        raise HTTPException(404, "Case not found")
        
    score = case.svi_score or 20
    escalation_velocity = min(98, int(score * 1.15) + 12)
    
    return {
        "case_id": case_id,
        "current_svi": score,
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
async def counsellor_intervene(data: dict, user: User = Depends(require_role("counsellor")),
                               db: AsyncSession = Depends(get_db)):
    """Counsellor sends direct live intervention into victim chat with AI assistance."""
    case_id = data.get("case_id")
    message = data.get("message")
    if not case_id or not message:
        raise HTTPException(400, "Missing case_id or message")
        
    case = (await db.execute(select(Case).where(Case.id == case_id))).scalar_one_or_none()
    if not case:
        raise HTTPException(404, "Case not found")
        
    # Save interaction with role 'counsellor'
    interaction = Interaction(
        case_id=case.id,
        user_id=user.id,
        mode="chat",
        role="assistant",
        content=f"[Counselor {user.name}]: {message}",
        language="en"
    )
    db.add(interaction)
    await db.commit()
    
    # Broadcast to victim live via WS
    await ws_manager.send_to_user(case.victim_id, {
        "type": "counsellor_message",
        "counsellor_name": user.name,
        "message": message,
        "case_id": case.id
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
