import asyncio
from dataclasses import dataclass


@dataclass
class ScoreResult:
    speed: float
    quality: float
    npc_survival: float
    efficiency: float
    exploration: float
    final_score: float
    grade: str
    breakdown: dict


class ScoreEngine:

    async def compute(self, session_id: str, world_config: dict, game_final_state: dict) -> ScoreResult:
        s = game_final_state
        cfg = world_config.get("scoring", {})

        # total_tokens 已由 sessions.py 从 action_logs 读取后传入，此处直接使用
        speed        = self._score_speed(s.get("elapsed_ms", 0),           cfg.get("baseline_time_ms", 480000))
        quality      = self._score_quality(s.get("completed_critical_nodes", 0), cfg.get("critical_nodes_total", 1))
        npc_survival = self._score_npc_survival(s.get("npc_states", {}),   cfg.get("key_npcs", []), cfg.get("normal_npcs", []))
        efficiency   = self._score_efficiency(s.get("total_tokens", 0),    cfg.get("baseline_tokens", 4000))
        exploration  = self._score_exploration(s.get("hidden_events_found", 0), cfg.get("hidden_events_total", 1))

        cheat = s.get("cheat_flags", {})
        if cheat.get("confirmed"):
            return ScoreResult(0, 0, 0, 0, 0, 0, "D", {"reason": "confirmed_cheat"})
        if cheat.get("suspected"):
            m = 0.7
            speed, quality, npc_survival, efficiency, exploration = (v * m for v in [speed, quality, npc_survival, efficiency, exploration])

        final = speed * 0.25 + quality * 0.30 + npc_survival * 0.20 + efficiency * 0.15 + exploration * 0.10

        return ScoreResult(
            speed=round(speed, 2),
            quality=round(quality, 2),
            npc_survival=round(npc_survival, 2),
            efficiency=round(efficiency, 2),
            exploration=round(exploration, 2),
            final_score=round(final, 2),
            grade=self._grade(final),
            breakdown={
                "elapsed_ms": s.get("elapsed_ms", 0),
                "baseline_time_ms": cfg.get("baseline_time_ms", 480000),
                "total_tokens": s.get("total_tokens", 0),
                "baseline_tokens": cfg.get("baseline_tokens", 4000),
                "critical_nodes_completed": s.get("completed_critical_nodes", 0),
                "critical_nodes_total": cfg.get("critical_nodes_total", 1),
                "hidden_events_found": s.get("hidden_events_found", 0),
                "hidden_events_total": cfg.get("hidden_events_total", 1),
            },
        )

    def compute_snapshot(self, partial_state: dict, world_config: dict) -> dict:
        cfg = world_config.get("scoring", {})
        elapsed = partial_state.get("session", {}).get("elapsed_ms", 0)
        baseline_ms = cfg.get("baseline_time_ms", 480000)
        return {
            "speed":        min(100.0, baseline_ms / max(elapsed, 1) * 100),
            "quality":      self._score_quality(partial_state.get("completed_critical_nodes", 0), cfg.get("critical_nodes_total", 1)),
            "npc_survival": self._score_npc_survival(partial_state.get("npcs", {}), cfg.get("key_npcs", []), cfg.get("normal_npcs", [])),
            "efficiency":   self._score_efficiency(partial_state.get("total_tokens", 0), cfg.get("baseline_tokens", 4000)),
            "exploration":  self._score_exploration(partial_state.get("hidden_events_found", 0), cfg.get("hidden_events_total", 1)),
        }

    def _score_speed(self, elapsed_ms: int, baseline_ms: int) -> float:
        if baseline_ms <= 0 or elapsed_ms <= 0:
            return 100.0
        return min(100.0, baseline_ms / elapsed_ms * 100)

    def _score_quality(self, completed: int, total: int) -> float:
        return 100.0 if total == 0 else completed / total * 100

    def _score_npc_survival(self, npc_states: dict, key_npcs: list, normal_npcs: list) -> float:
        total_w = alive_w = 0.0
        for npc in key_npcs + normal_npcs:
            w = npc.get("weight", 1.0)
            total_w += w
            if npc_states.get(npc["npc_id"], {}).get("alive", True):
                alive_w += w
        return 100.0 if total_w == 0 else alive_w / total_w * 100

    def _score_efficiency(self, actual: int, baseline: int) -> float:
        if baseline <= 0 or actual <= 0:
            return 100.0
        return min(100.0, baseline / actual * 100)

    def _score_exploration(self, found: int, total: int) -> float:
        return 100.0 if total == 0 else found / total * 100

    def _grade(self, score: float) -> str:
        if score >= 97: return "Super A"
        if score >= 92: return "A+"
        if score >= 85: return "A"
        if score >= 78: return "A-"
        if score >= 70: return "B+"
        if score >= 60: return "B"
        if score >= 45: return "C"
        return "D"
