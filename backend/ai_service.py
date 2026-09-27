import os
import re
import json
import uuid
import logging
from typing import List, Dict, Tuple, Optional

from groq import AsyncGroq
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()


def _get_groq_client() -> AsyncGroq:
    key = os.environ.get("GROQ_API_KEY", "")
    return AsyncGroq(api_key=key) if key else None


SYSTEM_PROMPT = """You are Nivara — a warm, calm, empathetic AI companion for individuals facing harassment, distress, domestic violence, threats, or safety concerns.

CORE BEHAVIOR:
- Listen with compassion. Never diagnose medical or psychiatric conditions.
- You are NOT a police officer, doctor, lawyer, or emergency service.
- Speak gently. Validate feelings first. Ask ONE natural, interactive follow-up question based on their message.
- MULTILINGUAL EMPOWERMENT:
  Detect the user's language and script:
  1. English ("en")
  2. Tamil script ("ta") e.g., "எனக்கு பயமாக இருக்கிறது"
  3. Hindi script ("hi") e.g., "मुझे डर लग रहा है"
  4. Tanglish ("tanglish") - Tamil written in English script e.g., "enaku bayama irukku, enna panradhu"
  5. Hinglish ("hinglish") - Hindi written in English script e.g., "mujhe dar lag raha hai, kya karu"
- ALWAYS REPLY IN THE EXACT SAME LANGUAGE, SCRIPT, AND DIALECT MIX THAT THE USER USED.
  - If Tanglish -> Reply in warm, natural Tanglish.
  - If Hinglish -> Reply in empathetic, natural Hinglish.
  - If Tamil -> Reply in clear, supportive Tamil script.
  - If Hindi -> Reply in supportive Hindi script.
- Keep replies concise (2-4 sentences). Avoid repetitive stock sentences. Adapt dynamically to each user's unique situation.
- Include 2-3 short, natural suggested quick-replies in the SAME language/script as your reply.

OUTPUT FORMAT (STRICT):
Return ONLY a valid JSON object with NO markdown or extra text:
{
  "reply": "your empathetic interactive reply",
  "language": "en" | "ta" | "hi" | "tanglish" | "hinglish",
  "svi_score": integer 0-100,
  "risk_level": "Low" | "Moderate" | "High" | "Critical",
  "indicators": ["fear", "threat", "intimidation", "distress", "urgency", "safety_concern"],
  "confidence": 0.85,
  "explanation": "one sentence explanation for the SVI score",
  "suggested_replies": ["short option 1", "short option 2", "short option 3"]
}
"""


def _extract_json(text: str) -> Dict:
    """Robust JSON extraction from LLM output."""
    if not text:
        return {}
    text = text.strip()

    # Remove markdown code blocks if present (e.g. ```json ... ```)
    if "```" in text:
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()

    # Try direct parse
    try:
        return json.loads(text)
    except Exception:
        pass

    # Find first {...} block
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        candidate = m.group(0)
        try:
            return json.loads(candidate)
        except Exception:
            # Fix trailing commas inside JSON arrays/objects
            cleaned = re.sub(r",\s*([\]}])", r"\1", candidate)
            try:
                return json.loads(cleaned)
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
    """Keyword-based fallback if LLM is unreachable."""
    lower = user_msg.lower()
    score = 15
    indicators = []
    critical_kw = ["kill", "beat", "hit me", "weapon", "knife", "gun", "die", "suicide", "rape", "choke"]
    high_kw = ["threat", "threaten", "stalking", "afraid", "scared", "unsafe", "violence", "abuse", "bayam", "dar"]
    mod_kw = ["harass", "follow", "message", "creepy", "uncomfortable", "controlling", "help"]

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
        "reply": f"I hear you. You mentioned '{user_msg[:40]}...'. I am right here with you. Can you share a bit more about what you are experiencing right now?",
        "language": "en",
        "svi_score": score,
        "risk_level": _risk_from_score(score),
        "indicators": list(set(indicators)) or ["distress"],
        "confidence": 0.5,
        "explanation": "Keyword analysis fallback.",
        "suggested_replies": ["I feel unsafe right now", "Someone is harassing me", "Tell me what steps to take"]
    }


CANDIDATE_CHAT_MODELS = [
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "allam-2-7b"
]


async def _create_chat_completion(client: AsyncGroq, messages: List[Dict], temperature: float = 0.5):
    """Helper to try candidate models sequentially until one succeeds."""
    last_error = None
    for model_name in CANDIDATE_CHAT_MODELS:
        try:
            res = await client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=temperature,
            )
            return res
        except Exception as e:
            logger.warning(f"Groq model {model_name} failed: {e}")
            last_error = e
    if last_error:
        raise last_error
    raise RuntimeError("No Groq models available")


async def analyze_and_reply(
    history: List[Dict[str, str]],
    user_msg: str,
    session_id: str
) -> Dict:
    """Send conversation to Groq model, get interactive reply + SVI."""

    client = _get_groq_client()
    if not client:
        return _fallback(user_msg)

    try:
        ctx_lines = []
        for h in history[-8:]:
            ctx_lines.append(f"{h['role'].upper()}: {h['content']}")

        ctx_lines.append(f"USER: {user_msg}")

        prompt = (
            "Conversation history:\n"
            + "\n".join(ctx_lines)
            + "\n\nAnalyze the latest user message and respond in JSON as specified."
        )

        response = await _create_chat_completion(
            client=client,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.5,
        )

        raw_text = response.choices[0].message.content or ""
        data = _extract_json(raw_text)

        # If LLM returned text instead of structured JSON, wrap raw text as response
        if not data or "reply" not in data or not str(data.get("reply")).strip():
            clean_reply = re.sub(r"```.*", "", raw_text).strip()
            if clean_reply:
                data = {
                    "reply": clean_reply,
                    "language": "en",
                    "svi_score": 25,
                    "risk_level": "Low",
                    "indicators": ["distress"],
                    "confidence": 0.7,
                    "explanation": "Direct response from AI assistant.",
                    "suggested_replies": ["I need help", "I am feeling scared", "What should I do?"]
                }
            else:
                return _fallback(user_msg)

        score = int(data.get("svi_score", 15))
        score = max(0, min(100, score))

        data["svi_score"] = score
        data["risk_level"] = data.get("risk_level") or _risk_from_score(score)
        data["indicators"] = data.get("indicators") or ["distress"]
        data["confidence"] = float(data.get("confidence", 0.8))
        data["language"] = data.get("language") or "en"
        data["explanation"] = data.get("explanation") or "Contextual NLP evaluation."
        data["suggested_replies"] = data.get("suggested_replies") or [
            "I need guidance", "I feel unsafe", "What steps should I take?"
        ]

        return data

    except Exception as e:
        logger.exception(f"Groq AI error: {e}")
        return _fallback(user_msg)


WHISPER_HALLUCINATIONS = {
    "thank you for watching", "thanks for watching",
    "subtitles by", "amara org", "like and subscribe", "subscribe to my channel",
    "please subscribe", "mbc news", "www mooji org", "coughing", "laughter",
    "cheering", "applause", "music", "silence", "blank", "thank you", "thanks",
    "bye", "you", "so", "oh", "uh"
}


def _is_whisper_hallucination(text: str) -> bool:
    if not text:
        return True
    cleaned = re.sub(r"[^\w\s]", "", text).strip().lower()
    if not cleaned:
        return True
    if cleaned in WHISPER_HALLUCINATIONS:
        return True
    if any(h in cleaned for h in ["subtitles by", "amara org", "thank you for watching", "thanks for watching", "like and subscribe"]):
        return True
    return False


from openai import AsyncOpenAI


def _get_openai_client() -> Optional[AsyncOpenAI]:
    key = os.environ.get("OPENAI_API_KEY", "")
    return AsyncOpenAI(api_key=key) if key else None


async def transcribe_audio(
    audio_bytes: bytes,
    filename: str = "audio.webm",
    language: str = None
) -> str:
    """Transcribe audio using Groq Whisper API with fallback to OpenAI Whisper."""

    if not audio_bytes:
        return ""

    mime_map = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".mp4": "audio/mp4",
        ".ogg": "audio/ogg",
        ".webm": "audio/webm",
    }
    ext = os.path.splitext(filename)[1].lower()
    content_type = mime_map.get(ext, "audio/webm")

    # 1. Try Groq Whisper models FIRST (fast, active Groq API key)
    client = _get_groq_client()
    if client:
        for whisper_model in ["whisper-large-v3-turbo", "whisper-large-v3"]:
            try:
                import io

                f = io.BytesIO(audio_bytes)
                f.name = filename

                kwargs = {
                    "model": whisper_model,
                    "file": (filename, f, content_type),
                    "prompt": "User speaking in English, Tamil, Hindi, Tanglish, or Hinglish expressing feelings, concerns, or safety situation."
                }

                if language:
                    clean_lang = language.split("-")[0].lower()
                    if clean_lang in ["en", "ta", "hi", "te", "ml", "kn", "mr", "gu", "bn"]:
                        kwargs["language"] = clean_lang

                response = await client.audio.transcriptions.create(**kwargs)
                text = (response.text or "").strip()
                if text and not _is_whisper_hallucination(text):
                    return text
            except Exception as e:
                logger.warning(f"Groq Whisper model {whisper_model} error: {e}")

    # 2. Fallback to OpenAI Whisper API if Groq is unavailable
    openai_client = _get_openai_client()
    if openai_client:
        try:
            import io
            f = io.BytesIO(audio_bytes)
            f.name = filename
            kwargs = {
                "model": "whisper-1",
                "file": (filename, f, content_type),
                "prompt": "User speaking in English, Tamil, Hindi, Tanglish, or Hinglish expressing feelings, concerns, or safety situation."
            }
            if language:
                clean_lang = language.split("-")[0].lower()
                if clean_lang in ["en", "ta", "hi", "te", "ml", "kn", "mr", "gu", "bn"]:
                    kwargs["language"] = clean_lang
            response = await openai_client.audio.transcriptions.create(**kwargs)
            text = (response.text or "").strip()
            if text and not _is_whisper_hallucination(text):
                return text
        except Exception as e:
            logger.warning(f"OpenAI Whisper error: {e}")

    return ""


async def synthesize_speech(text: str, voice: str = "alloy") -> bytes:
    """TTS placeholder."""
    return b""


async def summarize_case(
    interactions: List[Dict],
    session_id: str
) -> str:
    """Produce a 3-4 sentence case summary from transcript."""

    client = _get_groq_client()
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

        response = await _create_chat_completion(
            client=client,
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

        return response.choices[0].message.content or "Summary completed."

    except Exception as e:
        logger.exception(f"Summary error: {e}")
        return "Summary unavailable."


def gen_session_id() -> str:
    return f"nivara-{uuid.uuid4()}"