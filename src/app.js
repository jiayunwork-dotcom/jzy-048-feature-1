'use strict';

const Fastify = require('fastify');
const utm = require('./core/utm');
const { ValidationError } = require('./core/errors');
const { radToDeg } = require('./core/angles');

/**
 * 构建 Fastify 应用（无状态纯换算服务）。
 *
 * 路由：
 *   GET  /health                       健康检查
 *   GET  /                             服务说明 + 内置示范点
 *   POST /api/v1/forward               经纬度 → UTM
 *   GET  /api/v1/forward               同上（query 形式，便于浏览器直接调）
 *   POST /api/v1/inverse               UTM → 经纬度
 *   GET  /api/v1/inverse               同上（query 形式）
 *   POST /api/v1/zone                  经度 → 带号/中央经线
 *   GET  /api/v1/zone?lon=             同上（query 形式）
 *
 * 所有非法输入统一返回 400 + 结构化错误体 {error:{code,message,details}}。
 */
async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

  // 统一错误处理：校验错误 400，其余 500，均返回结构化 JSON
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ValidationError) {
      return reply.code(400).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }
    // Fastify 的 body/schema 解析错误也归一为 400
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: error.message, details: null },
      });
    }
    request.log.error(error);
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务内部错误', details: null },
    });
  });

  // query 参数统一转数值；非数字原样保留字符串交给校验模块判 INVALID_TYPE，
  // 空串视为缺失。不在此处吞掉 NaN，保证错误说明如实回显调用方输入。
  function num(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }

  app.get('/health', async () => ({ status: 'ok', service: 'wgs84-utm-service' }));

  app.get('/', async () => ({
    service: 'wgs84-utm-service',
    description: 'WGS84 通用横轴墨卡托（UTM）双向换算；级数出处 USGS PP 1395 (Snyder, 1987) Krüger 展开，k0=0.9996',
    endpoints: {
      forward: {
        method: 'POST /api/v1/forward (或 GET)',
        body: { lat: '纬度(度)', lon: '经度(度)', zone: '可选，强制带号 1..60' },
      },
      inverse: {
        method: 'POST /api/v1/inverse (或 GET)',
        body: { zone: '带号', easting: '东坐标(米)', northing: '北坐标(米)', hemisphere: "'N'|'S'，缺省 N" },
      },
      zone: {
        method: 'POST /api/v1/zone (或 GET /api/v1/zone?lon=)',
        body: { lon: '经度(度)' },
      },
      demo: { method: 'GET /demo' },
    },
    convergenceSignConvention: '以真子午线为准，格网北东偏为正；中央经线以东为正',
    demo: utm.demo(),
  }));

  app.get('/demo', async () => utm.demo());

  // ---------- 正算 ----------
  async function forwardHandler(body) {
    const result = utm.forward(body);
    return { ok: true, result };
  }

  app.post('/api/v1/forward', async (request) => forwardHandler(request.body || {}));
  app.get('/api/v1/forward', async (request) => forwardHandler({
    lat: num(request.query.lat),
    lon: num(request.query.lon),
    zone: num(request.query.zone),
  }));

  // ---------- 反算 ----------
  async function inverseHandler(input) {
    const result = utm.inverse(input);
    return { ok: true, result };
  }

  app.post('/api/v1/inverse', async (request) => inverseHandler(request.body || {}));
  app.get('/api/v1/inverse', async (request) => inverseHandler({
    zone: num(request.query.zone),
    easting: num(request.query.easting),
    northing: num(request.query.northing),
    hemisphere: typeof request.query.hemisphere === 'string'
      ? request.query.hemisphere
      : undefined,
  }));

  // ---------- 分带查询 ----------
  async function zoneHandler(input) {
    const result = utm.locateZone(input);
    return { ok: true, result };
  }

  app.post('/api/v1/zone', async (request) => zoneHandler(request.body || {}));
  app.get('/api/v1/zone', async (request) => zoneHandler({ lon: num(request.query.lon) }));

  // 未匹配路由
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: `路径不存在: ${request.method} ${request.url}`, details: null } });
  });

  return app;
}

module.exports = { buildApp, radToDeg };
