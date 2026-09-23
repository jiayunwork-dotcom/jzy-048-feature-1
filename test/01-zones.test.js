'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { zoneFromLongitude, centralMeridian } = require('../src/core/zones');

test('分带：带号公式 n = floor((lon+180)/6)+1 与中央经线 λ0 = 3+6(n−1)−180', () => {
  // 规则钉死的代表性点
  const cases = [
    { lon: -180, zone: 1, cm: -177 },
    { lon: -173.9999, zone: 2, cm: -171 },
    { lon: 0, zone: 31, cm: 3 },      // 格林威治落在第 31 带
    { lon: 116.3975, zone: 50, cm: 117 }, // 北京
    { lon: 120, zone: 51, cm: 123 },  // 带界经度 120 属于东侧第 51 带
    { lon: -6, zone: 30, cm: -3 },    // 带界点归东侧带
    { lon: 180, zone: 60, cm: 177 },  // 180° 按 UTM 约定并入第 60 带
    { lon: -120, zone: 11, cm: -117 },
  ];
  for (const c of cases) {
    assert.equal(zoneFromLongitude(c.lon), c.zone, `lon=${c.lon} 带号`);
    assert.equal(centralMeridian(c.zone), c.cm, `zone=${c.zone} 中央经线`);
  }
});

test('分带：每带为半开区间 (cm−3, cm+3]，带界点归东侧带，中央经线属自身', () => {
  // 带界经度序列：-174, -168, ..., 174；区间 (b_{k-1}, b_k] 属于第 k 带
  const boundaries = [];
  for (let k = 1; k < 60; k++) boundaries.push(-180 + 6 * k); // -174..174
  assert.equal(boundaries[0], -174);
  assert.equal(boundaries[boundaries.length - 1], 174);

  boundaries.forEach((b, idx) => {
    const westZone = idx + 1;  // 边界西侧的带
    const eastZone = idx + 2;  // 边界东侧的带
    assert.equal(zoneFromLongitude(b), eastZone, `带界 ${b} 归东侧第 ${eastZone} 带`);
    assert.equal(zoneFromLongitude(b - 1e-9), westZone, `带界 ${b} 内侧归第 ${westZone} 带`);
    assert.equal(zoneFromLongitude(b + 1e-9), eastZone);
  });

  for (let n = 1; n <= 60; n++) {
    const cm = centralMeridian(n);
    assert.equal(zoneFromLongitude(cm), n, `带 ${n} 的中央经线必须属于自身`);
    assert.equal(zoneFromLongitude(cm - 1e-9), n);
    assert.equal(zoneFromLongitude(cm + 1e-9), n);
  }

  // 全球两端
  assert.equal(zoneFromLongitude(-180), 1);
  assert.equal(zoneFromLongitude(180), 60); // 180° 按 UTM 约定并入第 60 带
});

test('分带：每带覆盖 6 度，全球共 60 带', () => {
  const seen = new Set();
  for (let lon = -179.999; lon < 180; lon += 0.0137) {
    seen.add(zoneFromLongitude(lon));
  }
  seen.add(zoneFromLongitude(180));
  assert.equal(seen.size, 60);
  assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: 60 }, (_, i) => i + 1));
});
