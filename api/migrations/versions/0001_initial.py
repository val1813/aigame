"""Initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('players',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('email', sa.String(), nullable=False, unique=True),
        sa.Column('password_hash', sa.String(), nullable=False),
        sa.Column('nickname', sa.String(), nullable=False),
        sa.Column('token', sa.String(), nullable=False, unique=True),
        sa.Column('token_expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table('gm_users',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('email', sa.String(), nullable=False, unique=True),
        sa.Column('password_hash', sa.String(), nullable=False),
        sa.Column('token', sa.String(), nullable=True, unique=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table('worlds',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('slug', sa.String(), nullable=False, unique=True),
        sa.Column('difficulty', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('baseline_time_ms', sa.Integer(), nullable=False),
        sa.Column('baseline_tokens', sa.Integer(), nullable=False),
        sa.Column('time_limit_ms', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(), server_default='draft'),
        sa.Column('config', JSON, nullable=True),
        sa.Column('cover_image_url', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_table('sessions',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('player_id', sa.String(), sa.ForeignKey('players.id'), nullable=False),
        sa.Column('world_id', sa.String(), sa.ForeignKey('worlds.id'), nullable=False),
        sa.Column('model_id', sa.String(), nullable=False),
        sa.Column('client_version', sa.String(), nullable=False),
        sa.Column('secret', sa.String(), nullable=False),
        sa.Column('status', sa.String(), server_default='active'),
        sa.Column('current_turn', sa.Integer(), server_default='0'),
        sa.Column('end_reason', sa.String(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table('action_logs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('session_id', sa.String(), sa.ForeignKey('sessions.id'), nullable=False),
        sa.Column('turn', sa.Integer(), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('payload_hash', sa.String(), nullable=True),
        sa.Column('ts_ns', sa.String(), nullable=False),
        sa.Column('prev_hash', sa.String(), nullable=False),
        sa.Column('entry_hash', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table('scores',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('session_id', sa.String(), sa.ForeignKey('sessions.id'), unique=True, nullable=False),
        sa.Column('world_id', sa.String(), sa.ForeignKey('worlds.id'), nullable=False),
        sa.Column('player_id', sa.String(), sa.ForeignKey('players.id'), nullable=False),
        sa.Column('speed', sa.Float(), nullable=True),
        sa.Column('quality', sa.Float(), nullable=True),
        sa.Column('npc_survival', sa.Float(), nullable=True),
        sa.Column('efficiency', sa.Float(), nullable=True),
        sa.Column('exploration', sa.Float(), nullable=True),
        sa.Column('final_score', sa.Float(), nullable=True),
        sa.Column('grade', sa.String(), nullable=True),
        sa.Column('breakdown', JSON, nullable=True),
        sa.Column('audit_status', sa.String(), server_default='pending'),
        sa.Column('audit_result', JSON, nullable=True),
        sa.Column('scored_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_action_logs_session_id', 'action_logs', ['session_id'])
    op.create_index('ix_scores_world_id_final_score', 'scores', ['world_id', 'final_score'])


def downgrade():
    op.drop_table('scores')
    op.drop_table('action_logs')
    op.drop_table('sessions')
    op.drop_table('worlds')
    op.drop_table('gm_users')
    op.drop_table('players')
