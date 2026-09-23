'use strict';

const { WGS84 } = require('./constants');

/**
 * 子午线弧长 M(φ) 及其辅助量。
 *
 * 采用 USGS PP 1395 第 3 章 / 第 8 章（Snyder, 1987）给出的
 * 子午线弧长二项级数（公式 3-21/3-22，在 UTM 章节记作 8-12），
 * 保留到 e^6 项；WGS84 下被截断的 e^8 项在全球范围内造成的
 * 弧长误差小于约 0.00003 米，远高于本服务所需投影精度。
 *
 * 约定：输入输出全部使用弧度。
 */

const { a, e2, e1 } = WGS84;

// 弧长二项级数系数（USGS PP 1395, 式 3-21/3-22）
const M1 = 1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * Math.pow(e2, 3)) / 256;
const M2 = (3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * Math.pow(e2, 3)) / 1024;
const M3 = (15 * e2 * e2) / 256 + (45 * Math.pow(e2, 3)) / 1024;
const M4 = (35 * Math.pow(e2, 3)) / 3072;

/**
 * 从赤道到纬度 φ 的子午线弧长（米）。
 * @param {number} phi 纬度（弧度）
 * @returns {number} 弧长，赤道以北为正、以南为负
 */
function meridianArc(phi) {
  return a * (
    M1 * phi
    - M2 * Math.sin(2 * phi)
    + M3 * Math.sin(4 * phi)
    - M4 * Math.sin(6 * phi)
  );
}

/**
 * 反算底点（footpoint）纬度 φf：由“已除以 k0 的弧长” μ 求纬度。
 * 对应 USGS PP 1395 式 8-19 与 8-20 的串联，保留到 e1^4。
 * @param {number} mu 归一化弧长 μ = M / (a·(1 − e²/4 − 3e⁴/64 − 5e⁶/256))
 * @returns {number} 底点纬度（弧度）
 */
function footpointLatitude(mu) {
  const e12 = e1 * e1;
  return mu
    + ((3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu))
    + (((21 * e12) / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu))
    + ((151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu))
    + ((1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu));
}

module.exports = {
  meridianArc,
  footpointLatitude,
  // 导出系数便于测试与反算模块复用归一化弧长
  M1,
  M2,
  M3,
  M4,
};
