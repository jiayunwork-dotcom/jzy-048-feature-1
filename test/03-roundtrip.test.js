'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const utm = require('../src/core/utm');

/**
 * 核心自洽性测试：正算 → 反算必须严格互逆。
 * 只要正、反两支级数任何一处系数写错，往返就会漂移，这里必然抓住。
 */

// 往返误差容差：1e-7 度（赤道处约 1.1 厘米）。
// USGS A^6/D^6 级数自身截断误差约 1e-9 度（亚毫米），留一个数量级余量。
const ROUNDTRIP_DEG_TOL = 1e-7;

function roundtrip(lat, lon, label) {
  const f = utm.forward({ lat, lon });
  const b = utm.inverse({
    zone: f.zone,
    easting: f.easting,
    northing: f.northing,
    hemisphere: f.hemisphere,
  });
  assert.ok(Math.abs(b.lat - lat) < ROUNDTRIP_DEG_TOL,
    `${label ?? ''} 纬度往返误差 ${Math.abs(b.lat - lat)} 度 (${lat},${lon})`);
  assert.ok(Math.abs(b.lon - lon) < ROUNDTRIP_DEG_TOL,
    `${label ?? ''} 经度往返误差 ${Math.abs(b.lon - lon)} 度 (${lat},${lon})`);
  assert.equal(b.zone, f.zone);
  return { f, b };
}

test('往返闭合：全球格网点（含接近投影域边界）', () => {
  const lats = [-79.5, -60, -30, -1, 0, 1, 30, 60, 83.5];
  const lons = [-179, -150, -90, -30, -0.001, 0.001, 30, 90, 150, 179];
  let checked = 0;
  for (const lat of lats) {
    for (const lon of lons) {
      roundtrip(lat, lon, 'grid');
      checked++;
    }
  }
  assert.ok(checked > 50);
});

test('往返闭合：带界附近（分带接缝处最容易暴露系数/带号错误）', () => {
  const seams = [-174, -120, -6, 0, 6, 114, 120, 174];
  for (const seam of seams) {
    for (const eps of [-1e-6, 1e-6]) {
      roundtrip(31.7, seam + eps, `seam ${seam}`);
    }
  }
});

test('往返闭合：500 个确定性伪随机全球点，最大误差必须远小于容差', () => {
  // 确定性 LCG，保证测试可复现
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let maxLat = 0, maxLon = 0;
  for (let i = 0; i < 500; i++) {
    const lat = -79.9 + rand() * 163.8; // (-79.9, 83.9)
    const lon = -179.999 + rand() * 359.998;
    const f = utm.forward({ lat, lon });
    const b = utm.inverse({
      zone: f.zone,
      easting: f.easting,
      northing: f.northing,
      hemisphere: f.hemisphere,
    });
    maxLat = Math.max(maxLat, Math.abs(b.lat - lat));
    maxLon = Math.max(maxLon, Math.abs(b.lon - lon));
  }
  // 级数截断的理论水平：亚毫米 → 约 1e-8 度量级
  assert.ok(maxLat < 1e-8, `随机点最大纬度误差 ${maxLat} 度`);
  assert.ok(maxLon < 2e-8, `随机点最大经度误差 ${maxLon} 度`);
});

test('往返闭合：反算 → 正算方向同样互逆（坐标层面）', () => {
  const f0 = utm.forward({ lat: -33.86, lon: 151.2 });
  const b0 = utm.inverse({ zone: f0.zone, easting: f0.easting, northing: f0.northing, hemisphere: 'S' });
  const f1 = utm.forward({ lat: b0.lat, lon: b0.lon });
  // 两次级数截断叠加，坐标层面误差仍为 0.1 毫米量级
  assert.ok(Math.abs(f1.easting - f0.easting) < 1e-3, '东坐标复原（米）');
  assert.ok(Math.abs(f1.northing - f0.northing) < 1e-3, '北坐标复原（米）');
});

test('往返闭合：强制带号（跨带）情形也必须互逆', () => {
  // lon=116 自动属 50 带，强制用西侧 49 带（差一带，东坐标约 113 万，仍在椭球可算域）
  const f = utm.forward({ lat: 25, lon: 116, zone: 49 });
  assert.equal(f.zoneForced, true);
  // 强制跨带结果会超出本带常规东坐标范围，反算层走内核直接验证互逆性
  const { unproject } = require('../src/core/tmInverse');
  const { degToRad, radToDeg } = require('../src/core/angles');
  const b = unproject(f.easting - 500000, f.northing, degToRad(f.centralMeridian));
  assert.ok(Math.abs(radToDeg(b.lat) - 25) < ROUNDTRIP_DEG_TOL);
  assert.ok(Math.abs(radToDeg(b.lon) - 116) < ROUNDTRIP_DEG_TOL);

  // 常规的“强制但仍落在带内合理域”的场景走 facade 反算
  const f2 = utm.forward({ lat: 25, lon: 120 + 1e-6, zone: 50 }); // 自动为 51 带，强压 50
  assert.equal(f2.zoneForced, true);
  const b2 = utm.inverse({ zone: 50, easting: f2.easting, northing: f2.northing, hemisphere: 'N' });
  assert.ok(Math.abs(b2.lat - 25) < ROUNDTRIP_DEG_TOL);
  assert.ok(Math.abs(b2.lon - (120 + 1e-6)) < ROUNDTRIP_DEG_TOL);
});
