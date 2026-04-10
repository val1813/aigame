"""audit_worker.py — 消费 Redis audit_queue，用 Claude 审计 action_log，检测作弊"""
import asyncio
import json
import os
import structlog

import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import select, update

log = structlog.get_logger()

DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
db_session = async_sessionmaker(engine, expire_on_commit=False)


async def audit_session(session_id: str):
    from models.models import ActionLog, Score
    import anthropic

    async with db_session() as db:
        result = await db.execute(
            select(ActionLog)
            .where(ActionLog.session_id == session_id)
            .order_by(ActionLog.turn)
        )
        logs = result.scalars().all()

    if not logs:
        return

    # 构建审计摘要
    actions_summary = "\n".join(
        f"Turn {l.turn}: {l.action}" for l in logs[:50]
    )

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = (
        "你是一个游戏反作弊审计员。以下是玩家的行动记录，请判断是否存在作弊行为。\n"
        "作弊特征：行动序列与关卡剧情高度吻合（说明提前知道攻略）、决策速度异常快、"
        "行动内容包含关卡内未公开的关键词。\n\n"
        f"行动记录：\n{actions_summary}\n\n"
        "请回答：PASS（无作弊迹象）或 FAIL（存在作弊迹象），并简要说明原因（50字以内）。"
    )

    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=100,
            messages=[{"role": "user", "content": prompt}],
        )
        verdict_text = response.content[0].text.strip()
        passed = verdict_text.upper().startswith("PASS")
        audit_status = "pass" if passed else "review"
    except Exception as e:
        log.error("audit_llm_failed", session_id=session_id, error=str(e))
        audit_status = "review"
        verdict_text = f"审计失败: {e}"

    async with db_session() as db:
        await db.execute(
            update(Score)
            .where(Score.session_id == session_id)
            .values(
                audit_status=audit_status,
                audit_result={"verdict": verdict_text},
            )
        )
        await db.commit()

    log.info("audit_done", session_id=session_id, status=audit_status)


async def main():
    redis = await aioredis.from_url(REDIS_URL, decode_responses=True)
    log.info("audit_worker_started")

    while True:
        try:
            item = await redis.blpop("audit_queue", timeout=5)
            if not item:
                continue
            _, raw = item
            data = json.loads(raw)
            session_id = data.get("session_id")
            if session_id:
                await audit_session(session_id)
        except Exception as e:
            log.error("audit_worker_error", error=str(e))
            await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(main())
