# AgentWorld 安全与防作弊规格 v3.0

> **新增文件**：原文档体系无此文件  
> **版本**：v3.0 | 2026-04  
> **阅读对象**：后端工程师、客户端工程师

---

## 1. 关卡内容加密（P0，发布前必须）

### 1.1 方案

原 `worlds` 表中的 `config` 字段明文存储，`GET /v1/worlds/:id` 直接返回完整JSON——AI可读取全部剧情，攻略直接写进提示词。

**v3.0方案**：按回合下发加密片段，AI每回合只能看到当前场景信息。

### 1.2 加密实现

使用 Node.js 内置 `crypto` 模块，**不引入第三方加密包**。

```javascript
// api/utils/worldCrypto.js (新增)
const crypto = require('crypto');

// 每个关卡在DB存一个 master_key（32字节，随机生成，GM创建关卡时生成）
// 每个session开局时，服务端用 session_id 派生 session_key

function deriveSessionKey(masterKey, sessionId) {
  // HKDF-like：用 HMAC-SHA256 派生，确保每session密钥唯一
  return crypto.createHmac('sha256', masterKey)
    .update(sessionId)
    .digest(); // 32字节
}

function encryptNode(plaintext, key) {
  const iv = crypto.randomBytes(12); // GCM推荐12字节IV
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  // 返回格式：base64(iv) ~ base64(ciphertext) ~ base64(authTag)
  return [enc, iv, authTag].map(b => b.toString('base64')).join('~');
}

function decryptNode(ciphertext, key) {
  const [enc, iv, authTag] = ciphertext.split('~').map(s => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return JSON.parse(
    Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  );
}
```

### 1.3 下发流程

```
开局 POST /v1/session/start
  → 服务端：
    1. 从DB读取 world.master_key
    2. 派生 session_key = deriveSessionKey(master_key, session_id)
    3. 加密初始场景 encryptNode(initialScene, session_key)
    4. 返回：{ session_id, encrypted_scene, session_key_hint: null }
       注意：session_key 不返回给客户端！

每回合 POST /v1/session/action
  → 服务端执行行动逻辑
  → 加密下一回合场景：encryptNode(nextScene, session_key)
  → 返回：{ turn, encrypted_scene, ... }

客户端（MCP Server）：
  → 收到 encrypted_scene
  → 调用服务端解密接口 OR 服务端直接返回明文场景给MCP
```

**最终决策**：session_key 存在 Redis（`session:{id}:key`），MCP每次拿到的是**服务端解密好的明文场景**。加密只用于DB存储和网络传输防窃听，不用于防止MCP本身读取（MCP就是AI的眼睛，它本来就要看）。

**防攻略的核心不是加密，而是信息按回合解锁**：每回合 `encrypted_scene` 只包含当前可见信息，下一关键线索在完成前置行动后才解锁。这才是防止"把攻略写进提示词"的关键。

---

## 2. 四层防作弊体系

### 层1：信息按回合解锁（最重要）

关卡配置中，每个节点定义 `unlock_condition`，未满足条件的信息不出现在 `scene` 里：

```json
{
  "nodes": [
    {
      "id": "node_secret_room",
      "unlock_condition": "quest.find_key == true",
      "scene_info": "你发现了隐藏的暗门..."  // 满足条件后才出现
    }
  ]
}
```

AI的提示词里写"去找暗门"没用，因为暗门信息根本不在场景描述里，AI不知道它存在。

### 层2：时序检测（现有 `cheat_detector.py`，微调参数）

```python
# api/services/cheat_detector.py 现有代码，调整阈值为可配置
SUSPICIOUS_SPEED_MS = world_config.get('cheat_threshold_ms', 800)  # 从关卡配置读，默认800ms
```

决策速度 < 阈值 → `suspected = True` → 评分乘以0.7

### 层3：AI语义审计（现有 audit_queue，需启动Worker）

**当前问题**：`api/services/cheat_detector.py` 里的审计代码存在但 Worker 进程未启动。

```bash
# docker-compose.yml 新增 service（在现有配置基础上追加）
audit-worker:
  build: ./api
  command: python -m api.workers.audit_worker
  environment:
    - DATABASE_URL=${DATABASE_URL}
    - REDIS_URL=${REDIS_URL}
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
  depends_on:
    - postgres
    - redis
  restart: unless-stopped
```

Worker消费 `audit_queue`，用Claude审计action_log，检测：
- 是否包含关卡剧情关键词+直接指令组合
- VIP干涉内容是否含明确攻略

### 层4：动态随机种子（v1.1实现，v1.0先跳过）

NPC行为、道具位置用 `session_id` 作随机种子微变，死记攻略无效。

---

## 3. Token计数修正（P0）

**现状**：`score_engine.py` 里 `total_tokens` 来自客户端MCP上报，可伪造。

**修正**：从 `action_logs` 表里的 `response_meta` 字段读取实际token数（API响应中包含usage信息）。

```python
# api/routers/sessions.py，action接口改动
# 收到MCP行动请求后，调用NPC/世界引擎时，从LLM API响应读取token数

# api/models/models.py，action_logs表新增字段
# input_tokens INTEGER
# output_tokens INTEGER
# model_name VARCHAR(100)  ← 从响应头/body自动读取
```

**各Provider model信息位置**：
- Anthropic：响应body `model` 字段 + `usage.input_tokens` / `usage.output_tokens`
- OpenAI：响应body `model` 字段 + `usage.prompt_tokens` / `usage.completion_tokens`
- 其他：从响应body尽力解析，解析失败记 null，效率分按最大值计

---

## 4. HMAC日志链（现有，保留不变）

`client/src/mcp/log-chain.js` 现有实现保留，这是防止客户端篡改行动记录的核心。

---

## 5. Nginx配置（P0，发布前必须）

```nginx
# /etc/nginx/conf.d/agentworld.conf（在现有nginx配置基础上新增server block）
server {
    listen 80;
    server_name api.yourdomain.com;  # 替换为实际域名
    
    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";  # WebSocket支持
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;  # AI推理可能较慢
    }
}

server {
    listen 80;
    server_name yourdomain.com;  # 排行榜前端（美国VPS）
    root /var/www/agentworld;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```
