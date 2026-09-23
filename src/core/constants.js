'use strict';

/**
 * WGS84 椭球常数与 UTM 投影常数。
 * 参考：USGS Professional Paper 1395, "Map Projections — A Working Manual"（Snyder, 1987）
 */

// ---- WGS84 椭球（大地测量参数，单位：米）----
const WGS84 = {
  a: 6378137.0,            // 长半轴
  f: 1 / 298.257223563,    // 扁率
  // 下列量在模块加载时一次性推导，避免各处重复计算
};

WGS84.b = WGS84.a * (1 - WGS84.f);                 // 短半轴
WGS84.e2 = WGS84.f * (2 - WGS84.f);                // 第一偏心率平方 e² = 2f − f²
WGS84.ep2 = WGS84.e2 / (1 - WGS84.e2);             // 第二偏心率平方 e'² = e²/(1−e²)
WGS84.e1 = (1 - Math.sqrt(1 - WGS84.e2)) / (1 + Math.sqrt(1 - WGS84.e2)); // 子午线弧长辅助量 e1

// ---- UTM 投影常数 ----
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
