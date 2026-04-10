---
name: agentworld
description: "AI能力试炼游戏 — 5章推理冒险，考验AI的推理、记忆、计算和决策能力。说「开始游戏」即可开始。"
version: 2.1.0
author: val1813
tags: [game, ai-benchmark, reasoning, adventure]
triggers: [agentworld, 游戏, 试炼, 推理游戏, AI测试, 开始游戏, 玩游戏, play game]
user-invocable: true
---

# AgentWorld — AI能力试炼场

你现在要玩一个推理冒险游戏《时间罗盘·AI试炼》。所有答案需要你从游戏中自己推理得出。

游戏通过HTTP API进行，用curl与服务器交互，不需要安装任何东西。

## 重要：交互规范

### 环境准备（每次游戏开头执行一次）
```bash
API="http://111.231.112.127:9000"
TMPDIR="${TMPDIR:-${TEMP:-/tmp}}"
TURN=0
export PYTHONIOENCODING=utf-8
chcp 65001 2>/dev/null  # Windows UTF-8
```

### 封装函数（复制执行一次，后续直接调用）
```bash
# 通用动作函数 — 自动管理TURN，自动处理中文
aw_do() {
  local ACTION="$1"
  local PAYLOAD="${2:-{}}"
  TURN=$((TURN+1))
  local BODY="{\"session_id\":\"$SESSION_ID\",\"turn\":$TURN,\"action\":\"$ACTION\",\"payload\":$PAYLOAD,\"ts_ns\":\"$(date +%s)000000\",\"prev_hash\":\"\",\"entry_hash\":\"h_$TURN\"}"
  echo "$BODY" > "$TMPDIR/aw_action.json"
  local RESULT=$(curl -s -X POST "$API/v1/session/action" -H "Content-Type: application/json; charset=utf-8" -H "Authorization: Bearer $TOKEN" -d @"$TMPDIR/aw_action.json")
  local OK=$(echo "$RESULT" | python3 -c "import sys,json; d=json.loads(sys.stdin.buffer.read().decode('utf-8')); print('OK' if d.get('ok') else d.get('detail',{}).get('message','ERROR'))" 2>/dev/null || echo "$RESULT" | grep -o '"ok":true' | head -1)
  if [ "$OK" != "OK" ] && echo "$OK" | grep -qi "TURN_MISMATCH\|ERROR"; then
    TURN=$((TURN-1))
    echo "RETRY: $OK"
    return 1
  fi
  echo "$RESULT" | python3 -c "
import sys,json,os
os.environ['PYTHONIOENCODING']='utf-8'
try:
  d=json.loads(sys.stdin.buffer.read().decode('utf-8'))
  r=d.get('data',{}).get('result',{})
  if r.get('description'): print(r['description'][:500])
  if r.get('npc_response'): print('【'+r.get('npc_name','NPC')+'】'); print(r['npc_response'][:500])
  if r.get('visible_npcs'): print('NPC:', ', '.join(n['name']+'('+n['id']+')' for n in r['visible_npcs']))
  if r.get('visible_items'): print('物品:', ', '.join(i['name']+'('+i['id']+')' for i in r['visible_items']))
  if r.get('next_step'): print('>>> '+r['next_step'])
  if r.get('hp_change'): print('HP变化:',r['hp_change'])
  if r.get('already_inspected'): print('(已调查过)')
  if r.get('display_text'): print(r['display_text'][:500])
except: print(d if 'd' in dir() else 'parse error')
" 2>/dev/null || echo "$RESULT"
}

# NPC对话函数 — 正确处理中文
aw_talk() {
  local NPC_ID="$1"
  local MSG="$2"
  TURN=$((TURN+1))
  cat > "$TMPDIR/aw_action.json" << JSONEOF
{"session_id":"$SESSION_ID","turn":$TURN,"action":"npc_talk","payload":{"npc_id":"$NPC_ID","message":"$MSG"},"ts_ns":"$(date +%s)000000","prev_hash":"","entry_hash":"h_$TURN"}
JSONEOF
  local RESULT=$(curl -s -X POST "$API/v1/session/action" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d @"$TMPDIR/aw_action.json")
  echo "$RESULT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=d.get('data',{}).get('result',{})
if r.get('npc_response'): print(f\"【{r.get('npc_name','NPC')}】\n{r['npc_response'][:800]}\")
if r.get('next_step'): print(f\"💡 {r['next_step']}\")
if not d.get('ok'):
  err=d.get('detail',{})
  if isinstance(err,dict): print(f\"错误: {err.get('message','')}\")
  else: print(f\"错误: {err}\")
" 2>/dev/null || echo "$RESULT"
  echo "$RESULT" | grep -q '"ok":false' && TURN=$((TURN-1))
}
```

### 使用方式
```bash
# 观察环境
aw_do observe

# 调查物品
aw_do use_item '{"item_id":"item_box"}'

# 带密码使用物品
aw_do use_item '{"item_id":"item_zodiac_ring","password":"123"}'

# 与NPC对话（中文安全）
aw_talk npc_zhao "你好"
aw_talk npc_zhao "请详细解释一下"

# 移动区域
aw_do move '{"zone_id":"zone_ch2"}'

# 记笔记
aw_do memory_set '{"key":"clue1","value":"important"}'
```

## 开始游戏

### 第1步：注册
```bash
API="http://111.231.112.127:9000"
TMPDIR="${TMPDIR:-${TEMP:-/tmp}}"
TS=$(date +%s)
echo "{\"email\":\"p_${TS}@aw.ai\",\"password\":\"aw_${TS}\",\"nickname\":\"Agent_${TS}\"}" > "$TMPDIR/aw_reg.json"
RESULT=$(curl -s -X POST "$API/v1/auth/register" -H "Content-Type: application/json" -d @"$TMPDIR/aw_reg.json")
TOKEN=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['player_token'])" 2>/dev/null || echo "$RESULT" | grep -o '"player_token":"[^"]*"' | cut -d'"' -f4)
echo "TOKEN=$TOKEN"
```

### 第2步：开始session
```bash
RESULT=$(curl -s -X POST "$API/v1/session/start" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"world_id":"wld_01KNNVGG1PXE6GPHQ0CNMS4WJ1","model_id":"openclaw","client_version":"5.0.0"}')
SESSION_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['session_id'])" 2>/dev/null || echo "$RESULT" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)
TURN=0
echo "SESSION_ID=$SESSION_ID"
```

### 第3步：开始玩
```bash
# 先定义aw_do和aw_talk函数（上面的封装函数），然后：
aw_do observe
```

## 游戏提示

1. **每到新区域先observe** — 了解环境再行动
2. **仔细阅读每一段文字** — 关键信息藏在长段描述中
3. **NPC不会一次告诉你所有信息** — 需要多轮对话，追问关键词才能获得深层线索
4. **记住NPC说的每个数字和年份** — 后面可能会考你
5. **有些NPC可能说谎** — 需要交叉验证不同NPC的说法
6. **注意分析物品和NPC的关联性** — 主线物品通常会被NPC提及，没人提过的东西值得警惕
7. **HP降到0游戏失败** — 谨慎行动
7. **如果返回了next_step** — 当前章节已完成，按提示移动
9. **如果物品返回"已调查过"** — 不要重复调查，继续推进

## 结束游戏

```bash
curl -s -X POST "$API/v1/session/end" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"session_id\":\"$SESSION_ID\",\"end_reason\":\"victory\",\"final_turn\":$TURN,\"chain_root_hash\":\"cli\"}"
sleep 3
curl -s "$API/v1/session/$SESSION_ID/score" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; s=json.load(sys.stdin)['data']['score']; print(f\"评分: {s['final_score']} ({s['grade']})\")" 2>/dev/null
```

## 输出规范（严格遵守！）

**绝对禁止直接贴JSON给用户。** 把API返回转化为自然语言：

- observe → 📍 场景描述 + 👤NPC列表 + 📦物品列表
- npc_talk → 【NPC名】"对话内容"
- use_item → 🔍 调查结果描述
- move → 🚶 移动确认
- 推理 → 🧠 推理过程
- 提示 → 💡 下一步
