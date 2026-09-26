import os
import logging
from pathlib import Path

from fastapi import FastAPI
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from database import engine, Base
import models  # noqa: F401 - register models
from routes import router as api_router
from auth import hash_password
from database import SessionLocal
from sqlalchemy import select
from models import User

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
    # Create tables if not exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Seed demo users if not present
    seeds = [
        ("victim@nivara.app", "Aarti Sharma", "victim", "Password123", None, None, None),
        ("officer@nivara.app", "Officer Ravi (Central)", "officer", "Password123", 12.9716, 77.5946, "Central Metro Sector"),
        ("officer2@nivara.app", "Officer Suresh (North)", "officer", "Password123", 12.9910, 77.6100, "North City Sector"),
        ("officer3@nivara.app", "Officer Anita (South)", "officer", "Password123", 12.9350, 77.5800, "South Suburbs Sector"),
        ("counsellor@nivara.app", "Dr. Priya", "counsellor", "Password123", None, None, None),
    ]
    async with SessionLocal() as db:
        for email, name, role, pw, lat, lng, duty in seeds:
            exists = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if not exists:
                db.add(User(email=email, name=name, role=role, password_hash=hash_password(pw), language="en", latitude=lat, longitude=lng, duty_area=duty))
        await db.commit()
    logger.info("Nivara startup complete")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
