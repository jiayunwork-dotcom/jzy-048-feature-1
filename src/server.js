'use strict';

const { buildApp } = require('./app');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

/**
 * 服务入口。换算内核全部为无状态纯函数，
 * Node 单线程事件循环 + 无共享可变状态，保证并发请求互不串扰。
 */
async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`WGS84 UTM 换算服务已启动: http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
