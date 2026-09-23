'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const utm = require('../src/core/utm');
const {
  ELLIPSOID_DEFS,
  ELLIPSOID_IDS,
  getEllipsoid,
  deriveEllipsoid,
  canonicalEllipsoidId,
  describeEllipsoid,
} = require('../src/core/ellipsoids');
const { meridianArc, meridianCoefficients, footpointLatitude } = require('../src/core/meridian');
const { project } = require('../src/core/tmForward');
const { unproject } = require('../src/core/tmInverse');
const { degToRad, radToDeg } = require('../src/core/angles');
const { UTM } = require('../src/core/constants');
const v = require('../src/core/validation');
const { ValidationError, ERROR_CODES } = require('../src/core/errors');

const ALL_IDS = ['WGS84', 'GRS80', 'BESSEL_1841', 'CLARKE_1866'];

/* ------------------------------------------------------------------ *
 * 1. 椭球定义值与派生量
 * ------------------------------------------------------------------ */

test('椭球表：权威定义值（a 与 1/f）按各自标准取值，四种椭球齐全', () => {
  assert.deepEqual([...ELLIPSOID_IDS], ALL_IDS);
  assert.equal(ELLIPSOID_DEFS.WGS84.a, 6378137.0);
  assert.equal(ELLIPSOID_DEFS.WGS84.invF, 298.257223563);
  assert.equal(ELLIPSOID_DEFS.GRS80.a, 6378137.0);
  assert.equal(ELLIPSOID_DEFS.GRS80.invF, 298.257222101);
  assert.equal(ELLIPSOID_DEFS.BESSEL_1841.a, 6377397.155);
  assert.equal(ELLIPSOID_DEFS.BESSEL_1841.invF, 299.1528128);
  assert.equal(ELLIPSOID_DEFS.CLARKE_1866.a, 6378206.4);
  assert.equal(ELLIPSOID_DEFS.CLARKE_1866.invF, 294.9786982);
});

test('派生量：f、b、e²、e′²、e1 全部按统一公式由 a、1/f 现推', () => {
  for (const id of ALL_IDS) {
    const ell = getEllipsoid(id);
    const a = ELLIPSOID_DEFS[id].a;
    const f = 1 / ELLIPSOID_DEFS[id].invF;
    assert.equal(ell.a, a);
    assert.equal(ell.f, f, `${id} f`);
    assert.equal(ell.b, a * (1 - f), `${id} b`);
    assert.equal(ell.e2, f * (2 - f), `${id} e2`);
    assert.equal(ell.ep2, ell.e2 / (1 - ell.e2), `${id} ep2`);
    assert.equal(
      ell.e1,
      (1 - Math.sqrt(1 - ell.e2)) / (1 + Math.sqrt(1 - ell.e2)),
      `${id} e1`
    );
  }
});

test('派生量：短半轴与公开权威值吻合（GRS80/Bessel/Clarke）', () => {
  assert.ok(Math.abs(getEllipsoid('GRS80').b - 6356752.314140347) < 1e-3);
  assert.ok(Math.abs(getEllipsoid('BESSEL_1841').b - 6356078.962818189) < 1e-2);
  assert.ok(Math.abs(getEllipsoid('CLARKE_1866').b - 6356583.79999898) < 1e-2);
});

test('派生量：e² 与权威已知值一致', () => {
  assert.ok(Math.abs(getEllipsoid('WGS84').e2 - 0.0066943799901413) < 1e-13);
  assert.ok(Math.abs(getEllipsoid('GRS80').e2 - 0.00669438002290) < 1e-13);
  assert.ok(Math.abs(getEllipsoid('BESSEL_1841').e2 - 0.0066743722318) < 1e-13);
  assert.ok(Math.abs(getEllipsoid('CLARKE_1866').e2 - 0.00676865799761) < 1e-13);
});

test('deriveEllipsoid：每次现推、对象冻结，无跨请求可变状态', () => {
  const e1 = getEllipsoid('BESSEL_1841');
  const e2x = getEllipsoid('BESSEL_1841');
  assert.notEqual(e1, e2x);                 // 每次新对象
  assert.equal(e1.e2, e2x.e2);              // 数值一致（纯函数推导）
  assert.ok(Object.isFrozen(e1));
  assert.throws(() => { e1.a = 1; }, TypeError);
});

test('标识解析：大小写/空白/连字符/别名都能归一到规范标识', () => {
  assert.equal(canonicalEllipsoidId('wgs84'), 'WGS84');
  assert.equal(canonicalEllipsoidId(' grs-80 '), 'GRS80');
  assert.equal(canonicalEllipsoidId('bessel 1841'), 'BESSEL_1841');
  assert.equal(canonicalEllipsoidId('BESSEL'), 'BESSEL_1841');
  assert.equal(canonicalEllipsoidId('Clarke-1866'), 'CLARKE_1866');
  assert.equal(canonicalEllipsoidId('NAD27'), 'CLARKE_1866');
  assert.equal(canonicalEllipsoidId('EPSG:7004'), 'BESSEL_1841');
  assert.equal(canonicalEllipsoidId('krassovsky'), null);
});

/* ------------------------------------------------------------------ *
 * 2. 默认路径逐位兼容（缺省 = 改造前的 WGS84 行为）
 * ------------------------------------------------------------------ */

const GOLDEN = [
  { in: { lat: 39.9087, lon: 116.3975 }, easting: 448502.1819542134, northing: 4417797.609404602, scale: 0.9996326479877631, cRad: -0.00674660629418693, cDeg: -0.3865520666933077 },
  { in: { lat: 0, lon: 117 }, easting: 500000, northing: 0, scale: 0.9996, cRad: 0, cDeg: 0 },
  { in: { lat: -33.8688, lon: 151.2093 }, easting: 334368.633646655, northing: 6250948.345329111, scale: 0.9999382005413734, cRad: 0.01742138538131608, cDeg: 0.9981718556203217 },
  { in: { lat: 60, lon: 120 }, easting: 332705.17887756065, northing: 6655205.484394241, scale: 0.9999429953140152, cRad: -0.0453553946843828, cDeg: -2.598672693565223 },
  { in: { lat: 83.5, lon: -179 }, easting: 474727.9733364467, northing: 9272714.162007427, scale: 0.9996078017960551, cRad: -0.03468238101698189, cDeg: -1.9871540557377063 },
];

// -0 与 +0 在投影退化点上语义相同（JSON 也无法区分），除此以外逐位一致
function exact(a, b) { return Object.is(a, b) || (a === 0 && b === 0); }

test('默认兼容：不传 ellipsoid 与显式传 WGS84，输出与改造前黄金值逐位一致', () => {
  for (const g of GOLDEN) {
    for (const ellipsoid of [undefined, null, 'WGS84', 'wgs84', 'WGS 84']) {
      const r = utm.forward({ ...g.in, ellipsoid });
      assert.ok(exact(r.easting, g.easting), `easting ${JSON.stringify(g.in)} ${ellipsoid}: ${r.easting}`);
      assert.ok(exact(r.northing, g.northing), `northing ${JSON.stringify(g.in)} ${ellipsoid}`);
      assert.ok(exact(r.scale, g.scale), `scale ${JSON.stringify(g.in)} ${ellipsoid}`);
      assert.ok(exact(r.convergence.radians, g.cRad), `cRad ${JSON.stringify(g.in)} ${ellipsoid}`);
      assert.ok(exact(r.convergence.degrees, g.cDeg), `cDeg ${JSON.stringify(g.in)} ${ellipsoid}`);
      assert.equal(r.datum, 'WGS84');
      assert.equal(r.ellipsoid.id, 'WGS84');
    }
  }
});

test('默认兼容：响应体保留 datum 字段且取值 "WGS84"（老调用方契约）', () => {
  const f = utm.forward({ lat: 10, lon: 100 });
  const b = utm.inverse({ zone: 47, easting: f.easting, northing: f.northing });
  assert.equal(f.datum, 'WGS84');
  assert.equal(b.datum, 'WGS84');
});

test('默认兼容：缺省路径的弧长系数与旧硬编码模块逐项相等', () => {
  // 改造前 constants.js 的 WGS84 字面推导
  const f0 = 1 / 298.257223563;
  const e20 = f0 * (2 - f0);
  const oldM1 = 1 - e20 / 4 - (3 * e20 * e20) / 64 - (5 * e20 ** 3) / 256;
  const oldM2 = (3 * e20) / 8 + (3 * e20 * e20) / 32 + (45 * e20 ** 3) / 1024;
  const oldM3 = (15 * e20 * e20) / 256 + (45 * e20 ** 3) / 1024;
  const oldM4 = (35 * e20 ** 3) / 3072;
  const c = meridianCoefficients(getEllipsoid('WGS84'));
  assert.equal(c.M1, oldM1);
  assert.equal(c.M2, oldM2);
  assert.equal(c.M3, oldM3);
  assert.equal(c.M4, oldM4);
});

/* ------------------------------------------------------------------ *
 * 3. 同一点不同椭球：几何确实变了（坐标/k/收敛角都不同）
 * ------------------------------------------------------------------ */

test('同点不同椭球：非原点处 easting/northing/scale/convergence 必须数值不同', () => {
  // 远离赤道+中央经线这个退化原点的点，椭球几何差异应体现在所有量上
  const p = { lat: 45, lon: 120 };
  const ref = utm.forward({ ...p, ellipsoid: 'WGS84' });
  for (const id of ['GRS80', 'BESSEL_1841', 'CLARKE_1866']) {
    const r = utm.forward({ ...p, ellipsoid: id });
    assert.notEqual(r.easting, ref.easting, `${id} easting 必须不同于 WGS84`);
    assert.notEqual(r.northing, ref.northing, `${id} northing 必须不同于 WGS84`);
    assert.notEqual(r.scale, ref.scale, `${id} scale 必须不同于 WGS84`);
    assert.notEqual(r.convergence.radians, ref.convergence.radians, `${id} 收敛角必须不同于 WGS84`);
    assert.equal(r.datum, id);
  }

  // Bessel 与 WGS84 长半轴差约 740 m、弧长尺度也不同：北京点北坐标应差数百米，
  // “只换标签、内部仍用 WGS84 常数”的实现绝不可能过这条
  const wgsBj = utm.forward({ lat: 39.9087, lon: 116.3975 }); // 默认 WGS84
  const bj = utm.forward({ lat: 39.9087, lon: 116.3975, ellipsoid: 'BESSEL_1841' });
  assert.ok(Math.abs(bj.northing - wgsBj.northing) > 100);
});

test('同点不同椭球：差异量级合理（Bessel 北坐标在北京点与 WGS84 差数百米）', () => {
  const w = utm.forward({ lat: 39.9087, lon: 116.3975 });
  const b = utm.forward({ lat: 39.9087, lon: 116.3975, ellipsoid: 'BESSEL_1841' });
  assert.ok(Math.abs(w.northing - b.northing) > 300, `Δnorthing=${w.northing - b.northing}`);
  assert.ok(Math.abs(w.northing - b.northing) < 600);
});

test('退化原点（赤道 + 中央经线）对所有椭球同为 500000/0 —— 唯一允许相同的位置', () => {
  for (const id of ALL_IDS) {
    const r = utm.forward({ lat: 0, lon: 117, ellipsoid: id });
    assert.ok(Math.abs(r.easting - 500000) < 1e-9, `${id} origin easting`);
    assert.ok(Math.abs(r.northing) < 1e-9, `${id} origin northing`);
  }
});

test('比例因子/收敛角确实走新椭球派生量：与“用 WGS84 几何 + 贴标签”的伪造结果不同', () => {
  const p = { lat: 60, lon: 123 + 2 };
  const fake = utm.forward({ ...p }); // 默认 WGS84 几何
  for (const id of ['GRS80', 'BESSEL_1841', 'CLARKE_1866']) {
    const real = utm.forward({ ...p, ellipsoid: id });
    // 贴标签实现内部仍用 WGS84 常数 → 与 fake 严格相等（差为 0）。
    // 真实现：换了派生量，k 与 γ 至少有一个必须严格偏离 WGS84 值。
    assert.ok(
      real.scale !== fake.scale || real.convergence.radians !== fake.convergence.radians,
      `${id} 的 k/γ 与 WGS84 完全相同，疑似贴标签`
    );
  }
  // 几何差异明显的椭球给一条强判据：Δk 必须在 1e-13 以上
  const b = utm.forward({ ...p, ellipsoid: 'BESSEL_1841' });
  const c = utm.forward({ ...p, ellipsoid: 'CLARKE_1866' });
  assert.ok(Math.abs(b.scale - fake.scale) > 1e-13);
  assert.ok(Math.abs(c.scale - fake.scale) > 1e-13);
  assert.ok(Math.abs(b.convergence.radians - fake.convergence.radians) > 1e-14);
});

test('派生量独立核验：级数使用的子午线弧长与椭球第一偏心率数值积分一致', () => {
  // 不复用 meridianArc 的级数：对椭圆曲率半径 ρ=a(1-e²)/(1-e²sin²φ)^{3/2}
  // 做高精度 Simpson 数值积分，弧长必须与级数结果一致（不同椭球分别成立）
  function arcNumeric(ell, phi) {
    const N = 20000;
    const h = phi / N;
    const rho = (t) => ell.a * (1 - ell.e2) / Math.pow(1 - ell.e2 * Math.sin(t) ** 2, 1.5);
    let s = rho(0) + rho(phi);
    for (let i = 1; i < N; i++) s += (i % 2 ? 4 : 2) * rho(i * h);
    return s * h / 3;
  }
  for (const id of ALL_IDS) {
    const ell = getEllipsoid(id);
    for (const deg of [15, 45, 60, 84]) {
      const phi = degToRad(deg);
      assert.ok(
        Math.abs(meridianArc(phi, ell) - arcNumeric(ell, phi)) < 0.002,
        `${id} ${deg}° 级数弧长与独立数值积分不一致`
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * 4. 每种内置椭球分别往返闭合
 * ------------------------------------------------------------------ */

const RT_DEG = 1e-7; // 约 1.1 cm

test('往返闭合：四种椭球各自全球格网点正算→反算互逆', () => {
  const lats = [-79.5, -45, -1, 0, 1, 45, 83.5];
  const lons = [-179, -120, -30, -0.001, 0.001, 30, 116.4, 179];
  let n = 0;
  for (const id of ALL_IDS) {
    for (const lat of lats) {
      for (const lon of lons) {
        const f = utm.forward({ lat, lon, ellipsoid: id });
        const b = utm.inverse({
          zone: f.zone, easting: f.easting, northing: f.northing,
          hemisphere: f.hemisphere, ellipsoid: id,
        });
        assert.ok(Math.abs(b.lat - lat) < RT_DEG, `${id} lat RT @${lat},${lon}: ${Math.abs(b.lat - lat)}`);
        assert.ok(Math.abs(b.lon - lon) < RT_DEG, `${id} lon RT @${lat},${lon}: ${Math.abs(b.lon - lon)}`);
        assert.equal(b.datum, id);
        n++;
      }
    }
  }
  assert.ok(n >= 100);
});

test('往返闭合：四种椭球各自确定性伪随机点，最大误差保持亚厘米', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (const id of ALL_IDS) {
    let maxLat = 0, maxLon = 0;
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

test('往返闭合：内核层级各椭球底点级数互逆（南纬含假北）', () => {
  for (const id of ALL_IDS) {
    const ell = getEllipsoid(id);
    const { M1 } = meridianCoefficients(ell);
    for (const deg of [-80, -45, 0, 45, 84]) {
      const phi = degToRad(deg);
      const mu = meridianArc(phi, ell) / (ell.a * M1);
      assert.ok(Math.abs(radToDeg(footpointLatitude(mu, ell) - phi)) < 1e-8, `${id} 底点 @${deg}`);
    }
  }
});

test('往返闭合：强制跨带 + 非默认椭球也必须互逆', () => {
  const ell = getEllipsoid('BESSEL_1841');
  const f = utm.forward({ lat: 25, lon: 116, zone: 49, ellipsoid: 'BESSEL_1841' });
  assert.equal(f.zoneForced, true);
  const b = unproject(f.easting - 500000, f.northing, degToRad(f.centralMeridian), ell);
  assert.ok(Math.abs(radToDeg(b.lat) - 25) < RT_DEG);
  assert.ok(Math.abs(radToDeg(b.lon) - 116) < RT_DEG);
});

/* ------------------------------------------------------------------ *
 * 5. 非法椭球标识：结构化错误，不静默退化
 * ------------------------------------------------------------------ */

test('非法椭球标识：正/反算都报 UNKNOWN_ELLIPSOID，绝不退回 WGS84', () => {
  for (const bad of ['KRASSOVSKY', 'wgs-72', 'Bessel1880', '  ']) {
    assert.throws(
      () => utm.forward({ lat: 10, lon: 100, ellipsoid: bad }),
      (e) => e instanceof ValidationError && e.code === ERROR_CODES.UNKNOWN_ELLIPSOID
        && Array.isArray(e.details.supported) && e.details.ellipsoid === bad
    );
    assert.throws(
      () => utm.inverse({ zone: 50, easting: 5e5, northing: 4e6, ellipsoid: bad }),
      (e) => e instanceof ValidationError && e.code === ERROR_CODES.UNKNOWN_ELLIPSOID
    );
  }
});

test('非法椭球标识：非字符串类型报 INVALID_TYPE，错误体带支持清单', () => {
  for (const bad of [123, true, {}, []]) {
    assert.throws(
      () => utm.forward({ lat: 10, lon: 100, ellipsoid: bad }),
      (e) => e instanceof ValidationError && e.code === ERROR_CODES.INVALID_TYPE
    );
  }
});

test('非法椭球在其他字段校验之前被拒（快速失败，不硬算）', () => {
  assert.throws(
    () => utm.forward({ lat: 999, lon: 100, ellipsoid: 'nope' }),
    (e) => e.code === ERROR_CODES.UNKNOWN_ELLIPSOID
  );
});

test('validateEllipsoidField：缺省/空值默认 WGS84，合法标识透传', () => {
  assert.equal(v.validateEllipsoidField(undefined), 'WGS84');
  assert.equal(v.validateEllipsoidField(null), 'WGS84');
  assert.equal(v.validateEllipsoidField('grs80'), 'GRS80');
});

/* ------------------------------------------------------------------ *
 * 6. 带号 / 平面坐标 / 椭球三者不自洽：现有校验不被绕过
 * ------------------------------------------------------------------ */

test('不自洽组合：坐标明显落在别的带宽范围，各椭球下都被拦', () => {
  for (const id of ALL_IDS) {
    // 东坐标 90000 明显在任何 6° 带的合理范围之外
    assert.throws(
      () => utm.inverse({ zone: 50, easting: 90000, northing: 4e6, ellipsoid: id }),
      (e) => e.code === ERROR_CODES.EASTING_OUT_OF_RANGE, `${id} 异常东坐标应被拦`
    );
    // 北坐标越界（北半球给负值）
    assert.throws(
      () => utm.inverse({ zone: 50, easting: 5e5, northing: -5, hemisphere: 'N', ellipsoid: id }),
      (e) => e.code === ERROR_CODES.NORTHING_OUT_OF_RANGE, `${id} 异常北坐标应被拦`
    );
    // 南半球却给北半球尺度的北坐标
    assert.throws(
      () => utm.inverse({ zone: 50, easting: 5e5, northing: 100, hemisphere: 'S', ellipsoid: id }),
      (e) => e.code === ERROR_CODES.NORTHING_OUT_OF_RANGE, `${id} 半球矛盾应被拦`
    );
  }
});

test('不自洽组合：带号错配 → 反算经度冲出 [-180,180]，域校验兜底（各椭球）', () => {
  for (const id of ALL_IDS) {
    // zone=1、CM=-177，东坐标 160000 对应西缘外约 -180.05°
    assert.throws(
      () => utm.inverse({ zone: 1, easting: 160000, northing: 0, hemisphere: 'N', ellipsoid: id }),
      (e) => e.code === ERROR_CODES.INVERSE_OUT_OF_DOMAIN, `${id} 错带反算应被域校验拦`
    );
  }
});

test('不自洽组合：北坐标粗检范围按本次椭球弧长现算（不是固定常量）', () => {
  // 粗检跨度 = k0·M(84°)+2000 / k0·(−M(−80°))+2000，随椭球几何变化
  for (const id of ALL_IDS) {
    const ell = getEllipsoid(id);
    const spans = v.northingSpans(ell);
    assert.equal(spans.north, UTM.K0 * meridianArc(degToRad(84), ell) + 2000, `${id} north span`);
    assert.equal(spans.south, UTM.K0 * -meridianArc(degToRad(-80), ell) + 2000, `${id} south span`);
  }
  // Bessel 与 WGS84 的跨度必须不同（长半轴/扁率都不同，84° 弧长差约 1 km）
  const sw = v.northingSpans(getEllipsoid('WGS84'));
  const sb = v.northingSpans(getEllipsoid('BESSEL_1841'));
  assert.ok(Math.abs(sw.north - sb.north) > 500);

  // validateNorthing 真的消费了椭球跨度：Bessel 84° 处正算出的最大附近北坐标
  // 对 Bessel 合法；把它抬到 Bessel 跨度之外（仍在 WGS84 跨度之内）必须被 Bessel 拦下
  const fB = utm.forward({ lat: 84, lon: 117, ellipsoid: 'BESSEL_1841' });
  assert.doesNotThrow(() => v.validateNorthing(fB.northing, 'N', getEllipsoid('BESSEL_1841')));
  const over = sb.north + 10; // 越过 Bessel 跨度，仍 < WGS84 跨度
  assert.ok(over < sw.north, '测试构造前提：该值在 WGS84 粗跨度内');
  assert.throws(
    () => v.validateNorthing(over, 'N', getEllipsoid('BESSEL_1841')),
    (e) => e.code === ERROR_CODES.NORTHING_OUT_OF_RANGE && e.details.ellipsoid === 'BESSEL_1841'
  );
  // 同一个数在 WGS84 椭球下不触粗检（其后的经纬度域复核由 facade 层负责）
  assert.doesNotThrow(() => v.validateNorthing(over, 'N', getEllipsoid('WGS84')));
});

test('带号合法性本身与椭球无关：换任何椭球，非法带号依旧 INVALID_ZONE', () => {
  for (const id of ALL_IDS) {
    assert.throws(
      () => utm.inverse({ zone: 61, easting: 5e5, northing: 4e6, ellipsoid: id }),
      (e) => e.code === ERROR_CODES.INVALID_ZONE
    );
  }
});

/* ------------------------------------------------------------------ *
 * 7. 分带查询与椭球无关
 * ------------------------------------------------------------------ */

test('分带查询：不接受/不依赖椭球参数，纯经度映射不变', () => {
  const a = utm.locateZone(116.3975);
  const b = utm.locateZone({ lon: 116.3975, ellipsoid: 'BESSEL_1841' }); // 传入也被忽略
  assert.deepEqual(a, { lon: 116.3975, zone: 50, centralMeridian: 117 });
  assert.deepEqual(a, b);
});

/* ------------------------------------------------------------------ *
 * 8. 无状态并发：同一实例不同请求各自不同椭球互不串扰
 * ------------------------------------------------------------------ */

test('并发隔离：交错使用四种椭球的正/反算，结果与串行逐一计算完全相同', async () => {
  const pts = [];
  for (let i = 0; i < 200; i++) {
    pts.push({
      lat: -70 + (i % 140) + (i % 7) * 0.13,
      lon: -170 + ((i * 13) % 340),
      ellipsoid: ALL_IDS[i % ALL_IDS.length],
    });
  }
  // 串行参考结果
  const serial = pts.map((p) => {
    const f = utm.forward(p);
    const b = utm.inverse({
      zone: f.zone, easting: f.easting, northing: f.northing,
      hemisphere: f.hemisphere, ellipsoid: p.ellipsoid,
    });
    return { f, b };
  });

  // 并发交错（Promise 微任务 + setImmediate 制造交错）
  const concurrent = await Promise.all(pts.map(async (p, i) => {
    if (i % 3 === 0) await new Promise((r) => setImmediate(r));
    const f = utm.forward(p);
    if (i % 5 === 0) await Promise.resolve();
    const b = utm.inverse({
      zone: f.zone, easting: f.easting, northing: f.northing,
      hemisphere: f.hemisphere, ellipsoid: p.ellipsoid,
    });
    return { f, b };
  }));

  for (let i = 0; i < pts.length; i++) {
    assert.equal(concurrent[i].f.easting, serial[i].f.easting, `点 ${i} easting 串扰`);
    assert.equal(concurrent[i].f.northing, serial[i].f.northing, `点 ${i} northing 串扰`);
    assert.equal(concurrent[i].f.scale, serial[i].f.scale, `点 ${i} scale 串扰`);
    assert.equal(concurrent[i].f.convergence.radians, serial[i].f.convergence.radians, `点 ${i} 收敛角串扰`);
    assert.equal(concurrent[i].f.datum, pts[i].ellipsoid);
    assert.ok(Math.abs(concurrent[i].b.lat - serial[i].b.lat) === 0);
    assert.ok(Math.abs(concurrent[i].b.lon - serial[i].b.lon) === 0);
  }
});

test('内核签名：级数模块直接按传入椭球计算，互不污染', () => {
  const phi = degToRad(40), lam = degToRad(118), l0 = degToRad(117);
  const xW = project(phi, lam, l0, getEllipsoid('WGS84'));
  const xB = project(phi, lam, l0, getEllipsoid('BESSEL_1841'));
  assert.notEqual(xW.x, xB.x);
  // 再算一次 WGS84，结果必须与首次完全一致（证明 Bessel 调用没有留下任何残留状态）
  const xW2 = project(phi, lam, l0, getEllipsoid('WGS84'));
  assert.equal(xW2.x, xW.x);
  assert.equal(xW2.y, xW.y);
  assert.equal(xW2.scale, xW.scale);
});

test('响应中的 ellipsoid 描述与所用派生量一致（防止描述与计算两张皮）', () => {
  const ell = getEllipsoid('CLARKE_1866');
  const r = utm.forward({ lat: 30, lon: 100, ellipsoid: 'CLARKE_1866' });
  assert.deepEqual(r.ellipsoid, describeEllipsoid(ell));
  assert.equal(r.ellipsoid.a, 6378206.4);
  assert.equal(r.ellipsoid.inverseFlattening, 294.9786982);
});
