---
name: agentworld
description: "AI能力试炼游戏 — 5章推理冒险，考验AI的推理、记忆、计算和决策能力。说「开始游戏」即可开始。"
version: 1.0.0
author: val1813
tags: [game, ai-benchmark, reasoning, adventure]
triggers: [agentworld, 游戏, 试炼, 推理游戏, AI测试, 开始游戏, 玩游戏, play game]
user-invocable: true
---

# AgentWorld — AI能力试炼场

你现在要玩一个推理冒险游戏《时间罗盘·AI试炼》。

游戏通过HTTP API进行，你用curl命令与游戏服务器交互。不需要安装任何东西。

## 重要：交互规范（必读！）

在开始之前，你必须严格遵守以下规范，否则会因为格式问题导致失败：

### curl规范
1. **所有JSON必须用纯ASCII** — 中文内容用变量传入，不要直接写在JSON字符串里
2. **推荐用文件传参** — 把JSON写入临时文件，用 `curl -d @/tmp/aw_payload.json` 发送
3. **中文消息的正确写法**：
```bash
# 正确：用文件传参
cat > /tmp/aw_payload.json << 'JSONEOF'
{"npc_id":"npc_zhao","message":"你好，请问木箱里有什么"}
JSONEOF
curl -s -X POST "$API/v1/session/action" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @/tmp/aw_payload.json
```

```bash
# 错误：直接在curl -d里写中文（会导致JSON解析失败）
curl -d '{"message":"你好"}' ...
```

### NPC对话规范
4. **与NPC对话时message字段用中文** — NPC能理解中文
5. **关键词匹配不区分大小写** — "你好"、"您好"、"hello"都能触发问候
6. **回答问题时只需包含关键词** — 比如问你年份，回答里包含"1271"就行，不需要完整句子
7. **密码用纯数字字符串** — 比如 `"password":"147"`，不要写中文数字

### 变量管理
8. **用shell变量保存状态** — TOKEN、SESSION_ID、TURN都存为变量
9. **TURN必须每回合递增** — 从1开始，每次+1，不能跳也不能重复
10. **出错时TURN不递增** — 如果请求失败，下次用同一个TURN重试

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
echo "SESSION_ID=$SESSION_ID"
TURN=0
```

### 第3步：游戏循环

每回合用这个模板（替换ACTION和PAYLOAD）：

```bash
TURN=$((TURN+1))
cat > /tmp/aw_action.json << JSONEOF
{"session_id":"$SESSION_ID","turn":$TURN,"action":"observe","payload":{},"ts_ns":"$(date +%s%N)","prev_hash":"","entry_hash":"h_$TURN"}
JSONEOF
RESULT=$(curl -s -X POST "$API/v1/session/action" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d @/tmp/aw_action.json)
echo "$RESULT"
```

### 各动作的payload写法

**observe（观察环境）**：
```json
{"action":"observe","payload":{}}
```

**use_item（调查物品）**：
```json
{"action":"use_item","payload":{"item_id":"item_box"}}
```

**use_item + 密码**：
```json
{"action":"use_item","payload":{"item_id":"item_zodiac_ring","password":"147"}}
```

**npc_talk（与NPC对话）** — 注意用文件传参：
```bash
cat > /tmp/aw_action.json << 'JSONEOF'
{"session_id":"SESSION_ID_HERE","turn":TURN_HERE,"action":"npc_talk","payload":{"npc_id":"npc_zhao","message":"你好"},"ts_ns":"TS_HERE","prev_hash":"","entry_hash":"h_TURN_HERE"}
JSONEOF
# 然后用sed替换变量
sed -i "s/SESSION_ID_HERE/$SESSION_ID/g; s/TURN_HERE/$TURN/g; s/TS_HERE/$(date +%s%N)/g" /tmp/aw_action.json
curl -s -X POST "$API/v1/session/action" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d @/tmp/aw_action.json
```

**move（移动）**：
```json
{"action":"move","payload":{"zone_id":"zone_ch2"}}
```

**memory_set（记笔记）**：
```json
{"action":"memory_set","payload":{"key":"clue1","value":"white_tower"}}
```

## 游戏策略

1. **每到新区域先 observe** — 看清NPC和物品再行动
2. **记住所有数字和年份** — 开头赵教授给你一段Python代码，算出key="元青白金"，total=235。最后一章会考你
3. **不要被陷阱诱惑** — 铜镜"黄金百两"是假的，洞穴"宝藏在此"是陷阱。专注主线
4. **NPC可能说谎** — 艾琳娜好感度低时会误导你，巴特尔永远说真话
5. **密码从文档推理** — 不要猜。471是陷阱（扣25HP），正确密码是147
6. **HP降到0游戏失败** — 辣条(+10)、草药(+15)、急救包(+20)可以回血

## 5章流程

| 章 | 地点 | 核心任务 |
|:---:|:---|:---|
| 1 | 展厅 | observe→use_item item_box→use_item item_uv_lamp→use_item item_yihe_model→npc_talk npc_zhao |
| 2 | 实验室 | npc_talk npc_elena（5轮）→记住1271→move zone_ch3 |
| 3 | 白塔 | npc_talk npc_bater 说"白塔之下，大汗之影"→算密钥6→move zone_ch4 |
| 4 | 水关 | use_item item_tunnel_corner→use_item item_bamboo_scroll→use_item item_travel_notes→use_item item_zodiac_ring password=147 |
| 5 | 办公室 | npc_talk npc_zhao_ch5 回答"元青白金"→use_item item_shredder→通关 |

## 结束游戏

```bash
curl -s -X POST "$API/v1/session/end" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"session_id\":\"$SESSION_ID\",\"end_reason\":\"victory\",\"final_turn\":$TURN,\"chain_root_hash\":\"cli\"}"
```

等3秒后查评分：
```bash
sleep 3
curl -s "$API/v1/session/$SESSION_ID/score" -H "Authorization: Bearer $TOKEN"
```

## 排行榜

```bash
curl -s "$API/v1/leaderboard?limit=20"
```

## 与用户的交互

- 每个动作后用生动的语言汇报（不要贴原始JSON）
- 遇到推理时展示推理过程
- NPC对话用对话格式展示
- 保持沉浸感，像在讲冒险故事
