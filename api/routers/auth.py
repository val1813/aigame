from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
import secrets
from ulid import ULID

from models.models import Player
from schemas.auth import RegisterRequest, LoginRequest

router = APIRouter()
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _get_db(request: Request):
    return request.app.state.db_session()


async def get_current_player(request: Request):
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, detail={"code": "INVALID_TOKEN", "message": "Missing token"})
    async with request.app.state.db_session() as db:
        result = await db.execute(select(Player).where(Player.token == token))
        player = result.scalar_one_or_none()
    if not player:
        raise HTTPException(401, detail={"code": "INVALID_TOKEN", "message": "Invalid token"})
    if player.token_expires_at < datetime.now(timezone.utc):
        raise HTTPException(401, detail={"code": "INVALID_TOKEN", "message": "Token expired"})
    return player


@router.post("/register")
async def register(req: RegisterRequest, request: Request):
    async with request.app.state.db_session() as db:
        existing = await db.execute(select(Player).where(Player.email == req.email))
        if existing.scalar_one_or_none():
            raise HTTPException(409, detail={"code": "EMAIL_TAKEN", "message": "Email already registered"})

        player = Player(
            id=f"ply_{str(ULID())}",
            email=req.email,
            password_hash=pwd_ctx.hash(req.password),
            nickname=req.nickname,
            token=f"aw_tok_{secrets.token_hex(24)}",
            token_expires_at=datetime.now(timezone.utc) + timedelta(days=365),
        )
        db.add(player)
        await db.commit()

    return {"ok": True, "data": {
        "player_id": player.id,
        "player_token": player.token,
        "nickname": player.nickname,
    }}


@router.post("/login")
async def login(req: LoginRequest, request: Request):
    async with request.app.state.db_session() as db:
        result = await db.execute(select(Player).where(Player.email == req.email))
        player = result.scalar_one_or_none()

    if not player or not pwd_ctx.verify(req.password, player.password_hash):
        raise HTTPException(401, detail={"code": "INVALID_TOKEN", "message": "Invalid credentials"})

    return {"ok": True, "data": {
        "player_token": player.token,
        "expires_at": player.token_expires_at.isoformat(),
    }}


@router.post("/verify")
async def verify(player: Player = Depends(get_current_player)):
    return {"ok": True, "data": {
        "player_id": player.id,
        "nickname": player.nickname,
        "valid_until": player.token_expires_at.isoformat(),
    }}
