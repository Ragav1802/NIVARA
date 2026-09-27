import os
import logging
from pathlib import Path

from fastapi import FastAPI
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from database import connect_db, close_db, get_db
from routes import router as api_router
from auth import hash_password
from models import make_user

app = FastAPI(title="Nivara API")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("nivara")


@app.on_event("startup")
async def on_startup():
    await connect_db()
    db = get_db()

    seeds = [
        ("victim@nivara.app",    "Aarti Sharma",             "victim",     "Password123", None,    None,    None),
        ("officer@nivara.app",   "Officer Ravi (Central)",   "officer",    "Password123", 12.9716, 77.5946, "Central Metro Sector"),
        ("officer2@nivara.app",  "Officer Suresh (North)",   "officer",    "Password123", 12.9910, 77.6100, "North City Sector"),
        ("officer3@nivara.app",  "Officer Anita (South)",    "officer",    "Password123", 12.9350, 77.5800, "South Suburbs Sector"),
        ("counsellor@nivara.app","Dr. Priya",                "counsellor", "Password123", None,    None,    None),
    ]

    for email, name, role, pw, lat, lng, duty in seeds:
        exists = await db.users.find_one({"email": email})
        if not exists:
            user_doc = make_user(
                email=email, name=name, password_hash=hash_password(pw),
                role=role, language="en", latitude=lat, longitude=lng, duty_area=duty
            )
            await db.users.insert_one(user_doc)

    logger.info("Nivara startup complete (MongoDB)")


@app.on_event("shutdown")
async def on_shutdown():
    await close_db()


@app.get("/api/health")
async def health():
    return {"status": "ok"}
