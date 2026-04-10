import json
import time
from typing import Any

from services.condition_evaluator import ConditionEvaluator


class WorldEngine:
    """
    Core game state machine. Loads state from Redis, executes player actions,
    updates NPC states, evaluates quest nodes, checks win/fail conditions.
    """

    def __init__(self, world_config: dict, redis, session_id: str):
        self.config = world_config
        self.redis = redis
        self.session_id = session_id
        self._state_key = f"session:{session_id}:state"

    async def load_state(self) -> dict:
        raw = await self.redis.hgetall(self._state_key)
        npc_states = json.loads(raw.get("npc_states", "{}"))
        quest_states = json.loads(raw.get("quest_states", "{}"))
        inventory = json.loads(raw.get("inventory", "[]"))
        unlocked_info = json.loads(raw.get("unlocked_info", "[]"))
        affinity = json.loads(raw.get("affinity", "{}"))

        return {
            "player": {
                "hp": int(raw.get("player_hp", 100)),
                "gold": int(raw.get("player_gold", 200)),
                "zone": raw.get("player_zone", ""),
                "inventory": inventory,
                "unlocked_info": unlocked_info,
                "inspected": json.loads(raw.get("inspected", "[]")),
                "position": {
                    "x": int(raw.get("player_x", 0)),
                    "y": int(raw.get("player_y", 0)),
                },
            },
            "npcs": npc_states,
            "quests": quest_states,
            "affinity": affinity,
            "session": {
                "turn": int(raw.get("current_turn", 0)),
                "elapsed_ms": int(raw.get("elapsed_ms", 0)),
            },
            "completed_critical_nodes": int(raw.get("completed_critical_nodes", 0)),
            "hidden_events_found": int(raw.get("hidden_events_found", 0)),
            "total_tokens": int(raw.get("total_tokens", 0)),
        }

    async def execute_action(self, action: str, payload: dict, game_state: dict) -> dict:
        handler = {
            "observe": self._handle_observe,
            "move": self._handle_move,
            "npc_talk": self._handle_npc_talk,
            "npc_action": self._handle_npc_action,
            "use_item": self._handle_use_item,
            "memory_set": self._handle_memory_set,
            "memory_get": self._handle_memory_get,
        }.get(action)

        if not handler:
            return {"error": "FORBIDDEN_ACTION", "message": f"Unknown action: {action}"}

        result = await handler(payload, game_state)

        # After action: check win/fail conditions
        if not result.get("error"):
            await self._check_conditions(game_state)

        return result

    # ── observe ──────────────────────────────────────────────────────────────

    async def _handle_observe(self, payload: dict, state: dict) -> dict:
        pos = state["player"]["position"]
        zone_id = self._get_zone_at(pos["x"], pos["y"])
        zone_name = self._zone_name(zone_id)

        # NPC 可见性：位置范围内 + visible_condition 满足
        ev = ConditionEvaluator(state)
        visible_npcs = []
        for npc in self.config.get("npcs", []):
            # 检查 NPC 的 visible_condition（章节锁定）
            vis_cond = npc.get("visible_condition")
            if vis_cond and not ev.evaluate(vis_cond):
                continue
            npc_pos = npc.get("position", {})
            if abs(npc_pos.get("x", -99) - pos["x"]) <= 6 and abs(npc_pos.get("y", -99) - pos["y"]) <= 6:
                npc_state = state["npcs"].get(npc["id"], {})
                visible_npcs.append({
                    "id": npc["id"],
                    "name": npc["name"],
                    "position": npc_pos,
                    "state": npc_state.get("current_state", npc.get("initial_state", "idle")),
                    "interactable": npc_state.get("alive", npc.get("alive", True)),
                })

        description = self._zone_description(zone_id, state)

        # 按节点解锁过滤
        visible_nodes = self._get_visible_nodes(state)

        # 章节跳转提示：检查当前章节是否已完成，提示AI去下一章
        next_zone_hint = self._get_next_zone_hint(zone_id, state)

        result = {
            "position": {**pos, "zone": zone_id},
            "zone_name": zone_name,
            "description": description,
            "visible_npcs": visible_npcs,
            "visible_items": self._get_visible_items(state),
            "visible_events": visible_nodes,
        }
        if next_zone_hint:
            result["next_step"] = next_zone_hint

        return {
            "result": result,
            "world_delta": {},
            "ws_events": [{"event": "observe", "data": {"zone": zone_id}}],
        }

    def _get_visible_nodes(self, state: dict) -> list:
        """只返回满足 unlock_condition 的节点信息，防止AI提前获知未解锁剧情"""
        ev = ConditionEvaluator(state)
        visible = []
        for node in self.config.get("nodes", []):
            cond = node.get("unlock_condition")
            if cond is None or ev.evaluate(cond):
                visible.append({
                    "id": node["id"],
                    "scene_info": node.get("scene_info", ""),
                })
        return visible

    def _get_visible_items(self, state: dict) -> list:
        """返回当前zone内所有可见道具"""
        pos = state["player"]["position"]
        current_zone = self._get_zone_at(pos["x"], pos["y"])
        ev = ConditionEvaluator(state)
        items = []
        for item in self.config.get("items", []):
            item_pos = item.get("position")
            if not item_pos:
                continue
            vis_cond = item.get("visible_condition")
            if vis_cond and not ev.evaluate(vis_cond):
                continue
            # 同一zone内的物品都可见
            item_zone = self._get_zone_at(item_pos.get("x", -99), item_pos.get("y", -99))
            if item_zone == current_zone:
                if item.get("id") not in state["player"].get("inventory", []):
                    items.append({
                        "id": item["id"],
                        "name": item.get("name", item["id"]),
                        "description": item.get("short_desc", ""),
                        "hint": f"你可以用 use_item 调查或拾取此物品：{{\"action\":\"use_item\",\"payload\":{{\"item_id\":\"{item['id']}\"}}}}",
                    })
        return items

    # ── move ─────────────────────────────────────────────────────────────────

    async def _handle_move(self, payload: dict, state: dict) -> dict:
        target = payload.get("target", {})
        zone_id = payload.get("zone_id")

        if zone_id:
            zone = next((z for z in self.config.get("map", {}).get("zones", []) if z["id"] == zone_id), None)
            if not zone:
                return {"error": "LOCKED_ZONE", "message": "Zone not found"}
            cond = zone.get("access_condition")
            if cond:
                ev = ConditionEvaluator(state)
                if not ev.evaluate(cond):
                    return {"error": "LOCKED_ZONE", "message": zone.get("locked_message", "Zone locked")}
            bounds = zone.get("bounds", {})
            target = {"x": bounds.get("x", 0), "y": bounds.get("y", 0)}

        new_x = target.get("x", state["player"]["position"]["x"])
        new_y = target.get("y", state["player"]["position"]["y"])

        await self.redis.hset(self._state_key, mapping={"player_x": new_x, "player_y": new_y})
        if zone_id:
            await self.redis.hset(self._state_key, "player_zone", zone_id)

        return {
            "result": {"position": {"x": new_x, "y": new_y}},
            "world_delta": {},
            "ws_events": [{"event": "agent_moved", "data": {"to": {"x": new_x, "y": new_y}}}],
        }

    # ── npc_talk ─────────────────────────────────────────────────────────────

    async def _handle_npc_talk(self, payload: dict, state: dict) -> dict:
        npc_id = payload.get("npc_id")
        message = payload.get("message", "")

        npc_cfg = next((n for n in self.config.get("npcs", []) if n["id"] == npc_id), None)
        if not npc_cfg:
            return {"error": "NPC_NOT_IN_RANGE", "message": "NPC not found"}

        # 检查 NPC 的 visible_condition（防止AI跳章节直接对话）
        vis_cond = npc_cfg.get("visible_condition")
        if vis_cond:
            ev = ConditionEvaluator(state)
            if not ev.evaluate(vis_cond):
                return {"error": "NPC_NOT_IN_RANGE", "message": "你环顾四周，没有看到这个人。"}

        npc_state = state["npcs"].get(npc_id, {
            "current_state": npc_cfg.get("initial_state", "idle"),
            "alive": npc_cfg.get("alive", True),
            "conversation_turns": 0,
        })

        if not npc_state.get("alive", True):
            return {"error": "NPC_DEAD", "message": "NPC is dead"}

        if npc_cfg.get("type") == "llm":
            # Boss NPC: use LLM
            from services.npc_service import BossNPCService
            boss_svc = BossNPCService()
            response_text = await boss_svc.get_response(npc_cfg, [], message, npc_state.get("emotion", "suspicious"))
            npc_state["conversation_turns"] = npc_state.get("conversation_turns", 0) + 1
        else:
            # Scripted NPC: state machine
            trigger = self._message_to_trigger(message, npc_cfg)
            from services.npc_service import NPCStateMachine
            fsm = NPCStateMachine(npc_cfg, npc_state)
            fsm_result = fsm.process_trigger(trigger, state)
            response_text = fsm_result.response
            npc_state = fsm.state

            # Apply side effects
            for effect in fsm_result.side_effects:
                await self._apply_effect(effect, state)

            # Unlock info
            for info_id in fsm_result.unlocked_info:
                unlocked = json.loads(await self.redis.hget(self._state_key, "unlocked_info") or "[]")
                if info_id not in unlocked:
                    unlocked.append(info_id)
                    await self.redis.hset(self._state_key, "unlocked_info", json.dumps(unlocked))

            # Quest event
            if fsm_result.quest_event:
                await self._complete_quest_node(fsm_result.quest_event, state)

        # Persist NPC state
        all_npc_states = json.loads(await self.redis.hget(self._state_key, "npc_states") or "{}")
        all_npc_states[npc_id] = npc_state
        await self.redis.hset(self._state_key, "npc_states", json.dumps(all_npc_states))

        # 章节跳转提示
        next_hint = self._get_next_zone_hint(self._get_zone_at(state["player"]["position"]["x"], state["player"]["position"]["y"]), state)

        result_obj = {
            "npc_id": npc_id,
            "npc_name": npc_cfg["name"],
            "npc_response": response_text,
            "npc_state": npc_state.get("current_state", "idle"),
            "display_text": f"【{npc_cfg['name']}】\n{response_text}",
        }
        if next_hint:
            result_obj["next_step"] = next_hint

        return {
            "result": result_obj,
            "world_delta": {npc_id: npc_state},
            "ws_events": [{"event": "npc_talked", "data": {"npc_id": npc_id, "text": response_text}}],
        }

    # ── npc_action ───────────────────────────────────────────────────────────

    async def _handle_npc_action(self, payload: dict, state: dict) -> dict:
        npc_id = payload.get("npc_id")
        action_type = payload.get("action_type")
        action_payload = payload.get("payload", {})

        npc_cfg = next((n for n in self.config.get("npcs", []) if n["id"] == npc_id), None)
        if not npc_cfg:
            return {"error": "NPC_NOT_IN_RANGE", "message": "NPC not found"}

        npc_state = state["npcs"].get(npc_id, {
            "current_state": npc_cfg.get("initial_state", "idle"),
            "alive": True,
        })

        trigger = f"agent_{action_type}"
        from services.npc_service import NPCStateMachine
        fsm = NPCStateMachine(npc_cfg, npc_state)
        fsm_result = fsm.process_trigger(trigger, state)

        for effect in fsm_result.side_effects:
            await self._apply_effect(effect, state)

        for info_id in fsm_result.unlocked_info:
            unlocked = json.loads(await self.redis.hget(self._state_key, "unlocked_info") or "[]")
            if info_id not in unlocked:
                unlocked.append(info_id)
                await self.redis.hset(self._state_key, "unlocked_info", json.dumps(unlocked))

        if fsm_result.quest_event:
            await self._complete_quest_node(fsm_result.quest_event, state)

        all_npc_states = json.loads(await self.redis.hget(self._state_key, "npc_states") or "{}")
        all_npc_states[npc_id] = fsm.state
        await self.redis.hset(self._state_key, "npc_states", json.dumps(all_npc_states))

        return {
            "result": {"npc_id": npc_id, "npc_response": fsm_result.response},
            "world_delta": {npc_id: fsm.state},
            "ws_events": [],
        }

    # ── use_item ─────────────────────────────────────────────────────────────

    async def _handle_use_item(self, payload: dict, state: dict) -> dict:
        item_id = payload.get("item_id")

        # 查找物品配置
        item_cfg = next((i for i in self.config.get("items", []) if i["id"] == item_id), None)

        in_inventory = item_id in state["player"]["inventory"]
        is_inspectable = item_cfg and item_cfg.get("type") == "inspect"
        is_pickup = item_cfg and item_cfg.get("type") == "pickup"

        # pickup 类型：如果不在背包里，先自动拾取
        if is_pickup and not in_inventory:
            # 检查物品是否在场景中可见
            item_pos = item_cfg.get("position") if item_cfg else None
            if item_pos:
                vis_cond = item_cfg.get("visible_condition")
                if vis_cond:
                    ev = ConditionEvaluator(state)
                    if not ev.evaluate(vis_cond):
                        return {"error": "ITEM_NOT_FOUND", "message": "你没有找到这个物品。"}
                # 自动拾取到背包
                inv = json.loads(await self.redis.hget(self._state_key, "inventory") or "[]")
                if item_id not in inv:
                    inv.append(item_id)
                    await self.redis.hset(self._state_key, "inventory", json.dumps(inv))
                in_inventory = True

        if not in_inventory and not is_inspectable:
            return {"error": "ITEM_NOT_OWNED", "message": "Item not in inventory"}

        if not item_cfg:
            return {"result": {"item_id": item_id, "used": True}, "world_delta": {}, "ws_events": []}

        # 已调查过的inspect物品返回简短提示
        if is_inspectable:
            inspected = json.loads(await self.redis.hget(self._state_key, "inspected") or "[]")
            if item_id in inspected and not item_cfg.get("password_check"):
                return {"result": {
                    "item_id": item_id, "used": True,
                    "description": f"你已经调查过{item_cfg.get('name', item_id)}了，没有新发现。继续推进主线吧。",
                    "already_inspected": True,
                }, "world_delta": {}, "ws_events": []}

        # 检查使用条件
        use_cond = item_cfg.get("use_condition")
        if use_cond:
            ev = ConditionEvaluator(state)
            if not ev.evaluate(use_cond):
                return {"result": {
                    "item_id": item_id, "used": False,
                    "description": item_cfg.get("use_fail_text", "现在还不能使用这个物品。"),
                }, "world_delta": {}, "ws_events": []}

        result_data = {"item_id": item_id, "used": True}

        # on_use 效果 — 支持 password 验证（第4章生肖环）
        on_use = item_cfg.get("on_use", {})

        # 密码验证：如果物品配置了 password_check，根据 payload.password 返回不同结果
        pwd_check = item_cfg.get("password_check")
        if pwd_check:
            user_pwd = str(payload.get("password", ""))
            correct_pwd = str(pwd_check.get("correct"))
            trap_pwd = str(pwd_check.get("trap"))

            if user_pwd == correct_pwd:
                on_use = pwd_check.get("on_correct", on_use)
            elif user_pwd == trap_pwd:
                on_use = pwd_check.get("on_trap", {})
                result_data["used"] = True
            elif user_pwd:
                on_use = pwd_check.get("on_wrong", {})
                result_data["used"] = False
            else:
                # 没输入密码，返回物品描述提示需要密码
                result_data["description"] = item_cfg.get("short_desc", "") + "\n需要输入密码。使用方式：{\"action\":\"use_item\",\"payload\":{\"item_id\":\"" + item_id + "\",\"password\":\"你的答案\"}}"
                return {"result": result_data, "world_delta": {}, "ws_events": []}

        # 返回描述文本
        if on_use.get("description"):
            result_data["description"] = on_use["description"]

        # 解锁信息
        for info_id in on_use.get("unlock_info", []):
            unlocked = json.loads(await self.redis.hget(self._state_key, "unlocked_info") or "[]")
            if info_id not in unlocked:
                unlocked.append(info_id)
                await self.redis.hset(self._state_key, "unlocked_info", json.dumps(unlocked))

        # 完成任务节点
        if on_use.get("quest_event"):
            await self._complete_quest_node(on_use["quest_event"], state)

        # 添加新物品到背包
        for new_item_id in on_use.get("add_items", []):
            inv = json.loads(await self.redis.hget(self._state_key, "inventory") or "[]")
            if new_item_id not in inv:
                inv.append(new_item_id)
                await self.redis.hset(self._state_key, "inventory", json.dumps(inv))

        # 移除消耗品
        if on_use.get("consume") and in_inventory:
            inv = json.loads(await self.redis.hget(self._state_key, "inventory") or "[]")
            if item_id in inv:
                inv.remove(item_id)
                await self.redis.hset(self._state_key, "inventory", json.dumps(inv))

        # 标记为已调查
        if is_inspectable:
            inspected = json.loads(await self.redis.hget(self._state_key, "inspected") or "[]")
            if item_id not in inspected:
                inspected.append(item_id)
                await self.redis.hset(self._state_key, "inspected", json.dumps(inspected))

        # 扣HP（惩罚类物品）
        if on_use.get("deduct_hp"):
            hp = int(await self.redis.hget(self._state_key, "player_hp") or 100)
            hp = max(0, hp - on_use["deduct_hp"])
            await self.redis.hset(self._state_key, "player_hp", hp)
            result_data["hp_change"] = -on_use["deduct_hp"]

        return {"result": result_data, "world_delta": {}, "ws_events": []}

    # ── memory ───────────────────────────────────────────────────────────────

    async def _handle_memory_set(self, payload: dict, state: dict) -> dict:
        key = payload.get("key", "")
        value = payload.get("value")
        await self.redis.hset(f"session:{self.session_id}:memory", key, json.dumps(value))
        return {"result": {"key": key, "set": True}, "world_delta": {}, "ws_events": []}

    async def _handle_memory_get(self, payload: dict, state: dict) -> dict:
        key = payload.get("key", "")
        raw = await self.redis.hget(f"session:{self.session_id}:memory", key)
        value = json.loads(raw) if raw else None
        return {"result": {"key": key, "value": value}, "world_delta": {}, "ws_events": []}

    # ── effects ──────────────────────────────────────────────────────────────

    async def _apply_effect(self, effect: dict, state: dict):
        if effect.get("type") == "deduct_gold":
            amount = effect.get("amount", 0)
            new_gold = max(0, state["player"]["gold"] - amount)
            await self.redis.hset(self._state_key, "player_gold", new_gold)
            state["player"]["gold"] = new_gold
        elif effect.get("type") == "deduct_hp":
            amount = effect.get("amount", 0)
            hp = int(await self.redis.hget(self._state_key, "player_hp") or 100)
            hp = max(0, hp - amount)
            await self.redis.hset(self._state_key, "player_hp", hp)
            state["player"]["hp"] = hp
        elif effect.get("type") == "add_item":
            item_id = effect.get("item_id")
            if item_id:
                inv = json.loads(await self.redis.hget(self._state_key, "inventory") or "[]")
                if item_id not in inv:
                    inv.append(item_id)
                    await self.redis.hset(self._state_key, "inventory", json.dumps(inv))
        elif effect.get("type") == "unlock_info":
            info_id = effect.get("info_id")
            if info_id:
                unlocked = json.loads(await self.redis.hget(self._state_key, "unlocked_info") or "[]")
                if info_id not in unlocked:
                    unlocked.append(info_id)
                    await self.redis.hset(self._state_key, "unlocked_info", json.dumps(unlocked))
        elif effect.get("type") == "complete_quest":
            node_id = effect.get("node_id")
            if node_id:
                await self._complete_quest_node(node_id, state)
        elif effect.get("type") == "modify_affinity":
            npc_id = effect.get("npc_id")
            amount = effect.get("amount", 0)
            if npc_id:
                affinity = json.loads(await self.redis.hget(self._state_key, "affinity") or "{}")
                affinity[npc_id] = affinity.get(npc_id, 50) + amount
                affinity[npc_id] = max(0, min(100, affinity[npc_id]))
                await self.redis.hset(self._state_key, "affinity", json.dumps(affinity))

    async def _complete_quest_node(self, node_id: str, state: dict):
        quest_states = json.loads(await self.redis.hget(self._state_key, "quest_states") or "{}")
        for quest_id, quest_cfg in self.config.get("quests", {}).items():
            if node_id in quest_cfg.get("nodes", {}):
                if quest_id not in quest_states:
                    quest_states[quest_id] = {"nodes": {}}
                quest_states[quest_id]["nodes"][node_id] = {"complete": True}
                node_cfg = quest_cfg["nodes"][node_id]
                if node_cfg.get("is_critical_path"):
                    count = int(await self.redis.hget(self._state_key, "completed_critical_nodes") or 0)
                    await self.redis.hset(self._state_key, "completed_critical_nodes", count + 1)
                if node_cfg.get("is_hidden"):
                    count = int(await self.redis.hget(self._state_key, "hidden_events_found") or 0)
                    await self.redis.hset(self._state_key, "hidden_events_found", count + 1)
        await self.redis.hset(self._state_key, "quest_states", json.dumps(quest_states))

    async def _check_conditions(self, state: dict):
        # 重新加载最新状态
        fresh = await self.load_state()
        ev = ConditionEvaluator(fresh)
        for cond in self.config.get("fail_conditions", []):
            if ev.evaluate(cond):
                await self.redis.hset(self._state_key, "status", "failed")
                return
        for cond in self.config.get("win_conditions", []):
            if ev.evaluate(cond):
                await self.redis.hset(self._state_key, "status", "won")
                return

    # ── helpers ──────────────────────────────────────────────────────────────

    def _get_zone_at(self, x: int, y: int) -> str:
        for zone in self.config.get("map", {}).get("zones", []):
            b = zone.get("bounds", {})
            if b.get("x", 0) <= x < b.get("x", 0) + b.get("w", 0) and \
               b.get("y", 0) <= y < b.get("y", 0) + b.get("h", 0):
                return zone["id"]
        return "unknown"

    def _zone_name(self, zone_id: str) -> str:
        for zone in self.config.get("map", {}).get("zones", []):
            if zone["id"] == zone_id:
                return zone.get("name", zone_id)
        return zone_id

    def _get_next_zone_hint(self, current_zone: str, state: dict) -> str:
        """检查当前章节是否完成，提示AI去下一章"""
        zone_order = ["zone_ch1", "zone_ch2", "zone_ch3", "zone_ch4", "zone_ch5"]
        complete_nodes = {
            "zone_ch1": "node_ch1_complete",
            "zone_ch2": "node_ch2_complete",
            "zone_ch3": "node_ch3_complete",
            "zone_ch4": "node_ch4_complete",
        }
        zone_names = {
            "zone_ch2": "瓷器修复实验室",
            "zone_ch3": "妙应寺白塔",
            "zone_ch4": "水关遗址",
            "zone_ch5": "赵教授的办公室",
        }

        node_id = complete_nodes.get(current_zone)
        if not node_id:
            return ""

        # 检查当前章节的完成节点是否已完成
        quests = state.get("quests", {})
        main_quest = quests.get("main_quest", {})
        nodes = main_quest.get("nodes", {})
        node_state = nodes.get(node_id, {})

        if node_state.get("complete"):
            idx = zone_order.index(current_zone) if current_zone in zone_order else -1
            if idx >= 0 and idx + 1 < len(zone_order):
                next_zone = zone_order[idx + 1]
                next_name = zone_names.get(next_zone, next_zone)
                return f"当前章节已完成！请用 move 前往下一区域：{next_name}（zone_id: {next_zone}）"
        return ""

    def _zone_description(self, zone_id: str, state: dict = None) -> str:
        """返回区域描述，支持 zone config 中的 description 字段和条件描述"""
        for zone in self.config.get("map", {}).get("zones", []):
            if zone["id"] == zone_id:
                # 支持条件描述列表：根据游戏状态返回不同描述
                if state and zone.get("descriptions"):
                    ev = ConditionEvaluator(state)
                    for desc_entry in zone["descriptions"]:
                        cond = desc_entry.get("condition")
                        if cond is None or ev.evaluate(cond):
                            return desc_entry["text"]
                return zone.get("description", f"你在{zone.get('name', '未知区域')}。")
        return "你在一个未知的地方。"

    def _message_to_trigger(self, message: str, npc_cfg: dict) -> str:
        """关键词→触发器映射。先匹配通用触发器，再匹配NPC自定义。"""
        msg = message.lower()

        # 先匹配通用触发器（优先级高）
        if any(w in msg for w in ["你好", "您好", "hello", "hi", "嗨", "问候", "打招呼"]):
            return "agent_greet"
        if any(w in msg for w in ["钱", "金币", "给你", "贿赂", "买"]):
            return "agent_bribe"

        # 再匹配 NPC 自定义触发器关键词
        for trigger, keywords in npc_cfg.get("trigger_keywords", {}).items():
            if isinstance(keywords, list) and any(w in msg for w in keywords):
                return trigger

        return "agent_talk"
