from fastapi import APIRouter, HTTPException, Request, Query
from sqlalchemy import select, func
from typing import Optional

from models.models import Score, World, Player, Session

router = APIRouter()


@router.get("")
async def get_leaderboard(
    request: Request,
    world_id: Optional[str] = Query(None),
    type: str = Query("pure_ai"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    grade: Optional[str] = Query(None),
):
    async with request.app.state.db_session() as db:
        q = (
            select(Score, Player, Session, World)
            .join(Player, Score.player_id == Player.id)
            .join(Session, Score.session_id == Session.id)
            .join(World, Score.world_id == World.id)
            .where(Score.audit_status.in_(["pending", "pass"]))
            .where(Score.leaderboard_type == type)
            .order_by(Score.final_score.desc())
        )
        if world_id:
            q = q.where(Score.world_id == world_id)
        if grade:
            q = q.where(Score.grade == grade)

        offset = (page - 1) * limit
        q_paged = q.offset(offset).limit(limit)
        result = await db.execute(q_paged)
        rows = result.all()

        # total count
        count_q = select(func.count()).select_from(
            select(Score.id)
            .where(Score.audit_status.in_(["pending", "pass"]))
            .where(Score.leaderboard_type == type)
        )
        if world_id:
            count_q = select(func.count()).select_from(
                select(Score.id)
                .where(Score.audit_status.in_(["pending", "pass"]))
                .where(Score.leaderboard_type == type)
                .where(Score.world_id == world_id)
            )
        total_result = await db.execute(count_q)
        total = total_result.scalar() or 0

        # model distribution
        dist_q = (
            select(Score.model_name, func.count(Score.id).label("cnt"))
            .where(Score.audit_status.in_(["pending", "pass"]))
            .where(Score.leaderboard_type == type)
            .where(Score.model_name.isnot(None))
            .group_by(Score.model_name)
            .order_by(func.count(Score.id).desc())
            .limit(10)
        )
        if world_id:
            dist_q = dist_q.where(Score.world_id == world_id)
        dist_result = await db.execute(dist_q)
        dist_rows = dist_result.all()

    # Build model distribution
    dist_total = sum(r.cnt for r in dist_rows) or 1
    model_distribution = {}
    other_cnt = 0
    for i, r in enumerate(dist_rows):
        if i < 4:
            key = r.model_name.split("-20")[0] if r.model_name else "unknown"
            model_distribution[key] = round(r.cnt / dist_total, 2)
        else:
            other_cnt += r.cnt
    if other_cnt:
        model_distribution["other"] = round(other_cnt / dist_total, 2)

    entries = []
    for rank_offset, (score, player, session, world) in enumerate(rows, offset + 1):
        bd = score.breakdown or {}
        entry = {
            "rank": rank_offset,
            "nickname": player.nickname,
            "model_name": score.model_name,
            "model_provider": score.model_provider,
            "score": score.final_score,
            "grade": score.grade,
            "turns": bd.get("total_turns", session.current_turn or 0),
            "elapsed_sec": bd.get("elapsed_ms", 0) // 1000,
            "traps_hit": bd.get("traps_hit", 0),
            "memory_test": bd.get("memory_test", "?"),
            "code_test": bd.get("code_test", "?"),
            "created_at": score.scored_at.isoformat() if score.scored_at else None,
        }
        if not world_id:
            entry["world_name"] = world.name
        entries.append(entry)

    return {"ok": True, "data": {
        "leaderboard_type": type,
        "entries": entries,
        "model_distribution": model_distribution,
        "total": total,
        "page": page,
    }}


@router.get("/{world_id}")
async def get_leaderboard_by_world(
    world_id: str,
    request: Request,
    type: str = Query("pure_ai"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    grade: Optional[str] = Query(None),
):
    async with request.app.state.db_session() as db:
        result2 = await db.execute(select(World).where(World.id == world_id))
        world = result2.scalar_one_or_none()
    if not world:
        raise HTTPException(404, detail={"code": "WORLD_NOT_FOUND", "message": "World not found"})

    return await get_leaderboard(request, world_id=world_id, type=type, page=page, limit=limit, grade=grade)
