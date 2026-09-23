'use strict';

const { UTM } = require('./constants');
const { degToRad, radToDeg } = require('./angles');
const { zoneFromLongitude, centralMeridian, isForcedZone } = require('./zones');
const { project } = require('./tmForward');
const { unproject } = require('./tmInverse');
const { getEllipsoid, describeEllipsoid, DEFAULT_ELLIPSOID_ID } = require('./ellipsoids');
const v = require('./validation');

/**
 * UTM 换算门面：把“分带 + 正/反算级数 + 假偏移 + 校验”组合成
 * 对外的纯函数 API。无状态、无可变全局量，天然支持并发互扰安全。
 *
 * 椭球由调用方按次在 input.ellipsoid 指定（缺省 WGS84，逐位兼容老行为）；
 * 每次调用现推一个只属于本次请求的冻结椭球对象，贯穿正/反算级数，
 * 不写入任何跨请求共享的位置——同一服务实例并发处理不同椭球请求互不影响。
 *
 * 级数出处统一为 USGS PP 1395 (Snyder, 1987) Krüger 展开，
 * 详见 tmForward.js / tmInverse.js。
 */

/**
 * 解析本次请求的椭球：校验标识 → 现推派生量。
 * @returns {{id:string, name:string, a:number, f:number, b:number, e2:number, ep2:number, e1:number}}
 */
function resolveEllipsoid(input) {
  const id = v.validateEllipsoidField(input.ellipsoid);
  return getEllipsoid(id);
}

/**
 * 正算：经纬度 → UTM。
 * @param {object} input
 * @param {number} input.lat 纬度（度），[-80, 84]
 * @param {number} input.lon 经度（度），[-180, 180]
 * @param {number} [input.zone] 调用方强制指定的带号（1..60），可缺省
 * @param {string} [input.ellipsoid] 椭球标识（WGS84/GRS80/BESSEL_1841/CLARKE_1866），
 *   缺省 WGS84；UTM 层面的 k0/假偏移不随椭球变化
 * @returns {object} 带号、东坐标、北坐标、比例因子、收敛角、强制带号标记、椭球信息
 */
function forward(input = {}) {
  const ell = resolveEllipsoid(input);
  const latDeg = v.validateLatitude(v.requireNumberField(input, 'lat'));
  const lonDeg = v.validateLongitude(v.requireNumberField(input, 'lon'));
  const forcedZone = v.validateOptionalZone(input.zone);

  const autoZone = zoneFromLongitude(lonDeg);
  const usedZone = forcedZone === null ? autoZone : forcedZone;
  const zoneForced = forcedZone !== null && forcedZone !== autoZone;
  const lon0Deg = centralMeridian(usedZone);

  const r = project(degToRad(latDeg), degToRad(lonDeg), degToRad(lon0Deg), ell);

  // 假东偏移恒加；南半球整体加 10000000 米假北偏移（UTM 约定，与椭球无关）
  const easting = r.x + UTM.FALSE_EASTING;
  const northing = r.y + (latDeg < 0 ? UTM.FALSE_NORTHING : 0);

  return {
    zone: usedZone,
    hemisphere: latDeg < 0 ? 'S' : 'N',
    easting,
    northing,
    scale: r.scale,
    convergence: {
      radians: r.convergence,
      degrees: radToDeg(r.convergence),
    },
    centralMeridian: lon0Deg,
    autoZone,
    zoneForced,
    // 明确标注：被强制指定的带号与自动分带不一致，调用方处于跨带状态
    zoneForcedReason: zoneForced
      ? `调用方强制使用第 ${usedZone} 带，而经度 ${lonDeg}° 自动分带应为第 ${autoZone} 带；结果按指定带计算，未被静默改带`
      : null,
    datum: ell.id,
    ellipsoid: describeEllipsoid(ell),
  };
}

/**
 * 反算：UTM → 经纬度。
 * @param {object} input
 * @param {number} input.zone 带号（1..60）
 * @param {number} input.easting 东坐标（米）
 * @param {number} input.northing 北坐标（米，南半球含 1000 万假北）
 * @param {'N'|'S'} [input.hemisphere] 半球标识，缺省 'N'
 *   （UTM 平面北坐标无法单独区分南北半球，必须显式声明）
 * @param {string} [input.ellipsoid] 椭球标识，缺省 WGS84；
 *   必须与生成该平面坐标所用的椭球一致，否则结果物理上不自洽
 */
function inverse(input = {}) {
  const ell = resolveEllipsoid(input);
  const usedZone = v.requireZone(input);
  const hemi = v.validateHemisphere(input.hemisphere);
  const e = v.validateEasting(v.requireNumberField(input, 'easting'));
  const n = v.validateNorthing(v.requireNumberField(input, 'northing'), hemi, ell);

  const lon0Deg = centralMeridian(usedZone);

  // 去掉假偏移：东坐标回到“相对中央经线”，南半球北坐标减掉 1000 万
  const xRel = e - UTM.FALSE_EASTING;
  const yRel = hemi === 'S' ? n - UTM.FALSE_NORTHING : n;

  const r = unproject(xRel, yRel, degToRad(lon0Deg), ell);
  const latDeg = radToDeg(r.lat);
  const lonDeg = radToDeg(r.lon);

  // 权威复核：反算结果必须落在 UTM 投影域内（跨带/错椭球的不自洽组合在此被拦）
  v.validateInverseResult(latDeg, lonDeg);

  return {
    lat: latDeg,
    lon: lonDeg,
    zone: usedZone,
    hemisphere: hemi,
    centralMeridian: lon0Deg,
    datum: ell.id,
    ellipsoid: describeEllipsoid(ell),
  };
}

/**
 * 分带查询：经度 → 带号与中央经线。
 * 纯经度 → 带号映射，属于 UTM 分带约定，与椭球几何无关，不接受也不需要椭球参数。
 * @param {number|object} input 经度（度）或 { lon }
 */
function locateZone(input) {
  const lonDeg = typeof input === 'object' && input !== null
    ? v.validateLongitude(v.requireNumberField(input, 'lon'))
    : v.validateLongitude(input);

  const zone = zoneFromLongitude(lonDeg);
  return {
    lon: lonDeg,
    zone,
    centralMeridian: centralMeridian(zone),
  };
}

/**
 * 预置示范点：中国境内（天安门附近），自动落在 50N 带，
 * 东坐标在 40 万–60 万米之间，供调用方一键确认级数正确性。
 */
const DEMO_POINT = Object.freeze({
  name: '中国境内示范点（北京·天安门附近）',
  lat: 39.9087,
  lon: 116.3975,
});

function demo() {
  const fwd = forward({ lat: DEMO_POINT.lat, lon: DEMO_POINT.lon });
  return { input: { ...DEMO_POINT }, forward: fwd };
}

module.exports = { forward, inverse, locateZone, demo, DEMO_POINT, DEFAULT_ELLIPSOID_ID };
