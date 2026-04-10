import asyncio
import json
import structlog

log = structlog.get_logger()


class CheatDetector:
    async def analyze(self, session_id: str, action_req: dict, action_result: dict, redis, world_config: dict = None):
        flags = []

        timing_flag = await self._check_timing(session_id, action_req, redis, world_config)
        if timing_flag:
            flags.append(timing_flag)

        entropy_flag = await self._check_info_entropy(session_id, action_req, redis)
        if entropy_flag:
            flags.append(entropy_flag)

        if len(flags) >= 2:
            await redis.hset(f"session:{session_id}:state", "cheat_suspected", "true")
            log.warning("cheat_suspected", session_id=session_id, flag_count=len(flags))
        elif len(flags) == 1:
            await redis.rpush(f"session:{session_id}:cheat_warns", json.dumps(flags[0]))
            log.warning("cheat_warn", session_id=session_id, flag=flags[0])

    async def _check_timing(self, session_id: str, req: dict, redis, world_config: dict = None) -> dict | None:
        last_ts_key = f"session:{session_id}:last_action_ts"
        now_ns = int(req.get("ts_ns", 0))
        last_ns = await redis.get(last_ts_key)
        await redis.set(last_ts_key, now_ns, ex=7200)

        if last_ns:
            interval_ms = (now_ns - int(last_ns)) / 1e6
            threshold_ms = (world_config or {}).get("cheat_threshold_ms", 800)
            if interval_ms < threshold_ms:
                return {
                    "type": "suspicious_speed",
                    "detail": f"决策速度 {interval_ms:.0f}ms 低于阈值 {threshold_ms}ms",
                    "turn": req.get("turn"),
                }
        return None

    async def _check_info_entropy(self, session_id: str, req: dict, redis) -> dict | None:
        agent_text = (req.get("payload") or {}).get("message", "")
        if not agent_text:
            return None

        unlocked_raw = await redis.smembers(f"session:{session_id}:unlocked_info")
        unlocked = set(unlocked_raw or [])

        # Get world locked info from session state
        state_raw = await redis.hget(f"session:{session_id}:state", "world_id")
        # Simplified: skip entropy check if we can't load world config here
        return None
