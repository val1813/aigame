# AgentWorld 工程师运行手册

> **文档类型**：Engineering Runbook  
> **版本**：v1.0 | 2026-04-06  
> **阅读对象**：所有工程师（后端/前端/运维）  
> **说明**：本文档涵盖本地开发环境搭建、部署、监控、常见问题排查

---

## 1. 本地开发环境搭建

### 1.1 依赖版本要求

| 工具 | 最低版本 | 推荐版本 |
|------|---------|---------|
| Python | 3.11 | 3.12 |
| Node.js | 18 | 20 LTS |
| Docker | 24 | 最新 |
| Docker Compose | 2.20 | 最新 |
| PostgreSQL | 16 | 16（TimescaleDB 镜像包含）|
| Redis | 7 | 7-alpine |

### 1.2 快速启动（首次）

```bash
# 1. 克隆仓库
git clone <repo_url>
cd agentworld

# 2. 复制环境变量模板
cp .env.example .env
# 编辑 .env，填写必要的密钥（见 1.3 节）

# 3. 启动所有服务（Docker Compose）
docker compose up -d

# 4. 数据库初始化
docker compose exec api python -m alembic upgrade head

# 5. 创建初始 GM 账号
docker compose exec api python scripts/create_gm.py --email gm@test.com --password test1234

# 6. 本地访问
# API:      http://localhost:8000
# GM 后台:   http://localhost:8001
# API Docs: http://localhost:8000/docs   (FastAPI 自动生成，仅 dev 环境)
```

### 1.3 必填环境变量

```bash
# .env 文件

# ── 必须填写 ──────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-xxx        # Boss NPC + AI 审核，必须
SESSION_SECRET_SALT=随机32字节base64  # Merkle 日志 HMAC 主密钥，必须
JWT_SECRET=随机64字节base64           # JWT 签名密钥，必须

# ── 数据库（Docker Compose 内置，本地开发不用改）────
DATABASE_URL=postgresql+asyncpg://aw:aw_pass@postgres:5432/agentworld
REDIS_URL=redis://redis:6379/0

# ── 可选（有默认值）──────────────────────────────────
MAX_SESSIONS_PER_WORLD=50
AGENT_TURN_TIMEOUT_S=120
CHEAT_SEMANTIC_THRESHOLD=0.85
ENVIRONMENT=development              # development | production
LOG_LEVEL=INFO
CORS_ORIGINS=http://localhost:3000,http://localhost:8001
```

### 1.4 单独启动各服务（非 Docker，调试用）

```bash
# ── 后端 API ──
cd api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# ── GM 后台 ──
cd gm-backend
npm install
npm run dev   # Next.js dev server on :8001

# ── 本地客户端（开发模式）──
cd client
npm install
npm run dev   # Vite dev server on :3000，同时启动 MCP Server
```

---

## 2. 项目目录结构

```
agentworld/
├── api/                        # 后端 FastAPI
│   ├── main.py                 # 应用入口，路由注册
│   ├── routers/
│   │   ├── auth.py             # 认证模块
│   │   ├── worlds.py           # 关卡模块
│   │   ├── sessions.py         # Session / 行动模块
│   │   ├── leaderboard.py      # 排行榜
│   │   └── gm.py               # GM 接口
│   ├── services/
│   │   ├── world_engine.py     # 世界状态引擎（核心）
│   │   ├── score_engine.py     # 评分计算
│   │   ├── cheat_detector.py   # 作弊检测
│   │   ├── audit_service.py    # AI 链路审核
│   │   └── npc_service.py      # NPC 状态机 + LLM Boss
│   ├── models/                 # SQLAlchemy ORM 模型
│   ├── schemas/                # Pydantic 请求/响应模型
│   ├── migrations/             # Alembic 数据库迁移
│   ├── requirements.txt
│   └── Dockerfile
│
├── gm-backend/                 # GM 后台 Next.js
│   ├── app/                    # Next.js App Router
│   │   ├── gm/worlds/          # 关卡管理页
│   │   ├── gm/audit/           # 审核管理页
│   │   └── api/                # Next.js API Routes（代理到主 API）
│   ├── components/             # React 组件
│   └── package.json
│
├── client/                     # 本地客户端 npm 包
│   ├── bin/agentworld-mcp.js   # CLI 入口
│   ├── src/
│   │   ├── mcp/                # MCP Server
│   │   ├── api/                # 与服务器通信
│   │   └── ui/                 # Phaser + React 游戏界面
│   └── package.json
│
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
└── README.md
```

---

## 3. 核心服务实现要点

### 3.1 FastAPI 应用结构

```python
# api/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时初始化连接池
    app.state.redis = await aioredis.from_url(settings.REDIS_URL)
    app.state.db_engine = create_async_engine(settings.DATABASE_URL)
    yield
    # 关闭时清理
    await app.state.redis.aclose()
    await app.state.db_engine.dispose()

app = FastAPI(
    title="AgentWorld API",
    version="1.0.0",
    lifespan=lifespan,
    # 生产环境关闭 docs
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url=None,
)

app.add_middleware(CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

from routers import auth, worlds, sessions, leaderboard, gm
app.include_router(auth.router,        prefix="/v1/auth")
app.include_router(worlds.router,      prefix="/v1/worlds")
app.include_router(sessions.router,    prefix="/v1/session")
app.include_router(leaderboard.router, prefix="/v1/leaderboard")
app.include_router(gm.router,          prefix="/gm")
```

### 3.2 Session Action 处理（核心路径）

```python
# api/routers/sessions.py
from fastapi import APIRouter, Depends, HTTPException
from services.world_engine import WorldEngine
from services.cheat_detector import CheatDetector
from schemas.session import ActionRequest, ActionResponse

router = APIRouter()

@router.post("/action", response_model=ActionResponse)
async def handle_action(
    req: ActionRequest,
    player = Depends(get_current_player),
    engine: WorldEngine = Depends(get_world_engine),
    cheat: CheatDetector = Depends(get_cheat_detector),
):
    # 1. 验证 Session 存活
    session = await engine.get_session(req.session_id)
    if not session or session.player_id != player.id:
        raise HTTPException(404, "Session not found")
    if session.status != "active":
        raise HTTPException(409, detail={"code": "SESSION_ENDED"})

    # 2. 验证 Turn 单调性（防重放）
    if req.turn != session.current_turn + 1:
        raise HTTPException(409, detail={"code": "TURN_MISMATCH"})

    # 3. 验证 HMAC 签名
    expected = compute_hmac(session.secret, req.to_signable_dict())
    if req.entry_hash != expected:
        raise HTTPException(400, detail={"code": "INVALID_HMAC"})

    # 4. 执行世界引擎动作（核心逻辑）
    result = await engine.execute_action(session, req)
    if result.error:
        raise HTTPException(403, detail={"code": result.error})

    # 5. 写入行动日志（异步，不阻塞响应）
    asyncio.create_task(
        write_action_log(session.id, req, result)
    )

    # 6. 并行：作弊检测（异步，不阻塞）
    asyncio.create_task(
        cheat.analyze(session.id, req, result)
    )

    # 7. 更新 Turn
    await engine.increment_turn(session.id)

    # 8. 广播 WebSocket 事件
    await broadcast_ws_event(session.id, result.ws_events)

    return ActionResponse(
        ok=True,
        turn_ack=req.turn,
        **result.to_response_dict(),
    )
```

### 3.3 NPC 状态机执行器

```python
# api/services/npc_service.py
class NPCStateMachine:
    def __init__(self, npc_config: dict, npc_state: dict):
        self.config = npc_config
        self.state = npc_state  # 来自 Redis，包含 current_state, alive 等

    def process_trigger(self, trigger: str, game_state: dict) -> NPCResult:
        """
        Agent 的行动会转化为 trigger，状态机据此做转移。
        返回：NPC 回应文本、状态变化、解锁信息
        """
        current = self.config["states"][self.state["current_state"]]
        evaluator = ConditionEvaluator(game_state)

        for transition in current.get("transitions", []):
            # 检查 trigger 匹配
            if transition["trigger"] != trigger and transition["trigger"] != "any":
                continue
            # 检查条件
            if transition.get("condition") and not evaluator.evaluate(transition["condition"]):
                return NPCResult(
                    response=transition.get("failure_response", self._default_response()),
                    state_changed=False,
                )
            # 执行转移
            new_state = transition["target_state"]
            self.state["current_state"] = new_state
            new_state_config = self.config["states"][new_state]

            # 执行副作用（扣金币等）
            effects = []
            if action := transition.get("action"):
                effects.append(action)

            # 解锁信息
            unlocked = new_state_config.get("on_enter_unlock", [])

            # 任务节点事件
            quest_event = new_state_config.get("on_enter_quest_event")

            return NPCResult(
                response=new_state_config.get("on_enter_response") or self._default_response(),
                state_changed=True,
                new_state=new_state,
                unlocked_info=unlocked,
                quest_event=quest_event,
                side_effects=effects,
            )

        # 没有匹配的 transition
        return NPCResult(response=self._default_response(), state_changed=False)

    def _default_response(self):
        state = self.state["current_state"]
        responses = self.config.get("npc_responses", {})
        return responses.get(state) or responses.get("default", "……")
```

### 3.4 Boss NPC LLM 调用

```python
# api/services/npc_service.py（续）
import anthropic

class BossNPCService:
    def __init__(self):
        self.client = anthropic.Anthropic()

    async def get_response(
        self,
        npc_config: dict,
        npc_memory: list[dict],
        agent_message: str,
        emotion_state: str,
    ) -> str:
        llm_cfg = npc_config["llm_config"]

        # 构建消息历史（记忆窗口）
        recent_memory = npc_memory[-llm_cfg["memory_window"]:]
        messages = []
        for mem in recent_memory:
            messages.append({"role": "user",    "content": mem["agent_message"]})
            messages.append({"role": "assistant","content": mem["npc_response"]})
        messages.append({"role": "user", "content": agent_message})

        system = f"""{llm_cfg['system_prompt']}

当前情绪状态：{emotion_state}
以下信息绝对不能透露：{', '.join(llm_cfg.get('forbidden_outputs', []))}"""

        response = self.client.messages.create(
            model="claude-haiku-4-5-20251001",   # Boss NPC 用 Haiku 节省成本
            max_tokens=llm_cfg["max_response_tokens"],
            temperature=llm_cfg.get("temperature", 0.7),
            system=system,
            messages=messages,
        )
        text = response.content[0].text

        # 安全检查：过滤禁止输出的内容
        for forbidden in llm_cfg.get("forbidden_outputs", []):
            if forbidden in text:
                text = "……（沉默）"
                break

        return text
```

---

## 4. 数据库迁移

使用 Alembic 管理数据库 Schema 变更：

```bash
# 生成新迁移（修改 models/ 后执行）
docker compose exec api python -m alembic revision --autogenerate -m "add npc_memory table"

# 应用迁移
docker compose exec api python -m alembic upgrade head

# 回滚
docker compose exec api python -m alembic downgrade -1

# 查看当前版本
docker compose exec api python -m alembic current
```

---

## 5. 测试规范

### 5.1 单元测试

```bash
# 运行所有测试
docker compose exec api pytest

# 带覆盖率
docker compose exec api pytest --cov=. --cov-report=html

# 只跑某个模块
docker compose exec api pytest tests/test_cheat_detector.py -v
```

**测试文件结构**

```
api/tests/
├── conftest.py            # pytest fixtures（db session, mock redis）
├── test_auth.py
├── test_world_engine.py   # 重点：状态机、条件求值、前置锁
├── test_cheat_detector.py # 重点：时序异常、HMAC 验证
├── test_score_engine.py   # 重点：各维度评分公式
└── test_npc_fsm.py        # 重点：NPC 状态转移
```

**关键测试用例示例**

```python
# tests/test_world_engine.py
import pytest
from services.world_engine import WorldEngine
from services.condition_evaluator import ConditionEvaluator

class TestCriticalPathLock:
    def test_locked_node_returns_error(self, game_state_without_prereq):
        """未完成前置节点时，访问目标节点应返回 LOCKED_NODE"""
        engine = WorldEngine(game_state_without_prereq)
        result = engine.check_node_access("node_get_address")
        assert result.error == "LOCKED_NODE"
        assert "node_contact_zhang" in result.detail["required_node"]

    def test_unlocked_after_prereq_complete(self, game_state_with_prereq):
        """完成前置节点后，目标节点应可访问"""
        engine = WorldEngine(game_state_with_prereq)
        result = engine.check_node_access("node_get_address")
        assert result.error is None

class TestConditionEvaluator:
    def test_player_gold_condition(self):
        state = {"player": {"gold": 600}, "npcs": {}, "quests": {}, "session": {}}
        ev = ConditionEvaluator(state)
        assert ev.evaluate("player.gold >= 500") == True
        assert ev.evaluate("player.gold >= 1000") == False
```

### 5.2 集成测试（完整游戏流程）

```python
# tests/test_full_game_flow.py
async def test_happy_path_solo_game(async_client, test_world):
    """测试完整通关流程"""
    # 1. 创建 Session
    r = await async_client.post("/v1/session/start", json={"world_id": test_world.id})
    session_id = r.json()["data"]["session_id"]
    session_secret = r.json()["data"]["session_secret"]
    chain = LogChain(session_id, session_secret)

    # 2. 模拟 Agent 行动序列
    turns = [
        {"action": "observe", "payload": {}},
        {"action": "move", "payload": {"target": {"x": 6, "y": 3}}},
        {"action": "npc_talk", "payload": {"npc_id": "npc_zhang_san", "message": "你好"}},
        {"action": "npc_action", "payload": {"npc_id": "npc_zhang_san", "action_type": "bribe", "payload": {"amount": 500}}},
        # ... 更多步骤
    ]

    for i, turn_data in enumerate(turns):
        entry = chain.add_entry(
            turn=i+1,
            action=turn_data["action"],
            payload=turn_data["payload"],
            response_summary="",
            agent_reasoning_summary="",
            token_cost=100,
        )
        r = await async_client.post("/v1/session/action", json={
            "session_id": session_id,
            "turn": i+1,
            **turn_data,
            "ts_ns": str(time.time_ns()),
            "prev_hash": entry["prev_hash"],
            "entry_hash": entry["entry_hash"],
        })
        assert r.json()["ok"] == True

    # 3. 验证评分
    await async_client.post("/v1/session/end", json={
        "session_id": session_id,
        "end_reason": "victory",
        "final_turn": len(turns),
        "chain_root_hash": chain.export_log()["chain_root_hash"],
    })
    # 轮询等待评分
    await asyncio.sleep(1)
    r = await async_client.get(f"/v1/session/{session_id}/score")
    assert r.json()["data"]["status"] == "scored"
    assert r.json()["data"]["score"]["grade"] in ["A", "A+", "A-", "B+"]
```

---

## 6. 监控与告警

### 6.1 关键指标

| 指标 | 告警阈值 | 说明 |
|------|---------|------|
| API P95 响应时间 | > 500ms | 不含 LLM 调用 |
| Action 写入失败率 | > 0.1% | 日志链写入关键，不能丢 |
| Redis 内存使用率 | > 80% | Session 状态存储 |
| Anthropic API 错误率 | > 5% | Boss NPC + 审核服务 |
| 活跃 Session 数 | > 45 | Phase 1 上限 50，接近时告警 |
| 作弊疑似率 | > 10%/日 | 异常则人工检查 |

### 6.2 结构化日志格式

```python
# 所有关键操作使用结构化日志，便于 Grep/查询
import structlog
log = structlog.get_logger()

# 示例：行动日志记录
log.info("action_processed",
    session_id=session_id,
    turn=turn,
    action=action_type,
    duration_ms=elapsed,
    cheat_flag=cheat_result.flag,
    token_cost=token_cost,
)
```

---

## 7. 常见问题排查

### Q1：客户端报 TURN_MISMATCH 错误

**原因**：客户端发送的 `turn` 号与服务器期望的不一致。

**排查步骤**：
```bash
# 查看当前 Session 的 Turn
docker compose exec redis redis-cli HGET session:{session_id}:state current_turn

# 查看最后一条行动日志
docker compose exec postgres psql -U aw agentworld -c \
  "SELECT turn, action, ts FROM action_logs WHERE session_id='{session_id}' ORDER BY turn DESC LIMIT 5;"
```

**解决**：客户端应从 `/v1/session/{id}/score` 或缓存中读取最新 turn，而不是本地维护计数器。

---

### Q2：Boss NPC 回复包含禁止内容

**原因**：LLM 可能绕过 forbidden_outputs 过滤。

**排查步骤**：
```bash
# 查看 Boss NPC LLM 调用日志
grep "boss_npc_response" /var/log/agentworld/api.log | grep session_id={id}
```

**临时修复**：在 `BossNPCService.get_response` 中增加更强的关键词过滤，提交 PR。

---

### Q3：AI 审核队列积压

**原因**：Anthropic API 限速或排行榜上榜人数集中。

**处理方式**：
```python
# api/services/audit_service.py 中的队列配置
AUDIT_BATCH_SIZE = 5         # 每批处理数量
AUDIT_INTERVAL_S = 60        # 每批间隔（秒）
AUDIT_RETRY_MAX = 3          # 失败重试次数
```

**查看队列状态**：
```bash
docker compose exec redis redis-cli LLEN audit_queue
```

---

### Q4：Merkle 链验证失败（日志链断裂）

**原因可能**：
1. 客户端 Bug 导致 prev_hash 计算错误
2. 服务器在写入日志时崩溃
3. 真实的日志篡改尝试

**诊断**：
```python
# 运行链完整性检查脚本
docker compose exec api python scripts/verify_chain.py --session-id {session_id}
```

---

## 8. 发布流程

```bash
# 1. 本地运行全量测试
docker compose exec api pytest --tb=short

# 2. 构建镜像
docker compose -f docker-compose.prod.yml build

# 3. 执行数据库迁移（在发布前）
docker compose -f docker-compose.prod.yml exec api python -m alembic upgrade head

# 4. 滚动重启（零停机）
docker compose -f docker-compose.prod.yml up -d --no-deps api

# 5. 验证健康检查
curl https://api.agentworld.io/health
# 期望响应: {"status": "ok", "db": "ok", "redis": "ok"}

# 6. 发布客户端 npm 包（新版本时）
cd client
npm version patch   # 或 minor / major
npm publish
```

### npm 包版本策略

| 变更类型 | 版本升级 | 说明 |
|---------|---------|------|
| Bug 修复 | patch (x.x.1) | 自动更新 |
| 新 MCP Tool | minor (x.1.0) | 建议更新 |
| 协议变更 | major (2.0.0) | 必须更新，服务器同步升级 |

服务器在 `/v1/auth/verify` 响应中返回 `min_client_version`，客户端启动时检查，版本过旧时提示升级。
