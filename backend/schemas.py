from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, EmailStr, Field


class RegisterIn(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(min_length=6)
    role: str = Field(pattern="^(victim|officer|counsellor)$")
    language: str = "en"
    phone: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    language: str
    phone: Optional[str] = None


class TokenOut(BaseModel):
    token: str
    user: UserOut


class ChatIn(BaseModel):
    case_id: Optional[str] = None
    message: str
    language: Optional[str] = None


class ChatOut(BaseModel):
    case_id: str
    reply: str
    language: str
    svi_score: int
    risk_level: str
    indicators: List[str]
    confidence: Optional[float] = 0.7
    explanation: Optional[str] = None
    voice_analysis: Optional[Any] = None
    assessment: Optional[Any] = None
    recommendations: Optional[List[Any]] = None
    suggested_replies: Optional[List[str]] = None


class ConsentIn(BaseModel):
    kind: str  # voice | location | video
    granted: bool


class ConsentOut(BaseModel):
    id: str
    kind: str
    granted: bool
    created_at: datetime



class SOSIn(BaseModel):
    case_id: Optional[str] = None
    latitude: float
    longitude: float
    location_label: Optional[str] = None
    message: Optional[str] = None


class CaseOut(BaseModel):
    id: str
    victim_id: str
    victim_name: Optional[str] = None
    officer_id: Optional[str] = None
    counsellor_id: Optional[str] = None
    counsellor_name: Optional[str] = None
    title: str
    summary: Optional[str] = None
    svi_score: int
    risk_level: str
    priority: str
    status: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_label: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class InteractionOut(BaseModel):
    id: str
    role: str
    content: str
    mode: str
    language: Optional[str] = None
    created_at: datetime


class AssignIn(BaseModel):
    case_id: str
    counsellor_id: str
    notes: Optional[str] = None


class OfficerActionIn(BaseModel):
    case_id: str
    action: str
    notes: Optional[str] = None


class NoteIn(BaseModel):
    case_id: str
    note: str
    support_provided: Optional[str] = None
    progress: Optional[str] = "ongoing"


class FollowupIn(BaseModel):
    case_id: str
    scheduled_at: datetime
    channel: str = "in-app"
    notes: Optional[str] = None


class StatusIn(BaseModel):
    case_id: str
    status: str


class TTSIn(BaseModel):
    text: str
    voice: Optional[str] = "alloy"
