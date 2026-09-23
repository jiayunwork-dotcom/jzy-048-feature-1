'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/app');
const utm = require('../src/core/utm');

let app;
before(async () => { app = await buildApp(); });

test('GET /health 健康检查', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', service: 'wgs84-utm-service' });
});

test('GET / 返回服务说明与内置示范点', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.endpoints.forward);
  assert.equal(body.demo.forward.zone, 50);
});

test('GET /demo 返回 50N 带、东坐标 40万–60万的中国示范点', async () => {
  const res = await app.inject({ method: 'GET', url: '/demo' });
  assert.equal(res.statusCode, 200);
  const { input, forward } = res.json();
  assert.equal(forward.zone, 50);
  assert.equal(forward.hemisphere, 'N');
  assert.ok(forward.easting > 400000 && forward.easting < 600000);
  assert.ok(input.lon >= 73 && input.lon <= 135);
});

test('POST /api/v1/forward 正算：赤道中央经线基准点', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/forward',
    headers: { 'content-type': 'application/json' },
    payload: { lat: 0, lon: 117 },
  });
  assert.equal(res.statusCode, 200);
  const r = res.json().result;
  assert.equal(r.zone, 50);
  assert.ok(Math.abs(r.easting - 500000) < 1e-6);
  assert.ok(Math.abs(r.northing) < 1e-6);
  assert.ok(Math.abs(r.scale - 0.9996) < 1e-12);
});

test('POST /api/v1/forward 正算：南北半球配对关系', async () => {
  const n = await app.inject({
    method: 'POST', url: '/api/v1/forward',
    headers: { 'content-type': 'application/json' },
    payload: { lat: 45.5, lon: 33 },
  }).then((r) => r.json().result);
  const s = await app.inject({
    method: 'POST', url: '/api/v1/forward',
    headers: { 'content-type': 'application/json' },
    payload: { lat: -45.5, lon: 33 },
  }).then((r) => r.json().result);
  assert.ok(Math.abs(s.northing - (10000000 - n.northing)) < 1e-6);
});

test('POST /api/v1/forward 强制带号：响应显式标注 zoneForced', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/forward',
    headers: { 'content-type': 'application/json' },
    payload: { lat: 39.9, lon: 116.4, zone: 49 },
  });
  const r = res.json().result;
  assert.equal(r.zone, 49);
  assert.equal(r.autoZone, 50);
  assert.equal(r.zoneForced, true);
  assert.ok(r.zoneForcedReason);
});

test('GET /api/v1/forward query 形式可用', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/forward?lat=39.9087&lon=116.3975' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().result.zone, 50);
});

test('POST /api/v1/inverse 反算：与正算互逆', async () => {
  const lat = 48.8566, lon = 2.3522;
  const f = utm.forward({ lat, lon });
  const res = await app.inject({
    method: 'POST', url: '/api/v1/inverse',
    headers: { 'content-type': 'application/json' },
    payload: { zone: f.zone, easting: f.easting, northing: f.northing, hemisphere: 'N' },
  });
  assert.equal(res.statusCode, 200);
  const r = res.json().result;
  assert.ok(Math.abs(r.lat - lat) < 1e-7);
  assert.ok(Math.abs(r.lon - lon) < 1e-7);
});

test('POST /api/v1/inverse 南半球反算', async () => {
  const lat = -33.8688, lon = 151.2093;
  const f = utm.forward({ lat, lon });
  const res = await app.inject({
    method: 'POST', url: '/api/v1/inverse',
    headers: { 'content-type': 'application/json' },
    payload: { zone: f.zone, easting: f.easting, northing: f.northing, hemisphere: 'S' },
  });
  const r = res.json().result;
  assert.ok(Math.abs(r.lat - lat) < 1e-7);
  assert.ok(Math.abs(r.lon - lon) < 1e-7);
});

test('GET /api/v1/inverse query 形式可用', async () => {
  const f = utm.forward({ lat: 35.68, lon: 139.76 });
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/inverse?zone=${f.zone}&easting=${f.easting}&northing=${f.northing}&hemisphere=N`,
  });
  assert.equal(res.statusCode, 200);
  const r = res.json().result;
  assert.ok(Math.abs(r.lat - 35.68) < 1e-7);
});

test('POST /api/v1/zone 与 GET 分带查询', async () => {
  const post = await app.inject({
    method: 'POST', url: '/api/v1/zone',
    headers: { 'content-type': 'application/json' },
    payload: { lon: 116.3975 },
  });
  assert.equal(post.statusCode, 200);
  assert.deepEqual(post.json().result, { lon: 116.3975, zone: 50, centralMeridian: 117 });

  const get = await app.inject({ method: 'GET', url: '/api/v1/zone?lon=0' });
  assert.deepEqual(get.json().result, { lon: 0, zone: 31, centralMeridian: 3 });
});

test('非法输入：正算纬度越界 → 400 + LAT_OUT_OF_RANGE', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/forward',
    headers: { 'content-type': 'application/json' },
    payload: { lat: 90, lon: 100 },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error.code, 'LAT_OUT_OF_RANGE');
  assert.ok(body.error.message);
});

test('非法输入：缺字段 / 类型错 / 带号非法 / 坐标越界 各自带不同错误码', async () => {
  const call = (url, payload) => app.inject({
    method: 'POST', url,
    headers: { 'content-type': 'application/json' },
    payload,
  });
  const missing = await call('/api/v1/forward', { lon: 100 });
  assert.equal(missing.json().error.code, 'MISSING_FIELD');

  const type = await call('/api/v1/forward', { lat: 'x', lon: 100 });
  assert.equal(type.json().error.code, 'INVALID_TYPE');

  const badZone = await call('/api/v1/inverse', { zone: 99, easting: 5e5, northing: 4e6 });
  assert.equal(badZone.json().error.code, 'INVALID_ZONE');

  const badE = await call('/api/v1/inverse', { zone: 50, easting: 1, northing: 4e6 });
  assert.equal(badE.json().error.code, 'EASTING_OUT_OF_RANGE');

  const badN = await call('/api/v1/inverse', { zone: 50, easting: 5e5, northing: 10000001, hemisphere: 'S' });
  assert.equal(badN.json().error.code, 'NORTHING_OUT_OF_RANGE');

  const badHemi = await call('/api/v1/inverse', { zone: 50, easting: 5e5, northing: 4e6, hemisphere: 'X' });
  assert.equal(badHemi.json().error.code, 'INVALID_HEMISPHERE');

  const badLon = await call('/api/v1/zone', { lon: 200 });
  assert.equal(badLon.json().error.code, 'LON_OUT_OF_RANGE');
});

test('非法 JSON body → 400 结构化错误', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/forward',
    headers: { 'content-type': 'application/json' },
    payload: '{ not json',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'BAD_REQUEST');
});

test('未知路由 → 404', async () => {
  const res = await app.inject({ method: 'GET', url: '/nope' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'NOT_FOUND');
});

test('并发：数百个混合换算请求彼此独立、结果不串扰（无状态纯函数）', async () => {
  const requests = [];
  for (let i = 0; i < 300; i++) {
    const lat = -70 + (i % 150);
    const lon = -170 + ((i * 7) % 340);
    requests.push(app.inject({
      method: 'POST', url: '/api/v1/forward',
      headers: { 'content-type': 'application/json' },
      payload: { lat, lon },
    }).then(async (fres) => {
      const f = fres.json().result;
      const bres = await app.inject({
        method: 'POST', url: '/api/v1/inverse',
        headers: { 'content-type': 'application/json' },
        payload: { zone: f.zone, easting: f.easting, northing: f.northing, hemisphere: f.hemisphere },
      });
      const b = bres.json().result;
      assert.ok(Math.abs(b.lat - lat) < 1e-7, `并发点 ${i} 纬度串扰`);
      assert.ok(Math.abs(b.lon - lon) < 1e-7, `并发点 ${i} 经度串扰`);
    }));
  }
  await Promise.all(requests);
});
