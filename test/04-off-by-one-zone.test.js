'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const utm = require('../src/core/utm');
const { zoneFromLongitude } = require('../src/core/zones');

/**
 * 差带识别：如果分带公式出现“差一个带”的偏移（经典 off-by-one），
 * 错误的中央经线会西移/东移整整 6°，点到中央经线的经差变化 6°，
 * 对应东坐标在赤道附近偏离约一个带宽（≈ 6°×111km×0.9996 ≈ 668km）。
 * 本测试用彼此独立的两条判据把这种偏差揪出来：
 *   1) 分带结果必须等于“距经度最近的中央经线”对应带；
 *   2) 用错误相邻带正算，东坐标必须与正确值相差约一个带宽。
 */

test('差带识别：分带结果的中央经线必须是最近的一条中央经线', () => {
  for (let lon = -179.9; lon < 180; lon += 0.37) {
    const z = zoneFromLongitude(lon);
    const cmCorrect = 3 + 6 * (z - 1) - 180;
    const cmWest = cmCorrect - 6;
    const cmEast = cmCorrect + 6;
    assert.ok(
      Math.abs(lon - cmCorrect) <= Math.abs(lon - cmWest) + 1e-9
      && Math.abs(lon - cmCorrect) <= Math.abs(lon - cmEast) + 1e-9,
      `lon=${lon} 的带号 ${z}（CM=${cmCorrect}）不是最近中央经线`
    );
  }
});

test('差带识别：差一个带 → 东坐标偏离约一个带宽（赤道处 ≈ 667~670 km）', () => {
  const lat = 0;
  for (const lon of [-50, 0, 75, 116.4, 160]) {
    const good = utm.forward({ lat, lon });
    const wrongWest = utm.forward({ lat, lon, zone: good.zone - 1 });
    const wrongEast = utm.forward({ lat, lon, zone: good.zone + 1 });

    // 差带时坐标根本不该等于正确带的结果
    assert.notEqual(wrongWest.zone, good.zone);
    assert.notEqual(wrongEast.zone, good.zone);

    // 东坐标差值应接近一个完整带宽：赤道处 |Δλ|=6°
    // 横轴墨卡托级数的非线性使该偏差落在约 668~672 km（球面一阶约 667.65 km），
    // 无论东错还是西错，偏差都是整带宽量级，绝不可能接近零（即不可能“悄悄对上”）
    const bandWidthApprox = 6 * Math.PI / 180 * 6378137.0 * 0.9996; // ≈ 667650 m
    assert.ok(
      Math.abs(Math.abs(wrongWest.easting - good.easting) - bandWidthApprox) < 5000,
      `lon=${lon} 西错带东坐标偏差 ${Math.abs(wrongWest.easting - good.easting)}`
    );
    assert.ok(
      Math.abs(Math.abs(wrongEast.easting - good.easting) - bandWidthApprox) < 5000,
      `lon=${lon} 东错带东坐标偏差 ${Math.abs(wrongEast.easting - good.easting)}`
    );

    // 正确带的东坐标必须在 500000 附近（半带宽 ≈ 333km 以内）
    assert.ok(Math.abs(good.easting - 500000) < 350000,
      `正确带东坐标 ${good.easting} 应在 500000 附近`);
    // 差带结果必然跑出正常带内范围
    assert.ok(Math.abs(wrongWest.easting - 500000) > 300000);
    assert.ok(Math.abs(wrongEast.easting - 500000) > 300000);
  }
});

test('差带识别：本服务对分带公式被改成 +2/+0 带的情形敏感（注入变异检验）', () => {
  // 用“变异公式”模拟实现失误：n_wrong = floor((lon+180)/6)+2（整好差一带）
  const wrongZone = (lon) => Math.min(60, Math.floor((lon + 180) / 6) + 2);
  let discrepancies = 0;
  for (let lon = -170; lon < 168; lon += 4) {
    if (wrongZone(lon) !== zoneFromLongitude(lon)) {
      const good = utm.forward({ lat: 10, lon });
      const bad = utm.forward({ lat: 10, lon, zone: wrongZone(lon) });
      if (Math.abs(bad.easting - good.easting) > 500000) discrepancies++;
    }
  }
  // 几乎所有采样点都会出现整带宽级偏差 → 测试必能抓住
  assert.ok(discrepancies > 70, `差带注入仅检出 ${discrepancies} 个点`);
});
