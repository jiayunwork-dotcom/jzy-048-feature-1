#!/usr/bin/env bash
# 一条命令：构建镜像并启动 WGS84 UTM 换算服务。
# 用法：./run.sh [宿主端口，默认 8080]
set -euo pipefail

IMAGE_NAME="wgs84-utm-service"
IMAGE_TAG="latest"
HOST_PORT="${1:-8080}"

cd "$(dirname "$0")"

echo "==> 构建镜像 ${IMAGE_NAME}:${IMAGE_TAG}（Node.js 20）"
docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .

echo "==> 启动容器，宿主机端口 ${HOST_PORT} -> 容器 8080"
# 若已有同名容器在跑，先停止移除（幂等，便于重复执行）
if docker ps -a --format '{{.Names}}' | grep -qx "${IMAGE_NAME}"; then
  docker rm -f "${IMAGE_NAME}" >/dev/null
fi

docker run -d \
  --name "${IMAGE_NAME}" \
  -p "${HOST_PORT}:8080" \
  --restart unless-stopped \
  "${IMAGE_NAME}:${IMAGE_TAG}"

echo "==> 等待健康检查 ..."
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/health" >/dev/null 2>&1; then
    echo ""
    echo "✅ 服务已就绪："
    echo "   健康检查   : http://127.0.0.1:${HOST_PORT}/health"
    echo "   示范点     : http://127.0.0.1:${HOST_PORT}/demo"
    echo "   正算示例   : curl 'http://127.0.0.1:${HOST_PORT}/api/v1/forward?lat=39.9087&lon=116.3975'"
    echo "   分带查询   : curl 'http://127.0.0.1:${HOST_PORT}/api/v1/zone?lon=116.3975'"
    echo "   查看日志   : docker logs -f ${IMAGE_NAME}"
    echo "   停止服务   : docker rm -f ${IMAGE_NAME}"
    exit 0
  fi
  sleep 0.5
done

echo "❌ 服务未在预期时间内就绪，请查看：docker logs ${IMAGE_NAME}" >&2
docker logs "${IMAGE_NAME}" >&2 || true
exit 1
