'use strict';

/**
 * 椭球基准：权威定义值表 + 按需派生量推导（独立模块）。
 *
 * 设计纪律：
 *   - 这里只存“权威定义量”——长半轴 a（米）与扁率倒数 1/f；
 *     b、e²、e'²、e1 等派生量一律由 deriveEllipsoid() 按统一公式现算，
 *     不在数值表里抄第二遍，杜绝“定义值改了、派生量忘了同步”。
 *   - 数值表只此一份；分带、子午线弧长、Krüger 级数等模块不得内置椭球数值，
 *     统一通过 getEllipsoid() 拿到本次请求所需的椭球几何量。
 *   - 不缓存、不持有任何按请求变化的可变状态：每次调用都从只读定义表
 *     现推一个冻结的椭球对象返回，同一服务实例并发处理不同椭球请求互不影响。
 *
 * UTM 层面的约定（k0=0.9996、假东 500000、南半球假北 10000000）不随椭球变化，
 * 仍在 constants.js 中，与本模块分离。
 */

/** 缺省椭球标识（不传 ellipsoid 字段时使用，行为与改造前完全一致） */
const DEFAULT_ELLIPSOID_ID = 'WGS84';

/**
 * 内置椭球权威定义值（大地测量参数，单位：米）。
 *
 * WGS84       a=6378137      1/f=298.257223563   （NIMA TR8350.2 / EPSG:7030）
 * GRS80       a=6378137      1/f=298.257222101   （Moritz 1980 / IUGG / EPSG:7019）
 * Bessel 1841 a=6377397.155  1/f=299.1528128     （Bessel 1841 / EPSG:7004）
 * Clarke 1866 a=6378206.4    1/f=294.9786982     （Clarke 1866 英尺定义的米制换算值 / EPSG:7008，NAD27 用球）
 */
const ELLIPSOID_DEFS = Object.freeze({
  WGS84: Object.freeze({
    id: 'WGS84',
    name: 'WGS84',
    a: 6378137.0,
    invF: 298.257223563,
    aliases: Object.freeze(['WGS 84', 'EPSG:7030']),
  }),
  GRS80: Object.freeze({
    id: 'GRS80',
    name: 'GRS80',
    a: 6378137.0,
    invF: 298.257222101,
    aliases: Object.freeze(['GRS 80', 'EPSG:7019']),
  }),
  BESSEL_1841: Object.freeze({
    id: 'BESSEL_1841',
    name: 'Bessel 1841',
    a: 6377397.155,
    invF: 299.1528128,
    aliases: Object.freeze(['BESSEL', 'BESSEL1841', 'BESSEL 1841', 'EPSG:7004']),
  }),
  CLARKE_1866: Object.freeze({
    id: 'CLARKE_1866',
    name: 'Clarke 1866',
    a: 6378206.4,
    invF: 294.9786982,
    aliases: Object.freeze(['CLARKE', 'CLARKE1866', 'CLARKE 1866', 'NAD27', 'EPSG:7008']),
  }),
});

/** 全部受支持的规范标识（对外错误提示用） */
const ELLIPSOID_IDS = Object.freeze(Object.keys(ELLIPSOID_DEFS));

function normalizeId(raw) {
  return String(raw).trim().toUpperCase().replace(/[\s-]+/g, '_');
}

/**
 * 标识归一化：去首尾空白、转大写、空白/连字符统一为下划线。
 * 规范标识与别名（见各定义的 aliases）都能识别。
 * @param {string} raw
 * @returns {string|null} 规范标识；未收录返回 null
 */
function canonicalEllipsoidId(raw) {
  const norm = normalizeId(raw);
  if (Object.prototype.hasOwnProperty.call(ELLIPSOID_DEFS, norm)) return norm;
  for (const id of ELLIPSOID_IDS) {
    if (ELLIPSOID_DEFS[id].aliases.some((alias) => normalizeId(alias) === norm)) return id;
  }
  return null;
}

/**
 * 由 a 与 1/f 现推椭球全部几何派生量。
 * 推导公式与 WGS84 硬编码时代逐式一致、运算顺序一致，
 * 因此 WGS84 路径上每个比特都与改造前相同。
 *
 * @param {{id:string,name:string,a:number,invF:number}} def
 * @returns {object} 冻结的椭球对象：a/f（原始）+ b/e²/e'²/e1（派生）
 */
function deriveEllipsoid(def) {
  const a = def.a;
  const f = 1 / def.invF;                       // 扁率
  const b = a * (1 - f);                        // 短半轴
  const e2 = f * (2 - f);                       // 第一偏心率平方 e² = 2f − f²
  const ep2 = e2 / (1 - e2);                    // 第二偏心率平方 e'² = e²/(1−e²)
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2)); // 子午线弧长辅助量
  return Object.freeze({
    id: def.id,
    name: def.name,
    a,
    invF: def.invF,
    f,
    b,
    e2,
    ep2,
    e1,
  });
}

/**
 * 按规范标识取椭球：每次现推一个冻结对象返回（不缓存、无共享可变状态）。
 * @param {string} [id] 规范标识；缺省为 WGS84
 */
function getEllipsoid(id = DEFAULT_ELLIPSOID_ID) {
  const def = ELLIPSOID_DEFS[id];
  if (!def) {
    // 内部调用方应先经 validation.validateEllipsoidField 把关；
    // 直接误用时给出明确错误而不是静默退回 WGS84。
    throw new RangeError(`未收录的椭球标识: ${JSON.stringify(id)}`);
  }
  return deriveEllipsoid(def);
}

/** 给响应体附带的椭球说明（只含只读元数据与派生量，供调用方核对） */
function describeEllipsoid(ell) {
  return {
    id: ell.id,
    name: ell.name,
    a: ell.a,
    inverseFlattening: ell.invF,
    flattening: ell.f,
    e2: ell.e2,
    ep2: ell.ep2,
  };
}

module.exports = {
  DEFAULT_ELLIPSOID_ID,
  ELLIPSOID_DEFS,
  ELLIPSOID_IDS,
  canonicalEllipsoidId,
  deriveEllipsoid,
  getEllipsoid,
  describeEllipsoid,
};
