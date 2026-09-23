'use strict';

const { DEFAULT_ELLIPSOID } = require('./ellipsoids');

/**
 * 子午线弧长 M(φ) 及其辅助量。
 *
 * 采用 USGS PP 1395 第 3 章 / 第 8 章（Snyder, 1987）给出的
 * 子午线弧长二项级数（公式 3-21/3-22，在 UTM 章节记作 8-12），
 * 保留到 e^6 项；被截断的 e^8 项在全球范围内造成的
 * 弧长误差小于约 0.00003 米，远高于本服务所需投影精度。
 *
 * 本模块不含任何具体椭球数值：所有 a、e²、e1 与级数系数 M1..M4
 * 都由调用方从 ellipsoids.js 解析出的派生量对象按请求传入；
 * 省略最后一个参数时使用默认 WGS84，且其计算式、操作数求值顺序与
 * 参数化改造前逐位一致，老调用方结果不会发生任何末位漂移。
 *
 * 约定：输入输出全部使用弧度。
 */

/**
 * 从赤道到纬度 φ 的子午线弧长（米）。
 * @param {number} phi 纬度（弧度）
 * @param {object} [ell] ellipsoids.js 产出的椭球派生量；缺省 WGS84
 * @returns {number} 弧长，赤道以北为正、以南为负
 */
function meridianArc(phi, ell = DEFAULT_ELLIPSOID) {
  const { a, meridian: { M1, M2, M3, M4 } } = ell;
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
 * @param {object} [ell] ellipsoids.js 产出的椭球派生量；缺省 WGS84
 * @returns {number} 底点纬度（弧度）
 */
function footpointLatitude(mu, ell = DEFAULT_ELLIPSOID) {
  const { e1 } = ell;
  const e12 = e1 * e1;
  return mu
    + ((3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu))
    + (((21 * e12) / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu))
    + ((151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu))
    + ((1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu));
}

// 默认 WGS84 的级数系数：兼容旧引用（测试与反算模块的缺省路径）
const { M1, M2, M3, M4 } = DEFAULT_ELLIPSOID.meridian;

module.exports = {
  meridianArc,
  footpointLatitude,
  // 导出系数便于测试与反算模块复用归一化弧长
  M1,
  M2,
  M3,
  M4,
};
