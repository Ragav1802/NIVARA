import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base

MYSQL_URL = os.environ["MYSQL_URL"]

engine = create_async_engine(MYSQL_URL, echo=False, pool_pre_ping=True, pool_recycle=1800)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()


async def get_db():
    async with SessionLocal() as session:
        yield session
