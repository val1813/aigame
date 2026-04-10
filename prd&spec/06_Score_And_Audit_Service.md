# AgentWorld 评分引擎 & AI 审核服务规格

> **文档类型**：Service Spec  
> **版本**：v1.0 | 2026-04-06  
> **阅读对象**：后端工程师

---

## 1. 评分引擎（Score Engine）

### 1.1 触发时机

游戏结束（`POST /v1/session/end`）后异步执行，不阻塞响应。

```python
# api/services/score_engine.py
import asyncio
from dataclasses import dataclass

@dataclass
class ScoreResult:
    speed: float
    quality: float
    npc_survival: float
    efficiency: float
    exploration: float
    final_score: float
    grade: str
    breakdown: dict


class ScoreEngine:

    async def compute(self, session_id: str, world_config: dict, game_final_state: dict) -> ScoreResult:
        s = game_final_state
        cfg = world_config["scoring"]

        speed        = self._score_speed(s["elapsed_ms"],      cfg["baseline_time_ms"])
        quality      = self._score_quality(s["completed_critical_nodes"], cfg["critical_nodes_total"])
        npc_survival = self._score_npc_survival(s["npc_states"], cfg["key_npcs"], cfg["normal_npcs"])
        efficiency   = self._score_efficiency(s["total_tokens"], cfg["baseline_tokens"])
        exploration  = self._score_exploration(s["hidden_events_found"], cfg["hidden_events_total"])

        # 作弊降分
        cheat = s.get("cheat_flags", {})
        if cheat.get("confirmed"):
            return ScoreResult(0, 0, 0, 0, 0, 0, "D",
                               {"reason": "confirmed_cheat"})
        if cheat.get("suspected"):
            multiplier = 0.7
            speed, quality, npc_survival, efficiency, exploration = (
                v * multiplier for v in [speed, quality, npc_survival, efficiency, exploration]
            )

        final = (speed * 0.25 + quality * 0.30 +
                 npc_survival * 0.20 + efficiency * 0.15 + exploration * 0.10)

        grade = self._grade(final)
        return ScoreResult(
            speed=round(speed, 2),
            quality=round(quality, 2),
            npc_survival=round(npc_survival, 2),
            efficiency=round(efficiency, 2),
            exploration=round(exploration, 2),
            final_score=round(final, 2),
            grade=grade,
            breakdown={
                "elapsed_ms": s["elapsed_ms"],
                "baseline_time_ms": cfg["baseline_time_ms"],
                "total_tokens": s["total_tokens"],
                "baseline_tokens": cfg["baseline_tokens"],
                "critical_nodes_completed": s["completed_critical_nodes"],
                "critical_nodes_total": cfg["critical_nodes_total"],
                "hidden_events_found": s["hidden_events_found"],
                "hidden_events_total": cfg["hidden_events_total"],
            }
        )

    def _score_speed(self, elapsed_ms: int, baseline_ms: int) -> float:
        if baseline_ms <= 0:
            return 100.0
        return min(100.0, baseline_ms / elapsed_ms * 100)

    def _score_quality(self, completed: int, total: int) -> float:
        if total == 0:
            return 100.0
        return completed / total * 100

    def _score_npc_survival(self, npc_states: dict, key_npcs: list, normal_npcs: list) -> float:
        total_weight = 0.0
        alive_weight = 0.0
        for npc in key_npcs:
            w = npc["weight"]
            total_weight += w
            if npc_states.get(npc["npc_id"], {}).get("alive", True):
                alive_weight += w
        for npc in normal_npcs:
            w = npc["weight"]
            total_weight += w
            if npc_states.get(npc["npc_id"], {}).get("alive", True):
                alive_weight += w
        if total_weight == 0:
            return 100.0
        return alive_weight / total_weight * 100

    def _score_efficiency(self, actual_tokens: int, baseline_tokens: int) -> float:
        if baseline_tokens <= 0 or actual_tokens <= 0:
            return 100.0
        return min(100.0, baseline_tokens / actual_tokens * 100)

    def _score_exploration(self, found: int, total: int) -> float:
        if total == 0:
            return 100.0
        return found / total * 100

    def _grade(self, score: float) -> str:
        if score >= 97: return "Super A"
        if score >= 92: return "A+"
        if score >= 85: return "A"
        if score >= 78: return "A-"
        if score >= 70: return "B+"
        if score >= 60: return "B"
        if score >= 45: return "C"
        return "D"
```

---

## 2. 实时评分快照（Score Snapshot）

游戏进行中，每次 `/v1/session/action` 响应都附带当前评分快照（`score_snapshot`）。 快照是**预估值**，不是最终分，用于前端实时仪表盘展示。

```python
# api/services/score_engine.py
class ScoreSnapshot:
    """轻量级实时评分预估，每步 action 后更新"""

    def compute_snapshot(self, partial_state: dict, world_config: dict) -> dict:
        cfg = world_config["scoring"]
        elapsed = partial_state.get("elapsed_ms", 0)

        return {
            # Speed：用当前用时预估，游戏未结束时偏乐观
            "speed": min(100.0, cfg["baseline_time_ms"] / max(elapsed, 1) * 100),
            # Quality：已完成关键节点数
            "quality": self._score_quality(
                partial_state.get("completed_critical_nodes", 0),
                cfg["critical_nodes_total"]
            ),
            # NPC 存活：实时计算
            "npc_survival": self._score_npc_survival(
                partial_state.get("npc_states", {}),
                cfg["key_npcs"], cfg["normal_npcs"]
            ),
            # Token 效率：当前消耗预估
            "efficiency": self._score_efficiency(
                partial_state.get("total_tokens", 0),
                cfg["baseline_tokens"]
            ),
            # 探索度：已触发隐藏事件数
            "exploration": self._score_exploration(
                partial_state.get("hidden_events_found", 0),
                cfg["hidden_events_total"]
            ),
        }
```

---

## 3. 作弊检测服务

### 3.1 检测流水线

```python
# api/services/cheat_detector.py
import asyncio

class CheatDetector:

    async def analyze(self, session_id: str, action_req: dict, action_result: dict):
        """
        异步执行，不阻塞主流程。
        发现异常则向 Redis 写入 cheat_flags，影响最终评分。
        """
        flags = []

        # Layer 1: 时序检测（毫秒级）
        timing_flag = await self._check_timing(session_id, action_req)
        if timing_flag:
            flags.append(timing_flag)

        # Layer 2: 信息熵检测（百毫秒级，有 LLM 则用语义）
        entropy_flag = await self._check_info_entropy(
            session_id, action_req, action_result
        )
        if entropy_flag:
            flags.append(entropy_flag)

        # 累计 WARN 数 >= 2 → SUSPECTED
        if len(flags) >= 2:
            await self._set_suspected(session_id, flags)
        elif len(flags) == 1:
            await self._add_warn(session_id, flags[0])

    async def _check_timing(self, session_id: str, req: dict) -> dict | None:
        """检测时序异常"""
        redis = get_redis()
        last_ts_key = f"session:{session_id}:last_action_ts"
        now_ns = int(req["ts_ns"])

        last_ns = await redis.get(last_ts_key)
        await redis.set(last_ts_key, now_ns, ex=7200)

        if last_ns:
            interval_s = (now_ns - int(last_ns)) / 1e9
            # 相邻 action 超过 120 秒（Agent 推理不应超过此时间）
            if interval_s > 120:
                return {
                    "type": "timing_anomaly",
                    "detail": f"Turn间隔 {interval_s:.0f}s，超过阈值120s",
                    "turn": req["turn"],
                }
        return None

    async def _check_info_entropy(self, session_id: str, req: dict, result: dict) -> dict | None:
        """
        检测 Agent 是否在未解锁信息的情况下使用了关键词。
        使用简单的关键词匹配（Phase 1），Phase 2 升级为语义相似度。
        """
        redis = get_redis()

        # 获取当前已解锁信息
        unlocked_key = f"session:{session_id}:unlocked_info"
        unlocked = await redis.smembers(unlocked_key)  # set of info_ids

        # 获取关卡中所有锁定信息
        world_locked_info = await get_world_locked_info(session_id)  # from cache

        agent_text = req.get("payload", {}).get("message", "")
        if not agent_text:
            return None

        for info in world_locked_info:
            if info["info_id"] in unlocked:
                continue  # 已解锁，正常使用
            # 检测 Agent 发言中是否包含该锁定信息的关键词
            keywords = extract_keywords(info["content"])  # 简单分词
            if any(kw in agent_text for kw in keywords if len(kw) >= 2):
                return {
                    "type": "info_entropy",
                    "detail": f"Agent 使用了未解锁信息的关键词: {info['info_id']}",
                    "turn": req["turn"],
                }
        return None

    async def _add_warn(self, session_id: str, flag: dict):
        redis = get_redis()
        await redis.rpush(f"session:{session_id}:cheat_warns", json.dumps(flag))
        # 日志记录
        log.warning("cheat_warn", session_id=session_id, **flag)

    async def _set_suspected(self, session_id: str, flags: list):
        redis = get_redis()
        await redis.hset(f"session:{session_id}:state",
                        "cheat_suspected", "true")
        log.warning("cheat_suspected", session_id=session_id,
                    flag_count=len(flags), flags=flags)
```

---

## 4. AI 链路审核服务

### 4.1 审核任务队列

```python
# api/services/audit_service.py
import anthropic
import asyncio
import json

class AuditService:
    MODEL_STANDARD = "claude-haiku-4-5-20251001"   # 普通排名
    MODEL_PRECISE  = "claude-sonnet-4-20250514"    # Top10 + Super A

    async def enqueue(self, session_id: str, rank: int, grade: str):
        """将审核任务加入 Redis 队列"""
        redis = get_redis()
        model = self.MODEL_PRECISE if (rank <= 10 or grade == "Super A") else self.MODEL_STANDARD
        task = {
            "session_id": session_id,
            "rank": rank,
            "grade": grade,
            "model": model,
            "queued_at": time.time(),
        }
        await redis.rpush("audit_queue", json.dumps(task))

    async def run_worker(self):
        """后台 Worker，持续处理审核队列"""
        redis = get_redis()
        while True:
            _, raw = await redis.blpop("audit_queue", timeout=10)
            if not raw:
                continue
            task = json.loads(raw)
            try:
                await self._process_audit(task)
            except Exception as e:
                log.error("audit_failed", session_id=task["session_id"], error=str(e))
                # 重试（最多3次）
                task["retries"] = task.get("retries", 0) + 1
                if task["retries"] < 3:
                    await redis.rpush("audit_queue", json.dumps(task))

    async def _process_audit(self, task: dict):
        session_id = task["session_id"]
        model = task["model"]

        # 1. 获取服务器侧日志（权威，不可篡改）
        server_log = await get_server_action_log(session_id)

        # 2. 获取玩家上传的链路日志（如已上传）
        player_log = await get_player_uploaded_log(session_id)

        # 3. Merkle 链验证（数学验证，不依赖 AI）
        chain_ok = verify_merkle_chain(server_log, player_log)
        if not chain_ok:
            await self._save_result(session_id, {
                "verdict": "fail",
                "confidence": 1.0,
                "issues": ["Merkle 链验证失败，日志已被篡改"],
                "recommendation": "取消资格",
            })
            return

        # 4. 获取关卡配置（用于 AI 理解"正确路径"）
        world_config = await get_world_config_for_session(session_id)

        # 5. 构建审核 Prompt
        prompt = self._build_audit_prompt(world_config, server_log, player_log)

        # 6. 调用 Claude 审核
        client = anthropic.Anthropic()
        response = client.messages.create(
            model=model,
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )

        # 7. 解析结果
        result_text = response.content[0].text
        result = self._parse_audit_result(result_text)

        # 8. 保存结果，更新排行榜状态
        await self._save_result(session_id, result)

    def _build_audit_prompt(self, world_config: dict, server_log: list, player_log: dict) -> str:
        # 提取关键节点路径（用于 AI 理解正确玩法）
        critical_path = [
            {"node_id": nid, "name": ncfg["name"], "prereqs": ncfg["prerequisites"]}
            for nid, ncfg in world_config["quests"]["main_quest"]["nodes"].items()
            if ncfg.get("is_critical_path")
        ]

        # 将服务器日志转为可读摘要（只取 action + turn + 时间戳）
        log_summary = [
            {
                "turn": e["turn"],
                "elapsed_s": round((e["ts"] - server_log[0]["ts"]) / 1e9, 1),
                "action": e["action"],
            }
            for e in server_log
        ]

        # 玩家上传的推理摘要（如有）
        reasoning = []
        if player_log:
            reasoning = [
                {"turn": e["turn"], "reasoning": e.get("agent_reasoning_summary", "")}
                for e in player_log.get("turns", [])
            ]

        return f"""你是 AgentWorld 游戏的公正裁判。请审核以下 Agent 的通关记录是否合规。

【关卡】{world_config["meta"]["name"]}（难度 {world_config["meta"]["difficulty"]}）

【必须按顺序完成的关键节点】
{json.dumps(critical_path, ensure_ascii=False, indent=2)}

【Agent 实际行动序列（服务器权威记录）】
{json.dumps(log_summary, ensure_ascii=False, indent=2)}

【Agent 推理摘要（玩家上传，供参考）】
{json.dumps(reasoning, ensure_ascii=False, indent=2) if reasoning else "（未提供）"}

【审核要点】
1. Agent 是否按合理逻辑推进（非跳过关键节点）？
2. 行动时间间隔是否有异常（如某步骤突然耗时很长后立即获得关键突破）？
3. Agent 获得关键信息的时机是否符合节点解锁条件？
4. 整体行动序列是否像正常 AI 推理（而非人工干预）？

请严格按以下 JSON 格式输出，不要输出其他内容：
{{
  "verdict": "pass" 或 "suspicious" 或 "fail",
  "confidence": 0到1之间的小数,
  "issues": ["具体问题1", "具体问题2"],
  "recommendation": "上榜" 或 "人工复核" 或 "取消资格"
}}"""

    def _parse_audit_result(self, text: str) -> dict:
        """解析 AI 返回的 JSON 结果，容错处理"""
        import re
        # 提取 JSON 部分
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if not match:
            return {
                "verdict": "suspicious",
                "confidence": 0.5,
                "issues": ["AI 返回格式异常，转人工复核"],
                "recommendation": "人工复核",
            }
        try:
            result = json.loads(match.group())
            # 验证必要字段
            assert result["verdict"] in ["pass", "suspicious", "fail"]
            assert 0 <= result["confidence"] <= 1
            return result
        except Exception:
            return {
                "verdict": "suspicious",
                "confidence": 0.5,
                "issues": ["AI 返回解析失败，转人工复核"],
                "recommendation": "人工复核",
            }

    async def _save_result(self, session_id: str, result: dict):
        """保存审核结果到数据库，更新排行榜显示"""
        db = get_db()
        await db.execute(
            "UPDATE scores SET audit_status=$1, audit_result=$2 WHERE session_id=$3",
            result["recommendation"].replace("上榜","pass").replace("取消资格","fail").replace("人工复核","review"),
            json.dumps(result),
            session_id,
        )
        log.info("audit_completed", session_id=session_id, verdict=result["verdict"],
                 confidence=result["confidence"])
```

---

## 5. WebSocket 广播服务

```python
# api/services/ws_broadcaster.py
import asyncio
from collections import defaultdict

class WSBroadcaster:
    """管理所有 Session 的 WebSocket 连接"""

    def __init__(self):
        # session_id → set of WebSocket connections
        self._connections: dict[str, set] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def register(self, session_id: str, ws):
        async with self._lock:
            self._connections[session_id].add(ws)

    async def unregister(self, session_id: str, ws):
        async with self._lock:
            self._connections[session_id].discard(ws)
            if not self._connections[session_id]:
                del self._connections[session_id]

    async def broadcast(self, session_id: str, event: dict):
        """向某 Session 的所有观战连接推送事件"""
        conns = self._connections.get(session_id, set()).copy()
        if not conns:
            return
        message = json.dumps(event, ensure_ascii=False)
        dead = set()
        for ws in conns:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        # 清理断开的连接
        if dead:
            async with self._lock:
                self._connections[session_id] -= dead

# 全局单例
broadcaster = WSBroadcaster()

# FastAPI WebSocket 路由
from fastapi import WebSocket, WebSocketDisconnect

@router.websocket("/ws/{session_id}")
async def ws_endpoint(websocket: WebSocket, session_id: str, token: str):
    # 验证 token
    player = await verify_token(token)
    if not player:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    await broadcaster.register(session_id, websocket)
    try:
        while True:
            # 保持连接，客户端只接收不发送（观战模式）
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await broadcaster.unregister(session_id, websocket)
```
