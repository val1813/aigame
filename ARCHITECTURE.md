# AgentWorld — 架构总结 & 部署手册

## 端口规划

| 服务 | 端口 | 说明 |
|------|------|------|
| AgentWorld API | **9000** | FastAPI 后端 |
| AgentWorld GM | **9001** | Next.js GM 后台 |
| 已有 nginx | 80/443/8888 | 不动 |
| 已有 llmbbs | 8080/8000 | 不动 |

VPS IP: `111.231.112.127`

---

## 项目结构

```
aigame/
├── api/                    # FastAPI 后端 (Python 3.12)
│   ├── main.py             # 应用入口，lifespan 管理连接池
│   ├── config.py           # pydantic-settings 配置
│   ├── routers/
│   │   ├── auth.py         # 注册/登录/验证
│   │   ├── worlds.py       # 关卡列表/下载
│   │   ├── sessions.py     # 游戏核心：start/action/end/score/ws
│   │   ├── leaderboard.py  # 排行榜
│   │   └── gm.py           # GM 管理接口
│   ├── services/
│   │   ├── world_engine.py     # 世界状态机（核心）
│   │   ├── npc_service.py      # NPC 状态机 + Boss LLM
│   │   ├── score_engine.py     # 评分计算（5维度）
│   │   ├── cheat_detector.py   # 作弊检测（时序+信息熵）
│   │   ├── ws_broadcaster.py   # WebSocket 广播
│   │   └── condition_evaluator.py  # 条件表达式求值
│   ├── models/models.py    # SQLAlchemy ORM
│   ├── schemas/            # Pydantic 请求/响应模型
│   ├── migrations/         # Alembic 数据库迁移
│   ├── scripts/create_gm.py
│   ├── requirements.txt
│   └── Dockerfile
│
├── gm-backend/             # Next.js GM 后台 (Node 20)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx        # 关卡列表 + 登录
│   │   └── gm/worlds/[id]/page.tsx  # 关卡 JSON 编辑器
│   ├── next.config.js
│   └── Dockerfile
│
├── client/                 # MCP 客户端 npm 包
│   ├── bin/agentworld-mcp.js   # CLI 入口
│   ├── src/
│   │   ├── mcp/server.js       # MCP JSON-RPC server (stdin/stdout)
│   │   ├── mcp/log-chain.js    # HMAC Merkle 日志链
│   │   └── api/client.js       # HTTP 客户端
│   └── package.json
│
├── docker-compose.yml      # 本地/生产 compose（postgres + redis + api + gm）
├── .env.example
├── deploy.sh               # rsync + 远程部署脚本
└── setup_vps.sh            # VPS 首次初始化（Docker + 防火墙）
```

---

## 核心数据流

```
Claude Agent
    │  MCP tools (aw_start_session / aw_action / aw_end_session)
    ▼
client/src/mcp/server.js
    │  HTTP POST /v1/session/action  (带 HMAC entry_hash)
    ▼
api/routers/sessions.py
    │  验证 turn 单调性 + HMAC
    ▼
api/services/world_engine.py   ←→  Redis (session state)
    │  NPC 状态机 / 条件求值 / 区域锁
    ▼
api/services/npc_service.py    ←→  Anthropic API (Boss NPC)
    │
    ├── async: cheat_detector.py  (时序检测)
    ├── async: ws_broadcaster.py  (WebSocket 推送)
    └── response → Claude Agent

游戏结束:
    ▼
api/routers/sessions.py → _run_scoring()
    ▼
api/services/score_engine.py  (5维度评分)
    ▼
DB: scores 表
```

---

## 数据库表

| 表 | 说明 |
|----|------|
| `players` | 玩家账号 + token |
| `gm_users` | GM 账号 |
| `worlds` | 关卡配置（含完整 JSON config） |
| `sessions` | 游戏局，记录 secret/turn/status |
| `action_logs` | 每步行动的 HMAC 链路日志 |
| `scores` | 最终评分 + 审核状态 |

---

## Redis Key 规范

| Key | 类型 | 说明 |
|-----|------|------|
| `session:{id}:state` | Hash | 游戏状态（turn/hp/gold/npc_states/quest_states/...） |
| `session:{id}:memory` | Hash | Agent 自定义 KV 记忆 |
| `session:{id}:player_log` | String | 玩家上传的链路日志（JSON） |
| `session:{id}:cheat_warns` | List | 作弊警告列表 |
| `session:{id}:last_action_ts` | String | 上次行动时间戳（时序检测用） |
| `audit_queue` | List | AI 审核任务队列 |

---

## 评分公式

```
final = speed×0.25 + quality×0.30 + npc_survival×0.20 + efficiency×0.15 + exploration×0.10

speed        = min(100, baseline_time_ms / elapsed_ms × 100)
quality      = completed_critical_nodes / total_critical_nodes × 100
npc_survival = Σ(alive_npc_weight) / Σ(total_npc_weight) × 100
efficiency   = min(100, baseline_tokens / actual_tokens × 100)
exploration  = hidden_events_found / hidden_events_total × 100

作弊降分: suspected → ×0.7; confirmed → 0分 grade=D
```

等级: Super A(≥97) / A+(≥92) / A(≥85) / A-(≥78) / B+(≥70) / B(≥60) / C(≥45) / D

---

## 首次部署步骤

```bash
# 1. VPS 初始化（只需一次）
scp setup_vps.sh root@111.231.112.127:/tmp/
ssh root@111.231.112.127 "bash /tmp/setup_vps.sh"

# 2. 上传项目
rsync -avz --exclude='prd&spec' --exclude='node_modules' --exclude='.git' \
  /d/program/aigame/ root@111.231.112.127:/opt/aigame/

# 3. 配置环境变量
ssh root@111.231.112.127 "cp /opt/aigame/.env.example /opt/aigame/.env && nano /opt/aigame/.env"
# 填写: ANTHROPIC_API_KEY, SESSION_SECRET_SALT, JWT_SECRET

# 4. 启动服务
ssh root@111.231.112.127 "cd /opt/aigame && docker compose up -d --build"

# 5. 数据库迁移
ssh root@111.231.112.127 "cd /opt/aigame && docker compose exec api python -m alembic upgrade head"

# 6. 创建 GM 账号
ssh root@111.231.112.127 "cd /opt/aigame && docker compose exec api python scripts/create_gm.py --email gm@yourdomain.com --password yourpassword"

# 7. 验证
curl http://111.231.112.127:9000/health
# → {"status":"ok"}
```

---

## 日常运维

```bash
# 查看日志
docker compose logs -f api
docker compose logs -f gm

# 重启 API
docker compose restart api

# 数据库迁移（更新后）
docker compose exec api python -m alembic upgrade head

# 进入 psql
docker compose exec postgres psql -U aw agentworld

# 查看 Redis
docker compose exec redis redis-cli
```

---

## MCP 客户端使用（Claude Agent 侧）

```bash
# 安装
cd /d/program/aigame/client && npm install

# 配置 Claude Desktop / claude-code MCP
# 在 claude_desktop_config.json 或 .claude/settings.json 中添加:
{
  "mcpServers": {
    "agentworld": {
      "command": "node",
      "args": ["/d/program/aigame/client/bin/agentworld-mcp.js"],
      "env": {
        "AGENTWORLD_API_URL": "http://111.231.112.127:9000",
        "AGENTWORLD_TOKEN": "<player_token>"
      }
    }
  }
}
```

MCP 工具列表:
- `aw_list_worlds` — 获取关卡列表
- `aw_start_session` — 开始游戏
- `aw_action` — 执行行动（observe/move/npc_talk/npc_action/use_item/memory_set/memory_get）
- `aw_end_session` — 结束游戏
- `aw_get_score` — 查询评分

---

## 已知 v1 限制 & 后续优化方向

1. **关卡包加密** — v1 直接返回 JSON config，v2 需实现 AES-256-GCM + CDN 分发
2. **GM 编辑器** — v1 是纯 JSON 文本编辑，v2 需可视化节点图编辑器
3. **AI 审核 Worker** — v1 未启动后台 Worker，v2 需独立进程消费 `audit_queue`
4. **信息熵作弊检测** — v1 简化跳过，v2 需加载 world locked_info 做关键词匹配
5. **Token 计数** — v1 由 Agent 自报，v2 需服务端从 Anthropic API 响应中读取
6. **Nginx 反代** — 可在现有 nginx 中加 server block，用域名访问 9000/9001
