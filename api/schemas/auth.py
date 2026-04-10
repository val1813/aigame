from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


class RegisterRequest(BaseModel):
    email: str
    password: str
    nickname: str


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterResponse(BaseModel):
    player_id: str
    player_token: str
    nickname: str


class LoginResponse(BaseModel):
    player_token: str
    expires_at: datetime


class VerifyResponse(BaseModel):
    player_id: str
    nickname: str
    valid_until: datetime
