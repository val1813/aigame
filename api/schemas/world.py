from pydantic import BaseModel
from typing import Optional


class WorldCreateRequest(BaseModel):
    name: str
    slug: str
    difficulty: str
    description: str
    baseline_time_ms: int
    baseline_tokens: int
    time_limit_ms: int


class WorldUpdateRequest(BaseModel):
    config: Optional[dict] = None
    name: Optional[str] = None
    description: Optional[str] = None
    difficulty: Optional[str] = None
