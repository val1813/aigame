#!/bin/bash
# 首次 VPS 环境初始化（只需运行一次）
# 在 VPS 上直接执行: bash setup_vps.sh

set -e

echo "=== 安装 Docker ==="
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
  apt-get install -y docker-compose-plugin
fi

echo "=== 开放防火墙端口 9000 9001 ==="
# 只开放 aigame 端口，不动已有规则
if command -v ufw &> /dev/null; then
  ufw allow 9000/tcp comment 'aigame-api'
  ufw allow 9001/tcp comment 'aigame-gm'
elif command -v firewall-cmd &> /dev/null; then
  firewall-cmd --permanent --add-port=9000/tcp
  firewall-cmd --permanent --add-port=9001/tcp
  firewall-cmd --reload
fi

echo "=== 创建部署目录 ==="
mkdir -p /opt/aigame

echo "=== 完成 ==="
echo "下一步: 上传项目文件到 /opt/aigame，编辑 .env，运行 docker compose up -d"
