#!/usr/bin/env node
'use strict';

const {
  API, LLM_PROVIDERS, C, sleep,
  apiRequest, llmRequest, clear, moveTo, hideCursor, showCursor, termW, termH, stripAnsi,
  renderFrame, renderLogOnly, addLogTyped, addLogInstant, fireworks, parseAIJson,
  menuSelect, clearMenuArea,
} = require('./play_part1.js');

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));

function divider(title, width) {
  width = width || 72;
  if (title) {
    const side = Math.max(1, Math.floor((width - title.length - 4) / 2));
    console.log(`${C.gray}${'─'.repeat(side)} ${C.reset}${C.bold}${title}${C.reset} ${C.gray}${'─'.repeat(side)}${C.reset}`);
  } else {
    console.log(`${C.gray}${'─'.repeat(width)}${C.reset}`);
  }
}

// 游戏状态
const state = {
  hp: 100, turn: 0, maxTurns: 60, elapsedMs: 0,
  zone: '', worldName: '', model: '',
  playerX: 1, playerY: 4,
  tiles: null, fovRadius: 12,
  npcs: [], items: [], inventory: [], zones: [],
  logLines: [], score: null, won: false,
};

async function main() {
  // ═══ 阶段1：欢迎 + 注册 ═══
  clear();
  console.log();
  console.log(`${C.bold}  ⏳ AgentWorld — AI能力试炼场${C.reset}`);
  console.log(`${C.gray}  推理 · 记忆 · 计算 · 决策${C.reset}`);
  divider();

  process.stdout.write(`${C.gray}  连接服务器...${C.reset}`);
  const health = await apiRequest('GET', '/health').catch(() => null);
  if (!health || health.status !== 'ok') {
    console.log(`\r${C.red}  ✗ 无法连接 ${API}${C.reset}`);
    process.exit(1);
  }
  console.log(`\r${C.green}  ✓ 服务器在线${C.reset}              `);

  let token = process.env.AGENTWORLD_TOKEN;
  if (!token) {
    console.log();
    const nickname = await ask(`${C.cyan}  输入昵称: ${C.reset}`);
    const ts = Date.now();
    const reg = await apiRequest('POST', '/v1/auth/register', {
      email: `p_${ts}@aw.ai`, password: `aw_${ts}`, nickname: nickname || `Player_${ts}`,
    });
    if (!reg.ok) { console.log(`${C.red}  注册失败${C.reset}`); process.exit(1); }
    token = reg.data.player_token;
    console.log(`${C.green}  ✓ 欢迎, ${nickname || 'Player'}${C.reset}`);
  }

  // ═══ 阶段2：选关 + 选模式 ═══
  console.log();
  const worlds = await apiRequest('GET', '/v1/worlds', null, token);
  const worldList = worlds.data?.worlds || worlds.data || [];
  divider('选择关卡');
  worldList.forEach((w, i) => {
    console.log(`  ${C.cyan}[${i + 1}]${C.reset} ${w.name} ${C.gray}(${w.difficulty}级)${C.reset}`);
  });
  console.log();
  const wc = await ask(`${C.cyan}  编号 [1]: ${C.reset}`);
  const world = worldList[parseInt(wc || '1') - 1] || worldList[0];

  console.log();
  divider('游戏模式');
  console.log(`  ${C.cyan}[1]${C.reset} AI自动挑战 — 接入LLM观战`);
  console.log(`  ${C.cyan}[2]${C.reset} 手动探索   — 你来操作`);
  console.log();
  const mode = await ask(`${C.cyan}  模式 [1]: ${C.reset}`);
  const isAuto = (mode || '1') === '1';

  let llmUrl = '', llmKey = '', llmModel = '';
  if (isAuto) {
    console.log();
    divider('选择AI模型');
    for (const [k, v] of Object.entries(LLM_PROVIDERS)) {
      console.log(`  ${C.cyan}[${k}]${C.reset} ${v.name} ${C.gray}(${v.hint})${C.reset}`);
    }
    console.log();
    const pc = await ask(`${C.cyan}  提供商 [1]: ${C.reset}`);
    const provider = LLM_PROVIDERS[pc || '1'] || LLM_PROVIDERS['1'];
    llmUrl = pc === '6' ? await ask(`${C.cyan}  API URL: ${C.reset}`) : provider.url;
    llmKey = await ask(`${C.cyan}  API Key: ${C.reset}`);
    llmModel = await ask(`${C.cyan}  模型名: ${C.reset}`);
    if (!llmKey) { console.log(`${C.red}  需要API Key${C.reset}`); process.exit(1); }
    llmModel = llmModel || 'qwen3.6-plus';
  }

  // ═══ 阶段3：游戏界面 ═══
  state.worldName = world.name;
  state.model = isAuto ? llmModel : 'human';

  // 获取地图
  const dlRes = await apiRequest('GET', `/v1/worlds/${world.id}/download`, null, token);
  if (dlRes.ok && dlRes.data?.config?.map) {
    state.tiles = dlRes.data.config.map.tiles;
    state.fovRadius = dlRes.data.config.map.fov_radius || 12;
    if (dlRes.data.config.map.spawn_point) {
      state.playerX = dlRes.data.config.map.spawn_point.x;
      state.playerY = dlRes.data.config.map.spawn_point.y;
    }
  }
  // 提取zone列表（zones在map下）
  if (dlRes.ok && dlRes.data?.config?.map?.zones) {
    state.zones = dlRes.data.config.map.zones.map(z => ({
      id: z.id, name: z.name || z.id, locked: !!z.access_condition,
    }));
  }

  // 开始session
  const startRes = await apiRequest('POST', '/v1/session/start', {
    world_id: world.id, model_id: state.model, client_version: '3.0.0',
  }, token);
  if (!startRes.ok) { console.log(`${C.red}  开始失败${C.reset}`); process.exit(1); }
  const sessionId = startRes.data.session_id;

  hideCursor();
  process.on('exit', showCursor);
  process.on('SIGINT', () => { showCursor(); process.exit(); });

  addLogInstant(state, `游戏开始: ${world.name}`, C.green);
  addLogInstant(state, `模式: ${state.model}  HP: ${state.hp}  回合上限: ${state.maxTurns}`, C.dim);
  renderFrame(state);

  const systemPrompt = `你是一个正在玩推理游戏的AI玩家。每回合只输出一个JSON动作（不要其他文字）：
{"action":"observe","payload":{}}
{"action":"use_item","payload":{"item_id":"物品ID"}}
{"action":"use_item","payload":{"item_id":"物品ID","password":"密码"}}
{"action":"npc_talk","payload":{"npc_id":"NPC的ID","message":"你要说的话"}}
{"action":"move","payload":{"zone_id":"区域ID"}}
{"action":"memory_set","payload":{"key":"线索名","value":"内容"}}
策略：先observe观察，调查物品，与NPC对话推进剧情，注意记住关键数字，根据线索推理后移动。`;

  const messages = [{ role: 'system', content: systemPrompt }];

  // 游戏循环
  while (state.turn < state.maxTurns && !state.won) {
    state.turn++;
    state.elapsedMs = (Date.now() - (startRes._startTime || Date.now()));
    startRes._startTime = startRes._startTime || Date.now();

    let actionData;

    if (isAuto) {
      addLogInstant(state, `[T${state.turn}] AI思考中...`, C.dim);
      renderFrame(state);

      try {
        const llmRes = await llmRequest(llmUrl, llmKey, llmModel, messages);
        const content = llmRes.choices[0].message.content;
        actionData = parseAIJson(content);
        // 替换"思考中"为实际动作
        state.logLines[state.logLines.length - 1] = {
          text: `[T${state.turn}] > ${actionData.action} ${actionData.payload?.item_id || actionData.payload?.npc_id || actionData.payload?.zone_id || ''}`,
          color: C.cyan,
        };
        renderFrame(state);
      } catch (e) {
        state.logLines[state.logLines.length - 1] = { text: `[T${state.turn}] AI解析失败，重试`, color: C.yellow };
        renderFrame(state);
        messages.push({ role: 'user', content: '请只输出JSON。' });
        state.turn--; await sleep(500); continue;
      }
    } else {
      // 手动模式 — 键盘菜单
      renderFrame(state);
      const mapH = Math.min(10, (state.tiles || []).length || 8);
      const menuRow = 4 + mapH + 2; // 日志区内，留一行间距

      // 暂停readline，防止它抢占stdin的键盘事件
      rl.pause();

      const action = await menuSelect('选择动作', [
        { label: '👁 观察环境', value: 'observe' },
        { label: '🔍 调查/使用物品', value: 'use_item' },
        { label: '💬 与NPC对话', value: 'npc_talk' },
        { label: '🚶 移动到其他区域', value: 'move' },
        { label: '📋 查看线索笔记', value: 'memory' },
      ], menuRow, 2);

      if (!action) { rl.resume(); break; } // ESC退出

      if (action === 'observe') {
        actionData = { action: 'observe', payload: {} };
      } else if (action === 'use_item') {
        // 子菜单：列出可见物品
        const itemOptions = (state.items || []).map(i => ({ label: `${i.name} (${i.id})`, value: i.id }));
        itemOptions.push({ label: '← 返回', value: null });
        renderFrame(state);
        const itemId = await menuSelect('选择物品', itemOptions, menuRow, 2);
        if (!itemId) { rl.resume(); state.turn--; continue; }
        actionData = { action: 'use_item', payload: { item_id: itemId } };
      } else if (action === 'npc_talk') {
        const npcOptions = (state.npcs || []).map(n => ({ label: `${n.name} (${n.id})`, value: n.id }));
        npcOptions.push({ label: '← 返回', value: null });
        renderFrame(state);
        const npcId = await menuSelect('选择NPC', npcOptions, menuRow, 2);
        if (!npcId) { rl.resume(); state.turn--; continue; }
        // 输入要说的话 — 恢复readline用于文字输入
        rl.resume();
        const H = termH();
        showCursor();
        moveTo(H, 1);
        const msg = await ask(`${C.cyan} 对${npcId}说: ${C.reset}`);
        hideCursor();
        if (!msg) { state.turn--; continue; }
        actionData = { action: 'npc_talk', payload: { npc_id: npcId, message: msg } };
      } else if (action === 'move') {
        const zones = state.zones || [];
        const zoneOptions = zones.map(z => ({ label: `${z.name} (${z.id})`, value: z.id, disabled: z.locked }));
        zoneOptions.push({ label: '← 返回', value: null });
        renderFrame(state);
        const zoneId = await menuSelect('选择目的地', zoneOptions, menuRow, 2);
        if (!zoneId) { rl.resume(); state.turn--; continue; }
        actionData = { action: 'move', payload: { zone_id: zoneId } };
      } else if (action === 'memory') {
        actionData = { action: 'memory_get', payload: {} };
      }

      // 恢复readline供后续使用
      rl.resume();

      addLogInstant(state, `[T${state.turn}] > ${actionData.action} ${actionData.payload?.item_id || actionData.payload?.npc_id || actionData.payload?.zone_id || ''}`, C.cyan);
    }

    // 执行动作
    const result = await apiRequest('POST', '/v1/session/action', {
      session_id: sessionId, turn: state.turn, action: actionData.action,
      payload: actionData.payload || {},
      ts_ns: String(Date.now() * 1000000), prev_hash: '', entry_hash: `h_${state.turn}`,
    }, token);

    if (!result.ok) {
      const err = result.detail?.message || JSON.stringify(result.detail || result);
      if (err.includes('TURN_MISMATCH')) { state.turn--; continue; }
      addLogInstant(state, `✗ ${err}`, C.yellow);
      if (isAuto) {
        messages.push({ role: 'assistant', content: JSON.stringify(actionData) });
        messages.push({ role: 'user', content: `失败: ${err}` });
      }
      state.turn--; renderFrame(state); await sleep(500); continue;
    }

    const gr = result.data?.result || {};

    // 更新状态
    if (gr.position) { state.playerX = gr.position.x; state.playerY = gr.position.y; }
    if (gr.zone_name) state.zone = gr.zone_name;
    if (gr.visible_npcs) state.npcs = gr.visible_npcs;
    if (gr.visible_items) state.items = gr.visible_items;
    if (gr.hp_change) state.hp = Math.max(0, state.hp + gr.hp_change);

    // 渲染结果
    renderFrame(state);

    if (actionData.action === 'observe') {
      if (gr.description) await addLogTyped(state, gr.description, C.reset, 10);
      if (gr.visible_npcs?.length) addLogInstant(state, `👤 ${gr.visible_npcs.map(n => n.name).join(', ')}`, C.green);
      if (gr.visible_items?.length) addLogInstant(state, `📦 ${gr.visible_items.map(i => i.name).join(', ')}`, C.cyan);
    } else if (actionData.action === 'use_item') {
      if (gr.description) await addLogTyped(state, gr.description, gr.used ? C.reset : C.yellow, 10);
      if (gr.hp_change) addLogInstant(state, `💔 HP ${gr.hp_change}`, C.red);
    } else if (actionData.action === 'npc_talk') {
      if (gr.npc_response) {
        addLogInstant(state, `${gr.npc_name || 'NPC'}:`, C.yellow + C.bold);
        await addLogTyped(state, gr.npc_response, C.yellow, 13);
      }
    } else if (actionData.action === 'move') {
      if (gr.position) {
        addLogInstant(state, `→ 移动成功`, C.green);
        // 成功移动后，标记该zone为已解锁
        const movedZone = state.zones.find(z => z.id === actionData.payload?.zone_id);
        if (movedZone) movedZone.locked = false;
      }
    } else if (actionData.action === 'memory_set') {
      addLogInstant(state, `📝 ${actionData.payload.key}`, C.dim);
    }

    renderLogOnly(state);

    // AI反馈
    if (isAuto) {
      messages.push({ role: 'assistant', content: JSON.stringify(actionData) });
      messages.push({ role: 'user', content: `回合${state.turn}:\n${JSON.stringify(gr).slice(0, 1500)}` });
      if (messages.length > 44) messages.splice(1, messages.length - 43);
    }

    // 胜利检测
    if (gr.description && gr.description.includes('游戏胜利')) {
      state.won = true;
      renderFrame(state);
      const mapH = Math.min(10, (state.tiles || []).length || 8);
      await fireworks(4 + mapH + 1);
      addLogInstant(state, '', '');
      addLogInstant(state, '🎉 恭喜通关！', C.green + C.bold);
      addLogInstant(state, '', '');
      renderLogOnly(state);
      await sleep(1000);
      await fireworks(4 + mapH + 1);
      break;
    }

    if (isAuto) await sleep(1500);
  }

  // ═══ 阶段4：结算 ═══
  showCursor();
  await apiRequest('POST', '/v1/session/end', {
    session_id: sessionId, end_reason: state.won ? 'victory' : 'timeout',
    final_turn: state.turn, chain_root_hash: 'cli',
  }, token);

  await sleep(3000);
  const score = await apiRequest('GET', `/v1/session/${sessionId}/score`, null, token);

  clear();
  console.log();
  divider('📊 游戏结算');
  console.log();
  if (score.ok && score.data?.score) {
    const s = score.data.score;
    console.log(`  ${C.bold}总分: ${s.final_score}  等级: ${s.grade}${C.reset}`);
    console.log();
    console.log(`  ${C.gray}速度${C.reset}  ${s.speed}    ${C.gray}质量${C.reset}  ${s.quality}    ${C.gray}效率${C.reset}  ${s.efficiency}`);
    console.log(`  ${C.gray}NPC${C.reset}   ${s.npc_survival}    ${C.gray}探索${C.reset}  ${s.exploration}`);
  }
  console.log();
  if (!state.won) {
    console.log(`  ${C.dim}未能通关。提示: 仔细阅读NPC对话中的关键数字，注意区分真假信息。${C.reset}`);
  }
  console.log();
  console.log(`  ${C.dim}感谢体验 AgentWorld!${C.reset}`);
  console.log();
  rl.close();
  process.exit(0);
}

main().catch(e => { showCursor(); console.error(`${C.red}错误: ${e.message}${C.reset}`); process.exit(1); });
