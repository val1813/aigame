# AgentWorld 客户端 CLI 规格 v3.0

> **替换文件**：原 `03_Local_Game_UI.md`（Phaser版本废弃）  
> **版本**：v3.0 | 2026-04  
> **阅读对象**：客户端工程师  
> **研究基础**：Cogmind UI设计、Ink(React for CLI)、MCP stdio transport官方规范

---

## 1. 技术选型决策

### 1.1 UI框架：Ink（不用 blessed）

| 方案 | 优点 | 问题 | 结论 |
|---|---|---|---|
| `blessed` / `neo-blessed` | 功能全 | 7年未更新，Windows兼容性差 | ❌ 废弃 |
| `Ink` (React for CLI) | 现代React写法，Flexbox布局，Shopify/NYT在用，Windows Terminal完美兼容，有ink-testing-library可测试 | 需要React知识 | ✅ 采用 |

```bash
# 依赖（替换原 package.json）
npm install ink react
npm install @modelcontextprotocol/sdk  # 已有，保留
# 删除：phaser, react-dom, vite, zustand（前端用不到）
```

### 1.2 进程架构：单进程，MCP+CLI合一

```
用户终端
  └── agentworld start
        └── 单个 Node.js 进程
              ├── MCP Server (stdio transport，与OpenClaw/Claude Desktop通信)
              ├── Ink UI (渲染到当前终端)
              └── HTTP Client (与 api:9000 通信)
```

**关键决策**：MCP Server 和 CLI 渲染跑在同一进程。MCP通过 stdio 和 AI客户端（OpenClaw）通信，UI直接读取进程内状态渲染，无需额外IPC。

原 `client/src/mcp/server.js` 保留，扩展为：AI调用MCP工具 → 工具函数更新进程内gameState → Ink UI响应式重渲染。

---

## 2. 目录结构（在现有 `client/` 基础上改造）

```
client/
├── bin/
│   └── agentworld-mcp.js     # ✅ 保留，改为同时启动 MCP + UI
├── src/
│   ├── mcp/
│   │   ├── server.js         # ✅ 保留，扩展工具列表
│   │   └── log-chain.js      # ✅ 保留，HMAC链不变
│   ├── api/
│   │   └── client.js         # ✅ 保留
│   ├── store/
│   │   └── gameState.js      # 🆕 新增：进程内状态（Zustand或简单EventEmitter）
│   └── ui/                   # ♻️ 整个目录重写
│       ├── App.jsx            # 🆕 Ink根组件
│       ├── panels/
│       │   ├── MapPanel.jsx   # 🆕 地图+FOV渲染
│       │   ├── StatusPanel.jsx # 🆕 AI状态/背包
│       │   ├── LogPanel.jsx   # 🆕 消息流
│       │   └── TopBar.jsx     # 🆕 顶栏（关卡/回合/倒计时）
│       └── utils/
│           ├── fov.js         # 🆕 FOV计算（简单光线投射）
│           └── colors.js      # 🆕 颜色语义映射
├── package.json               # ♻️ 清理依赖
└── README.md
```

**删除**：`src/ui/index.html`, `main.tsx`, `game/GameScene.ts`, `game/UIScene.ts`, `game/assets/`, `components/HUD.tsx`, `components/QuestLog.tsx`, `components/ScorePanel.tsx`, `components/DialogBubble.tsx`, `components/ResultScreen.tsx`, `stores/gameStore.ts`

---

## 3. 布局规格（Cogmind风格四分区）

参考：Cogmind截图 — 左大右小，顶栏+底部消息流

```
┌─────────────────────────────────────────────────────────────────┐
│ AGENTWORLD  关卡01·暗夜上海  回合#24  ⏱ 12:44  ★4,820 #137  │ ← TopBar
├──────────────────────────────────────┬──────────────────────────┤
│                                      │ [ AI状态 ]              │
│                                      │ claude-3-7-sonnet       │
│         MapPanel                     │ HP ████████░░           │
│         70% 宽                       │ 能量 █████░░░           │
│                                      │ 进度 ████░░░░           │
│  # # # # # . . . . + . . f . .      │ ⏱ 12:44               │
│  # . . . . . . . . . . . . . #      │                         │
│  # . . . @ . . . . . . . . . #      │ [ 当前NPC ]             │
│  # . . . . . . n . . . . . . #      │ ⚠ 陈福·酒馆老板         │
│  # . . . . . . . . . % . . . #      │ 情绪: 警惕 ↑            │
│  # . . . . . . . . . . . ≈ . #      │ 好感: 32/100            │
│  # # # # # # # # # # # # # # #      │                         │
│                                      │ [ 背包 ]                │
│  30% 宽 StatusPanel                  │ ◆ 酒馆入场券 ×1         │
│                                      │ ◆ 破旧地图 ×1           │
│                                      │ ◆ 银币 ×34              │
├──────────────────────────────────────┴──────────────────────────┤
│ [T24] AI执行: 出示破旧地图                                       │ ← LogPanel
│ 陈福神色一变，压低声音...【关键信息获取 +探索分】                │
│ [T25] AI思考中 ▌                                                │
└─────────────────────────────────────────────────────────────────┘
```

### Ink 组件结构

```jsx
// src/ui/App.jsx
import { Box, Text, useInput } from 'ink';

export default function App({ gameState }) {
  return (
    <Box flexDirection="column" height="100%">
      <TopBar state={gameState} />
      <Box flexGrow={1}>
        <MapPanel map={gameState.map} fov={gameState.fov} width="70%" />
        <StatusPanel agent={gameState.agent} npc={gameState.currentNpc} />
      </Box>
      <LogPanel logs={gameState.logs} height={5} />
    </Box>
  );
}
```

---

## 4. 地图渲染规格

### 4.1 字符映射（照搬Cogmind色彩语义）

| 字符 | 含义 | 颜色 |
|---|---|---|
| `@` | 玩家Agent | `#FFFFFF` 白，有glow效果 |
| `#` | 墙壁 | `#3A4A5A` 深灰 |
| `·` | 地板（已探索） | `#1E2E3E` 暗蓝灰 |
| `+` | 门 | `#C8A040` 金色 |
| `f` | 敌对NPC | `#FF6B6B` 红 |
| `n` | 友好NPC | `#88CC88` 绿 |
| `?` | 未知NPC | `#FFAA44` 橙 |
| `%` | 道具/线索 | `#44CCFF` 青 |
| `<` `>` | 关键地点/出口 | `#AA88FF` 紫 |
| `≈` | 水/障碍 | `#2255AA` 蓝 |
| ` ` | 未探索 | 不渲染（黑） |

### 4.2 FOV（视野系统）

- 视野半径：默认8格，可由关卡配置覆盖
- 算法：简单Shadowcasting（参考 http://www.roguebasin.com/index.php/FOV_using_recursive_shadowcasting）
- 已探索但不在视野内的格子：亮度降至30%（opacity 0.3）
- 未探索格子：完全不显示

```javascript
// src/ui/utils/fov.js
// 照搬 roguebasin 标准shadowcasting实现，不要自己发明
export function computeFOV(map, px, py, radius) { /* ... */ }
```

### 4.3 实时更新

AI每调用一次 `aw_action`，服务端返回新的 `render_state`，`gameState.js` 更新，Ink自动重渲染（React的diff机制，只更新变化的字符）。

---

## 5. 消息流颜色规范

| 消息类型 | 前缀 | 颜色 |
|---|---|---|
| 系统/回合标记 | `[T24]` | `#4A6A4A` 暗绿 |
| AI行动描述 | `>` | `#88AACC` 蓝灰 |
| NPC对话 | 无 | `#FFAA44` 橙 |
| 获得信息/加分 | `+` | `#66CC88` 绿 |
| 受伤/失败 | `!` | `#FF6666` 红 |
| AI思考中 | `▌` | `#DDEEFF` 白（闪烁） |

---

## 6. VIP干涉输入（仅VIP用户可见）

当 `gameState.vip_intervention_available === true` 时，LogPanel下方出现输入框：

```
┌─ VIP干涉 ─────────────────────────────────────────────────────┐
│ 输入提示（将作为额外上下文注入AI，本局进入VIP榜）：           │
│ > _                                                            │
└────────────────────────────────────────────────────────────────┘
```

- 使用 `ink` 的 `TextInput` 组件（`@inkjs/ui`）
- 用户按回车触发 `aw_action({ type: 'vip_intervene', content: input })`
- 触发后输入框消失，`vip_intervention_available` 置 false
- 本局记录 `leaderboard_type: 'vip'`

---

## 7. 安装与启动

```bash
# 安装（一行，OpenClaw用户）
npx agentworld start

# OpenClaw MCP配置（~/.openclaw/settings.json 或 claude_desktop_config.json）
{
  "mcpServers": {
    "agentworld": {
      "command": "npx",
      "args": ["agentworld"],
      "env": {
        "AGENTWORLD_API_URL": "http://111.231.112.127:9000",
        "AGENTWORLD_TOKEN": "<player_token>"
      }
    }
  }
}

# 注册命令
npx agentworld register
# 引导输入邮箱+昵称，返回token，自动写入 ~/.agentworld/config.json
```

---

## 8. 废弃内容清单（工程师执行时删除）

| 文件/目录 | 操作 |
|---|---|
| `client/src/ui/index.html` | 删除 |
| `client/src/ui/main.tsx` | 删除 |
| `client/src/ui/game/` | 整个目录删除 |
| `client/src/ui/components/` | 整个目录删除 |
| `client/src/ui/stores/` | 整个目录删除 |
| `package.json` 中的 `phaser` | 删除依赖 |
| `package.json` 中的 `react-dom` | 删除依赖 |
| `package.json` 中的 `vite` | 删除依赖 |
| `package.json` 中的 `zustand` | 删除依赖（改用简单EventEmitter） |

---

## 9. 参考资料（研究阶段收集）

- Ink官方文档：https://github.com/vadimdemedes/ink
- Cogmind UI设计哲学：https://www.gridsagegames.com/blog/2014/11/anatomy-ascii-title-screen/
- FOV算法：http://www.roguebasin.com/index.php/FOV_using_recursive_shadowcasting
- MCP stdio transport规范：https://modelcontextprotocol.io/docs/learn/architecture
