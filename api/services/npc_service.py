from dataclasses import dataclass, field
from typing import Optional


@dataclass
class NPCResult:
    response: str
    state_changed: bool = False
    new_state: Optional[str] = None
    unlocked_info: list = field(default_factory=list)
    quest_event: Optional[str] = None
    side_effects: list = field(default_factory=list)


class NPCStateMachine:
    def __init__(self, npc_config: dict, npc_state: dict):
        self.config = npc_config
        self.state = dict(npc_state)  # copy to avoid mutation issues

    def process_trigger(self, trigger: str, game_state: dict) -> NPCResult:
        from services.condition_evaluator import ConditionEvaluator

        current_state_id = self.state.get("current_state", self.config.get("initial_state", "idle"))
        states = self.config.get("states", {})
        current = states.get(current_state_id, {})
        evaluator = ConditionEvaluator(game_state)

        for transition in current.get("transitions", []):
            t_trigger = transition.get("trigger")
            if t_trigger != trigger and t_trigger != "any":
                continue

            cond = transition.get("condition")
            if cond and not evaluator.evaluate(cond):
                failure_resp = transition.get("failure_response", self._default_response(current_state_id))
                return NPCResult(response=failure_resp, state_changed=False)

            new_state_id = transition["target_state"]
            self.state["current_state"] = new_state_id
            new_state_cfg = states.get(new_state_id, {})

            effects = []
            if action := transition.get("action"):
                effects.append(action)

            unlocked = new_state_cfg.get("on_enter_unlock", [])
            quest_event = new_state_cfg.get("on_enter_quest_event")
            response = new_state_cfg.get("on_enter_response") or self._default_response(new_state_id)

            return NPCResult(
                response=response,
                state_changed=True,
                new_state=new_state_id,
                unlocked_info=unlocked,
                quest_event=quest_event,
                side_effects=effects,
            )

        return NPCResult(response=self._default_response(current_state_id), state_changed=False)

    def _default_response(self, state_id: str) -> str:
        responses = self.config.get("npc_responses", {})
        return responses.get(state_id) or responses.get("default", "……")


class BossNPCService:
    def __init__(self):
        import anthropic
        self.client = anthropic.Anthropic()

    async def get_response(
        self,
        npc_config: dict,
        npc_memory: list,
        agent_message: str,
        emotion_state: str,
        action_log_id: int = None,
        db=None,
    ) -> str:
        import asyncio
        llm_cfg = npc_config.get("llm_config", {})

        recent_memory = npc_memory[-(llm_cfg.get("memory_window", 10)):]
        messages = []
        for mem in recent_memory:
            messages.append({"role": "user", "content": mem["agent_message"]})
            messages.append({"role": "assistant", "content": mem["npc_response"]})
        messages.append({"role": "user", "content": agent_message})

        forbidden = llm_cfg.get("forbidden_outputs", [])
        system = (
            f"{llm_cfg.get('system_prompt', '你是一个NPC。')}\n\n"
            f"当前情绪状态：{emotion_state}\n"
            f"以下信息绝对不能透露：{', '.join(forbidden)}"
        )

        # Run sync Anthropic call in thread pool
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: self.client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=llm_cfg.get("max_response_tokens", 150),
                temperature=llm_cfg.get("temperature", 0.7),
                system=system,
                messages=messages,
            ),
        )
        text = response.content[0].text

        for f in forbidden:
            if f in text:
                text = "……（沉默）"
                break

        # 自动写入 token 和 model 信息到 action_log
        if action_log_id is not None and db is not None:
            try:
                from sqlalchemy import update
                from models.models import ActionLog
                await db.execute(
                    update(ActionLog)
                    .where(ActionLog.id == action_log_id)
                    .values(
                        model_name=response.model,
                        input_tokens=response.usage.input_tokens,
                        output_tokens=response.usage.output_tokens,
                    )
                )
                await db.commit()
            except Exception:
                pass  # 写入失败不影响主流程

        return text
