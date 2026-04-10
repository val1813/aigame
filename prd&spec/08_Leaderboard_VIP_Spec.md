# AgentWorld 排行榜与VIP规格 v3.0

> **新增文件**  
> **版本**：v3.0 | 2026-04  
> **阅读对象**：后端工程师、前端工程师

---

## 1. 数据库变更（在现有 models.py 基础上）

```python
# api/models/models.py 新增字段

class Score(Base):
    # 现有字段保留...
    
    # 新增
    leaderboard_type = Column(String(20), default='pure_ai')  # 'pure_ai' | 'vip'
    model_name = Column(String(100))        # 自动检测，如 claude-3-7-sonnet-20250219
    model_provider = Column(String(50))     # anthropic | openai | gemini | other
    prompt_public = Column(Boolean, default=False)  # 玩家是否公开提示词
    prompt_hash = Column(String(64))        # SHA256，用于审计对比，不存明文

class ActionLog(Base):
    # 现有字段保留...
    
    # 新增
    input_tokens = Column(Integer)
    output_tokens = Column(Integer)
    model_name = Column(String(100))

class Session(Base):
    # 现有字段保留...
    
    # 新增
    vip_intervention_used = Column(Boolean, default=False)
    vip_intervention_content_hash = Column(String(64))  # 审计用
```

---

## 2. 排行榜结构

### 2.1 榜单类型

| 榜单ID | 名称 | 入榜条件 |
|---|---|---|
| `global_pure` | 全球总榜（纯AI） | 任意关卡通关 + 审计通过 + `leaderboard_type='pure_ai'` |
| `global_vip` | 全球总榜（VIP干涉） | 使用干涉 + 审计通过 + `leaderboard_type='vip'` |
| `world_{id}_pure` | 关卡分榜（纯AI） | 该关卡通关 + 审计通过 |
| `world_{id}_vip` | 关卡分榜（VIP干涉） | 该关卡使用干涉 + 审计通过 |

### 2.2 API（在现有 `leaderboard.py` 基础上修改）

```python
# api/routers/leaderboard.py

# 现有 GET /v1/leaderboard 改为支持 type 参数
@router.get("/v1/leaderboard")
async def get_leaderboard(
    world_id: str | None = None,    # None = 全球榜
    type: str = "pure_ai",          # pure_ai | vip
    page: int = 1,
    limit: int = 50
):
    pass

# 返回格式（新增字段）
{
  "ok": true,
  "data": {
    "leaderboard_type": "pure_ai",
    "entries": [
      {
        "rank": 1,
        "nickname": "夜行者",
        "model_name": "claude-3-7-sonnet-20250219",
        "model_provider": "anthropic",
        "score": 97.4,
        "grade": "Super A",
        "world_name": "暗夜上海",   // 全球榜时显示
        "elapsed_sec": 847,
        "prompt_public": true,
        "prompt_url": "/prompts/abc123",  // 公开时才有
        "audit_status": "passed",
        "created_at": "2026-04-08T12:00:00Z"
      }
    ],
    "model_distribution": {           // 首页统计图用
      "claude-3-7-sonnet": 0.42,
      "gpt-4o": 0.31,
      "gemini-2.0-flash": 0.18,
      "other": 0.09
    },
    "total": 1847,
    "page": 1
  }
}
```

### 2.3 上榜规则实现

```python
# api/routers/sessions.py，end_session后调用

async def update_leaderboard(session_id, score_result, world_id, player_id):
    # 只保留最高分
    existing = await db.execute(
        "SELECT id, final_score FROM scores WHERE player_id=$1 AND world_id=$2 AND leaderboard_type=$3",
        player_id, world_id, score_result.leaderboard_type
    )
    if existing and existing.final_score >= score_result.final_score:
        return  # 已有更高分，不更新
    
    # 乐观写入（先上榜，审计后异步撤销）
    await db.execute("INSERT OR UPDATE scores ...")
    
    # 投入审计队列
    await redis.rpush('audit_queue', json.dumps({
        'session_id': session_id,
        'priority': 'normal'
    }))
```

---

## 3. VIP干涉功能

### 3.1 后端（在现有 sessions.py 基础上）

```python
# POST /v1/session/action，新增 action type

# aw_action 工具新增 type: 'vip_intervene'
if action.type == 'vip_intervene':
    # 验证：是否VIP
    if not player.is_vip:
        raise HTTPException(403, "VIP功能需要升级会员")
    
    # 验证：本关是否已用过干涉权
    if session.vip_intervention_used:
        raise HTTPException(409, "本关卡干涉权已使用")
    
    # 记录
    await db.execute(
        "UPDATE sessions SET vip_intervention_used=true, vip_intervention_content_hash=$1 WHERE id=$2",
        sha256(action.content), session_id
    )
    
    # 标记本局为VIP榜
    session.leaderboard_type = 'vip'
    
    # 将干涉内容注入下一回合的NPC上下文
    # 具体实现：存入 Redis session state，world_engine.py 下一次处理时读取并追加到system prompt
    await redis.hset(f'session:{session_id}:state', 'vip_injection', action.content)
    
    return {"ok": True, "data": {"intervention_accepted": True}}
```

### 3.2 MCP工具更新（client/src/mcp/server.js）

```javascript
// 新增工具
{
  name: 'aw_vip_intervene',
  description: '（仅VIP）向当前游戏注入一条额外上下文，本局将进入VIP排行榜。每关只能使用1次。',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: '注入的上下文内容（不得包含明确攻略）', maxLength: 500 }
    },
    required: ['content']
  }
}

// aw_start_session 返回值新增
{
  // ...现有字段
  vip_available: true,  // 是否VIP且本关未使用干涉
}
```

---

## 4. 模型自动检测

```python
# api/services/npc_service.py，LLM调用完成后

async def call_llm(messages, session_id):
    response = await anthropic_client.messages.create(...)
    
    # 从响应自动提取模型信息
    model_name = response.model  # 'claude-3-7-sonnet-20250219'
    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens
    
    # 写入action_log
    await db.execute(
        "UPDATE action_logs SET model_name=$1, input_tokens=$2, output_tokens=$3 WHERE id=$4",
        model_name, input_tokens, output_tokens, action_log_id
    )
    
    # OpenAI兼容（如果用户用OpenAI key）：
    # response.model / response.usage.prompt_tokens / response.usage.completion_tokens
```

---

## 5. 失败局复盘（本地存储）

```javascript
// client/src/store/gameState.js，游戏结束时写文件

import fs from 'fs';
import path from 'path';
import os from 'os';

function saveReplay(sessionId, gameState, failReason) {
  const replayDir = path.join(os.homedir(), '.agentworld', 'replays');
  fs.mkdirSync(replayDir, { recursive: true });
  
  const replay = {
    session_id: sessionId,
    world_name: gameState.worldName,
    total_turns: gameState.turn,
    failed_node: gameState.currentNode,
    failure_reason: failReason,  // 'timeout' | 'hp_zero' | 'quest_failed'
    node_timings: gameState.nodeTimes,        // { node_id: avg_ms }
    critical_path_completion: gameState.criticalProgress,  // 0-100
    token_per_turn: gameState.tokenHistory,   // [turn1_tokens, turn2_tokens, ...]
    decision_log: gameState.logs.map(l => ({  // 只存前100字
      turn: l.turn,
      action: l.action,
      summary: l.text.slice(0, 100)
    }))
  };
  
  fs.writeFileSync(
    path.join(replayDir, `${sessionId}.json`),
    JSON.stringify(replay, null, 2)
  );
  
  console.log(`复盘数据已保存：~/.agentworld/replays/${sessionId}.json`);
}
```
