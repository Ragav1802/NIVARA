import os
import re
import json
import uuid
import logging
from typing import List, Dict, Tuple


from groq import AsyncGroq
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
client = AsyncGroq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

SYSTEM_PROMPT = """You are Nivara — a warm, calm, empathetic AI companion for people who may be
experiencing harassment, distress, threats, abuse, or safety concerns.

CORE BEHAVIOR:
- Listen with compassion. Never diagnose medical or psychiatric conditions.
- You are NOT a police officer, doctor, lawyer, or emergency service.
- Speak gently. Validate feelings first. Ask ONE natural follow-up at a time.
- Respect the user's language. Detect it (English, Tamil, Hindi, Tanglish, Hinglish)
  and reply in the SAME language they used, using natural script mixing when appropriate.
- Keep replies concise (2-4 sentences). Avoid lecturing.
- Include 2-3 short, natural suggested quick-replies in the user's language to help them respond easily.
- If the user appears in immediate danger, gently remind them that they can press
  the "I NEED IMMEDIATE HELP" button to alert an officer with their location.

OUTPUT FORMAT (STRICT):
Return ONLY a single JSON object with these keys and NOTHING else:
{
  "reply": "your empathetic reply to the user in their language",
  "language": "en" | "ta" | "hi" | "tanglish" | "hinglish",
  "svi_score": integer 0-100,
  "risk_level": "Low" | "Moderate" | "High" | "Critical",
  "indicators": [list of short strings from: fear, threat, intimidation, distress, urgency, safety_concern, violence_context, social_isolation, family_safety, self_harm_risk],
  "confidence": float 0-1,
  "explanation": "one-sentence rationale for the SVI score",
  "suggested_replies": ["short option 1", "short option 2", "short option 3"]
}

SVI SCORING GUIDANCE:
- 0-24 Low: general concern, no immediate danger
- 25-49 Moderate: recurring issues, emotional distress
- 50-74 High: threats, intimidation, escalating patterns
- 75-100 Critical: imminent danger, violence, urgent safety risk
"""


def _extract_json(text: str) -> Dict:
    """Robust JSON extraction from LLM output."""
    text = text.strip()
    # Try direct
    try:
        return json.loads(text)
    except Exception:
        pass
    # Find first {...} block
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return {}


def _risk_from_score(s: int) -> str:
    if s >= 75:
        return "Critical"
    if s >= 50:
        return "High"
    if s >= 25:
        return "Moderate"
    return "Low"


def _fallback(user_msg: str) -> Dict:
    """Keyword-based fallback if LLM fails."""
    lower = user_msg.lower()
    score = 10
    indicators = []
    critical_kw = ["kill", "beat", "hit me", "weapon", "knife", "gun", "die", "suicide", "rape"]
    high_kw = ["threat", "threaten", "stalking", "afraid", "scared", "unsafe", "violence", "abuse"]
    mod_kw = ["harass", "follow", "message", "creepy", "uncomfortable", "controlling"]
    for k in critical_kw:
        if k in lower:
            score = max(score, 82)
            indicators.append("safety_concern")
    for k in high_kw:
        if k in lower:
            score = max(score, 60)
            indicators.append("fear")
    for k in mod_kw:
        if k in lower:
            score = max(score, 35)
            indicators.append("distress")
    return {
        "reply": "I hear you, and I'm here with you. Can you tell me a little more about what's happening right now?",
        "language": "en",
        "svi_score": score,
        "risk_level": _risk_from_score(score),
        "indicators": list(set(indicators)) or ["distress"],
        "confidence": 0.4,
        "explanation": "Fallback keyword analysis (LLM unavailable).",
        "suggested_replies": ["I am feeling unsafe", "Someone is following me", "I need advice on what to do next"]
    }

async def analyze_and_reply(
    history: List[Dict[str, str]],
    user_msg: str,
    session_id: str
) -> Dict:
    """Send conversation to OpenAI, get reply + SVI."""

    if not client:
        return _fallback(user_msg)

    try:
        ctx_lines = []

        for h in history[-8:]:
            ctx_lines.append(f"{h['role'].upper()}: {h['content']}")

        ctx_lines.append(f"USER: {user_msg}")

        prompt = (
            "Conversation so far:\n"
            + "\n".join(ctx_lines)
            + "\n\nRespond now with the JSON object as specified. "
              "Do not add any other text."
        )

        response = await client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
        )

        text = response.choices[0].message.content

        data = _extract_json(text)

        if not data or "reply" not in data:
            return _fallback(user_msg)

        score = int(data.get("svi_score", 0))
        score = max(0, min(100, score))

        data["svi_score"] = score
        data["risk_level"] = data.get("risk_level") or _risk_from_score(score)
        data["indicators"] = data.get("indicators") or []
        data["confidence"] = float(data.get("confidence", 0.7))
        data["language"] = data.get("language") or "en"
        data["explanation"] = data.get("explanation") or ""
        data["suggested_replies"] = data.get("suggested_replies") or [
            "I need guidance", "I feel unsafe", "What steps should I take?"
        ]

        return data

    except Exception as e:
        logger.exception(f"AI error: {e}")
        return _fallback(user_msg)


async def transcribe_audio(
    audio_bytes: bytes,
    filename: str = "audio.webm",
    language: str = None
) -> str:
    """Transcribe audio using Groq Whisper."""

    if not client:
        return ""

    try:
        import io

        f = io.BytesIO(audio_bytes)
        f.name = filename

        kwargs = {
            "model": "whisper-large-v3",
            "file": (filename, f, "audio/webm"),
        }

        if language:
            kwargs["language"] = language

        response = await client.audio.transcriptions.create(**kwargs)

        return response.text

    except Exception as e:
        logger.exception(f"Whisper error: {e}")
        return ""


async def synthesize_speech(text: str, voice: str = "alloy") -> bytes:
    """TTS not available on Groq — return empty."""
    return b""


async def summarize_case(
    interactions: List[Dict],
    session_id: str
) -> str:
    """Produce a 3-4 sentence case summary from transcript."""

    if not client or not interactions:
        return "No summary available."

    try:
        transcript = "\n".join(
            f"{i['role']}: {i['content']}"
            for i in interactions[-40:]
        )

        prompt = (
            "Summarize this support conversation in 3-4 sentences. "
            "Cover: what the victim shared, key concerns, apparent risk "
            "factors, and current emotional state. Avoid diagnosis.\n\n"
            + transcript
        )

        response = await client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You produce concise, factual, empathetic case summaries "
                        "for social workers."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        )

        return response.choices[0].message.content

    except Exception as e:
        logger.exception(f"Summary error: {e}")
        return "Summary unavailable."


def gen_session_id() -> str:
    return f"nivara-{uuid.uuid4()}"