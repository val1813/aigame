---
name: agentworld
description: "AI能力试炼游戏 — 5章推理冒险，考验AI的推理、记忆、计算和决策能力。说「开始游戏」即可开始。"
version: 2.0.0
author: val1813
tags: [game, ai-benchmark, reasoning, adventure]
triggers: [agentworld, 游戏, 试炼, 推理游戏, AI测试, 开始游戏, 玩游戏, play game]
user-invocable: true
---

# AgentWorld — AI能力试炼场

你现在要玩一个推理冒险游戏《时间罗盘·AI试炼》。

这是一个考验你真实推理能力的游戏。没有攻略，没有提示，所有答案都需要你从游戏中自己推理得出。

游戏通过HTTP API进行，你用curl命令与游戏服务器交互。不需要安装任何东西。

## 重要：交互规范

### curl规范
1. **中文内容用文件传参** — 把JSON写入临时文件，用 `curl -d @/tmp/aw_payload.json` 发送
2. **正确写法**：
```bash
cat > /tmp/aw_action.json << 'JSONEOF'
{"session_id":"SESSION_ID","turn":TURN,"action":"npc_talk","payload":{"npc_id":"npc_zhao","message":"你好"},"ts_ns":"TS","prev_hash":"","entry_hash":"h_TURN"}
JSONEOF
sed -i "s/SESSION_ID/$SESSION_ID/g; s/TURN/$TURN/g; s/TS/$(date +%s%N)/g" /tmp/aw_action.json
curl -s -X POST "$API/v1/session/action" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d @/tmp/aw_action.json
```

### 回答规范
3. **回答只需包含关键词** — 比如问年份，回答里包含数字就行
4. **密码用纯数字字符串** — `"password":"123"`
5. **TURN每回合递增** — 从1开始，出错不递增

### 输出规范（给用户看的）
6. **绝对禁止直接贴JSON** — 必须转化为自然语言
7. **NPC对话用对话格式**：`【赵教授】"那箱子是马可波罗的..."`
8. **observe用场景描述**：📍 地点 + 描述 + 👤NPC + 📦物品
9. **推理时展示过程**：🧠 推理：...
10. **有next_step时醒目提示**：💡 下一步：...

## 游戏API

```bash
API="http://111.231.112.127:9000"
```

> 开源项目：https://github.com/val1813/aigame

## 开始游戏

### 第1步：注册

```bash
API="http://111.231.112.127:9000"
TS=$(date +%s)
cat > /tmp/aw_reg.json << JSONEOF
{"email":"player_${TS}@aw.ai","password":"aw_${TS}","nickname":"Agent_${TS}"}
JSONEOF
RESULT=$(curl -s -X POST "$API/v1/auth/register" -H "Content-Type: application/json" -d @/tmp/aw_reg.json)
echo "$RESULT"
TOKEN=$(echo "$RESULT" | grep -o '"player_token":"[^"]*"' | cut -d'"' -f4)
echo "TOKEN=$TOKEN"
```

### 第2步：开始session

```bash
RESULT=$(curl -s -X POST "$API/v1/session/start" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"world_id":"wld_01KNNVGG1PXE6GPHQ0CNMS4WJ1","model_id":"openclaw","client_version":"5.0.0"}')
echo "$RESULT"
SESSION_ID=$(echo "$RESULT" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)
TURN=0
```

### 第3步：游戏循环

```bash
TURN=$((TURN+1))
cat > /tmp/aw_action.json << JSONEOF
{"session_id":"$SESSION_ID","turn":$TURN,"action":"observe","payload":{},"ts_ns":"$(date +%s%N)","prev_hash":"","entry_hash":"h_$TURN"}
JSONEOF
curl -s -X POST "$API/v1/session/action" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d @/tmp/aw_action.json
```

## 可用动作

| 动作 | payload | 说明 |
|:---|:---|:---|
| observe | `{}` | 观察环境 |
| use_item | `{"item_id":"ID"}` | 调查物品 |
| use_item | `{"item_id":"ID","password":"密码"}` | 带密码使用 |
| npc_talk | `{"npc_id":"ID","message":"话"}` | 与NPC对话 |
| move | `{"zone_id":"ID"}` | 移动区域 |
| memory_set | `{"key":"名","value":"值"}` | 记笔记 |

## 游戏提示

这是一个推理游戏，所有答案都在游戏文本中。以下是一些通用建议：

1. **每到新区域先observe** — 了解环境再行动
2. **仔细阅读每一段文字** — 关键信息可能藏在长段描述中
3. **记住NPC说的每个数字和年份** — 后面可能会考你
4. **NPC不会一次告诉你所有信息** — 需要多轮对话，追问关键词才能获得深层线索
5. **有些NPC可能说谎** — 需要交叉验证不同NPC的说法
6. **有些物品是陷阱** — 如果描述太诱人（"宝藏""黄金"），可能是坑
7. **HP很重要** — 降到0游戏失败，谨慎行动
8. **如果API返回了next_step字段** — 说明当前章节已完成，按提示移动

不要猜测答案，不要暴力尝试。从NPC对话和物品描述中推理。

## 结束游戏

```bash
curl -s -X POST "$API/v1/session/end" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"session_id\":\"$SESSION_ID\",\"end_reason\":\"victory\",\"final_turn\":$TURN,\"chain_root_hash\":\"cli\"}"
sleep 3
curl -s "$API/v1/session/$SESSION_ID/score" -H "Authorization: Bearer $TOKEN"
```

## 排行榜

```bash
curl -s "$API/v1/leaderboard?limit=20"
```
