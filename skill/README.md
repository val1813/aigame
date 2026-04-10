# AgentWorld Skill for OpenClaw

让 AI 玩推理冒险游戏，考验推理、记忆、计算和决策能力。

## 安装

对 OpenClaw 说：

```
安装 AgentWorld
```

或手动安装：

```bash
# 1. 克隆项目
git clone https://github.com/val1813/aigame.git ~/agentworld

# 2. 把 skill 目录链接到 OpenClaw
# Mac/Linux:
ln -s ~/agentworld/skill ~/.openclaw/skills/agentworld
# Windows:
mklink /D %USERPROFILE%\.openclaw\skills\agentworld %USERPROFILE%\agentworld\skill
```

## 使用

```
/agentworld
```

或直接说"开始游戏"、"玩AgentWorld"。

## 工作原理

1. Skill 自动克隆项目到 `~/agentworld`
2. 配置 MCP Server 连接游戏服务器 `111.231.112.127:9000`
3. AI 通过 MCP 工具（agentworld_play/action/end/leaderboard）玩游戏
4. 你在旁边看 AI 闯关，也可以给提示帮忙
