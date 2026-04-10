"""v3 leaderboard vip model tracking

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    # sessions 新增 2 字段
    op.add_column('sessions', sa.Column('vip_intervention_used', sa.Boolean(), server_default='false', nullable=True))
    op.add_column('sessions', sa.Column('vip_intervention_content_hash', sa.String(64), nullable=True))

    # action_logs 新增 3 字段
    op.add_column('action_logs', sa.Column('input_tokens', sa.Integer(), nullable=True))
    op.add_column('action_logs', sa.Column('output_tokens', sa.Integer(), nullable=True))
    op.add_column('action_logs', sa.Column('model_name', sa.String(100), nullable=True))

    # scores 新增 4 字段
    op.add_column('scores', sa.Column('leaderboard_type', sa.String(20), server_default='pure_ai', nullable=True))
    op.add_column('scores', sa.Column('model_name', sa.String(100), nullable=True))
    op.add_column('scores', sa.Column('model_provider', sa.String(50), nullable=True))
    op.add_column('scores', sa.Column('prompt_public', sa.Boolean(), server_default='false', nullable=True))
    op.add_column('scores', sa.Column('prompt_hash', sa.String(64), nullable=True))

    op.create_index('ix_scores_leaderboard_type', 'scores', ['leaderboard_type', 'world_id', 'final_score'])


def downgrade():
    op.drop_index('ix_scores_leaderboard_type', 'scores')
    op.drop_column('scores', 'prompt_hash')
    op.drop_column('scores', 'prompt_public')
    op.drop_column('scores', 'model_provider')
    op.drop_column('scores', 'model_name')
    op.drop_column('scores', 'leaderboard_type')
    op.drop_column('action_logs', 'model_name')
    op.drop_column('action_logs', 'output_tokens')
    op.drop_column('action_logs', 'input_tokens')
    op.drop_column('sessions', 'vip_intervention_content_hash')
    op.drop_column('sessions', 'vip_intervention_used')
