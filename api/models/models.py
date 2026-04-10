from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, Text, JSON, ForeignKey
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class Player(Base):
    __tablename__ = "players"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    nickname = Column(String, nullable=False)
    token = Column(String, unique=True, nullable=False)
    token_expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class GMUser(Base):
    __tablename__ = "gm_users"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    token = Column(String, unique=True, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class World(Base):
    __tablename__ = "worlds"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, nullable=False)
    difficulty = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    baseline_time_ms = Column(Integer, nullable=False)
    baseline_tokens = Column(Integer, nullable=False)
    time_limit_ms = Column(Integer, nullable=False)
    status = Column(String, default="draft")  # draft | published
    config = Column(JSON, nullable=True)       # full world config JSON
    cover_image_url = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True)
    player_id = Column(String, ForeignKey("players.id"), nullable=False)
    world_id = Column(String, ForeignKey("worlds.id"), nullable=False)
    model_id = Column(String, nullable=False)
    client_version = Column(String, nullable=False)
    secret = Column(String, nullable=False)   # HMAC key for this session
    status = Column(String, default="active") # active | ended | scoring | scored
    current_turn = Column(Integer, default=0)
    end_reason = Column(String, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    ended_at = Column(DateTime(timezone=True), nullable=True)
    # v3 新增
    vip_intervention_used = Column(Boolean, default=False)
    vip_intervention_content_hash = Column(String(64), nullable=True)


class ActionLog(Base):
    __tablename__ = "action_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    turn = Column(Integer, nullable=False)
    action = Column(String, nullable=False)
    payload_hash = Column(String, nullable=True)
    ts_ns = Column(String, nullable=False)
    prev_hash = Column(String, nullable=False)
    entry_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # v3 新增
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    model_name = Column(String(100), nullable=True)


class Score(Base):
    __tablename__ = "scores"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, ForeignKey("sessions.id"), unique=True, nullable=False)
    world_id = Column(String, ForeignKey("worlds.id"), nullable=False)
    player_id = Column(String, ForeignKey("players.id"), nullable=False)
    speed = Column(Float, nullable=True)
    quality = Column(Float, nullable=True)
    npc_survival = Column(Float, nullable=True)
    efficiency = Column(Float, nullable=True)
    exploration = Column(Float, nullable=True)
    final_score = Column(Float, nullable=True)
    grade = Column(String, nullable=True)
    breakdown = Column(JSON, nullable=True)
    audit_status = Column(String, default="pending")  # pending | pass | fail | review
    audit_result = Column(JSON, nullable=True)
    scored_at = Column(DateTime(timezone=True), nullable=True)
    # v3 新增
    leaderboard_type = Column(String(20), default='pure_ai')  # pure_ai | vip
    model_name = Column(String(100), nullable=True)
    model_provider = Column(String(50), nullable=True)
    prompt_public = Column(Boolean, default=False)
    prompt_hash = Column(String(64), nullable=True)
