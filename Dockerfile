# WGS84 UTM 换算服务 —— 运行环境固定为 Node.js 20
FROM node:20-bookworm-slim

# 镜像元信息
LABEL org.opencontainers.image.title="wgs84-utm-service" \
      org.opencontainers.image.description="WGS84 UTM 投影双向换算后端（Fastify, USGS Krüger 级数）" \
      org.opencontainers.image.source="wgs84-utm-service"

WORKDIR /app

# 默认监听端口（HTTP 服务对外开放）
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info

# 先只拷依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# 拷贝源码与测试
COPY src ./src
COPY test ./test

# 非 root 用户运行
RUN chown -R node:node /app
USER node

EXPOSE 8080

# 容器内自检后启动（失败则构建/编排层可见）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
