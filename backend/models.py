"""
MongoDB document helpers — replaces SQLAlchemy ORM models.
All collections use string UUIDs as '_id' for easy interop.
"""
import uuid
from datetime import datetime, timezone


def uid() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---- Document factory helpers ----

def make_user(email: str, name: str, password_hash: str, role: str,
              language: str = "en", phone: str = None,
              latitude: float = None, longitude: float = None,
              duty_area: str = None) -> dict:
    return {
        "_id": uid(),
        "email": email,
        "name": name,
        "password_hash": password_hash,
        "role": role,
        "language": language,
        "phone": phone,
        "latitude": latitude,
        "longitude": longitude,
        "duty_area": duty_area,
        "created_at": now_utc(),
    }


def make_case(victim_id: str, title: str = "New Case") -> dict:
    now = now_utc()
    return {
        "_id": uid(),
        "victim_id": victim_id,
        "officer_id": None,
        "counsellor_id": None,
        "title": title,
        "summary": None,
        "svi_score": 0,
        "risk_level": "Low",
        "priority": "normal",
        "status": "open",
        "latitude": None,
        "longitude": None,
        "location_label": None,
        "created_at": now,
        "updated_at": now,
    }


def make_interaction(case_id: str, user_id: str, mode: str, role: str,
                     content: str, language: str = None, audio_url: str = None) -> dict:
    return {
        "_id": uid(),
        "case_id": case_id,
        "user_id": user_id,
        "mode": mode,
        "role": role,
        "content": content,
        "language": language,
        "audio_url": audio_url,
        "created_at": now_utc(),
    }


def make_analysis_result(case_id: str, svi_score: int, risk_level: str,
                         confidence: float = 0.7, indicators=None, explanation: str = None) -> dict:
    return {
        "_id": uid(),
        "case_id": case_id,
        "svi_score": svi_score,
        "risk_level": risk_level,
        "confidence": confidence,
        "indicators": indicators or [],
        "explanation": explanation,
        "created_at": now_utc(),
    }


def make_officer_action(case_id: str, officer_id: str, action: str, notes: str = None) -> dict:
    return {
        "_id": uid(),
        "case_id": case_id,
        "officer_id": officer_id,
        "action": action,
        "notes": notes,
        "created_at": now_utc(),
    }


def make_counsellor_note(case_id: str, counsellor_id: str, note: str,
                         support_provided: str = None, progress: str = "ongoing") -> dict:
    return {
        "_id": uid(),
        "case_id": case_id,
        "counsellor_id": counsellor_id,
        "note": note,
        "support_provided": support_provided,
        "progress": progress,
        "created_at": now_utc(),
    }


def make_followup(case_id: str, scheduled_at: datetime, channel: str = "in-app",
                  notes: str = None) -> dict:
    return {
        "_id": uid(),
        "case_id": case_id,
        "scheduled_at": scheduled_at,
        "channel": channel,
        "notes": notes,
        "status": "scheduled",
        "created_at": now_utc(),
    }


def make_notification(user_id: str, kind: str, title: str, body: str = None,
                      case_id: str = None) -> dict:
    return {
        "_id": uid(),
        "user_id": user_id,
        "case_id": case_id,
        "kind": kind,
        "title": title,
        "body": body,
        "read": False,
        "created_at": now_utc(),
    }


def make_consent(user_id: str, kind: str, granted: bool = True) -> dict:
    return {
        "_id": uid(),
        "user_id": user_id,
        "kind": kind,
        "granted": granted,
        "created_at": now_utc(),
    }


def make_audit_log(user_id: str, action: str, meta: dict = None) -> dict:
    return {
        "_id": uid(),
        "user_id": user_id,
        "action": action,
        "meta": meta or {},
        "created_at": now_utc(),
    }


def make_voice_analysis(case_id: str, interaction_id: str = None, **fields) -> dict:
    return {
        "_id": uid(),
        "interaction_id": interaction_id,
        "case_id": case_id,
        "pitch_mean": fields.get("pitch_mean", 0.0),
        "pitch_variance": fields.get("pitch_variance", 0.0),
        "pitch_range": fields.get("pitch_range", 0.0),
        "speech_rate": fields.get("speech_rate", 0.0),
        "pause_count": fields.get("pause_count", 0),
        "average_pause": fields.get("average_pause", 0.0),
        "longest_pause": fields.get("longest_pause", 0.0),
        "silence_ratio": fields.get("silence_ratio", 0.0),
        "energy_mean": fields.get("energy_mean", 0.0),
        "energy_variance": fields.get("energy_variance", 0.0),
        "voice_stress_score": fields.get("voice_stress_score", 0),
        "stress_level": fields.get("stress_level", "LOW"),
        "indicators": fields.get("indicators", []),
        "created_at": now_utc(),
    }


def make_stress_assessment(case_id: str, interaction_id: str = None, **fields) -> dict:
    return {
        "_id": uid(),
        "interaction_id": interaction_id,
        "case_id": case_id,
        "text_score": fields.get("text_score", 0),
        "voice_score": fields.get("voice_score", 0),
        "safety_score": fields.get("safety_score", 0),
        "final_svi": fields.get("final_svi", 0),
        "risk_level": fields.get("risk_level", "Low"),
        "indicators": fields.get("indicators", []),
        "confidence": fields.get("confidence", 0.7),
        "score_breakdown": fields.get("score_breakdown", []),
        "created_at": now_utc(),
    }


def make_intervention_recommendation(case_id: str, assessment_id: str = None,
                                     recommendations=None, disclaimer: str = None) -> dict:
    return {
        "_id": uid(),
        "case_id": case_id,
        "assessment_id": assessment_id,
        "recommendations": recommendations or [],
        "disclaimer": disclaimer or "AI Recommendation — Human Review Required",
        "created_at": now_utc(),
    }
