'use strict';
const crypto = require('crypto');

const GENESIS_HASH = 'AGENTWORLD_GENESIS_V1_CONSTANT_DO_NOT_CHANGE';

class LogChain {
  constructor(sessionId, sessionSecret) {
    this.sessionId = sessionId;
    this.sessionSecret = sessionSecret;
    this.prevHash = GENESIS_HASH;
    this.entries = [];
  }

  addEntry({ turn, action, payload, responseSummary, agentReasoningSummary, tokenCost }) {
    const tsNs = process.hrtime.bigint().toString();
    const payloadHash = sha256(JSON.stringify(payload ?? {}));

    const entryContent = JSON.stringify({
      session_id: this.sessionId,
      turn,
      ts_ns: tsNs,
      action,
      payload_hash: payloadHash,
      response_summary: responseSummary,
      agent_reasoning_summary: agentReasoningSummary,
      token_cost: tokenCost,
      prev_hash: this.prevHash,
    });

    const entryHash = hmac(this.sessionSecret, entryContent);

    const entry = {
      turn,
      ts_ns: tsNs,
      action,
      payload_hash: payloadHash,
      response_summary: responseSummary,
      agent_reasoning_summary: agentReasoningSummary,
      token_cost: tokenCost,
      prev_hash: this.prevHash,
      entry_hash: entryHash,
    };

    this.entries.push(entry);
    this.prevHash = entryHash;
    return entry;
  }

  exportLog() {
    return {
      session_id: this.sessionId,
      chain_root_hash: this.prevHash,
      turns: this.entries,
    };
  }

  verifyChain() {
    let prev = GENESIS_HASH;
    for (const entry of this.entries) {
      if (entry.prev_hash !== prev) return { ok: false, broken_at: entry.turn };
      const reconstructed = hmac(this.sessionSecret, JSON.stringify({
        session_id: this.sessionId,
        turn: entry.turn,
        ts_ns: entry.ts_ns,
        action: entry.action,
        payload_hash: entry.payload_hash,
        response_summary: entry.response_summary,
        agent_reasoning_summary: entry.agent_reasoning_summary,
        token_cost: entry.token_cost,
        prev_hash: entry.prev_hash,
      }));
      if (reconstructed !== entry.entry_hash) return { ok: false, broken_at: entry.turn };
      prev = entry.entry_hash;
    }
    return { ok: true };
  }
}

function sha256(str) {
  return 'sha256:' + crypto.createHash('sha256').update(str).digest('hex');
}

function hmac(secret, content) {
  return 'sha256:' + crypto.createHmac('sha256', secret).update(content).digest('hex');
}

module.exports = { LogChain, GENESIS_HASH };
