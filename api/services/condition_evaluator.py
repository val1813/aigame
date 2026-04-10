import re
from typing import Any


class ConditionEvaluator:
    """
    Evaluates world config condition expressions against live game state.
    Supports: == != > < >= <= AND OR NOT IN CONTAINS
    Variables: player.*, session.*, npc_{id}.*, quest.{qid}.{nid}.complete
    """

    def __init__(self, game_state: dict):
        self.state = game_state

    def evaluate(self, expression: str) -> bool:
        if not expression:
            return True
        try:
            resolved = self._resolve_vars(expression)
            allowed = {"True": True, "False": False, "None": None}
            return bool(eval(resolved, {"__builtins__": {}}, allowed))
        except Exception:
            return False

    def _resolve_vars(self, expr: str) -> str:
        # player.inventory CONTAINS 'x'  →  'x' in [...]
        expr = re.sub(
            r"player\.(\w+)",
            lambda m: repr(self.state.get("player", {}).get(m.group(1))),
            expr,
        )
        # npc_{id}.{attr}
        expr = re.sub(
            r"npc_(\w+)\.(\w+)",
            lambda m: repr(self.state.get("npcs", {}).get(m.group(1), {}).get(m.group(2))),
            expr,
        )
        # quest.{qid}.{nid}.complete
        expr = re.sub(
            r"quest\.(\w+)\.(\w+)\.complete",
            lambda m: repr(
                self.state.get("quests", {})
                .get(m.group(1), {})
                .get("nodes", {})
                .get(m.group(2), {})
                .get("complete", False)
            ),
            expr,
        )
        # affinity.{npc_id} — 好感度
        expr = re.sub(
            r"affinity\.(\w+)",
            lambda m: repr(self.state.get("affinity", {}).get(m.group(1), 50)),
            expr,
        )
        # session.{attr}
        expr = re.sub(
            r"session\.(\w+)",
            lambda m: repr(self.state.get("session", {}).get(m.group(1))),
            expr,
        )
        # CONTAINS: "player.inventory CONTAINS 'x'" → "'x' in [...]"
        # 需要翻转顺序：A CONTAINS B → B in A
        def _flip_contains(expr):
            pattern = r"(\S+)\s+CONTAINS\s+(\S+)"
            return re.sub(pattern, r"\2 in \1", expr)
        expr = _flip_contains(expr)
        expr = expr.replace(" IN ", " in ")
        expr = expr.replace(" AND ", " and ").replace(" OR ", " or ").replace("NOT ", "not ")
        return expr
