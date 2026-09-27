import os
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "nivara")

client: AsyncIOMotorClient = None
db = None


def get_client() -> AsyncIOMotorClient:
    return client


def get_db():
    return db


async def connect_db():
    global client, db
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    # Create indexes
    await db.users.create_index("email", unique=True)
    await db.cases.create_index("victim_id")
    await db.cases.create_index("officer_id")
    await db.cases.create_index("counsellor_id")
    await db.interactions.create_index("case_id")
    await db.notifications.create_index("user_id")
    await db.audit_logs.create_index("user_id")
    await db.voice_analysis.create_index("case_id")
    await db.stress_assessment.create_index("case_id")
    await db.intervention_recommendation.create_index("case_id")
    await db.consents.create_index([("user_id", 1), ("kind", 1)])
    await db.followups.create_index("case_id")
    await db.counsellor_notes.create_index("case_id")
    await db.officer_actions.create_index("case_id")


async def close_db():
    global client
    if client:
        client.close()
