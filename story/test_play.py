"""
用百炼 qwen3-plus 模型自动跑《时间罗盘·AI试炼》关卡。
Usage: python story/test_play.py
"""
import json
import time
import urllib.request

API = "http://111.231.112.127:9000"
WORLD_ID = "wld_01KNNVGG1PXE6GPHQ0CNMS4WJ1"
LLM_KEY = "sk-e2ef34341f3e4628bc6fd46772a0345d"
LLM_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
LLM_MODEL = "qwen3.6-plus"

# ── helpers ──────────────────────────────────────────────────────────────────

def api_post(path, data, token=None):
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(f"{API}{path}", data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return json.loads(body)
        except Exception:
            return {"ok": False, "detail": {"code": str(e.code), "message": body.decode("utf-8", errors="replace")}}

def api_get(path, token=None):
    req = urllib.request.Request(f"{API}{path}")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())

def llm_chat(messages):
    body = json.dumps({
        "model": LLM_MODEL,
        "messages": messages,
        "max_tokens": 800,
        "temperature": 0.7,
        "enable_thinking": False,
    }).encode("utf-8")
    req = urllib.request.Request(LLM_URL, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {LLM_KEY}")
    resp = urllib.request.urlopen(req, timeout=120)
    result = json.loads(resp.read())
    return result["choices"][0]["message"]["content"]

# ── main ─────────────────────────────────────────────────────────────────────

def main():
    # 1. 注册/登录
    print("=== 注册玩家 ===")
    ts = str(int(time.time()))
    reg = api_post("/v1/auth/register", {
        "email": f"qwen_test_{ts}@test.com",
        "password": "test123456",
        "nickname": f"Qwen测试_{ts}",
    })
    if not reg.get("ok"):
        print("注册失败:", reg)
        return
    player_token = reg["data"]["player_token"]
    print(f"玩家token: {player_token[:20]}...")

    # 2. 开始session
    print("\n=== 开始游戏 ===")
    start = api_post("/v1/session/start", {
        "world_id": WORLD_ID,
        "model_id": LLM_MODEL,
        "client_version": "3.0.0",
    }, player_token)
    if not start.get("ok"):
        print("开始失败:", start)
        return
    session_id = start["data"]["session_id"]
    session_secret = start["data"]["session_secret"]
    print(f"session: {session_id}")
    print(f"初始状态: {json.dumps(start['data']['initial_state'], ensure_ascii=False)[:200]}")

    # 3. 游戏循环
    system_prompt = """你是一个正在玩推理游戏《时间罗盘·AI试炼》的AI玩家。
游戏是纯文字推理，你需要通过调查物品、与NPC对话、移动到不同区域来推进剧情。

每回合你必须输出一个JSON动作，格式如下（只输出JSON，不要其他文字）：
{"action": "observe", "payload": {}}
{"action": "use_item", "payload": {"item_id": "item_box"}}
{"action": "npc_talk", "payload": {"npc_id": "npc_zhao", "message": "你好"}}
{"action": "move", "payload": {"zone_id": "zone_ch2"}}
{"action": "memory_set", "payload": {"key": "clue1", "value": "白塔"}}

策略：
1. 先observe观察环境，了解可见NPC和物品
2. 调查(use_item)所有可见物品获取线索
3. 与NPC对话获取信息
4. 推理后移动到下一个区域
5. 不要猜测，根据已获得的线索推理"""

    messages = [{"role": "system", "content": system_prompt}]
    turn = 0
    max_turns = 999

    while turn < max_turns:
        turn += 1
        print(f"\n{'='*60}")
        print(f"回合 {turn}/{max_turns}")

        # 让LLM决定动作
        try:
            llm_response = llm_chat(messages)
        except Exception as e:
            print(f"LLM调用失败: {e}")
            break

        print(f"AI决策: {llm_response[:200]}")

        # 解析JSON动作
        try:
            text = llm_response.strip()
            # 去掉markdown代码块包裹
            if "```" in text:
                parts = text.split("```")
                for p in parts[1:]:
                    p = p.strip()
                    if p.startswith("json"):
                        p = p[4:]
                    p = p.strip()
                    if p.startswith("{"):
                        text = p
                        break
            # 去掉JSON前后的非JSON文字
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                text = text[start:end]
            # 修复多余的右括号
            text = text.rstrip()
            while text.count("}") > text.count("{"):
                text = text[:text.rfind("}")]
            action_data = json.loads(text)
        except Exception:
            print(f"无法解析AI输出为JSON，让AI重试")
            messages.append({"role": "assistant", "content": llm_response})
            messages.append({"role": "user", "content": "请只输出一个JSON动作，不要其他文字。格式：{\"action\":\"observe\",\"payload\":{}}"})
            continue

        action = action_data.get("action", "observe")
        payload = action_data.get("payload", {})

        # 执行动作
        result = api_post("/v1/session/action", {
            "session_id": session_id,
            "turn": turn,
            "action": action,
            "payload": payload,
            "ts_ns": str(time.time_ns()),
            "prev_hash": "",
            "entry_hash": f"hash_{turn}",
        }, player_token)

        if not result.get("ok"):
            print(f"动作失败: {result}")
            # 回退turn
            turn -= 1
            messages.append({"role": "assistant", "content": llm_response})
            err_msg = result.get("detail", {})
            if isinstance(err_msg, dict):
                err_msg = err_msg.get("message", str(err_msg))
            messages.append({"role": "user", "content": f"动作失败: {err_msg}。请换一个动作。"})
            continue

        game_result = result.get("data", {}).get("result", {})
        print(f"游戏反馈: {json.dumps(game_result, ensure_ascii=False)[:300]}")

        # 检查是否结束
        if result.get("data", {}).get("world_delta", {}).get("status") in ("won", "failed"):
            print(f"\n游戏结束! 状态: {result['data']['world_delta']['status']}")
            break

        # 将结果反馈给LLM
        messages.append({"role": "assistant", "content": llm_response})
        feedback = f"回合{turn}结果:\n{json.dumps(game_result, ensure_ascii=False)}"
        if result.get("data", ).get("score_snapshot"):
            feedback += f"\n当前评分快照: {json.dumps(result['data']['score_snapshot'], ensure_ascii=False)}"
        messages.append({"role": "user", "content": feedback})

        # 控制消息长度，保留最近20轮
        if len(messages) > 42:
            messages = [messages[0]] + messages[-40:]

        time.sleep(1)  # 避免请求过快

    # 4. 结束session
    print(f"\n=== 结束游戏（{turn}回合）===")
    end = api_post("/v1/session/end", {
        "session_id": session_id,
        "end_reason": "timeout" if turn >= max_turns else "victory",
        "final_turn": turn,
        "chain_root_hash": "test",
    }, player_token)
    print(f"结束结果: {json.dumps(end, ensure_ascii=False)[:200]}")

    # 5. 查分
    time.sleep(3)
    score = api_get(f"/v1/session/{session_id}/score", player_token)
    print(f"评分: {json.dumps(score, ensure_ascii=False)[:300]}")


if __name__ == "__main__":
    main()
