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


# 强制所有JSON响应带 charset=utf-8，解决Windows终端中文乱码
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

class UTF8Middleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        ct = response.headers.get("content-type", "")
        if "application/json" in ct and "charset" not in ct:
            response.headers["content-type"] = "application/json; charset=utf-8"
        return response

app.add_middleware(UTF8Middleware)

app.include_router(auth.router,        prefix="/v1/auth",        tags=["auth"])
app.include_router(worlds.router,      prefix="/v1/worlds",      tags=["worlds"])
app.include_router(sessions.router,    prefix="/v1/session",     tags=["session"])
app.include_router(leaderboard.router, prefix="/v1/leaderboard", tags=["leaderboard"])
app.include_router(gm.router,          prefix="/gm",             tags=["gm"])


@app.get("/health")
async def health(request=None):
    return {"status": "ok"}


@app.get("/download/client")
async def download_client():
    import os
    path = "/var/www/agentworld/agentworld-client.tar.gz"
    if not os.path.exists(path):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=404, content={"error": "file not found"})
    from fastapi.responses import FileResponse
    return FileResponse(path, filename="agentworld-client.tar.gz", media_type="application/gzip")
