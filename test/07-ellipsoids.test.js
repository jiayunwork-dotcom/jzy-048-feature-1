'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const utm = require('../src/core/utm');
const {
  ELLIPSOIDS, ELLIPSOID_DEFS, SUPPORTED_ELLIPSOID_IDS,
  DEFAULT_ELLIPSOID, resolveEllipsoid, deriveEllipsoid,
} = require('../src/core/ellipsoids');
const { meridianArc } = require('../src/core/meridian');
const { project } = require('../src/core/tmForward');
const { unproject } = require('../src/core/tmInverse');
const { degToRad, radToDeg } = require('../src/core/angles');
const { ValidationError, ERROR_CODES } = require('../src/core/errors');

/**
 * 多椭球支持测试。覆盖四条彼此独立的硬判据：
 *   1. 默认路径（不传 ellipsoid）相对改造前 WGS84 结果逐位一致；
 *   2. 三种新增内置椭球（GRS80 / BESSEL_1841 / CLARKE_1866）各自往返闭合；
 *   3. 同一点换椭球，坐标/比例因子/收敛角必须真的不同（除非原点退化点）；
 *   4. 非法椭球标识 → 结构化错误；带号/坐标/椭球不自洽仍被既有校验拦下。
 */

const ALL_IDS = ['WGS84', 'GRS80', 'BESSEL_1841', 'CLARKE_1866'];
const RT_TOL = 1e-7; // 往返经纬度容差（度）

function expectError(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ValidationError);
    assert.equal(err.code, code);
    assert.ok(typeof err.message === 'string' && err.message.length > 0);
    return true;
  });
}

// ---------------------------------------------------------------------------
// 1. 默认路径逐位兼容（fixture 由改造前代码生成，Object.is 严格判等）
// ---------------------------------------------------------------------------

const baselineRows = require(path.join(__dirname, 'fixtures', 'wgs84-forward-baseline.json'));

test('默认路径逐位兼容：100 个全球点坐标/比例因子/收敛角与改造前完全相同（Object.is）', () => {
  assert.equal(baselineRows.length, 100);
  for (const [lat, lon, e0, n0, k0, g0, gd0] of baselineRows) {
    const r = utm.forward({ lat, lon });
    assert.ok(Object.is(r.easting, e0), `(${lat},${lon}) easting ${r.easting} !== ${e0}`);
    assert.ok(Object.is(r.northing, n0), `(${lat},${lon}) northing ${r.northing} !== ${n0}`);
    assert.ok(Object.is(r.scale, k0), `(${lat},${lon}) scale ${r.scale} !== ${k0}`);
    assert.ok(Object.is(r.convergence.radians, g0), `(${lat},${lon}) convergence rad`);
    assert.ok(Object.is(r.convergence.degrees, gd0), `(${lat},${lon}) convergence deg`);
  }
});

test('默认路径逐位兼容：显式 ellipsoid:"WGS84" 与缺省结果逐位相同', () => {
  for (const [lat, lon] of [[39.9087, 116.3975], [-60, -150], [83.9, 179]]) {
    const a = utm.forward({ lat, lon });
    const b = utm.forward({ lat, lon, ellipsoid: 'WGS84' });
    for (const k of ['easting', 'northing', 'scale']) assert.ok(Object.is(a[k], b[k]), k);
    assert.ok(Object.is(a.convergence.radians, b.convergence.radians));
    const ia = utm.inverse({ zone: a.zone, easting: a.easting, northing: a.northing, hemisphere: a.hemisphere });
    const ib = utm.inverse({ zone: a.zone, easting: a.easting, northing: a.northing, hemisphere: a.hemisphere, ellipsoid: 'WGS84' });
    assert.ok(Object.is(ia.lat, ib.lat) && Object.is(ia.lon, ib.lon));
  }
});

test('默认路径逐位兼容：底层子午线弧长/正算/反算原始返回值不变', () => {
  // 这些字面量取自改造前同版本内核的直接输出
  assert.ok(Object.is(meridianArc(degToRad(45)), 4984944.378231886));
  const p = project(degToRad(39.9087), degToRad(116.3975), degToRad(117));
  assert.ok(Object.is(p.x, -51497.81804578656));
  assert.ok(Object.is(p.y, 4417797.609404602));
  assert.ok(Object.is(p.scale, 0.9996326479877631));
  assert.ok(Object.is(p.convergence, -0.00674660629418693));
  const u = unproject(448502.1819542134 - 500000, 4417797.609404602, degToRad(117));
  assert.ok(Object.is(u.lat, 0.6965382151974444));
  assert.ok(Object.is(u.lon, 2.0315196160900393));
  // 默认派生量就是 WGS84 同一个冻结对象
  assert.equal(resolveEllipsoid(undefined), DEFAULT_ELLIPSOID);
  assert.equal(DEFAULT_ELLIPSOID.id, 'WGS84');
});

test('默认响应仍带 datum:"WGS84"，并新增同义的 ellipsoid 字段', () => {
  const f = utm.forward({ lat: 10, lon: 100 });
  assert.equal(f.datum, 'WGS84');
  assert.equal(f.ellipsoid, 'WGS84');
  const b = utm.inverse({ zone: f.zone, easting: f.easting, northing: f.northing, hemisphere: 'N' });
  assert.equal(b.datum, 'WGS84');
  assert.equal(b.ellipsoid, 'WGS84');
});

// ---------------------------------------------------------------------------
// 2. 椭球定义常数与派生量
// ---------------------------------------------------------------------------

test('内置椭球：四种权威定义值齐备，标识与别名均可解析到同一对象', () => {
  assert.deepEqual(SUPPORTED_ELLIPSOID_IDS, ALL_IDS);
  const defs = Object.fromEntries(ELLIPSOID_DEFS.map((d) => [d.id, d]));
  assert.equal(defs.WGS84.a, 6378137.0);
  assert.equal(defs.WGS84.invFlattening, 298.257223563);
  assert.equal(defs.GRS80.a, 6378137.0);
  assert.equal(defs.GRS80.invFlattening, 298.257222101);
  assert.equal(defs.BESSEL_1841.a, 6377397.155);
  assert.equal(defs.BESSEL_1841.invFlattening, 299.1528128);
  assert.equal(defs.CLARKE_1866.a, 6378206.4);
  assert.equal(defs.CLARKE_1866.invFlattening, 294.9786982);

  for (const alias of ['wgs84', ' wGs84 ', 'WGS-84', 'grs80', 'GRS 1980', 'bessel', 'Bessel 1841', 'clarke', 'CLARKE1866']) {
    const ell = resolveEllipsoid(alias);
    assert.ok(ALL_IDS.includes(ell.id), `别名 ${alias} 解析失败`);
    assert.equal(ell, ELLIPSOIDS[ell.id]); // 返回的是预推导的冻结对象
    assert.ok(Object.isFrozen(ell) && Object.isFrozen(ell.meridian));
  }
});

test('派生量：f/b/e²/e\'²/e1 与弧长系数均由 (a,1/f) 独立公式推出，关系自洽', () => {
  for (const id of ALL_IDS) {
    const def = ELLIPSOID_DEFS.find((d) => d.id === id);
    const e = ELLIPSOIDS[id];
    const f = 1 / def.invFlattening;
    assert.ok(Object.is(e.f, f));
    assert.ok(Math.abs(e.b - def.a * (1 - f)) < 1e-9);
    const e2 = f * (2 - f);
    const ep2 = e2 / (1 - e2);
    assert.ok(Math.abs(e.e2 - e2) < 1e-18);
    assert.ok(Math.abs(e.ep2 - ep2) < 1e-18);
    assert.equal(e.e2, f * (2 - f));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    assert.ok(Math.abs(e.e1 - e1) < 1e-18);
    // 弧长系数随椭球：M1 = 1 − e²/4 − 3e⁴/64 − 5e⁶/256
    const m1 = 1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256;
    assert.ok(Math.abs(e.meridian.M1 - m1) < 1e-18);
  }
});

test('派生量：短半轴与发表值一致（Bessel 6356078.9628…、Clarke1866 6356583.8、WGS84 6356752.3142…）', () => {
  assert.ok(Math.abs(ELLIPSOIDS.WGS84.b - 6356752.31424518) < 1e-6);
  assert.ok(Math.abs(ELLIPSOIDS.GRS80.b - 6356752.31414036) < 1e-6);
  assert.ok(Math.abs(ELLIPSOIDS.BESSEL_1841.b - 6356078.96281819) < 1e-6);
  // Clarke 1866 的 b 常用表值只给到 6356583.8（0.1 m 精度），容差相应放宽
  assert.ok(Math.abs(ELLIPSOIDS.CLARKE_1866.b - 6356583.8) < 1e-4);
});

test('deriveEllipsoid 可独立复用：任意 (a,1/f) 推导出的对象喂给级数，定义值与内置一致', () => {
  const custom = deriveEllipsoid({ id: 'X', name: 'x', a: 6378137.0, invFlattening: 298.257223563 });
  assert.equal(custom.e2, DEFAULT_ELLIPSOID.e2);
  assert.equal(custom.meridian.M1, DEFAULT_ELLIPSOID.meridian.M1);
});

// ---------------------------------------------------------------------------
// 3. 同点不同椭球：坐标必须真的不同（防“只换标签，内部仍按 WGS84 算”）
// ---------------------------------------------------------------------------

// 取一个远离中央经线（Δλ≈2.9°，近带边缘）且不在赤道的点：
// 椭球几何差异（尤其 GRS80 与 WGS84 只有约 1e-10 相对差）在此充分放大到可分辨。
const P = { lat: 47.3769, lon: 11.9234 }; // 自动 32 带（CM=9），在带内近东缘

test('不同椭球：同一点东坐标、北坐标均不同（原点退化点除外）', () => {
  const w = utm.forward({ ...P });
  for (const id of ['GRS80', 'BESSEL_1841', 'CLARKE_1866']) {
    const f = utm.forward({ ...P, ellipsoid: id });
    assert.equal(f.ellipsoid, id);
    assert.equal(f.datum, id);
    // 即使是与 WGS84 只差 0.1mm 量级的 GRS80，也必须能与 WGS84 区分开
    assert.notEqual(f.easting, w.easting, `${id} easting 不应等于 WGS84`);
    assert.notEqual(f.northing, w.northing, `${id} northing 不应等于 WGS84`);
    assert.ok(Math.abs(f.easting - w.easting) > 1e-7, `${id} easting 差异过小: ${f.easting - w.easting}`);
    assert.ok(Math.abs(f.northing - w.northing) > 1e-7, `${id} northing 差异过小: ${f.northing - w.northing}`);
  }
  // Bessel 与 WGS84 的长半轴差约 740 m，北纬点北坐标应有百米量级差异
  const b = utm.forward({ ...P, ellipsoid: 'BESSEL_1841' });
  assert.ok(Math.abs(b.northing - w.northing) > 100, `Bessel 北坐标差异 ${b.northing - w.northing}`);
  assert.ok(Math.abs(b.easting - w.easting) > 0.5, `Bessel 东坐标差异 ${b.easting - w.easting}`);
  const c = utm.forward({ ...P, ellipsoid: 'CLARKE_1866' });
  assert.ok(Math.abs(c.northing - w.northing) > 50);
});

test('不同椭球：比例因子与收敛角也是新椭球派生量算出来的（不是复用 WGS84 贴标签）', () => {
  const w = utm.forward({ ...P });
  for (const id of ['GRS80', 'BESSEL_1841', 'CLARKE_1866']) {
    const f = utm.forward({ ...P, ellipsoid: id });
    assert.notEqual(f.scale, w.scale, `${id} scale 不应等于 WGS84`);
    assert.notEqual(f.convergence.radians, w.convergence.radians, `${id} γ 不应等于 WGS84`);
  }
  // 用各椭球自己的派生量在级数层独立算一遍，服务结果必须与之一致
  for (const id of ALL_IDS) {
    const ell = ELLIPSOIDS[id];
    const raw = project(degToRad(P.lat), degToRad(P.lon), degToRad(9), ell);
    const svc = utm.forward({ ...P, ellipsoid: id });
    assert.ok(Object.is(raw.scale, svc.scale), `${id} 比例因子与级数层不一致`);
    assert.ok(Object.is(raw.convergence, svc.convergence.radians), `${id} 收敛角与级数层不一致`);
    assert.ok(Object.is(raw.x + 500000, svc.easting), `${id} 东坐标与级数层不一致`);
  }
});

test('不同椭球：多点扫描下非原点处东/北坐标必须全部不同（含 GRS80 亚毫米差）', () => {
  const pts = [[10, 0.5], [-55, 67.2], [80, -123.45], [0.5, 119.99], [60, -178], [-79.5, 30.1]];
  for (const [lat, lon] of pts) {
    const w = utm.forward({ lat, lon });
    for (const id of ['GRS80', 'BESSEL_1841', 'CLARKE_1866']) {
      const f = utm.forward({ lat, lon, ellipsoid: id });
      assert.notEqual(f.easting, w.easting, `${id} @(${lat},${lon}) easting 退化`);
      assert.notEqual(f.northing, w.northing, `${id} @(${lat},${lon}) northing 退化`);
    }
  }
});

test('原点退化点（赤道 + 中央经线）：各椭球按 UTM 约定恒为 (500000, 0, k=0.9996, γ=0)', () => {
  // 这是题目明确允许的唯一例外：UTM 层面的假偏移/k0 不随椭球变化
  for (const id of ALL_IDS) {
    const f = utm.forward({ lat: 0, lon: 117, ellipsoid: id });
    assert.equal(f.easting, 500000);
    assert.equal(f.northing, 0);
    assert.equal(f.scale, 0.9996);
    assert.ok(Math.abs(f.convergence.radians) < 1e-16);
    assert.ok(Math.abs(f.convergence.degrees) < 1e-16);
  }
});

test('UTM 层约定不随椭球变：任何椭球中央经线上 k≡0.9996、东坐标≡500000', () => {
  for (const id of ALL_IDS) {
    for (const lat of [-60, 0, 30, 80]) {
      const f = utm.forward({ lat, lon: 117, ellipsoid: id });
      assert.ok(Math.abs(f.scale - 0.9996) < 1e-12);
      assert.equal(f.easting, 500000);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. 每种内置椭球各自往返闭合
// ---------------------------------------------------------------------------

test('往返闭合：四种椭球在全球格网点上正反算互逆（lat/lon 误差 < 1e-7°）', () => {
  const lats = [-79.5, -45, -1, 0, 1, 45, 83.5];
  const lons = [-179, -120, -30, -0.001, 0.001, 30, 120, 179];
  let n = 0;
  for (const id of ALL_IDS) {
    for (const lat of lats) {
      for (const lon of lons) {
        const f = utm.forward({ lat, lon, ellipsoid: id });
        const b = utm.inverse({
          zone: f.zone, easting: f.easting, northing: f.northing,
          hemisphere: f.hemisphere, ellipsoid: id,
        });
        assert.ok(Math.abs(b.lat - lat) < RT_TOL, `${id} lat 往返 @${lat},${lon}: ${b.lat - lat}`);
        assert.ok(Math.abs(b.lon - lon) < RT_TOL, `${id} lon 往返 @${lat},${lon}: ${b.lon - lon}`);
        assert.equal(b.ellipsoid, id);
        n++;
      }
    }
  }
  assert.equal(n, 4 * lats.length * lons.length);
});

test('往返闭合：四种椭球 + 确定性随机点，最大误差达亚毫米级（< 1e-8° / 2e-8°）', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (const id of ALL_IDS) {
    let maxLat = 0, maxLon = 0;
    seed = id.length * 999 + 1;
    for (let i = 0; i < 120; i++) {
      const lat = -79.9 + rand() * 163.8;
      const lon = -179.999 + rand() * 359.998;
      const f = utm.forward({ lat, lon, ellipsoid: id });
      const b = utm.inverse({
        zone: f.zone, easting: f.easting, northing: f.northing,
        hemisphere: f.hemisphere, ellipsoid: id,
      });
      maxLat = Math.max(maxLat, Math.abs(b.lat - lat));
      maxLon = Math.max(maxLon, Math.abs(b.lon - lon));
    }
    assert.ok(maxLat < 1e-8, `${id} 随机点最大纬度误差 ${maxLat}`);
    assert.ok(maxLon < 2e-8, `${id} 随机点最大经度误差 ${maxLon}`);
  }
});

test('往返闭合：南半球点各椭球各自闭合，假北偏移不参与椭球推导', () => {
  for (const id of ALL_IDS) {
    const lat = -33.86, lon = 151.2;
    const f = utm.forward({ lat, lon, ellipsoid: id });
    assert.equal(f.hemisphere, 'S');
    assert.ok(f.northing > 1e7 - 4e6 && f.northing < 1e7);
    const b = utm.inverse({ zone: f.zone, easting: f.easting, northing: f.northing, hemisphere: 'S', ellipsoid: id });
    assert.ok(Math.abs(b.lat - lat) < RT_TOL);
    assert.ok(Math.abs(b.lon - lon) < RT_TOL);
  }
});

test('往返闭合：带界接缝点在各椭球上也互逆', () => {
  for (const id of ALL_IDS) {
    for (const seam of [114, 120, -174, 174]) {
      for (const eps of [-1e-6, 1e-6]) {
        const lat = 25.3, lon = seam + eps;
        const f = utm.forward({ lat, lon, ellipsoid: id });
        const b = utm.inverse({
          zone: f.zone, easting: f.easting, northing: f.northing,
          hemisphere: f.hemisphere, ellipsoid: id,
        });
        assert.ok(Math.abs(b.lat - lat) < RT_TOL, `${id} seam lat`);
        assert.ok(Math.abs(b.lon - lon) < RT_TOL, `${id} seam lon`);
      }
    }
  }
});

test('反算→正算方向：各椭球坐标层面同样互逆（< 1e-3 m）', () => {
  for (const id of ALL_IDS) {
    const f0 = utm.forward({ lat: 48.8566, lon: 2.3522, ellipsoid: id });
    const b0 = utm.inverse({ zone: f0.zone, easting: f0.easting, northing: f0.northing, hemisphere: 'N', ellipsoid: id });
    const f1 = utm.forward({ lat: b0.lat, lon: b0.lon, ellipsoid: id });
    assert.ok(Math.abs(f1.easting - f0.easting) < 1e-3, `${id} easting 复原`);
    assert.ok(Math.abs(f1.northing - f0.northing) < 1e-3, `${id} northing 复原`);
  }
});

test('混椭球不闭合可被抓住：A 椭球正算的坐标喂给 B 椭球反算，经纬度必偏离（防标签偷换）', () => {
  const lat = 40, lon = 116;
  const f = utm.forward({ lat, lon, ellipsoid: 'BESSEL_1841' });
  const wrong = utm.inverse({ zone: f.zone, easting: f.easting, northing: f.northing, hemisphere: 'N', ellipsoid: 'WGS84' });
  // Bessel 与 WGS84 差异达数百米 → 反算纬度偏差约 1e-3 度量级，必然远超闭合容差
  assert.ok(Math.abs(wrong.lat - lat) > 1e-5, `混椭球反算竟闭合: Δlat=${wrong.lat - lat}`);
});

test('子午线弧长：各椭球 M(φ) 与对其自身被积函数的数值积分一致（验证真用了新椭球几何）', () => {
  // M(φ)=∫₀^φ a(1−e²)/ (1−e² sin²u)^(3/2) du，Simpson 高分辨率独立积分
  function arcNumerical(phiDeg, ell) {
    const n = 20000;
    const phi = degToRad(phiDeg);
    const h = phi / n;
    const f = (u) => ell.a * (1 - ell.e2) / Math.pow(1 - ell.e2 * Math.sin(u) ** 2, 1.5);
    let s = f(0) + f(phi);
    for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(i * h);
    return s * h / 3;
  }
  for (const id of ALL_IDS) {
    const ell = ELLIPSOIDS[id];
    for (const deg of [-60, 0, 45, 84]) {
      const series = meridianArc(degToRad(deg), ell);
      const integ = arcNumerical(deg, ell);
      assert.ok(Math.abs(series - integ) < 0.01, `${id} M(${deg}) 级数=${series} 积分=${integ}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 5. 非法椭球标识：结构化错误，绝不静默退回 WGS84
// ---------------------------------------------------------------------------

test('非法椭球标识：正算/反算均报 INVALID_ELLIPSOID（400 类结构化错误），不退化 WGS84', () => {
  for (const bad of ['BEIJING54', 'wgs-72', '', '   ', 123, null, true, {}]) {
    expectError(() => utm.forward({ lat: 10, lon: 100, ellipsoid: bad }), ERROR_CODES.INVALID_ELLIPSOID);
    expectError(
      () => utm.inverse({ zone: 50, easting: 5e5, northing: 4e6, ellipsoid: bad }),
      ERROR_CODES.INVALID_ELLIPSOID
    );
  }
});

test('INVALID_ELLIPSOID 错误体带 received 与 supported 明细，可供调用方程序化处理', () => {
  try {
    utm.forward({ lat: 1, lon: 1, ellipsoid: 'XIAN80' });
    assert.fail('应抛错');
  } catch (e) {
    assert.equal(e.code, 'INVALID_ELLIPSOID');
    assert.ok(e.message.includes('XIAN80'));
    assert.deepEqual(e.details.supported, ALL_IDS);
    assert.equal(e.details.received, 'XIAN80');
  }
});

test('未收录标识不会悄悄按 WGS84 算：错误在计算之前抛出，不存在“伪结果”', () => {
  // 若实现静默退化，下面这串调用会返回 WGS84 数值而不抛错
  assert.throws(() => utm.forward({ lat: 39.9087, lon: 116.3975, ellipsoid: 'CLARKE1880' }));
});

// ---------------------------------------------------------------------------
// 6. 带号 / 平面坐标 / 椭球三者自洽性：既有物理校验不被椭球参数绕过
// ---------------------------------------------------------------------------

test('东坐标越界：指定任何椭球都照样报 EASTING_OUT_OF_RANGE', () => {
  for (const id of [undefined, 'WGS84', 'GRS80', 'BESSEL_1841', 'CLARKE_1866']) {
    expectError(
      () => utm.inverse({ zone: 50, easting: 90000, northing: 4e6, ellipsoid: id }),
      ERROR_CODES.EASTING_OUT_OF_RANGE
    );
    expectError(
      () => utm.inverse({ zone: 50, easting: 9000000, northing: 4e6, ellipsoid: id }),
      ERROR_CODES.EASTING_OUT_OF_RANGE
    );
  }
});

test('带号非法：带 ellipsoid 参数不绕过 INVALID_ZONE', () => {
  expectError(
    () => utm.inverse({ zone: 0, easting: 5e5, northing: 4e6, ellipsoid: 'BESSEL' }),
    ERROR_CODES.INVALID_ZONE
  );
  expectError(
    () => utm.forward({ lat: 10, lon: 100, zone: 61, ellipsoid: 'GRS80' }),
    ERROR_CODES.INVALID_ZONE
  );
});

test('坐标落在别的带宽范围：反算经度跨出 [-180,180]，各椭球都被落域复核拦下', () => {
  // 第 1 带西缘给最小合理东坐标，反算经度约 −180.05° → INVERSE_OUT_OF_DOMAIN
  for (const id of ALL_IDS) {
    expectError(
      () => utm.inverse({ zone: 1, easting: 160000, northing: 0, hemisphere: 'N', ellipsoid: id }),
      ERROR_CODES.INVERSE_OUT_OF_DOMAIN
    );
  }
});

test('北坐标粗检随椭球几何走：越界值在各椭球下报 NORTHING_OUT_OF_RANGE', () => {
  for (const id of ALL_IDS) {
    expectError(
      () => utm.inverse({ zone: 31, easting: 5e5, northing: -1, hemisphere: 'N', ellipsoid: id }),
      ERROR_CODES.NORTHING_OUT_OF_RANGE
    );
    expectError(
      () => utm.inverse({ zone: 31, easting: 5e5, northing: 10000001, hemisphere: 'S', ellipsoid: id }),
      ERROR_CODES.NORTHING_OUT_OF_RANGE
    );
  }
});

test('半球标识非法：椭球参数存在时仍报 INVALID_HEMISPHERE', () => {
  expectError(
    () => utm.inverse({ zone: 50, easting: 5e5, northing: 4e6, hemisphere: 'E', ellipsoid: 'GRS80' }),
    ERROR_CODES.INVALID_HEMISPHERE
  );
});

// ---------------------------------------------------------------------------
// 7. 分带查询与椭球无关
// ---------------------------------------------------------------------------

test('分带查询是纯经度映射：请求带不带 ellipsoid 字段结果一致，且不校验该字段', () => {
  const a = utm.locateZone({ lon: 116.3975 });
  const b = utm.locateZone({ lon: 116.3975, ellipsoid: 'BESSEL' });
  const c = utm.locateZone({ lon: 116.3975, ellipsoid: 'NOT_A_DATUM' }); // 分带接口刻意忽略
  assert.deepEqual(a, { lon: 116.3975, zone: 50, centralMeridian: 117 });
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
});

// ---------------------------------------------------------------------------
// 8. 同实例并发混用多椭球：互不串扰、无共享可变状态
// ---------------------------------------------------------------------------

test('并发隔离：同一进程内交错使用四种椭球，各请求结果与独立串行计算一致', async () => {
  const tasks = [];
  const expected = new Map();
  for (let i = 0; i < 400; i++) {
    const id = ALL_IDS[i % ALL_IDS.length];
    const lat = -70 + (i % 140) + (i % 7) * 0.013;
    const lon = -170 + ((i * 7) % 340);
    const key = `${id}:${lat}:${lon}`;
    expected.set(key, utm.forward({ lat, lon, ellipsoid: id }));
    tasks.push((async () => {
      // 每轮 await 让出事件循环，制造交错
      await Promise.resolve();
      const f = utm.forward({ lat, lon, ellipsoid: id });
      const ref = expected.get(key);
      assert.equal(f.easting, ref.easting, `${id} 并发东坐标串扰`);
      assert.equal(f.northing, ref.northing, `${id} 并发北坐标串扰`);
      assert.equal(f.scale, ref.scale);
      assert.equal(f.ellipsoid, id);
      await Promise.resolve();
      const b = utm.inverse({
        zone: f.zone, easting: f.easting, northing: f.northing,
        hemisphere: f.hemisphere, ellipsoid: id,
      });
      assert.ok(Math.abs(b.lat - lat) < RT_TOL, `${id} 并发往返纬度`);
      assert.ok(Math.abs(b.lon - lon) < RT_TOL, `${id} 并发往返经度`);
    })());
  }
  await Promise.all(tasks);
});

test('无共享可变状态：解析出的椭球对象全部冻结，修改尝试在严格模式下抛错', () => {
  const ell = resolveEllipsoid('BESSEL');
  assert.ok(Object.isFrozen(ell));
  assert.throws(() => { 'use strict'; ell.e2 = 0; });
});
