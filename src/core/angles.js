'use strict';

/**
 * 角度单位转换 —— 全服务唯一的角度换算点。
 * 约定：所有投影级数内部一律使用弧度；度 → 弧度只在服务边界发生一次，
 * 防止“已经是度还当弧度再乘一次换算系数”的常见错误。
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** 度 → 弧度 */
function degToRad(degrees) {
  return degrees * DEG_TO_RAD;
}

/** 弧度 → 度 */
function radToDeg(radians) {
  return radians * RAD_TO_DEG;
}

module.exports = { DEG_TO_RAD, RAD_TO_DEG, degToRad, radToDeg };
