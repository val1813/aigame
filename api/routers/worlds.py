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

    # 只返回地图渲染数据，不返回NPC状态机、物品详情、答案等
    cfg = world.config or {}
    map_data = cfg.get("map", {})
    safe_config = {
        "map": {
            "width": map_data.get("width", 80),
            "height": map_data.get("height", 8),
            "tiles": map_data.get("tiles", []),
            "fov_radius": map_data.get("fov_radius", 12),
            "spawn_point": map_data.get("spawn_point", {"x": 1, "y": 4}),
            "zones": [
                {"id": z["id"], "name": z.get("name", z["id"])}
                for z in map_data.get("zones", [])
            ],
        },
        "meta": {
            "name": cfg.get("meta", {}).get("name", world.name),
            "difficulty": cfg.get("meta", {}).get("difficulty", world.difficulty),
            "description": cfg.get("meta", {}).get("description", world.description),
        },
    }

    return {"ok": True, "data": {
        "world_id": world.id,
        "version": "1.0.0",
        "config": safe_config,
    }}
