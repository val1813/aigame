// ═══ play_part1.js — 渲染引擎（按Cogmind Spec分栏布局）═══
'use strict';

const http = require('http');
const https = require('https');

const API = process.env.AGENTWORLD_API_URL || 'http://111.231.112.127:9000';

const LLM_PROVIDERS = {
  '1': { name: '百炼(阿里云)', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', hint: 'qwen3.6-plus / deepseek-v3.2 / glm-5' },
  '2': { name: 'DeepSeek官方', url: 'https://api.deepseek.com/v1/chat/completions', hint: 'deepseek-chat' },
  '3': { name: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', hint: 'gpt-4o / o1' },
  '4': { name: '火山引擎', url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', hint: 'doubao-pro' },
  '5': { name: '本地Ollama', url: 'http://localhost:11434/v1/chat/completions', hint: 'llama3 / qwen2' },
  '6': { name: '自定义URL', url: '', hint: '任意OpenAI兼容' },
};

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m', gray: '\x1b[90m',
  bw: '\x1b[97m',
};

const TILE = {
  '#': [C.gray, '#'], '.': ['\x1b[38;5;238m', '·'],
  '@': [C.bw + C.bold, '@'],
  'Z': [C.green, 'Z'], 'E': [C.green, 'E'], 'B': [C.green, 'B'],
  'n': [C.green, 'n'], 'f': [C.red, 'f'], 'X': [C.red, 'X'], '?': [C.yellow, '?'],
  '%': [C.cyan, '%'], '+': [C.yellow, '+'], '>': [C.magenta, '>'], '<': [C.magenta, '<'],
  '≈': [C.blue, '≈'], ' ': ['', ' '],
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const w = s => process.stdout.write(s);
function clear() { w('\x1b[2J\x1b[H'); }
function moveTo(r, c) { w(`\x1b[${r};${c}H`); }
function hideCursor() { w('\x1b[?25l'); }
function showCursor() { w('\x1b[?25h'); }
function termW() { return process.stdout.columns || 80; }
function termH() { return process.stdout.rows || 24; }
function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }

// ── HTTP ──
function apiRequest(method, path, body, token) {
  const url = new URL(API + path);
  const lib = url.protocol === 'https:' ? https : http;
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = lib.request({ hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false, error: d }); } }); });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
function llmRequest(llmUrl, llmKey, model, messages) {
  const url = new URL(llmUrl);
  const lib = url.protocol === 'https:' ? https : http;
  const body = JSON.stringify({ model, messages, max_tokens: 800, temperature: 0.7, enable_thinking: false });
  return new Promise((resolve, reject) => {
    const req = lib.request({ hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llmKey}`, 'Content-Length': Buffer.byteLength(body) } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error(d.slice(0, 200))); } }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

// ── 框线 ──
const B = { tl:'┌', tr:'┐', bl:'└', br:'┘', h:'─', v:'│', lj:'├', rj:'┤', tj:'┬', bj:'┴' };

// ── 完整界面渲染 ──
// ┌─── AGENTWORLD  关卡名  回合#N  ⏱ MM:SS ──────────────────────────┐
// ├────────────────────────────────────┬───────────────────────────────┤
// │ ####·····+··f··                    │ [ AI状态 ]                    │
// │ #···@··········#                   │ claude-3-opus                 │
// │ #······n·······#                   │ HP ████████░░ 80              │
// │ #·········%····#                   │ 进度 ████░░░░░░ 40%          │
// │ ###############                    │ ⏱ 05:32                      │
// │                                    │ [ 当前NPC ]                   │
// │                                    │ △ 赵教授                     │
// │                                    │ [ 背包 ]                      │
// │                                    │ ◆ 羊皮手稿                   │
// │                                    │ ◆ 紫外灯                     │
// ├────────────────────────────────────┴───────────────────────────────┤
// │ [T5] > 调查木箱                                                    │
// │ 箱内衬着褪色的天鹅绒，中央放着一张羊皮手稿...                      │
// │ [T6] AI思考中 ▌                                                    │
// └───────────────────────────────────────────────────────────────────┘

function renderFrame(state) {
  const W = termW(), H = termH();
  const mapW = Math.floor(W * 0.6);
  const infoW = W - mapW;
  const mapH = Math.min(10, (state.tiles || []).length || 8);
  const logH = Math.max(3, H - mapH - 5);

  clear();

  // Row 1: 顶部边框
  moveTo(1, 1);
  w(C.gray + B.tl + B.h.repeat(W - 2) + B.tr + C.reset);

  // Row 2: TopBar
  moveTo(2, 1); w(C.gray + B.v + C.reset);
  const mins = Math.floor((state.elapsedMs || 0) / 60000);
  const secs = Math.floor(((state.elapsedMs || 0) % 60000) / 1000);
  const top = ` ${C.bold}AGENTWORLD${C.reset}  ${C.cyan}${(state.worldName || '').slice(0, 15)}${C.reset}  回合#${state.turn || 0}  ⏱ ${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}  ${C.yellow}★${state.score || '-'}${C.reset}`;
  w(top); w(' '.repeat(Math.max(0, W - 2 - stripAnsi(top).length)));
  w(C.gray + B.v + C.reset);

  // Row 3: 分隔线
  moveTo(3, 1);
  w(C.gray + B.lj + B.h.repeat(mapW - 1) + B.tj + B.h.repeat(infoW - 2) + B.rj + C.reset);

  // Row 4 ~ 4+mapH-1: 地图 + 信息面板
  for (let i = 0; i < mapH; i++) {
    const row = 4 + i;
    moveTo(row, 1); w(C.gray + B.v + C.reset);
    _renderMapRow(state, i, mapW - 2);
    w(C.gray + B.v + C.reset);
    _renderInfoRow(state, i, infoW - 2);
    moveTo(row, W); w(C.gray + B.v + C.reset);
  }

  // 地图/信息分隔线
  const divRow = 4 + mapH;
  moveTo(divRow, 1);
  w(C.gray + B.lj + B.h.repeat(mapW - 1) + B.bj + B.h.repeat(infoW - 2) + B.rj + C.reset);

  // 日志区
  const logStart = divRow + 1;
  const logs = (state.logLines || []).slice(-logH);
  for (let i = 0; i < logH; i++) {
    moveTo(logStart + i, 1); w(C.gray + B.v + C.reset);
    const log = logs[i];
    if (log) {
      const txt = (' ' + log.text).slice(0, W - 3);
      w((log.color || '') + txt + C.reset);
      w(' '.repeat(Math.max(0, W - 3 - stripAnsi(txt).length)));
    } else {
      w(' '.repeat(W - 2));
    }
    moveTo(logStart + i, W); w(C.gray + B.v + C.reset);
  }

  // 底部边框
  moveTo(logStart + logH, 1);
  w(C.gray + B.bl + B.h.repeat(W - 2) + B.br + C.reset);

  return { logStart, logH, divRow };
}

function _renderMapRow(state, rowIdx, width) {
  if (!state.tiles || !state.tiles[rowIdx]) { w(' '.repeat(width)); return; }
  const row = state.tiles[rowIdx];
  const px = state.playerX, py = state.playerY, fov = state.fovRadius || 12;
  const halfW = Math.floor(width / 2);
  const maxX = row.length;
  const ox = Math.max(0, Math.min(px - halfW, maxX - width));

  let out = '';
  for (let dx = 0; dx < width; dx++) {
    const wx = ox + dx, wy = rowIdx;
    if (wx >= maxX) { out += ' '; continue; }
    const ch = row[wx] || ' ';
    const dist = Math.abs(wx - px) + Math.abs(wy - py);
    if (wx === px && wy === py) out += C.bw + C.bold + '@' + C.reset;
    else if (dist <= fov) { const t = TILE[ch] || [C.gray, ch]; out += t[0] + t[1] + C.reset; }
    else out += '\x1b[38;5;236m' + (ch === '#' ? '░' : ' ') + C.reset;
  }
  w(out);
}

function _renderInfoRow(state, rowIdx, width) {
  let text = '';
  switch (rowIdx) {
    case 0: text = `${C.bold} [ AI状态 ]${C.reset}`; break;
    case 1: text = ` ${C.dim}${(state.model || 'human').slice(0, width - 2)}${C.reset}`; break;
    case 2: {
      const hp = state.hp || 100, hc = hp > 60 ? C.green : hp > 30 ? C.yellow : C.red;
      const f = Math.ceil(hp / 10);
      text = ` HP ${hc}${'█'.repeat(f)}${C.gray}${'░'.repeat(10 - f)}${C.reset} ${hp}`;
      break;
    }
    case 3: {
      const p = Math.min(100, Math.round((state.turn || 0) / (state.maxTurns || 60) * 100));
      const f = Math.ceil(p / 10);
      text = ` 进度 ${C.cyan}${'█'.repeat(f)}${C.gray}${'░'.repeat(10 - f)}${C.reset} ${p}%`;
      break;
    }
    case 4: {
      const m = Math.floor((state.elapsedMs || 0) / 60000), s = Math.floor(((state.elapsedMs || 0) % 60000) / 1000);
      text = ` ⏱ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      break;
    }
    case 5: text = `${C.bold} [ 当前NPC ]${C.reset}`; break;
    case 6: { const n = (state.npcs || [])[0]; text = n ? ` ${C.green}△${C.reset} ${n.name}` : ` ${C.dim}(无交互)${C.reset}`; break; }
    case 7: text = `${C.bold} [ 背包 ]${C.reset}`; break;
    case 8: { const inv = state.inventory || []; text = inv.length ? ` ${C.cyan}◆${C.reset} ${inv[0]}` : ` ${C.dim}(空)${C.reset}`; break; }
    case 9: { const inv = state.inventory || []; text = inv.length > 1 ? ` ${C.cyan}◆${C.reset} ${inv[1]}` : ''; break; }
    default: text = '';
  }
  const clean = stripAnsi(text);
  w(text); w(' '.repeat(Math.max(0, width - clean.length)));
}

// ── 日志区刷新（打字机用）──
function renderLogOnly(state) {
  const W = termW(), H = termH();
  const mapH = Math.min(10, (state.tiles || []).length || 8);
  const divRow = 4 + mapH;
  const logStart = divRow + 1;
  const bottomRow = H - 1;
  const logH = Math.max(3, bottomRow - logStart);
  const logs = (state.logLines || []).slice(-logH);
  for (let i = 0; i < logH; i++) {
    moveTo(logStart + i, 2);
    const log = logs[i];
    if (log) {
      const txt = log.text.slice(0, W - 3);
      w((log.color || '') + txt + C.reset);
      w(' '.repeat(Math.max(0, W - 3 - stripAnsi(txt).length)));
    } else { w(' '.repeat(W - 2)); }
  }
}

// 打字机追加日志
async function addLogTyped(state, text, color, speed) {
  speed = speed || 12; color = color || C.reset;
  state.logLines = state.logLines || [];
  const maxLen = termW() - 4;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    for (let i = 0; i < line.length; i += maxLen) {
      const chunk = line.slice(i, i + maxLen);
      state.logLines.push({ text: '', color });
      const idx = state.logLines.length - 1;
      for (const ch of chunk) {
        state.logLines[idx].text += ch;
        renderLogOnly(state);
        if ('。！？，、；：'.includes(ch)) await sleep(speed * 3);
        else await sleep(speed);
      }
    }
  }
  if (state.logLines.length > 60) state.logLines.splice(0, state.logLines.length - 60);
}

function addLogInstant(state, text, color) {
  state.logLines = state.logLines || [];
  state.logLines.push({ text, color: color || C.reset });
  if (state.logLines.length > 60) state.logLines.splice(0, state.logLines.length - 60);
}

// ── 烟花 ──
async function fireworks(startRow) {
  const sparks = ['✦','✧','★','☆','✶','❋','✺'];
  const colors = [C.red, C.yellow, C.green, C.cyan, C.magenta];
  const W = termW();
  for (let round = 0; round < 4; round++) {
    const cx = 8 + Math.floor(Math.random() * (W - 16));
    const cy = startRow + 1;
    for (let y = startRow + 5; y >= cy; y--) { moveTo(y, cx); w(C.yellow + '│' + C.reset); await sleep(20); moveTo(y, cx); w(' '); }
    const color = colors[round % colors.length];
    for (let r = 1; r <= 3; r++) {
      for (let a = 0; a < 8; a++) {
        const dx = Math.round(Math.cos(a * Math.PI / 4) * r), dy = Math.round(Math.sin(a * Math.PI / 4) * r * 0.5);
        if (cx + dx > 1 && cx + dx < W && cy + dy > startRow) { moveTo(cy + dy, cx + dx); w(color + sparks[Math.floor(Math.random() * sparks.length)] + C.reset); }
      }
      await sleep(70);
    }
    await sleep(120);
    for (let r = 1; r <= 3; r++) for (let a = 0; a < 8; a++) { const dx = Math.round(Math.cos(a * Math.PI / 4) * r), dy = Math.round(Math.sin(a * Math.PI / 4) * r * 0.5); moveTo(cy + dy, cx + dx); w(' '); }
  }
}

// ── 键盘菜单选择 ──
async function menuSelect(title, options, row, col) {
  let selected = 0;
  while (options[selected]?.disabled) selected++;
  if (selected >= options.length) selected = options.findIndex(o => !o.disabled);
  if (selected < 0) selected = 0;

  const render = () => {
    const labelLens = options.map(o => {
      const base = stripAnsi(o.label).length;
      return base + (o.disabled ? 3 : 0); // ' 🔒' visual width ~3
    });
    const titleLen = stripAnsi(title).length;
    const innerW = Math.max(titleLen + 4, ...labelLens.map(l => l + 6)) + 2;

    moveTo(row, col);
    w(C.gray + '┌─ ' + C.reset + C.bold + title + C.reset + C.gray + ' ' + '─'.repeat(Math.max(0, innerW - titleLen - 5)) + '┐' + C.reset);

    for (let i = 0; i < options.length; i++) {
      moveTo(row + 1 + i, col);
      const opt = options[i];
      const isSelected = i === selected;
      const prefix = isSelected ? C.cyan + ' > ' + C.reset : '   ';
      let label;
      if (opt.disabled) {
        label = C.dim + opt.label + ' 🔒' + C.reset;
      } else if (isSelected) {
        label = C.bold + opt.label + C.reset;
      } else {
        label = opt.label;
      }
      const visLen = 3 + labelLens[i];
      const pad = Math.max(0, innerW - visLen - 1);
      w(C.gray + '│' + C.reset + prefix + label + ' '.repeat(pad) + C.gray + '│' + C.reset);
    }

    moveTo(row + 1 + options.length, col);
    w(C.gray + '└' + '─'.repeat(innerW - 1) + '┘' + C.reset);
  };

  render();

  return new Promise(resolve => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(!!wasRaw);
    };

    const onData = (data) => {
      const key = data.toString();
      if (key === '\x1b[A') { // ↑
        let tries = options.length;
        do { selected = (selected - 1 + options.length) % options.length; tries--; } while (options[selected]?.disabled && tries > 0);
        render();
      } else if (key === '\x1b[B') { // ↓
        let tries = options.length;
        do { selected = (selected + 1) % options.length; tries--; } while (options[selected]?.disabled && tries > 0);
        render();
      } else if (key === '\r' || key === '\n') { // 回车
        if (!options[selected]?.disabled) {
          cleanup();
          resolve(options[selected].value);
        }
      } else if (key === '\x1b' || key === 'q') { // ESC或q
        cleanup();
        resolve(null);
      }
    };

    stdin.on('data', onData);
  });
}

// ── 菜单区域清除 ──
function clearMenuArea(row, col, height, width) {
  for (let i = 0; i < height; i++) {
    moveTo(row + i, col);
    w(' '.repeat(width));
  }
}

function parseAIJson(text) {
  text = text.trim();
  if (text.includes('```')) { for (const p of text.split('```').slice(1)) { let s = p.trim(); if (s.startsWith('json')) s = s.slice(4); s = s.trim(); if (s.startsWith('{')) { text = s; break; } } }
  const si = text.indexOf('{'), ei = text.lastIndexOf('}') + 1;
  if (si >= 0 && ei > si) text = text.slice(si, ei);
  while ((text.match(/\}/g) || []).length > (text.match(/\{/g) || []).length) text = text.slice(0, text.lastIndexOf('}'));
  return JSON.parse(text);
}

module.exports = {
  API, LLM_PROVIDERS, C, sleep, apiRequest, llmRequest,
  clear, moveTo, hideCursor, showCursor, termW, termH, stripAnsi,
  renderFrame, renderLogOnly, addLogTyped, addLogInstant, fireworks, parseAIJson,
  menuSelect, clearMenuArea,
};
