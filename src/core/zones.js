'use strict';

const { UTM, LIMITS } = require('./constants');

/**
 * UTM 分带规则（钉死，不做任何近似）：
 *   带号      n = floor((经度 + 180) / 6) + 1
 *   中央经线  λ0 = 3 + 6·(n − 1) − 180  （度）
 *
 * 经度 180° 按公式会得到 61，按 UTM 约定它属于第 60 带（与第 60 带
 * 中央经线 177° 最近），因此在边界处夹到 60。−180° 为第 1 带。
 */

/**
 * 由经度（度）计算自动带号。
 * @param {number} lonDeg 经度，范围 [-180, 180]
 * @returns {number} 带号 1..60
 */
function zoneFromLongitude(lonDeg) {
  let n = Math.floor((lonDeg + 180) / UTM.ZONE_WIDTH) + 1;
  if (n < UTM.FIRST_ZONE) n = UTM.FIRST_ZONE;
  if (n > UTM.LAST_ZONE) n = UTM.LAST_ZONE;
  return n;
}

/**
 * 由带号计算中央经线（度）。
 * @param {number} zone 带号 1..60
 * @returns {number} 中央经线经度（度）
 */
function centralMeridian(zone) {
  return 3 + UTM.ZONE_WIDTH * (zone - 1) - 180;
}

/** 带号是否合法 */
function isValidZone(zone) {
  return Number.isInteger(zone) && zone >= UTM.FIRST_ZONE && zone <= UTM.LAST_ZONE;
}

/** 判断给定带号是否就是该经度的自动带号 */
function isForcedZone(zone, lonDeg) {
  return isValidZone(zone) && zone !== zoneFromLongitude(lonDeg);
}

module.exports = {
  zoneFromLongitude,
  centralMeridian,
  isValidZone,
  isForcedZone,
  ZONE_WIDTH: UTM.ZONE_WIDTH,
  LIMITS,
};
