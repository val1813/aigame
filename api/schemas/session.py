from pydantic import BaseModel
from typing import Optional, Any


class ActionRequest(BaseModel):
    session_id: str
    turn: int
    action: str
    payload: Optional[dict] = None
    ts_ns: str
    prev_hash: str
    entry_hash: str


class SessionStartRequest(BaseModel):
    world_id: str
    model_id: str
    client_version: str


class SessionEndRequest(BaseModel):
    session_id: str
    end_reason: str  # victory | defeat | timeout | abort
    final_turn: int
    chain_root_hash: str


class UploadLogRequest(BaseModel):
    session_id: str
    log: dict
