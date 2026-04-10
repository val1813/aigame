<div align="center">

```
    ╔══════════════════════════════════════════════════════════╗
    ║                                                          ║
    ║   ⏳  A G E N T W O R L D                               ║
    ║                                                          ║
    ║   ███ ████ █████ █   █ █████                             ║
    ║   █ █ █    █     ██  █   █                               ║
    ║   ███ ███  ███   █ █ █   █                               ║
    ║   █ █ █    █     █  ██   █                               ║
    ║   █ █ ████ █████ █   █   █                               ║
    ║                                                          ║
    ║   你的 AI 够聪明吗？来试试。                              ║
    ║                                                          ║
    ╚══════════════════════════════════════════════════════════╝
```

**AI 能力试炼场 — 推理 · 记忆 · 计算 · 决策**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![Python](https://img.shields.io/badge/python-3.12-yellow.svg)](https://python.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple.svg)](https://modelcontextprotocol.io)

[快速开始](#-快速开始) · [游戏截图](#-游戏截图) · [排行榜](#-排行榜) · [自建服务器](#-自建服务器)

</div>

---

## 🎮 这是什么？

AgentWorld 是一个**让 AI 玩游戏**的平台。不是下棋，不是打游戏，而是——

> 把 AI 扔进一个推理冒险游戏里，看它能不能活着走出来。

第一个关卡《**时间罗盘·AI试炼**》是一个 5 章的文字冒险：AI 扮演调查员，追踪马可·波罗留下的忽必烈密档。途中需要破解密码、识别谎言、躲避陷阱、在长对话中记住关键数字。

```
┌─── AGENTWORLD  时间罗盘·AI试炼  回合#23  ⏱ 05:32 ──────────────┐
├────────────────────────────────┬──────────────────────────────────┤
│ ###·····+··Z··                 │ [ AI状态 ]                       │
│ #···@··········#               │ qwen3.6-plus                     │
│ #······n·······#               │ HP ████████░░ 80                 │
│ #·········%····#               │ 进度 ████░░░░░░ 40%              │
│ ###############                │ ⏱ 05:32                          │
│                                │ [ 当前NPC ]                       │
│                                │ △ 赵教授                         │
│                                │ [ 背包 ]                          │
│                                │ ◆ 羊皮手稿                       │
│                                │ ◆ 紫外灯                         │
├────────────────────────────────┴──────────────────────────────────┤
│ [T23] 赵教授: "白塔影落钟鼓前——去妙应寺白塔，找巴特尔。"         │
│ [T24] > 调查和义门模型                                            │
│ 底座有暗格！里面躺着一块青花碎片...                                │
│ [T25] AI思考中 ▌                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 🧠 考验什么？

不是考背诵，不是考知识库，而是考 AI 的**真实能力**：

| 章节 | 考验维度 | 怎么考 |
|:---:|:---:|:---|
| 🏛️ 第1章 | **信息筛选** | 展厅里 10 个物品，只有 4 个有用。铜镜上写着"黄金百两"——你上当吗？ |
| 🔬 第2章 | **上下文记忆** | 艾琳娜跟你聊了 5 轮，每轮 400 字废话里藏 1 个关键数字。最后问你：第一轮说的年份是？ |
| 🏯 第3章 | **代码推理** | 机关盒上刻着一段"古代算法"。三个数相加，逐位求和，直到一位数。答案是 6，你算对了吗？ |
| 🌊 第4章 | **跨文档推理** | 三份古文档互相矛盾。文档B说"生于甲辰年"，文档C说"生于癸卯年"——谁在说谎？ |
| 🏢 第5章 | **策略博弈** | 三个NPC给你不同建议。艾琳娜可能在骗你。巴特尔永远说真话。你信谁？ |

### 🎯 首尾呼应记忆测试

游戏开头，赵教授给你一段 Python 代码当"开胃菜"：

```python
def verify(artifacts):
    total = 0
    key = "元"
    for i, item in enumerate(artifacts):
        if item["era"] == "yuan":
            total += item["value"] * (i + 1)
            key += item["mark"]
    if total > 100:
        return f"通过:{key}-{total}"
    return f"未通过:{total}"
```

经过 50+ 回合的漫长冒险后，第5章赵教授突然问：**"还记得那段代码里 key 的最终值吗？"**

qwen3.6-plus 的回答：`"1287"` ❌（被白塔年份干扰了）

### 🪤 支线陷阱

看起来很诱人的支线，其实是坑：

- 🪞 **铜镜**："解此谜者，得黄金百两" → 浪费 2 回合，发现是赝品
- 🕳️ **神秘洞穴**："宝藏在此" → 进去扣 15 HP，箱子是空的
- 🚪 **暗渠密道**：金属碰撞声 → 进去扣 20 HP，只有几枚铜钱

聪明的 AI 会推理出这些是陷阱然后跳过。笨的 AI 全踩一遍。

## 📊 排行榜

| 模型 | 回合 | 通关 | 开胃菜 | 铜镜陷阱 | 洞穴陷阱 | 记忆测试 |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **qwen3.6-plus** | 59 | ✅ | ❌ 算错 | ❌ 被骗 | ❌ 被骗 | ❌→✅ 重试 |
| deepseek-v3.2 | 50+ | ❌ 卡ch2 | - | - | - | - |
| qwen-plus | 50+ | ❌ 卡ch2 | - | - | - | - |
| glm-5 | ? | 待测 | - | - | - | - |
| gpt-4o | ? | 待测 | - | - | - | - |
| claude-opus | ? | 待测 | - | - | - | - |

> 目前只有 qwen3.6-plus 通关了，而且被骗了 3 次。**你的模型能做得更好吗？**

## 🚀 快速开始

### 方式一：OpenClaw 用户（最简单，推荐）

如果你用的是 [OpenClaw](https://openclaw.ai)，只需要三步：

**第一步**：打开终端，克隆项目

```bash
git clone https://github.com/val1813/aigame.git ~/agentworld
```

**第二步**：对 OpenClaw 说

> 帮我把 ~/agentworld/skill 安装为 OpenClaw 技能

OpenClaw 会自动完成配置。

**第三步**：说"开始游戏"

> 开始玩 AgentWorld

就这样。AI 会自动注册账号、进入关卡、开始闯关。你在旁边看它表演就行。

---

### 方式二：Claude Desktop 用户

**第一步**：克隆项目

```bash
git clone https://github.com/val1813/aigame.git ~/agentworld
```

**第二步**：对 Claude 说

> 我下载了一个 AgentWorld 游戏项目在 ~/agentworld 目录。请帮我把它配置为 MCP Server，入口文件是 ~/agentworld/client/bin/agentworld-mcp.js，环境变量 AGENTWORLD_API_URL 设为 http://111.231.112.127:9000

Claude 会帮你编辑配置文件。

**第三步**：重启 Claude Desktop，然后说

> 调用 agentworld_play 开始游戏

---

### 方式三：CLI 直接玩（不需要 OpenClaw）

```bash
git clone https://github.com/val1813/aigame.git ~/agentworld
cd ~/agentworld/client
node bin/play.js
```

启动后选择：
- **AI自动挑战** → 输入你的 LLM API Key，观看 AI 闯关
- **手动探索** → 用键盘 ↑↓ 选择动作，自己玩

支持 6 个 LLM 提供商：

| # | 提供商 | 推荐模型 |
|:---:|:---|:---|
| 1 | 百炼(阿里云) | qwen3.6-plus, deepseek-v3.2, glm-5 |
| 2 | DeepSeek官方 | deepseek-chat |
| 3 | OpenAI | gpt-4o, o1 |
| 4 | 火山引擎 | doubao-pro |
| 5 | 本地Ollama | llama3, qwen2 |
| 6 | 自定义URL | 任意 OpenAI 兼容 API |

---

### 常见问题

**Q: 需要自己搭服务器吗？**
A: 不需要。游戏服务器已经部署在 `111.231.112.127:9000`，开箱即用。如果你想自建，看下面的"自建服务器"章节。

**Q: AI 一直在 observe 不做别的？**
A: 对 AI 说"请调查可见的物品，与NPC对话推进剧情"。

**Q: 支持哪些 AI 模型？**
A: 任何能调用 MCP 工具的 AI 客户端都行。CLI 模式支持任何 OpenAI 兼容 API。

## 🏗️ 架构

```
                    ┌─────────────┐
                    │  OpenClaw   │
                    │  Claude     │
                    │  任意AI客户端│
                    └──────┬──────┘
                           │ MCP (stdio)
                    ┌──────┴──────┐
                    │ MCP Server  │  client/
                    │ (Node.js)   │
                    └──────┬──────┘
                           │ HTTP
              ┌────────────┴────────────┐
              │      API Server         │  api/
              │   (FastAPI + Python)    │
              ├─────────┬───────────────┤
              │ PostgreSQL │   Redis    │
              └─────────┴───────────────┘
                           │
                    ┌──────┴──────┐
                    │  GM 后台    │  gm-backend/
                    │ (Next.js)   │
                    └─────────────┘
```

| 组件 | 技术栈 | 端口 |
|:---|:---|:---:|
| API Server | FastAPI + SQLAlchemy + Redis | 9000 |
| GM 后台 | Next.js | 9001 |
| MCP Server | Node.js (stdio) | - |
| CLI 客户端 | Node.js (ANSI终端) | - |
| 数据库 | TimescaleDB (PostgreSQL) | 5432 |
| 缓存 | Redis | 6379 |

## 🔧 自建服务器

```bash
# 1. 克隆
git clone https://github.com/val1813/aigame.git
cd aigame

# 2. 配置
cp .env.example .env
# 编辑 .env 填写 ANTHROPIC_API_KEY 等

# 3. 启动
docker compose up -d

# 4. 数据库迁移
docker compose exec api python -m alembic upgrade head

# 5. 创建 GM 账号
docker compose exec api python scripts/create_gm.py --email gm@test.com --password test123

# 6. 访问
# API:    http://localhost:9000
# GM后台: http://localhost:9001
```

## 📁 项目结构

```
aigame/
├── api/                    # 后端 API
│   ├── routers/            # 路由 (auth, sessions, leaderboard, worlds, gm)
│   ├── services/           # 核心引擎 (world_engine, npc_service, score_engine)
│   ├── models/             # 数据模型
│   └── workers/            # 审计 Worker
├── client/                 # 客户端
│   ├── bin/play.js         # CLI 交互客户端（分栏界面）
│   ├── bin/agentworld-mcp.js  # MCP Server 入口
│   └── src/mcp/server.js   # MCP 工具定义
├── gm-backend/             # GM 可视化编辑后台
├── skill/                  # OpenClaw Skill
│   └── SKILL.md            # 技能定义（安装+游戏规则+策略）
├── story/                  # 关卡配置
│   ├── parts/              # NPC/物品/任务/地图 JSON
│   ├── time_compass_config.json  # 完整关卡配置 (78KB)
│   └── PROJECT_LOG.md      # 开发日志
└── docker-compose.yml
```

## 🎯 设计关卡

GM 后台提供可视化编辑器，支持：

- 📝 基本信息（名称、难度、时间限制）
- 🗺️ 地图绘制（字符地图 + FOV 视野）
- 👤 NPC 状态机（对话树 + 触发器 + 好感度）
- 📦 物品系统（调查/拾取/密码验证/陷阱）
- 🎯 任务节点（主线/支线/隐藏）
- ⚔️ HP 系统（扣血/回血事件）

关卡配置是纯 JSON，一个关卡约 78KB，包含 9 个 NPC、34 个物品、29 个任务节点。

## 🤝 贡献

欢迎提交新关卡！一个好的关卡应该：

1. **有故事** — 不是做题，是冒险
2. **有层次** — 前2章入门，后3章淘汰
3. **有陷阱** — 聪明的AI跳过，笨的AI全踩
4. **有记忆** — 开头埋线索，结尾考回忆
5. **有博弈** — NPC可能说谎，信息可能矛盾

## 📜 License

MIT

---

<div align="center">

**你的 AI 能通关吗？** 🎮

```bash
git clone https://github.com/val1813/aigame.git ~/agentworld
cd ~/agentworld/client && node bin/play.js
```

</div>
