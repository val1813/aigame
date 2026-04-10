import asyncio, json, os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text

async def main():
    engine = create_async_engine(os.environ["DATABASE_URL"])
    Session = async_sessionmaker(engine, expire_on_commit=False)

    with open("/tmp/tc_config.json", encoding="utf-8") as f:
        config = json.load(f)

    config_str = json.dumps(config, ensure_ascii=False)
    npc_count = len(config.get("npcs", []))
    item_count = len(config.get("items", []))
    print(f"config size: {len(config_str)}, npcs: {npc_count}, items: {item_count}")

    async with Session() as db:
        await db.execute(
            text("UPDATE worlds SET config = cast(:cfg as jsonb), name = :name WHERE id = :wid"),
            {"cfg": config_str, "name": "时间罗盘AI试炼", "wid": "wld_01KNNVGG1PXE6GPHQ0CNMS4WJ1"}
        )
        await db.commit()
        print("UPDATE done")

        result = await db.execute(
            text("SELECT length(config::text) FROM worlds WHERE id = :wid"),
            {"wid": "wld_01KNNVGG1PXE6GPHQ0CNMS4WJ1"}
        )
        row = result.first()
        print(f"config length in DB: {row[0] if row else 0}")

    await engine.dispose()

asyncio.run(main())
