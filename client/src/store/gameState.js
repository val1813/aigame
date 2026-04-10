'use strict';
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 进程内游戏状态管理，基于 EventEmitter。
 * MCP 工具调用后更新状态，Ink UI 监听 'change' 事件重渲染。
 */
class GameState extends EventEmitter {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this._state = {
      // 会话
      sessionId: null,
      worldName: '',
      turn: 0,
      status: 'idle', // idle | active | ended
      vipAvailable: false,
      vipInterventionUsed: false,
      leaderboardType: 'pure_ai',

      // 地图
      map: null,       // { width, height, tiles, legend, fov_radius }
      fovRadius: 8,
      playerPos: { x: 0, y: 0 },
      exploredCells: new Set(),
      fovCells: new Set(),

      // Agent 状态
      agent: {
        hp: 100,
        gold: 200,
        inventory: [],
        energy: 100,
      },

      // NPC
      currentNpc: null,  // { name, emotion, affinity }

      // 进度
      criticalProgress: 0,  // 0-100
      score: null,

      // 计时
      startedAt: null,
      elapsedMs: 0,

      // 消息流
      logs: [],

      // 复盘数据
      nodeTimes: {},
      tokenHistory: [],
    };
  }

  get state() {
    return this._state;
  }

  update(patch) {
    Object.assign(this._state, patch);
    this.emit('change', this._state);
  }

  addLog(type, text, turn) {
    const entry = { type, text, turn: turn ?? this._state.turn };
    this._state.logs = [...this._state.logs.slice(-200), entry];
    this.emit('change', this._state);
  }

  updateFov(map, px, py, radius) {
    const { computeFOV } = require('../ui/utils/fov');
    const fovCells = computeFOV(map, px, py, radius ?? this._state.fovRadius);
    fovCells.forEach(k => this._state.exploredCells.add(k));
    this._state.fovCells = fovCells;
    this._state.playerPos = { x: px, y: py };
    this.emit('change', this._state);
  }

  saveReplay(failReason) {
    const s = this._state;
    if (!s.sessionId) return;

    const replayDir = path.join(os.homedir(), '.agentworld', 'replays');
    fs.mkdirSync(replayDir, { recursive: true });

    const replay = {
      session_id: s.sessionId,
      world_name: s.worldName,
      total_turns: s.turn,
      failure_reason: failReason,
      node_timings: s.nodeTimes,
      critical_path_completion: s.criticalProgress,
      token_per_turn: s.tokenHistory,
      decision_log: s.logs.map(l => ({
        turn: l.turn,
        action: l.type,
        summary: l.text.slice(0, 100),
      })),
    };

    const filePath = path.join(replayDir, `${s.sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(replay, null, 2), 'utf-8');
    console.error(`复盘数据已保存：~/.agentworld/replays/${s.sessionId}.json`);
  }
}

module.exports = new GameState();
