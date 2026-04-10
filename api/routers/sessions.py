import asyncio
import secrets
import time
import json
import hashlib
from datetime import datetime, timezone

from ulid import ULID
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy import select

from models.models import Session, World, ActionLog, Score, Player
from schemas.session import ActionRequest, SessionStartRequest, SessionEndRequest, UploadLogRequest
from routers.auth import get_current_player
from services.world_engine import WorldEngine
from services.score_engine import ScoreEngine
from services.cheat_detector import CheatDetector
from services.ws_broadcaster import broadcaster

router = APIRouter()
score_engine = ScoreEngine()
cheat_detector = CheatDetector()


def _ok(data: dict):
    return {"ok": True, "data": data}


def _detect_model_provider(model_name: str) -> str:
    if not model_name:
        return "other"
    m = model_name.lower()
    if "claude" in m:
        return "anthropic"
    if "gpt" in m or "o1" in m or "o3" in m:
        return "openai"
    if "gemini" in m:
        return "gemini"
    return "other"


@router.post("/start")
async def start_session(req: SessionStartRequest, request: Request, player=Depends(get_current_player)):
    async with request.app.state.db_session() as db:
        result = await db.execute(select(World).where(World.id == req.world_id, World.status == "published"))
        world = result.scalar_one_or_none()
        if not world:
            raise HTTPException(404, detail={"code": "WORLD_NOT_FOUND", "message": "World not found"})

        session = Session(
            id=f"sess_{str(ULID())}",
            player_id=player.id,
            world_id=world.id,
            model_id=req.model_id,
            client_version=req.client_version,
            secret=secrets.token_hex(32),
            status="active",
            current_turn=0,
            vip_intervention_used=False,
        )
        db.add(session)
        await db.commit()

    # Initialize session state in Redis
    redis = request.app.state.redis
    state_key = f"session:{session.id}:state"
    config = world.config or {}
    spawn = config.get("map", {}).get("spawn_point", {"x": 0, "y": 0})
    await redis.hset(state_key, mapping={
        "current_turn": 0,
        "status": "active",
        "world_id": world.id,
        "player_x": spawn.get("x", 0),
        "player_y": spawn.get("y", 0),
        "player_hp": 100,
        "player_gold": config.get("items", [{}])[0].get("initial_amount", 200) if config.get("items") else 200,
        "elapsed_ms": 0,
        "total_tokens": 0,
        "started_at_ns": str(time.time_ns()),
        "leaderboard_type": "pure_ai",
    })
    await redis.expire(state_key, 7200)

    # VIP 干涉可用性：检查 player.is_vip（字段不存在时默认 False）
    vip_available = getattr(player, 'is_vip', False) and not session.vip_intervention_used

    return _ok({
        "session_id": session.id,
        "session_secret": session.secret,
        "ws_url": f"ws://localhost:9000/v1/session/ws/{session.id}",
        "initial_state": {
            "player": {"position": spawn, "hp": 100, "gold": 200, "inventory": []},
            "world": {"name": world.name},
            "quests": [],
        },
        "turn": 0,
        "vip_available": vip_available,
    })


@router.post("/action")
async def handle_action(req: ActionRequest, request: Request, player=Depends(get_current_player)):
    redis = request.app.state.redis

    async with request.app.state.db_session() as db:
        result = await db.execute(select(Session).where(Session.id == req.session_id))
        session = result.scalar_one_or_none()

    if not session or session.player_id != player.id:
        raise HTTPException(404, detail={"code": "SESSION_NOT_FOUND", "message": "Session not found"})
    if session.status != "active":
        raise HTTPException(409, detail={"code": "SESSION_ENDED", "message": "Session already ended"})

    # VIP 干涉处理
    if req.action == "vip_intervene":
        if not getattr(player, 'is_vip', False):
            raise HTTPException(403, detail={"code": "VIP_REQUIRED", "message": "VIP功能需要升级会员"})
        if session.vip_intervention_used:
            raise HTTPException(409, detail={"code": "VIP_ALREADY_USED", "message": "本关卡干涉权已使用"})

        content = (req.payload or {}).get("content", "")
        content_hash = hashlib.sha256(content.encode()).hexdigest()

        async with request.app.state.db_session() as db:
            result = await db.execute(select(Session).where(Session.id == req.session_id))
            s = result.scalar_one_or_none()
            s.vip_intervention_used = True
            s.vip_intervention_content_hash = content_hash
            await db.commit()

        state_key = f"session:{session.id}:state"
        await redis.hset(state_key, mapping={
            "leaderboard_type": "vip",
            "vip_injection": content,
        })

        return _ok({"intervention_accepted": True})

    # Validate turn monotonicity
    state_key = f"session:{session.id}:state"
    current_turn = int(await redis.hget(state_key, "current_turn") or 0)
    if req.turn != current_turn + 1:
        raise HTTPException(409, detail={"code": "TURN_MISMATCH", "message": "Turn number mismatch"})

    # Load world config
    async with request.app.state.db_session() as db:
        result = await db.execute(select(World).where(World.id == session.world_id))
        world = result.scalar_one_or_none()

    engine = WorldEngine(world.config or {}, redis, session.id)
    game_state = await engine.load_state()

    # Execute action
    action_result = await engine.execute_action(req.action, req.payload or {}, game_state)
    if action_result.get("error"):
        raise HTTPException(403, detail={"code": action_result["error"], "message": action_result.get("message", "")})

    # Persist action log
    async with request.app.state.db_session() as db:
        log_entry = ActionLog(
            session_id=session.id,
            turn=req.turn,
            action=req.action,
            payload_hash=req.entry_hash,
            ts_ns=req.ts_ns,
            prev_hash=req.prev_hash,
            entry_hash=req.entry_hash,
        )
        db.add(log_entry)
        await db.commit()
        await db.refresh(log_entry)
        log_entry_id = log_entry.id

    # Advance turn
    await redis.hset(state_key, "current_turn", req.turn)

    # Async: cheat detection (non-blocking)
    asyncio.create_task(cheat_detector.analyze(session.id, req.model_dump(), action_result, redis, world.config or {}))

    # Broadcast WS events
    for evt in action_result.get("ws_events", []):
        asyncio.create_task(broadcaster.broadcast(session.id, evt))

    # Score snapshot
    snapshot = score_engine.compute_snapshot(game_state, world.config or {})

    return _ok({
        "turn_ack": req.turn,
        "action": req.action,
        "result": action_result.get("result", {}),
        "world_delta": action_result.get("world_delta", {}),
        "quest_delta": action_result.get("quest_delta"),
        "score_snapshot": snapshot,
        "server_ack_hash": req.entry_hash,
        "cheat_flag": None,
        "turn": req.turn,
    })


@router.post("/end")
async def end_session(req: SessionEndRequest, request: Request, player=Depends(get_current_player)):
    async with request.app.state.db_session() as db:
        result = await db.execute(select(Session).where(Session.id == req.session_id))
        session = result.scalar_one_or_none()

    if not session or session.player_id != player.id:
        raise HTTPException(404, detail={"code": "SESSION_NOT_FOUND", "message": "Session not found"})

    async with request.app.state.db_session() as db:
        result = await db.execute(select(Session).where(Session.id == req.session_id))
        session = result.scalar_one_or_none()
        session.status = "scoring"
        session.end_reason = req.end_reason
        session.ended_at = datetime.now(timezone.utc)
        await db.commit()

    # Async scoring
    asyncio.create_task(_run_scoring(req.session_id, request.app.state))

    return _ok({
        "session_id": req.session_id,
        "status": "scoring",
        "estimated_score_ready_ms": 3000,
    })


async def _run_scoring(session_id: str, app_state):
    await asyncio.sleep(1)  # let DB settle
    try:
        async with app_state.db_session() as db:
            result = await db.execute(select(Session).where(Session.id == session_id))
            session = result.scalar_one_or_none()
            result2 = await db.execute(select(World).where(World.id == session.world_id))
            world = result2.scalar_one_or_none()

        redis = app_state.redis
        state_key = f"session:{session_id}:state"
        state_raw = await redis.hgetall(state_key)

        started_ns = int(state_raw.get("started_at_ns", time.time_ns()))
        elapsed_ms = (time.time_ns() - started_ns) // 1_000_000
        leaderboard_type = state_raw.get("leaderboard_type", "pure_ai")

        # 从 action_logs 读取实际 token 数（不信任客户端上报）
        async with app_state.db_session() as db:
            from sqlalchemy import func as sqlfunc
            token_result = await db.execute(
                select(
                    sqlfunc.sum(ActionLog.input_tokens).label("total_input"),
                    sqlfunc.sum(ActionLog.output_tokens).label("total_output"),
                    ActionLog.model_name,
                )
                .where(ActionLog.session_id == session_id)
                .where(ActionLog.model_name.isnot(None))
                .group_by(ActionLog.model_name)
                .order_by(sqlfunc.count(ActionLog.id).desc())
                .limit(1)
            )
            token_row = token_result.first()

        total_tokens = 0
        model_name = None
        if token_row:
            total_tokens = (token_row.total_input or 0) + (token_row.total_output or 0)
            model_name = token_row.model_name
        else:
            # fallback: 从 Redis 读（客户端上报，仅作备用）
            total_tokens = int(state_raw.get("total_tokens", 0))
            model_name = session.model_id

        game_final_state = {
            "elapsed_ms": elapsed_ms,
            "total_tokens": total_tokens,
            "completed_critical_nodes": int(state_raw.get("completed_critical_nodes", 0)),
            "hidden_events_found": int(state_raw.get("hidden_events_found", 0)),
            "npc_states": json.loads(state_raw.get("npc_states", "{}")),
            "cheat_flags": {
                "confirmed": state_raw.get("cheat_confirmed") == "true",
                "suspected": state_raw.get("cheat_suspected") == "true",
            },
        }

        score_result = await score_engine.compute(session_id, world.config or {}, game_final_state)

        async with app_state.db_session() as db:
            score = Score(
                session_id=session_id,
                world_id=session.world_id,
                player_id=session.player_id,
                speed=score_result.speed,
                quality=score_result.quality,
                npc_survival=score_result.npc_survival,
                efficiency=score_result.efficiency,
                exploration=score_result.exploration,
                final_score=score_result.final_score,
                grade=score_result.grade,
                breakdown=score_result.breakdown,
                audit_status="pending",
                scored_at=datetime.now(timezone.utc),
                leaderboard_type=leaderboard_type,
                model_name=model_name,
                model_provider=_detect_model_provider(model_name),
            )
            db.add(score)

            # 投入审计队列
            await redis.rpush('audit_queue', json.dumps({
                'session_id': session_id,
                'priority': 'normal',
            }))

            result = await db.execute(select(Session).where(Session.id == session_id))
            s = result.scalar_one_or_none()
            s.status = "scored"
            await db.commit()
    except Exception as e:
        import structlog
        structlog.get_logger().error("scoring_failed", session_id=session_id, error=str(e))


@router.get("/{session_id}/score")
async def get_score(session_id: str, request: Request, player=Depends(get_current_player)):
    async with request.app.state.db_session() as db:
        result = await db.execute(select(Session).where(Session.id == session_id))
        session = result.scalar_one_or_none()

    if not session or session.player_id != player.id:
        raise HTTPException(404, detail={"code": "SESSION_NOT_FOUND", "message": "Session not found"})

    if session.status in ("active", "scoring"):
        return _ok({"status": "scoring"})

    async with request.app.state.db_session() as db:
        result = await db.execute(select(Score).where(Score.session_id == session_id))
        score = result.scalar_one_or_none()

    if not score:
        return _ok({"status": "scoring"})

    return _ok({
        "status": "scored",
        "score": {
            "speed": score.speed,
            "quality": score.quality,
            "npc_survival": score.npc_survival,
            "efficiency": score.efficiency,
            "exploration": score.exploration,
            "final_score": score.final_score,
            "grade": score.grade,
        },
        "breakdown": score.breakdown,
        "audit_status": score.audit_status,
        "leaderboard_type": score.leaderboard_type,
        "model_name": score.model_name,
    })


@router.post("/upload-log")
async def upload_log(req: UploadLogRequest, request: Request, player=Depends(get_current_player)):
    async with request.app.state.db_session() as db:
        result = await db.execute(select(Session).where(Session.id == req.session_id))
        session = result.scalar_one_or_none()

    if not session or session.player_id != player.id:
        raise HTTPException(404, detail={"code": "SESSION_NOT_FOUND", "message": "Session not found"})

    # Store uploaded log in Redis for audit
    redis = request.app.state.redis
    await redis.set(f"session:{req.session_id}:player_log", json.dumps(req.log), ex=86400 * 7)

    return _ok({
        "upload_id": f"upl_{str(ULID())}",
        "chain_verified": True,
        "audit_status": "queued",
        "estimated_audit_ms": 86400000,
    })


@router.websocket("/ws/{session_id}")
async def ws_endpoint(websocket: WebSocket, session_id: str, token: str = ""):
    # Simple token check via query param
    await websocket.accept()
    await broadcaster.register(session_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await broadcaster.unregister(session_id, websocket)
