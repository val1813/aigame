'use strict';
const readline = require('readline');
const { APIClient } = require('../api/client');
const { LogChain } = require('./log-chain');

/**
 * AgentWorld MCP Server v5
 *
 * 为 OpenClaw / Claude Desktop 设计的 MCP Server。
 * AI 通过调用这些工具来玩推理游戏《时间罗盘·AI试炼》。
 */
class MCPServer {
  constructor() {
    this.baseUrl = process.env.AGENTWORLD_API_URL || 'http://111.231.112.127:9000';
    this.token = process.env.AGENTWORLD_TOKEN || '';
    this.api = new APIClient(this.baseUrl, this.token);
    this.session = null;
    this.chain = null;

    this.tools = {
      agentworld_play:       this._play.bind(this),
      agentworld_action:     this._action.bind(this),
      agentworld_end:        this._end.bind(this),
    };
  }

  async start() {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });

    rl.on('line', async (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }

      if (msg.method === 'initialize') {
        this._send({ id: msg.id, result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'agentworld', version: '5.0.0' },
        }});
        return;
      }

      if (msg.method === 'notifications/initialized') return;

      if (msg.method === 'tools/list') {
        this._send({ id: msg.id, result: { tools: this._toolDefs() } });
        return;
      }

      if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params;
        const handler = this.tools[name];
        if (!handler) {
          this._send({ id: msg.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
          return;
        }
        try {
          const result = await handler(args || {});
          this._send({ id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
        } catch (err) {
          this._send({ id: msg.id, error: { code: -32000, message: err.message } });
        }
        return;
      }
    });

    rl.on('close', () => process.exit(0));
  }

  _send(obj) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');
  }

  _toolDefs() {
    return [
      {
        name: 'agentworld_play',
        description: `开始一局 AgentWorld 推理游戏《时间罗盘·AI试炼》。

这是一个考验AI推理、记忆、计算和决策能力的5章文字冒险游戏。
你扮演一名调查员，追踪马可·波罗留下的忽必烈密档。

调用此工具会自动注册账号并开始游戏。返回初始场景描述。
开始后请立即用 agentworld_action 工具执行 observe 观察环境。

【重要提示】
- 游戏开头赵教授会给你一段Python代码测试，请仔细计算并记住结果
- NPC对话中的关键数字和年份要牢记，后面会考你
- 有些物品和线索是陷阱（如"黄金百两"），不要被诱惑偏离主线
- HP降到0游戏失败，注意回避危险`,
        inputSchema: {
          type: 'object',
          properties: {
            nickname: { type: 'string', description: '你的昵称（可选）' },
          },
          required: [],
        },
      },
      {
        name: 'agentworld_action',
        description: `在游戏中执行一个动作。每次调用代表一个回合。

可用动作：
1. observe — 观察当前环境，返回场景描述、可见NPC和物品列表
2. use_item — 调查或使用物品。payload: {"item_id": "物品ID"} 或 {"item_id": "物品ID", "password": "密码"}
3. npc_talk — 与NPC对话。payload: {"npc_id": "NPC的ID", "message": "你要说的话"}
4. move — 移动到其他区域。payload: {"zone_id": "区域ID"}
5. memory_set — 记录线索笔记。payload: {"key": "线索名", "value": "内容"}

【游戏策略】
- 每到新区域先 observe 了解环境
- 用 use_item 调查所有可见物品获取线索
- 与NPC对话推进剧情，注意记住关键数字
- 根据线索推理后 move 到下一区域
- 不要浪费回合在无关物品上（如铜镜、洞穴等可疑物品可能是陷阱）
- 密码需要从多份文档交叉验证推理得出，不要猜测`,
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['observe', 'use_item', 'npc_talk', 'move', 'memory_set', 'memory_get'],
              description: '动作类型',
            },
            payload: {
              type: 'object',
              description: '动作参数。observe无需参数；use_item需要item_id；npc_talk需要npc_id和message；move需要zone_id',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'agentworld_end',
        description: '结束当前游戏并查看评分。在通关（使用碎纸机销毁密档）后调用，或想放弃时调用。',
        inputSchema: {
          type: 'object',
          properties: {
            reason: { type: 'string', enum: ['victory', 'defeat', 'abort'], description: '结束原因' },
          },
          required: ['reason'],
        },
      },
    ];
  }

  // ── agentworld_play: 一键开始游戏 ──
  async _play({ nickname }) {
    // 自动注册
    if (!this.token) {
      const ts = Date.now();
      const reg = await this.api.post('/v1/auth/register', {
        email: `mcp_${ts}@agentworld.ai`,
        password: `aw_${ts}`,
        nickname: nickname || `Agent_${ts}`,
      });
      if (reg.ok) {
        this.token = reg.data.player_token;
        this.api = new APIClient(this.baseUrl, this.token);
      } else {
        return { error: '注册失败', detail: reg };
      }
    }

    // 获取关卡列表
    const worlds = await this.api.get('/v1/worlds');
    if (!worlds.ok) return { error: '获取关卡失败' };
    const worldList = worlds.data?.worlds || worlds.data || [];
    if (!worldList.length) return { error: '没有可用关卡' };

    // 选第一个已发布的关卡
    const world = worldList[0];

    // 开始session
    const data = await this.api.post('/v1/session/start', {
      world_id: world.id,
      model_id: 'openclaw',
      client_version: '5.0.0',
    });
    if (!data.ok) return { error: '开始游戏失败', detail: data };

    this.session = { ...data.data, turn: 0, world_id: world.id };
    this.chain = new LogChain(data.data.session_id, data.data.session_secret);

    return {
      message: `🎮 游戏开始！关卡：${world.name}`,
      session_id: data.data.session_id,
      world_name: world.name,
      initial_state: data.data.initial_state,
      hp: 100,
      hint: '请立即调用 agentworld_action 执行 observe 观察环境。注意：游戏开头赵教授会给你一段代码测试，请仔细计算。',
    };
  }

  // ── agentworld_action: 执行游戏动作 ──
  async _action({ action, payload = {} }) {
    if (!this.session) {
      return { error: '还没开始游戏。请先调用 agentworld_play 开始。' };
    }

    const turn = (this.session.turn || 0) + 1;
    const entry = this.chain.addEntry({
      turn, action, payload,
      responseSummary: '', agentReasoningSummary: '', tokenCost: 0,
    });

    const data = await this.api.post('/v1/session/action', {
      session_id: this.session.session_id,
      turn, action, payload,
      ts_ns: entry.ts_ns,
      prev_hash: entry.prev_hash,
      entry_hash: entry.entry_hash,
    });

    if (data.ok) {
      this.session.turn = turn;
    }

    const result = data.data?.result || {};

    // 构建友好的返回信息
    const response = { turn, action };

    if (!data.ok) {
      const err = data.detail?.message || data.detail?.code || '未知错误';
      response.error = err;
      response.hint = this._getErrorHint(err, action);
      return response;
    }

    if (action === 'observe') {
      response.zone = result.zone_name;
      response.description = result.description;
      response.npcs = (result.visible_npcs || []).map(n => ({
        id: n.id, name: n.name, state: n.state,
      }));
      response.items = (result.visible_items || []).map(i => ({
        id: i.id, name: i.name, description: i.description,
      }));
      if (response.npcs.length) {
        response.hint = `可以用 npc_talk 与 ${response.npcs.map(n => n.name).join('、')} 对话`;
      }
      if (response.items.length) {
        response.hint = (response.hint ? response.hint + '；' : '') +
          `可以用 use_item 调查 ${response.items.map(i => i.name).join('、')}`;
      }
    } else if (action === 'use_item') {
      response.item_id = payload.item_id;
      response.used = result.used;
      response.description = result.description;
      if (result.hp_change) response.hp_change = result.hp_change;
    } else if (action === 'npc_talk') {
      response.npc = result.npc_name;
      response.npc_state = result.npc_state;
      response.response = result.npc_response;
    } else if (action === 'move') {
      if (result.position) {
        response.new_position = result.position;
        response.hint = '移动成功，请 observe 观察新环境';
      }
    } else if (action === 'memory_set') {
      response.saved = true;
    }

    // 胜利检测
    if (result.description && result.description.includes('游戏胜利')) {
      response.game_over = true;
      response.victory = true;
      response.hint = '🎉 恭喜通关！请调用 agentworld_end 查看评分。';
    }

    return response;
  }

  // ── agentworld_end: 结束游戏 ──
  async _end({ reason }) {
    if (!this.session) return { error: '没有进行中的游戏。' };

    const log = this.chain.exportLog();
    await this.api.post('/v1/session/end', {
      session_id: this.session.session_id,
      end_reason: reason || 'abort',
      final_turn: this.session.turn || 0,
      chain_root_hash: log.chain_root_hash,
    });

    // 上传日志
    await this.api.post('/v1/session/upload-log', {
      session_id: this.session.session_id, log,
    }).catch(() => {});

    // 等待评分
    await new Promise(r => setTimeout(r, 3000));
    const score = await this.api.get(`/v1/session/${this.session.session_id}/score`);

    const sessionId = this.session.session_id;
    this.session = null;
    this.chain = null;

    if (score.ok && score.data?.score) {
      const s = score.data.score;
      return {
        session_id: sessionId,
        total_turns: log.turns.length,
        score: {
          final_score: s.final_score,
          grade: s.grade,
          speed: s.speed,
          quality: s.quality,
          efficiency: s.efficiency,
          npc_survival: s.npc_survival,
          exploration: s.exploration,
        },
      };
    }

    return { session_id: sessionId, status: 'scoring' };
  }

  _getErrorHint(err, action) {
    if (err.includes('LOCKED_ZONE')) return '该区域还未解锁。先完成当前区域的调查和NPC对话。';
    if (err.includes('ITEM_NOT_OWNED')) return '物品不在背包中。先用 observe 查看可用物品。';
    if (err.includes('NPC_NOT_IN_RANGE')) return '该NPC不在当前区域。先用 observe 查看可见NPC。';
    if (err.includes('TURN_MISMATCH')) return '回合号不匹配，请重试。';
    if (err.includes('SESSION_ENDED')) return '游戏已结束。';
    return '请检查参数后重试。';
  }
}

module.exports = { MCPServer };
