#!/bin/bash
# AgentWorld 部署脚本 - 国内VPS (111.231.112.127)
# 端口: API=9000, GM=9001
# 不影响已有服务: 80, 443, 8080, 8888

set -e

DEPLOY_DIR="/opt/aigame"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== AgentWorld Deploy ==="

# 1. 确保目标目录存在
ssh root@111.231.112.127 "mkdir -p $DEPLOY_DIR"

# 2. 同步文件（排除 prd&spec 和 node_modules）
rsync -avz --exclude='prd&spec' --exclude='node_modules' --exclude='.git' \
  --exclude='__pycache__' --exclude='*.pyc' --exclude='.env' \
  "$REPO_DIR/" root@111.231.112.127:"$DEPLOY_DIR/"

# 3. 在 VPS 上执行部署
ssh root@111.231.112.127 << 'REMOTE'
  set -e
  cd /opt/aigame

  # 复制 .env（首次需手动创建 /opt/aigame/.env）
  if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  请编辑 /opt/aigame/.env 填写真实密钥后重新运行"
    exit 1
  fi

  # 构建并启动
  docker compose pull --quiet 2>/dev/null || true
  docker compose build --no-cache
  docker compose up -d

  # 等待 API 健康
  echo "等待 API 启动..."
  for i in $(seq 1 30); do
    if curl -sf http://localhost:9000/health > /dev/null 2>&1; then
      echo "✓ API 健康"
      break
    fi
    sleep 2
  done

  # 数据库迁移
  docker compose exec -T api python -m alembic upgrade head

  echo "=== 部署完成 ==="
  echo "API:    http://111.231.112.127:9000"
  echo "GM后台: http://111.231.112.127:9001"
REMOTE
