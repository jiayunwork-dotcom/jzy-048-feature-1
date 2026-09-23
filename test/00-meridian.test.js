'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { meridianArc, footpointLatitude, M1 } = require('../src/core/meridian');
const { WGS84 } = require('../src/core/constants');
const { degToRad, radToDeg } = require('../src/core/angles');

test('子午线弧长：赤道为零、奇对称', () => {
  assert.ok(Math.abs(meridianArc(0)) < 1e-9);
  const m60 = meridianArc(degToRad(60));
  const mm60 = meridianArc(degToRad(-60));
  assert.ok(Math.abs(m60 + mm60) < 1e-9);
});

test('子午线弧长：已知参考量级（45° 约 4985 km，90° 约 10001.97 km）', () => {
  const m45 = meridianArc(degToRad(45));
  assert.ok(Math.abs(m45 - 4984944.4) < 1, `M(45)=${m45}`);
  const m90 = meridianArc(Math.PI / 2);
  // WGS84 1/4 子午线周长约 10001965.7 m
  assert.ok(Math.abs(m90 - 10001965.7) < 0.1, `M(90)=${m90}`);
});

test('底点纬度：footpointLatitude 与 meridianArc 严格互逆', () => {
  for (const deg of [-80, -45, -1, 0, 1, 45, 84]) {
    const phi = degToRad(deg);
    const mu = meridianArc(phi) / (WGS84.a * M1);
    const phiBack = footpointLatitude(mu);
    // 底点级数保留到 e1^4，互逆误差约 5e-9 度（亚毫米）
    assert.ok(Math.abs(radToDeg(phiBack - phi)) < 1e-8, `底点互逆失败 @ ${deg}°`);
  }
});
