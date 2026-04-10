from fastapi import APIRouter, HTTPException, Request, Query
from sqlalchemy import select
from typing import Optional

from models.models import World, Score, Session, Player

router = APIRouter()


@router.get("")
async def list_worlds(
    request: Request,
    difficulty: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=50),
):
    async with request.app.state.db_session() as db:
        q = select(World).where(World.status == "published")
        if difficulty:
            diffs = difficulty.split(",")
            q = q.where(World.difficulty.in_(diffs))
        q = q.offset((page - 1) * per_page).limit(per_page)
        result = await db.execute(q)
        worlds = result.scalars().all()

    return {"ok": True, "data": {
        "total": len(worlds),
        "page": page,
        "worlds": [
            {
                "id": w.id,
                "name": w.name,
                "slug": w.slug,
                "difficulty": w.difficulty,
                "description": w.description,
                "baseline_time_ms": w.baseline_time_ms,
                "baseline_tokens": w.baseline_tokens,
                "cover_image_url": w.cover_image_url,
            }
            for w in worlds
        ],
    }}


@router.get("/{world_id}/download")
async def download_world(world_id: str, request: Request):
    async with request.app.state.db_session() as db:
        result = await db.execute(select(World).where(World.id == world_id))
        world = result.scalar_one_or_none()

    if not world or world.status != "published":
        raise HTTPException(404, detail={"code": "WORLD_NOT_FOUND", "message": "World not found"})

    # In production this would generate a signed CDN URL + decrypt params.
    # For v1 we return the config directly (no CDN yet).
    return {"ok": True, "data": {
        "world_id": world.id,
        "version": "1.0.0",
        "config": world.config,
    }}
