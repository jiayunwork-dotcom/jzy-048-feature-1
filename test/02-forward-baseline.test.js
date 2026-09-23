'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const utm = require('../src/core/utm');
const { UTM } = require('../src/core/constants');

const EPS_M = 1e-6; // 坐标判据容差（米），1 微米

test('基准：赤道且位于中央经线 → 东坐标 500000、北坐标 0', () => {
  for (const lon of [-177, -3, 3, 117, 177]) {
    const r = utm.forward({ lat: 0, lon });
    assert.ok(Math.abs(r.easting - 500000) < EPS_M, `lon=${lon} easting=${r.easting}`);
    assert.ok(Math.abs(r.northing - 0) < EPS_M, `lon=${lon} northing=${r.northing}`);
  }
});

test('基准：中央经线上比例因子恒为 0.9996（与纬度无关）', () => {
  for (const lat of [-70, -30, 0, 30, 60, 80]) {
    const { zoneFromLongitude, centralMeridian } = require('../src/core/zones');
    const cm = centralMeridian(zoneFromLongitude(0));
    const r = utm.forward({ lat, lon: cm });
    assert.ok(Math.abs(r.scale - UTM.K0) < 1e-12, `lat=${lat} scale=${r.scale}`);
  }
});

test('基准：中央经线上东坐标恒为 500000（假东偏移）', () => {
  for (const lat of [-60, 0, 60]) {
    const r = utm.forward({ lat, lon: 117 });
    assert.ok(Math.abs(r.easting - 500000) < EPS_M);
  }
});

test('比例因子：点从中央经线向东偏离时单调升高，向西对称', () => {
  let prev = null;
  for (const dl of [0, 0.5, 1, 1.5, 2, 2.9]) {
    const k = utm.forward({ lat: 30, lon: 117 + dl }).scale;
    if (prev !== null) assert.ok(k > prev, `东向 dl=${dl} 应升高: ${prev} -> ${k}`);
    prev = k;
    if (dl !== 0) {
      const kw = utm.forward({ lat: 30, lon: 117 - dl }).scale;
      assert.ok(Math.abs(kw - k) < 1e-12, '东西对称点比例因子相等');
    }
  }
  // 比例因子至少不低于中央经线值
  assert.ok(utm.forward({ lat: 0, lon: 117 + 3 }).scale > UTM.K0);
});

test('子午线收敛角：中央经线与赤道上为零，以东为正、以西为负', () => {
  for (const lat of [-50, 0, 50]) {
    const g = utm.forward({ lat, lon: 117 }).convergence.degrees;
    assert.ok(Math.abs(g) < 1e-8, `CM 上应为零, got ${g}`);
  }
  for (const lon of [3, 50, 117]) {
    const g = utm.forward({ lat: 0, lon }).convergence.degrees;
    assert.ok(Math.abs(g) < 1e-8, `赤道上应为零, got ${g}`);
  }
  const east = utm.forward({ lat: 45, lon: 118.5 }).convergence.degrees;
  const west = utm.forward({ lat: 45, lon: 115.5 }).convergence.degrees;
  assert.ok(east > 0);
  assert.ok(west < 0);
  assert.ok(Math.abs(east + west) < 1e-12);
  // 一阶近似 γ ≈ Δλ·sinφ（度），级数应与之接近
  const firstOrder = 1.5 * Math.sin(45 * Math.PI / 180);
  assert.ok(Math.abs(east - firstOrder) < 0.001, '与一阶近似偏差应极小');
});

test('南北半球配对：南纬点北坐标 = 10000000 − 同经度北纬点北坐标', () => {
  const cases = [[45.5, 33], [0.001, -100], [80, 60], [-10, 170]];
  for (const [lat, lon] of cases) {
    const n = utm.forward({ lat, lon });
    const s = utm.forward({ lat: -lat, lon });
    assert.ok(
      Math.abs(s.northing - (UTM.FALSE_NORTHING - n.northing)) < EPS_M,
      `lat=${lat},lon=${lon}: N=${n.northing} S=${s.northing}`
    );
    // 东坐标与比例因子南北对称
    assert.ok(Math.abs(s.easting - n.easting) < EPS_M);
    assert.ok(Math.abs(s.scale - n.scale) < 1e-12);
  }
});

test('内置示范点：中国境内、50N 带、东坐标在 40万–60万之间', () => {
  const d = utm.demo();
  assert.equal(d.forward.zone, 50);
  assert.equal(d.forward.hemisphere, 'N');
  assert.ok(d.forward.easting > 400000 && d.forward.easting < 600000);
  assert.ok(d.input.lat > 0 && d.input.lon > 73 && d.input.lon < 135);
});

test('强制带号：与自动分带不一致时按指定带计算并显式标注跨带', () => {
  const auto = utm.forward({ lat: 39.9, lon: 116.4 });
  assert.equal(auto.zone, 50);
  assert.equal(auto.zoneForced, false);

  const forced = utm.forward({ lat: 39.9, lon: 116.4, zone: 49 });
  assert.equal(forced.zone, 49);
  assert.equal(forced.autoZone, 50);
  assert.equal(forced.zoneForced, true);
  assert.ok(forced.zoneForcedReason.includes('强制'));
  // 东坐标按相邻带（中央经线偏西 6°）计算，应明显变大，未被静默改回 50 带
  assert.ok(forced.easting > auto.easting + 400000);
});

test('强制带号与自动带一致时不算跨带', () => {
  const r = utm.forward({ lat: 10, lon: 100, zone: 47 });
  assert.equal(r.zoneForced, false);
  assert.equal(r.zoneForcedReason, null);
});
