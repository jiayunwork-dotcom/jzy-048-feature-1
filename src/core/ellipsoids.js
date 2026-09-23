'use strict';

const { ValidationError, ERROR_CODES } = require('./errors');

/**
 * 基准椭球定义表与派生量推导（独立模块）。
 *
 * 本模块只负责“椭球几何”本身：
 *   - 维护各权威基准椭球的定义常数（长半轴 a、扁率倒数 1/f）；
 *   - 按需把 (a, 1/f) 推导成投影级数需要的派生量
 *     （扁率 f、短半轴 b、第一偏心率平方 e²、第二偏心率平方 e'²、
 *       子午线弧长辅助量 e1 及其弧长二项级数系数 M1..M4）。
 *
 * UTM 层面的约定（中央经线比例因子 k0=0.9996、假东 500000、
 * 南半球假北 10000000、6 度分带）与椭球无关，仍在 constants.js /
 * zones.js，不在此处出现；正反算级数（tmForward/tmInverse/meridian）
 * 也不内嵌任何椭球数值表，只接收本模块产出的派生量对象。
 *
 * 并发模型：定义表与派生结果在模块加载时一次性算完并全部 Object.freeze，
 * 之后只读；每次调用 resolveEllipsoid 返回同一个冻结对象，不产生、
 * 不缓存任何跨请求可变状态，同一服务实例可并发混用不同椭球。
 *
 * 权威定义值（长半轴 a：米；扁率以 1/f 给出）：
 *   - WGS84：       a = 6378137.0   1/f = 298.257223563（EPSG / NIMA TR8350.2）
 *   - GRS80：       a = 6378137.0   1/f = 298.257222101（Moritz 1980，ETRS89/NAVD88 基准）
 *   - Bessel 1841： a = 6377397.155 1/f = 299.1528128（Bessel 1841 全球版，EPSG:7004）
 *   - Clarke 1866： a = 6378206.4   1/f = 294.9786982（NAD27 基准椭球，EPSG:7008）
 */

/** 缺省椭球标识：不传 ellipsoid 字段时必须与改造前的 WGS84 行为完全一致 */
const DEFAULT_ELLIPSOID_ID = 'WGS84';

/**
 * 椭球定义表（只放权威定义常数，派生量一律经 deriveEllipsoid 推导）。
 * aliases 为测绘软件中常见的等义写法，解析时一并接受；对外规范标识以 id 为准。
 */
const ELLIPSOID_DEFS = [
  {
    id: 'WGS84',
    name: 'World Geodetic System 1984（WGS 84）',
    a: 6378137.0,
    invFlattening: 298.257223563,
    aliases: ['WGS_1984', 'WGS-84', 'WGS'],
  },
  {
    id: 'GRS80',
    name: 'Geodetic Reference System 1980（GRS 80）',
    a: 6378137.0,
    invFlattening: 298.257222101,
    aliases: ['GRS_1980', 'GRS-80', 'GRS 1980'],
  },
  {
    id: 'BESSEL_1841',
    name: 'Bessel 1841（贝塞尔椭球，全球版）',
    a: 6377397.155,
    invFlattening: 299.1528128,
    aliases: ['BESSEL', 'BESSEL1841', 'BESSEL 1841'],
  },
  {
    id: 'CLARKE_1866',
    name: 'Clarke 1866（克拉克 1866 椭球，NAD27）',
    a: 6378206.4,
    invFlattening: 294.9786982,
    aliases: ['CLARKE', 'CLARKE1866', 'CLARKE 1866', 'CLRK66'],
  },
];

/**
 * 由定义常数 (a, 1/f) 推导一个椭球的全部几何派生量。
 *
 * 推导关系（USGS PP 1395, Snyder 1987）：
 *   f  = 1/(1/f)
 *   b  = a·(1 − f)
 *   e² = 2f − f²                第一偏心率平方
 *   e'² = e²/(1 − e²)           第二偏心率平方
 *   e1 = (1 − √(1−e²))/(1 + √(1−e²))   子午线弧长/底点纬度辅助量
 * M1..M4 为子午线弧长二项级数（式 3-21/3-22，保留到 e⁶）的系数。
 *
 * 注意：WGS84 分支的每个表达式文本、求值顺序都与原 constants.js /
 * meridian.js 完全一致，保证默认路径逐位（bit-for-bit）不变。
 *
 * @param {object} def ELLIPSOID_DEFS 中的一条定义
 * @returns {object} 冻结的椭球派生量对象
 */
function deriveEllipsoid(def) {
  const a = def.a;                          // 长半轴
  const f = 1 / def.invFlattening;          // 扁率
  const b = a * (1 - f);                    // 短半轴
  const e2 = f * (2 - f);                   // 第一偏心率平方 e² = 2f − f²
  const ep2 = e2 / (1 - e2);                // 第二偏心率平方 e'² = e²/(1−e²)
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2)); // 弧长辅助量 e1

  // 子午线弧长二项级数系数（USGS PP 1395, 式 3-21/3-22，保留到 e⁶）
  const M1 = 1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * Math.pow(e2, 3)) / 256;
  const M2 = (3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * Math.pow(e2, 3)) / 1024;
  const M3 = (15 * e2 * e2) / 256 + (45 * Math.pow(e2, 3)) / 1024;
  const M4 = (35 * Math.pow(e2, 3)) / 3072;

  return Object.freeze({
    id: def.id,
    name: def.name,
    a,
    f,
    invFlattening: def.invFlattening,
    b,
    e2,
    ep2,
    e1,
    meridian: Object.freeze({ M1, M2, M3, M4 }),
  });
}

// 模块加载时一次性推导全部内置椭球并冻结；之后只读，无运行期可变状态
const ELLIPSOIDS = Object.freeze(
  ELLIPSOID_DEFS.reduce((acc, def) => {
    acc[def.id] = deriveEllipsoid(def);
    return acc;
  }, Object.create(null))
);

// 标识（含别名）→ 规范椭球对象的只读索引
const LOOKUP = (() => {
  const map = new Map();
  for (const def of ELLIPSOID_DEFS) {
    map.set(def.id, ELLIPSOIDS[def.id]);
    for (const alias of def.aliases) map.set(alias, ELLIPSOIDS[def.id]);
  }
  return map;
})();

/** 受支持的规范标识列表（冻结副本，供错误信息/接口说明使用） */
const SUPPORTED_ELLIPSOID_IDS = Object.freeze(ELLIPSOID_DEFS.map((d) => d.id));

/** 默认椭球（WGS84）派生量，供内核缺省参数引用 */
const DEFAULT_ELLIPSOID = ELLIPSOIDS[DEFAULT_ELLIPSOID_ID];

/**
 * 按调用方标识解析椭球（正反算接口共用的唯一入口）。
 *
 * - 不传（undefined）：返回默认 WGS84 派生量，行为与改造前完全一致；
 * - 传入受支持标识（大小写/空白不敏感，含别名）：返回对应椭球派生量；
 * - 传 null、非字符串、空白串或未收录标识：抛结构化 INVALID_ELLIPSOID，
 *   绝不静默退化成 WGS84。
 *
 * @param {undefined|string} value 请求中的 ellipsoid 字段
 * @returns {object} 冻结的椭球派生量对象
 */
function resolveEllipsoid(value) {
  if (value === undefined) return DEFAULT_ELLIPSOID;

  if (typeof value !== 'string') {
    throw new ValidationError(
      ERROR_CODES.INVALID_ELLIPSOID,
      `椭球标识必须是字符串，收到: ${JSON.stringify(value)}`,
      { received: value, supported: SUPPORTED_ELLIPSOID_IDS }
    );
  }

  const key = value.trim().toUpperCase();
  const ell = LOOKUP.get(key);
  if (key === '' || !ell) {
    throw new ValidationError(
      ERROR_CODES.INVALID_ELLIPSOID,
      `未收录的椭球标识: ${JSON.stringify(value)}；受支持: ${SUPPORTED_ELLIPSOID_IDS.join(', ')}`,
      { received: value, supported: SUPPORTED_ELLIPSOID_IDS }
    );
  }
  return ell;
}

module.exports = {
  ELLIPSOIDS,
  ELLIPSOID_DEFS,
  SUPPORTED_ELLIPSOID_IDS,
  DEFAULT_ELLIPSOID_ID,
  DEFAULT_ELLIPSOID,
  deriveEllipsoid,
  resolveEllipsoid,
};
