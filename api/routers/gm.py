from fastapi import APIRouter, HTTPException, Request, Depends
from sqlalchemy import select
from passlib.context import CryptContext
from datetime import datetime, timezone
import secrets
from ulid import ULID

from models.models import World, GMUser
from schemas.world import WorldCreateRequest, WorldUpdateRequest

router = APIRouter()
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


async def get_current_gm(request: Request):
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, detail={"code": "INVALID_TOKEN", "message": "Missing GM token"})
    async with request.app.state.db_session() as db:
        result = await db.execute(select(GMUser).where(GMUser.token == token))
        gm = result.scalar_one_or_none()
    if not gm:
        raise HTTPException(401, detail={"code": "INVALID_TOKEN", "message": "Invalid GM token"})
    return gm


@router.post("/auth/login")
async def gm_login(request: Request):
    body = await request.json()
    async with request.app.state.db_session() as db:
        result = await db.execute(select(GMUser).where(GMUser.email == body.get("email")))
        gm = result.scalar_one_or_none()
    if not gm or not pwd_ctx.verify(body.get("password", ""), gm.password_hash):
        raise HTTPException(401, detail={"code": "INVALID_TOKEN", "message": "Invalid credentials"})

    new_token = f"gm_tok_{secrets.token_hex(24)}"
    async with request.app.state.db_session() as db:
        result = await db.execute(select(GMUser).where(GMUser.id == gm.id))
        gm_row = result.scalar_one_or_none()
        gm_row.token = new_token
        await db.commit()

    return {"ok": True, "data": {"gm_token": new_token}}


@router.post("/worlds")
async def create_world(req: WorldCreateRequest, request: Request, gm=Depends(get_current_gm)):
    world = World(
        id=f"wld_{str(ULID())}",
        name=req.name,
        slug=req.slug,
        difficulty=req.difficulty,
        description=req.description,
        baseline_time_ms=req.baseline_time_ms,
        baseline_tokens=req.baseline_tokens,
        time_limit_ms=req.time_limit_ms,
        status="draft",
    )
    async with request.app.state.db_session() as db:
        db.add(world)
        await db.commit()

    return {"ok": True, "data": {"world_id": world.id, "status": "draft"}}


@router.patch("/worlds/{world_id}")
async def update_world(world_id: str, req: WorldUpdateRequest, request: Request, gm=Depends(get_current_gm)):
    async with request.app.state.db_session() as db:
        result = await db.execute(select(World).where(World.id == world_id))
        world = result.scalar_one_or_none()
        if not world:
            raise HTTPException(404, detail={"code": "WORLD_NOT_FOUND", "message": "World not found"})
        if req.config is not None:
            world.config = req.config
        if req.name is not None:
            world.name = req.name
        if req.description is not None:
            world.description = req.description
        if req.difficulty is not None:
            world.difficulty = req.difficulty
        await db.commit()

    return {"ok": True, "data": {"world_id": world_id}}


@router.post("/worlds/{world_id}/publish")
async def publish_world(world_id: str, request: Request, gm=Depends(get_current_gm)):
    async with request.app.state.db_session() as db:
        result = await db.execute(select(World).where(World.id == world_id))
        world = result.scalar_one_or_none()
        if not world:
            raise HTTPException(404, detail={"code": "WORLD_NOT_FOUND", "message": "World not found"})
        if not world.config:
            raise HTTPException(400, detail={"code": "VALIDATION_ERROR", "message": "World config is empty"})
        world.status = "published"
        await db.commit()

    return {"ok": True, "data": {"world_id": world_id, "status": "published"}}


@router.get("/worlds/{world_id}/stats")
async def world_stats(world_id: str, request: Request, gm=Depends(get_current_gm)):
    from models.models import Score, Session
    from sqlalchemy import func

    async with request.app.state.db_session() as db:
        result = await db.execute(
            select(func.count(Score.id), func.avg(Score.final_score))
            .where(Score.world_id == world_id)
        )
        row = result.one()

    return {"ok": True, "data": {
        "world_id": world_id,
        "total_sessions": row[0] or 0,
        "avg_score": round(row[1] or 0, 2),
    }}


@router.get("/worlds")
async def list_worlds_gm(request: Request, gm=Depends(get_current_gm)):
    async with request.app.state.db_session() as db:
        result = await db.execute(select(World).order_by(World.created_at.desc()))
        worlds = result.scalars().all()

    return {"ok": True, "data": [
        {"id": w.id, "name": w.name, "slug": w.slug, "difficulty": w.difficulty, "status": w.status, "config": w.config}
        for w in worlds
    ]}
