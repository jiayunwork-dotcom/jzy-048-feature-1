'use strict';

/**
 * UTM 投影层面的常数与投影适用范围。
 *
 * 椭球几何常数（WGS84 及其他基准椭球的 a、f 与 e²、e'² 等派生量）
 * 已拆分到独立的 ellipsoids.js，按请求指定的椭球解析；
 * 本文件只保留与椭球无关的 UTM 约定：中央经线比例因子、假偏移、
 * 分带宽度与合法域。
 *
 * 为兼容既有引用（旧测试与内部模块按 `const { WGS84 } = require('./constants')`
 * 取值），这里仍转出同一份冻结的 WGS84 派生量；它与 ellipsoids.js
 * 中 resolveEllipsoid(undefined) 返回的是同一个对象。
 *
 * 参考：USGS Professional Paper 1395, "Map Projections — A Working Manual"（Snyder, 1987）
 */

const { ELLIPSOIDS } = require('./ellipsoids');

// ---- WGS84 椭球派生量（定义与推导见 ellipsoids.js）----
const WGS84 = ELLIPSOIDS.WGS84;

// ---- UTM 投影常数（不随椭球变化）----
const UTM = {
  K0: 0.9996,              // 中央经线比例因子（钉死）
  FALSE_EASTING: 500000,   // 假东偏移（米）
  FALSE_NORTHING: 10000000,// 南半球假北偏移（米）
  ZONE_WIDTH: 6,           // 每带 6 度
  FIRST_ZONE: 1,
  LAST_ZONE: 60,
};

// ---- 投影适用范围（UTM 覆盖北纬 84° 到南纬 80°）----
const LIMITS = {
  LAT_MIN: -80,            // 南纬 80°（含）
  LAT_MAX: 84,             // 北纬 84°（含）
  LON_MIN: -180,
  LON_MAX: 180,
  // 反算平面坐标的合理性范围（略放宽，最终以反算后的经纬度域校验为准）
  EASTING_MIN: 160000,
  EASTING_MAX: 840000,
};

module.exports = { WGS84, UTM, LIMITS };
