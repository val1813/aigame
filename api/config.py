from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ANTHROPIC_API_KEY: str = ""
    SESSION_SECRET_SALT: str = "dev_salt_change_me"
    JWT_SECRET: str = "dev_jwt_secret_change_me"

    DATABASE_URL: str = "postgresql+asyncpg://aw:aw_pass@postgres:5432/agentworld"
    REDIS_URL: str = "redis://redis:6379/0"

    MAX_SESSIONS_PER_WORLD: int = 50
    AGENT_TURN_TIMEOUT_S: int = 120
    CHEAT_SEMANTIC_THRESHOLD: float = 0.85
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:9001"

    class Config:
        env_file = ".env"


settings = Settings()
