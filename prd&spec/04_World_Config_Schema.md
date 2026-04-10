# AgentWorld 关卡配置 Schema 文档

> **文档类型**：Data Schema Spec  
> **版本**：v1.0 | 2026-04-06  
> **阅读对象**：后端工程师、客户端工程师、GM 后台工程师  
> **说明**：关卡所有配置以 JSON 存储，GM 后台生成，客户端解密后加载运行

---

## 1. 关卡顶层结构

```json
{
  "meta": { ... },          // 关卡元信息
  "map": { ... },           // 地图配置
  "npcs": [ ... ],          // NPC 列表
  "items": [ ... ],         // 物品定义
  "quests": { ... },        // 任务系统
  "events": [ ... ],        // 世界事件
  "win_conditions": [ ... ],// 胜利条件
  "fail_conditions": [ ... ],// 失败条件
  "scoring": { ... }        // 评分基准
}
```

---

## 2. meta（关卡元信息）

```json
{
  "meta": {
    "id": "wld_01hx...",
    "name": "暗夜上海",
    "slug": "dark-night-shanghai-v2",
    "version": "2.1.0",
    "difficulty": "B",
    "description": "都市之下，暗流涌动。蛇神会控制着半座城市...",
    "background_story": "# 背景\n2089年，上海...",
    "time_limit_ms": 1800000,
    "world_time": "23:00",
    "weather": "霓虹雨夜",
    "tags": ["都市玄幻", "侦探", "中难度"]
  }
}
```

---

## 3. map（地图配置）

> **v3.0 变更**：`tiled_json` 字段已废弃（不再使用 Phaser/Tiled），改为字符地图格式。

```json
{
  "map": {
    "width": 40,
    "height": 20,
    "tiles": [
      "########################################",
      "#..............................#####...#",
      "#......@...............f.......#...#...#",
      "#..............................#...#...#",
      "#..............n...............+...>...#",
      "#..............................#...#...#",
      "#..........%...........................#",
      "#..............................#####...#",
      "########################################"
    ],
    "legend": {
      "f": "陈福·酒馆老板",
      "n": "线人张三",
      "%": "入场券",
      ">": "出口"
    },
    "fov_radius": 8,
    "zones": [
      {
        "id": "zone_neon_street",
        "name": "霓虹街",
        "bounds": { "x": 0, "y": 0, "w": 20, "h": 15 },
        "access_condition": null,          // null = 无限制
        "locked_message": null
      },
      {
        "id": "zone_snake_guild_hq",
        "name": "暗夜会馆",
        "bounds": { "x": 40, "y": 20, "w": 15, "h": 15 },
        "access_condition": "quest.main_quest.node_get_address.complete == true",
        "locked_message": "你还不知道会馆的位置"
      }
    ],
    "spawn_point": { "x": 5, "y": 3 }
  }
}
```

---

## 4. npcs（NPC 列表）

### 4.1 脚本型 NPC（状态机）

```json
{
  "id": "npc_zhang_san",
  "name": "线人张三",
  "type": "scripted",
  "position": { "x": 6, "y": 3 },
  "sprite": "npc_informant",
  "is_key_npc": true,
  "key_npc_weight": 1.0,
  "alive": true,
  "initial_state": "idle",

  "states": {
    "idle": {
      "description": "在街角徘徊，神情警惕",
      "transitions": [
        {
          "trigger": "agent_greet",
          "condition": null,
          "target_state": "talking",
          "action": null
        }
      ]
    },
    "talking": {
      "description": "打量着陌生人",
      "transitions": [
        {
          "trigger": "agent_ask_guild",
          "condition": "quest.main_quest.node_contact_zhang.complete == true",
          "target_state": "idle",
          "action": null,
          "failure_response": "什么暗夜会馆？不知道你说什么。"
        },
        {
          "trigger": "agent_bribe",
          "condition": "player.gold >= 500",
          "target_state": "reveal_location",
          "action": {
            "type": "deduct_gold",
            "amount": 500
          }
        },
        {
          "trigger": "agent_bribe",
          "condition": "player.gold < 500",
          "target_state": "talking",
          "action": null,
          "failure_response": "就这点金币？打发叫花子呢。"
        }
      ]
    },
    "reveal_location": {
      "description": "贴近耳语，说出了地址",
      "on_enter_response": "记住，在灵隐路40号，后门进。别说是我说的。",
      "on_enter_unlock": ["snake_guild_address"],
      "on_enter_quest_event": "node_get_address",
      "terminal": false,
      "transitions": [
        {
          "trigger": "any",
          "condition": null,
          "target_state": "idle"
        }
      ]
    }
  },

  "locked_info": [
    {
      "info_id": "snake_guild_address",
      "content": "暗夜会馆地址：灵隐路40号，后门",
      "unlock_condition": "npc_zhang_san.state == 'reveal_location'"
    }
  ],

  "npc_responses": {
    "idle": "（张三瞥了你一眼，没有说话）",
    "talking": "外来人？有什么事？",
    "default": "我不想说话。"
  }
}
```

### 4.2 Boss NPC（LLM 驱动）

```json
{
  "id": "npc_boss_li",
  "name": "李玄阳",
  "type": "llm",
  "position": { "x": 48, "y": 28 },
  "sprite": "npc_boss_snake",
  "is_key_npc": true,
  "key_npc_weight": 1.0,
  "alive": true,

  "llm_config": {
    "system_prompt": "你是暗夜上海蛇神会的会长「李玄阳」，修炼蛇道秘术百年。你怀疑进入你领地的陌生人（Agent）是调查员，表面礼貌，内心警惕。你掌握混沌镜的下落，但绝不轻易透露。用简短的文言夹白话口吻回应，不超过80字。",
    "memory_window": 10,
    "max_response_tokens": 150,
    "temperature": 0.7,
    "initial_emotion": "suspicious",

    "forbidden_outputs": [
      "混沌镜在",
      "地下室"
    ],

    "emotion_transitions": {
      "suspicious": { "friendly_threshold": 3, "angry_threshold": -2 },
      "friendly":   { "betray_threshold": 5 },
      "angry":      { "attack_trigger": true }
    }
  },

  "locked_info": [
    {
      "info_id": "chaos_mirror_location",
      "content": "混沌镜藏于会馆地下三层密室",
      "unlock_condition": "npc_boss_li.emotion == 'friendly' AND quest.main_quest.node_boss_trust.complete"
    }
  ]
}
```

---

## 5. items（物品定义）

```json
{
  "items": [
    {
      "id": "item_gold_coin",
      "name": "金币",
      "type": "currency",
      "initial_amount": 200,
      "max_stack": 9999,
      "icon": "icon_gold",
      "usable_on": ["npc"]
    },
    {
      "id": "item_chaos_mirror",
      "name": "混沌镜",
      "type": "artifact",
      "icon": "icon_artifact_mirror",
      "description": "传说中能照见真相的古器",
      "obtainable_from": "zone_snake_guild_hq",
      "obtain_condition": "quest.main_quest.node_find_mirror.complete"
    }
  ]
}
```

---

## 6. quests（任务系统）

```json
{
  "quests": {
    "main_quest": {
      "id": "main_quest",
      "name": "追查混沌镜",
      "type": "main",
      "nodes": {
        "node_start": {
          "name": "接到任务",
          "prerequisites": [],
          "complete_condition": "session.turn >= 1",
          "is_critical_path": true,
          "is_hidden": false,
          "anti_cheat_lock": false
        },
        "node_contact_zhang": {
          "name": "接触线人张三",
          "prerequisites": ["node_start"],
          "complete_condition": "npc_zhang_san.state IN ['talking', 'reveal_location']",
          "is_critical_path": true,
          "is_hidden": false,
          "anti_cheat_lock": true,
          "locked_error": "LOCKED_NODE",
          "locked_message": "你还没有任何线索，需要先找到知情人"
        },
        "node_get_address": {
          "name": "获取会馆地址",
          "prerequisites": ["node_contact_zhang"],
          "complete_condition": "player.unlocked_info CONTAINS 'snake_guild_address'",
          "is_critical_path": true,
          "is_hidden": false,
          "anti_cheat_lock": true
        },
        "node_infiltrate": {
          "name": "潜入暗夜会馆",
          "prerequisites": ["node_get_address"],
          "complete_condition": "player.zone == 'zone_snake_guild_hq'",
          "is_critical_path": true,
          "is_hidden": false,
          "anti_cheat_lock": true
        },
        "node_boss_trust": {
          "name": "获得李玄阳信任",
          "prerequisites": ["node_infiltrate"],
          "complete_condition": "npc_boss_li.emotion == 'friendly' AND npc_boss_li.conversation_turns >= 3",
          "is_critical_path": true,
          "is_hidden": false,
          "anti_cheat_lock": true
        },
        "node_find_mirror": {
          "name": "找到混沌镜",
          "prerequisites": ["node_boss_trust"],
          "complete_condition": "player.inventory CONTAINS 'item_chaos_mirror'",
          "is_critical_path": true,
          "is_hidden": false,
          "anti_cheat_lock": true
        },
        "node_hidden_truth": {
          "name": "发现真相（隐藏）",
          "prerequisites": ["node_infiltrate"],
          "complete_condition": "player.inspected 'hidden_mural'",
          "is_critical_path": false,
          "is_hidden": true,
          "anti_cheat_lock": false,
          "score_bonus": { "exploration": 20 }
        }
      },
      "node_graph": [
        ["node_start", "node_contact_zhang"],
        ["node_contact_zhang", "node_get_address"],
        ["node_get_address", "node_infiltrate"],
        ["node_infiltrate", "node_boss_trust"],
        ["node_infiltrate", "node_hidden_truth"],
        ["node_boss_trust", "node_find_mirror"]
      ]
    }
  }
}
```

---

## 7. events（世界事件）

```json
{
  "events": [
    {
      "id": "evt_patrol_alert",
      "name": "蛇神会巡逻队",
      "trigger": {
        "type": "zone_enter",
        "zone_id": "zone_snake_guild_hq",
        "condition": "quest.main_quest.node_get_address.complete == false"
      },
      "effect": {
        "type": "fail_session",
        "reason": "你在没有任何掩护的情况下闯入会馆，被巡逻队发现"
      },
      "fx": "red_flash",
      "once": true
    },
    {
      "id": "evt_rain_ends",
      "name": "雨停了",
      "trigger": {
        "type": "turn_reached",
        "turn": 20
      },
      "effect": {
        "type": "world_state_change",
        "changes": { "weather": "雾霭清晨" }
      },
      "fx": null,
      "once": true
    }
  ]
}
```

---

## 8. win_conditions / fail_conditions

```json
{
  "win_conditions": [
    "quest.main_quest.node_find_mirror.complete == true"
  ],

  "fail_conditions": [
    "player.hp <= 0",
    "session.elapsed_ms >= 1800000",
    "npc_zhang_san.alive == false AND npc_boss_li.alive == false"
  ],

  "partial_win": {
    "enabled": true,
    "condition": "quest.main_quest.node_find_mirror.complete == true",
    "description": "主线完成但支线未完成，评级上限 A-"
  }
}
```

---

## 9. scoring（评分基准）

```json
{
  "scoring": {
    "baseline_time_ms": 480000,
    "baseline_tokens": 4000,
    "key_npcs": [
      { "npc_id": "npc_zhang_san", "weight": 1.0 },
      { "npc_id": "npc_boss_li",   "weight": 1.0 }
    ],
    "normal_npcs": [
      { "npc_id": "npc_patrol_a", "weight": 0.3 },
      { "npc_id": "npc_patrol_b", "weight": 0.3 }
    ],
    "hidden_events_total": 2,
    "critical_nodes_total": 6
  }
}
```

---

## 10. 条件表达式语法

关卡配置中的 `condition`、`complete_condition`、`win_conditions` 均使用同一套表达式语法，由服务器端 Python 解析执行：

```
# 基本操作符
==  !=  >  <  >=  <=  AND  OR  NOT  IN  CONTAINS

# 可访问的变量空间
player.hp                         # 玩家血量
player.gold                       # 玩家金币
player.zone                       # 玩家当前区域 ID
player.inventory                  # 玩家背包 [item_id, ...]
player.unlocked_info              # 已解锁信息 ID 列表
player.inspected                  # 已检查的对象 ID 列表

session.turn                      # 当前回合数
session.elapsed_ms                # 已用时间（毫秒）

npc_{id}.state                    # NPC 当前状态
npc_{id}.alive                    # NPC 是否存活（布尔）
npc_{id}.emotion                  # Boss NPC 情绪（字符串）
npc_{id}.conversation_turns       # 与该 NPC 的对话轮数

quest.{quest_id}.{node_id}.complete  # 任务节点是否完成（布尔）
```

**服务器端表达式求值器示例**

```python
# server/engine/condition_evaluator.py
import re

class ConditionEvaluator:
    def __init__(self, game_state: dict):
        self.state = game_state

    def evaluate(self, expression: str) -> bool:
        """
        将表达式中的变量替换为实际值后用 Python eval 求值。
        注意：eval 有安全风险，需严格限制可访问的命名空间。
        """
        if not expression:
            return True

        # 提取所有变量引用并替换为实际值
        resolved = self._resolve_vars(expression)

        # 只允许布尔运算，不允许任意代码执行
        allowed_names = {'True': True, 'False': False, 'None': None}
        try:
            return bool(eval(resolved, {"__builtins__": {}}, allowed_names))
        except Exception:
            return False

    def _resolve_vars(self, expr: str) -> str:
        # player.gold → 实际值
        expr = re.sub(
            r'player\.(\w+)',
            lambda m: repr(self.state['player'].get(m.group(1))),
            expr
        )
        # npc_{id}.{attr}
        expr = re.sub(
            r'npc_(\w+)\.(\w+)',
            lambda m: repr(
                self.state['npcs'].get(m.group(1), {}).get(m.group(2))
            ),
            expr
        )
        # quest.{qid}.{nid}.complete
        expr = re.sub(
            r'quest\.(\w+)\.(\w+)\.complete',
            lambda m: repr(
                self.state['quests']
                    .get(m.group(1), {})
                    .get('nodes', {})
                    .get(m.group(2), {})
                    .get('complete', False)
            ),
            expr
        )
        # session.{attr}
        expr = re.sub(
            r'session\.(\w+)',
            lambda m: repr(self.state['session'].get(m.group(1))),
            expr
        )
        # IN 和 CONTAINS → Python in
        expr = expr.replace(' IN ', ' in ').replace(' CONTAINS ', ' in ')
        # AND OR NOT
        expr = expr.replace(' AND ', ' and ').replace(' OR ', ' or ').replace('NOT ', 'not ')
        return expr
```
