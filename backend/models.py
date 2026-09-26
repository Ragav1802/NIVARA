import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, Text, DateTime, ForeignKey, JSON, Boolean
from sqlalchemy.orm import relationship
from database import Base


def uid():
    return str(uuid.uuid4())


def now_utc():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id = Column(String(36), primary_key=True, default=uid)
    email = Column(String(191), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False)  # victim | officer | counsellor
    language = Column(String(10), default="en")
    phone = Column(String(30), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    duty_area = Column(String(120), nullable=True)
    created_at = Column(DateTime, default=now_utc)


class Case(Base):
    __tablename__ = "cases"
    id = Column(String(36), primary_key=True, default=uid)
    victim_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    officer_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    counsellor_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    title = Column(String(255), nullable=False, default="New Case")
    summary = Column(Text, nullable=True)
    svi_score = Column(Integer, default=0)
    risk_level = Column(String(20), default="Low")
    priority = Column(String(20), default="normal")  # normal | emergency
    status = Column(String(30), default="open")  # open | assigned | in_progress | resolved
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    location_label = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=now_utc)
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc)


class Interaction(Base):
    __tablename__ = "interactions"
    id = Column(String(36), primary_key=True, default=uid)
    case_id = Column(String(36), ForeignKey("cases.id"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    mode = Column(String(20), nullable=False)  # chat | voice
    role = Column(String(20), nullable=False)  # user | assistant | system
    content = Column(Text, nullable=False)
    language = Column(String(20), nullable=True)
    audio_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=now_utc)


class AnalysisResult(Base):
    __tablename__ = "analysis_results"
    id = Column(String(36), primary_key=True, default=uid)
    case_id = Column(String(36), ForeignKey("cases.id"), nullable=False)
    svi_score = Column(Integer, nullable=False)
    risk_level = Column(String(20), nullable=False)
    confidence = Column(Float, default=0.7)
    indicators = Column(JSON, nullable=True)
    explanation = Column(Text, nullable=True)
    created_at = Column(DateTime, default=now_utc)


class OfficerAction(Base):
    __tablename__ = "officer_actions"
    id = Column(String(36), primary_key=True, default=uid)
    case_id = Column(String(36), ForeignKey("cases.id"), nullable=False)
    officer_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    action = Column(String(80), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=now_utc)


class CounsellorNote(Base):
    __tablename__ = "counsellor_notes"
    id = Column(String(36), primary_key=True, default=uid)
    case_id = Column(String(36), ForeignKey("cases.id"), nullable=False)
    counsellor_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    note = Column(Text, nullable=False)
    support_provided = Column(String(255), nullable=True)
    progress = Column(String(50), default="ongoing")
    created_at = Column(DateTime, default=now_utc)


class Followup(Base):
    __tablename__ = "followups"
    id = Column(String(36), primary_key=True, default=uid)
    case_id = Column(String(36), ForeignKey("cases.id"), nullable=False)
    scheduled_at = Column(DateTime, nullable=False)
    channel = Column(String(30), default="in-app")
    notes = Column(Text, nullable=True)
    status = Column(String(30), default="scheduled")
    created_at = Column(DateTime, default=now_utc)


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(String(36), primary_key=True, default=uid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    case_id = Column(String(36), ForeignKey("cases.id"), nullable=True)
    kind = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=True)
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_utc)


class Consent(Base):
    __tablename__ = "consents"
    id = Column(String(36), primary_key=True, default=uid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    kind = Column(String(50), nullable=False)  # voice | location | video
    granted = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_utc)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(String(36), primary_key=True, default=uid)
    user_id = Column(String(36), nullable=True)
    action = Column(String(120), nullable=False)
    meta = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=now_utc)


class VoiceAnalysis(Base):
    __tablename__ = "voice_analysis"
    id = Column(String(36), primary_key=True, default=uid)
    interaction_id = Column(String(36), nullable=True)
    case_id = Column(String(36), ForeignKey("cases.id"), nullable=False)
    pitch_mean = Column(Float, default=0.0)
    pitch_variance = Column(Float, default=0.0)
    pitch_range = Column(Float, default=0.0)
    speech_rate = Column(Float, default=0.0)
    pause_count = Column(Integer, default=0)
    average_pause = Column(Float, default=0.0)
    longest_pause = Column(Float, default=0.0)
    silence_ratio = Column(Float, default=0.0)
    energy_mean = Column(Float, default=0.0)
    energy_variance = Column(Float, default=0.0)
    voice_stress_score = Column(Integer, default=0)
    stress_level = Column(String(20), default="LOW")
    indicators = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=now_utc)


class StressAssessment(Base):
    __tablename__ = "stress_assessment"
    id = Column(String(36), primary_key=True, default=uid)
    interaction_id = Column(String(36), nullable=True)
    case_id = Column(String(36), ForeignKey("cases.id"), nullable=False)
    text_score = Column(Integer, default=0)
    voice_score = Column(Integer, default=0)
    safety_score = Column(Integer, default=0)
    final_svi = Column(Integer, default=0)
    risk_level = Column(String(20), default="Low")
    indicators = Column(JSON, nullable=True)
    confidence = Column(Float, default=0.7)
    score_breakdown = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=now_utc)


class InterventionRecommendation(Base):
    __tablename__ = "intervention_recommendation"
    id = Column(String(36), primary_key=True, default=uid)
    case_id = Column(String(36), ForeignKey("cases.id"), nullable=False)
    assessment_id = Column(String(36), nullable=True)
    recommendations = Column(JSON, nullable=True)
    disclaimer = Column(String(255), default="AI Recommendation — Human Review Required")
    created_at = Column(DateTime, default=now_utc)

