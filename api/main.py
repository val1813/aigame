from contextlib import asynccontextmanager
import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import auth, worlds, sessions, leaderboard, gm


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = await aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    engine = create_async_engine(settings.DATABASE_URL, pool_size=10, max_overflow=20)
    app.state.db_engine = engine
    app.state.db_session = async_sessionmaker(engine, expire_on_commit=False)
    yield
    await app.state.redis.aclose()
    await app.state.db_engine.dispose()


app = FastAPI(
    title="AgentWorld API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,        prefix="/v1/auth",        tags=["auth"])
app.include_router(worlds.router,      prefix="/v1/worlds",      tags=["worlds"])
app.include_router(sessions.router,    prefix="/v1/session",     tags=["session"])
app.include_router(leaderboard.router, prefix="/v1/leaderboard", tags=["leaderboard"])
app.include_router(gm.router,          prefix="/gm",             tags=["gm"])


@app.get("/health")
async def health(request=None):
    return {"status": "ok"}
