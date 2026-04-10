#!/usr/bin/env python3
"""Create initial GM account. Usage: python scripts/create_gm.py --email gm@test.com --password test1234"""
import asyncio
import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from passlib.context import CryptContext
from config import settings
from models.models import GMUser
from ulid import ULID

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


async def main(email: str, password: str):
    engine = create_async_engine(settings.DATABASE_URL)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as db:
        gm = GMUser(
            id=f"gm_{str(ULID())}",
            email=email,
            password_hash=pwd_ctx.hash(password),
        )
        db.add(gm)
        await db.commit()
    await engine.dispose()
    print(f"GM account created: {email}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()
    asyncio.run(main(args.email, args.password))
