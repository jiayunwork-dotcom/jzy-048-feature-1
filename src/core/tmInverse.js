'use strict';

const { WGS84, UTM } = require('./constants');
const { meridianArc, footpointLatitude, M1 } = require('./meridian');

/**
 * 横轴墨卡托投影 —— 反算（平面坐标 → 大地经纬度）。
 *
 * 采用 USGS Professional Paper 1395《Map Projections — A Working Manual》
 * (Snyder, 1987) 第 8 章 UTM 的底点（footpoint）Krüger 级数：
 *   式 (8-16)  由北坐标还原子午线弧长与归一化弧长 μ
 *   式 (8-19)/(8-20) 由 μ 求底点纬度 φ1（放在 meridian.js）
 *   式 (8-21)/(8-22) 底点处的 N1,T1,C1,R1,D
 *   式 (8-17)  反算纬度，保留到 D^6
 *   式 (8-18)  反算经差，保留到 D^5
 *
 * 与 tmForward.js 的式 (8-13)/(8-14) 正算级数互为反函数，
 * 在 6° 带内互逆误差为亚毫米级（见 test/04-roundtrip.test.js）。
 *
 * 角度一律使用弧度；输入为“去掉假偏移、除以 k0 之前的原始平面量”
 * 由本模块负责除以 k0。
 */

const { a, e2, ep2 } = WGS84;
const K0 = UTM.K0;

/**
 * 反算内核。
 * @param {number} xRel 相对中央经线的东坐标（米，= UTM东坐标 − 500000）
 * @param {number} yRel 相对赤道的北坐标（米，南半球为负，= 已去假北的北坐标）
 * @param {number} lon0Rad 中央经线经度（弧度）
 * @returns {{lat:number, lon:number}} 纬度、经度（弧度）
 */
function unproject(xRel, yRel, lon0Rad) {
  // ---- 式 (8-16)：还原归一化子午线弧长 μ ----
  const m = yRel / K0;            // 去掉 k0 缩放后的子午线弧长
  const mu = m / (a * M1);

  // ---- 式 (8-19)/(8-20)：底点纬度 φ1 ----
  const phi1 = footpointLatitude(mu);

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);

  // ---- 式 (8-21)/(8-22)：底点辅助量 ----
  const N1 = a / Math.sqrt(1 - e2 * sin1 * sin1);                 // 式 8-21
  const T1 = tan1 * tan1;
  const C1 = ep2 * cos1 * cos1;
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sin1 * sin1, 1.5); // 子午线曲率半径
  const D = xRel / (N1 * K0);                                     // 式 8-22

  const D2 = D * D;
  const D3 = D2 * D;
  const D4 = D3 * D;
  const D5 = D4 * D;
  const D6 = D5 * D;

  // ---- 式 (8-17)：反算纬度（保留到 D^6）----
  const lat = phi1 - (N1 * tan1 / R1) * (
    D2 / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D6 / 720
  );

  // ---- 式 (8-18)：反算经差（保留到 D^5）----
  const dLon = (
    D
    - (1 + 2 * T1 + C1) * D3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D5 / 120
  ) / cos1;

  const lon = lon0Rad + dLon;

  return { lat, lon };
}

module.exports = { unproject };
