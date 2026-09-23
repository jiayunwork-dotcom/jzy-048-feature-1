'use strict';

const { WGS84, UTM } = require('./constants');
const { meridianArc } = require('./meridian');

/**
 * 横轴墨卡托投影 —— 正算（大地经纬度 → 平面坐标）。
 *
 * 采用 USGS Professional Paper 1395《Map Projections — A Working Manual》
 * (Snyder, 1987) 第 8 章 UTM 给出的 Krüger 级数：
 *   - 平面坐标  x,y：公式 (8-13)/(8-14)
 *   - 点比例因子 k：公式 (8-15)
 * 级数保留到 A^6 项，在 6° 带边缘处截断误差远小于 1 毫米。
 *
 * 角度一律使用弧度（见 angles.js，全服务仅在边界做一次度→弧度）。
 *
 * 本模块返回“未加任何假偏移”的横轴墨卡托坐标：
 *   xRaw 以中央经线为零，yRaw 以赤道为零；
 *   假东 500000、南半球假北 10000000 由上层 utm.js 统一加。
 */

const { a, e2, ep2 } = WGS84;
const K0 = UTM.K0;

/**
 * 正算几何部分（USGS 式 8-13/8-14，未乘 k0）。
 * 全服务正算级数系数只在此函数出现一次，差分收敛角与正算入口都复用它，
 * 杜绝“两套系数写出不一致”的隐患。
 * @param {number} phi 纬度（弧度）
 * @param {number} lon 经度（弧度）
 * @param {number} lon0 中央经线经度（弧度）
 * @returns {{x:number,y:number,N:number,T:number,C:number,A:number,M:number}}
 */
function projectGeometry(phi, lon, lon0) {
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const tanPhi = Math.tan(phi);

  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);           // 卯酉圈曲率半径
  const T = tanPhi * tanPhi;                                   // tan²φ
  const C = ep2 * cosPhi * cosPhi;                             // e'²·cos²φ
  const A = cosPhi * (lon - lon0);                             // 圆量 A = cosφ·(λ−λ0)
  const M = meridianArc(phi);                                  // 子午线弧长

  const A2 = A * A;
  const A3 = A2 * A;
  const A4 = A3 * A;
  const A5 = A4 * A;
  const A6 = A5 * A;

  // USGS PP 1395 式 (8-13)：东坐标（相对中央经线，乘 k0 前）
  const x = N * (
    A
    + (1 - T + C) * A3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5 / 120
  );

  // USGS PP 1395 式 (8-14)：北坐标（相对赤道，乘 k0 前）
  const y = M + N * (
    tanPhi * (
      A2 / 2
      + (5 - T + 9 * C + 4 * C * C) * A4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6 / 720
    )
  );

  return { x, y, N, T, C, A, M };
}

/**
 * 正算入口。
 * @returns {{x:number,y:number,scale:number,convergence:number}}
 *   x：相对中央经线的东坐标（米，已乘 k0，未加假东）
 *   y：相对赤道的北坐标（米，已乘 k0，南半球为负、未加假北）
 *   scale：点比例因子
 *   convergence：子午线收敛角（弧度），真子午线相对格网北向东偏为正
 */
function project(phi, lon, lon0) {
  const g = projectGeometry(phi, lon, lon0);
  const { T, C, A } = g;

  const A2 = A * A;
  const A4 = A2 * A2;
  const A6 = A4 * A2;

  // USGS PP 1395 式 (8-15)：点比例因子
  const scale = K0 * (
    1
    + (1 + C) * A2 / 2
    + (5 - 4 * T + 42 * C + 13 * C * C - 28 * ep2) * A4 / 24
    + (61 - 148 * T + 16 * T * T) * A6 / 720
  );

  return {
    x: g.x * K0,
    y: g.y * K0,
    scale,
    convergence: meridianConvergence(phi, lon, lon0),
  };
}

/**
 * 子午线收敛角（弧度）。
 *
 * 共形投影下，先得到真子午线切线在格网坐标系中的方位角
 * α = atan2(∂x/∂φ, ∂y/∂φ)（沿子午线方向，经度固定、纬度微扰）；
 * 本服务采用的收敛角是“真北 → 格网北”的有向角，东偏为正，
 * 故 γ = −α = atan2(−∂x/∂φ, ∂y/∂φ)。
 * 五点中心差分（O(h⁴)）直接对本文件同一套 projectGeometry 级数求导，
 * 因此收敛角与 x,y,k 严格同源，不可能和正算系数脱节。
 * h = 1e-6 弧度（约 0.001″）时截断误差约 1e-24 rad、
 * 舍入误差约 1e-10 rad，远高于 0.01″ 的实用精度。
 *
 * 符号约定（中国测绘《控制测量学》及 EPSG 通用约定）：
 * 以真子午线北方向为准，坐标纵线（格网北）北端偏在真子午线以东为正、
 * 以西为负。中央经线以东（Δλ>0）γ>0，以西 γ<0；
 * 中央经线与赤道上恒为零，一阶近似 γ ≈ Δλ·sinφ。
 */
function meridianConvergence(phi, lon, lon0) {
  const h = 1e-6;

  const p2 = projectGeometry(phi + h, lon, lon0);
  const p1 = projectGeometry(phi + 2 * h, lon, lon0);
  const pm1 = projectGeometry(phi - h, lon, lon0);
  const pm2 = projectGeometry(phi - 2 * h, lon, lon0);

  // 五点公式: f'(φ)=(-f(φ+2h)+8f(φ+h)-8f(φ-h)+f(φ-2h))/(12h)
  const dX = (-p1.x + 8 * p2.x - 8 * pm1.x + pm2.x) / (12 * h) * K0;
  const dY = (-p1.y + 8 * p2.y - 8 * pm1.y + pm2.y) / (12 * h) * K0;

  // 真子午线在格网坐标中的方位角 α = atan2(dX, dY)；
  // 收敛角（真北→格网北，东偏为正）γ = −α
  return Math.atan2(-dX, dY);
}

module.exports = { project, projectGeometry, K0 };
