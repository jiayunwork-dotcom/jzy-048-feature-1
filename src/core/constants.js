'use strict';

/**
 * UTM 投影层面的固定约定与合法域常量。
 *
 * 注意：椭球几何常数（长半轴、扁率及其派生量）不在本模块，
 * 已拆到 ellipsoids.js，由调用方按次指定椭球、按需推导；
 * 这里的 k0、假偏移、分带规则属于 UTM 投影约定，与椭球无关，保持钉死。
 * 参考：USGS Professional Paper 1395, "Map Projections — A Working Manual"（Snyder, 1987）
 */

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

module.exports = { UTM, LIMITS };
