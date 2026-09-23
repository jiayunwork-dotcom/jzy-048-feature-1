'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const utm = require('../src/core/utm');
const { ValidationError, ERROR_CODES } = require('../src/core/errors');

function expectError(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ValidationError, '必须抛 ValidationError');
    assert.equal(err.code, code, `错误码应为 ${code}，实际 ${err.code}`);
    assert.ok(typeof err.message === 'string' && err.message.length > 0);
    return true;
  });
}

test('正算非法输入：纬度越界（>84 / <-80）', () => {
  expectError(() => utm.forward({ lat: 84.0001, lon: 100 }), ERROR_CODES.LAT_OUT_OF_RANGE);
  expectError(() => utm.forward({ lat: -80.0001, lon: 100 }), ERROR_CODES.LAT_OUT_OF_RANGE);
  expectError(() => utm.forward({ lat: 90, lon: 0 }), ERROR_CODES.LAT_OUT_OF_RANGE);
  // 边界合法
  assert.doesNotThrow(() => utm.forward({ lat: 84, lon: 0 }));
  assert.doesNotThrow(() => utm.forward({ lat: -80, lon: 0 }));
});

test('正算非法输入：经度越界', () => {
  expectError(() => utm.forward({ lat: 10, lon: 180.0001 }), ERROR_CODES.LON_OUT_OF_RANGE);
  expectError(() => utm.forward({ lat: 10, lon: -180.0001 }), ERROR_CODES.LON_OUT_OF_RANGE);
  assert.doesNotThrow(() => utm.forward({ lat: 10, lon: 180 }));
  assert.doesNotThrow(() => utm.forward({ lat: 10, lon: -180 }));
});

test('正算非法输入：类型错误（字符串/NaN/null/布尔/缺失）——防“度当弧度再乘一次”类隐患', () => {
  expectError(() => utm.forward({ lat: '39.9', lon: 116 }), ERROR_CODES.INVALID_TYPE);
  expectError(() => utm.forward({ lat: NaN, lon: 116 }), ERROR_CODES.INVALID_TYPE);
  expectError(() => utm.forward({ lat: null, lon: 116 }), ERROR_CODES.MISSING_FIELD);
  expectError(() => utm.forward({ lat: true, lon: 116 }), ERROR_CODES.INVALID_TYPE);
  expectError(() => utm.forward({ lat: 10, lon: Infinity }), ERROR_CODES.INVALID_TYPE);
  expectError(() => utm.forward({ lon: 116 }), ERROR_CODES.MISSING_FIELD);
  expectError(() => utm.forward({ lat: 10 }), ERROR_CODES.MISSING_FIELD);
  expectError(() => utm.forward({}), ERROR_CODES.MISSING_FIELD);
  expectError(() => utm.forward(), ERROR_CODES.MISSING_FIELD);
});

test('正算非法输入：强制带号非法', () => {
  expectError(() => utm.forward({ lat: 10, lon: 100, zone: 0 }), ERROR_CODES.INVALID_ZONE);
  expectError(() => utm.forward({ lat: 10, lon: 100, zone: 61 }), ERROR_CODES.INVALID_ZONE);
  expectError(() => utm.forward({ lat: 10, lon: 100, zone: 50.5 }), ERROR_CODES.INVALID_ZONE);
  expectError(() => utm.forward({ lat: 10, lon: 100, zone: '50' }), ERROR_CODES.INVALID_ZONE);
  expectError(() => utm.forward({ lat: 10, lon: 100, zone: null }), ERROR_CODES.INVALID_ZONE);
});

test('反算非法输入：带号非法', () => {
  expectError(() => utm.inverse({ zone: 0, easting: 500000, northing: 4000000 }), ERROR_CODES.INVALID_ZONE);
  expectError(() => utm.inverse({ zone: 61, easting: 500000, northing: 4000000 }), ERROR_CODES.INVALID_ZONE);
  expectError(() => utm.inverse({ zone: 31.2, easting: 500000, northing: 4000000 }), ERROR_CODES.INVALID_ZONE);
  expectError(() => utm.inverse({ easting: 500000, northing: 4000000 }), ERROR_CODES.MISSING_FIELD);
  expectError(() => utm.inverse({ zone: null, easting: 500000, northing: 4000000 }), ERROR_CODES.MISSING_FIELD);
});

test('反算非法输入：东坐标明显越界', () => {
  expectError(() => utm.inverse({ zone: 50, easting: -1, northing: 4000000 }), ERROR_CODES.EASTING_OUT_OF_RANGE);
  expectError(() => utm.inverse({ zone: 50, easting: 0, northing: 4000000 }), ERROR_CODES.EASTING_OUT_OF_RANGE);
  expectError(() => utm.inverse({ zone: 50, easting: 1000000, northing: 4000000 }), ERROR_CODES.EASTING_OUT_OF_RANGE);
  expectError(() => utm.inverse({ zone: 50, easting: 9000000, northing: 4000000 }), ERROR_CODES.EASTING_OUT_OF_RANGE);
  expectError(() => utm.inverse({ zone: 50, easting: 90000, northing: 4000000 }), ERROR_CODES.EASTING_OUT_OF_RANGE);
  expectError(() => utm.inverse({ zone: 50, easting: 'x', northing: 4000000 }), ERROR_CODES.INVALID_TYPE);
});

test('反算非法输入：北坐标明显越界（南/北半球分别判定）', () => {
  expectError(() => utm.inverse({ zone: 50, easting: 500000, northing: -1, hemisphere: 'N' }), ERROR_CODES.NORTHING_OUT_OF_RANGE);
  expectError(() => utm.inverse({ zone: 50, easting: 500000, northing: 10000000, hemisphere: 'N' }), ERROR_CODES.NORTHING_OUT_OF_RANGE);
  expectError(() => utm.inverse({ zone: 50, easting: 500000, northing: 500000, hemisphere: 'S' }), ERROR_CODES.NORTHING_OUT_OF_RANGE);
  expectError(() => utm.inverse({ zone: 50, easting: 500000, northing: 10000001, hemisphere: 'S' }), ERROR_CODES.NORTHING_OUT_OF_RANGE);
  // 合法值不抛
  assert.doesNotThrow(() => utm.inverse({ zone: 50, easting: 500000, northing: 4400000, hemisphere: 'N' }));
  assert.doesNotThrow(() => utm.inverse({ zone: 50, easting: 500000, northing: 5600000, hemisphere: 'S' }));
});

test('反算非法输入：半球标识非法', () => {
  expectError(() => utm.inverse({ zone: 50, easting: 500000, northing: 4e6, hemisphere: 'E' }), ERROR_CODES.INVALID_HEMISPHERE);
  expectError(() => utm.inverse({ zone: 50, easting: 500000, northing: 4e6, hemisphere: '' }), ERROR_CODES.INVALID_HEMISPHERE);
  expectError(() => utm.inverse({ zone: 50, easting: 500000, northing: 4e6, hemisphere: 1 }), ERROR_CODES.INVALID_HEMISPHERE);
});

test('反算非法输入：平面坐标在粗检边缘但反算经纬度落出 [-180,180]', () => {
  // 第 1 带（CM=−177）西缘取最小合理东坐标，反算经度约 −180.05° → 落域复核拒绝
  expectError(
    () => utm.inverse({ zone: 1, easting: 160000, northing: 0, hemisphere: 'N' }),
    ERROR_CODES.INVERSE_OUT_OF_DOMAIN
  );
  // 北坐标接近 0、但与南半球矛盾（南半球点必须 > 约 113 万）
  expectError(
    () => utm.inverse({ zone: 50, easting: 500000, northing: 100, hemisphere: 'S' }),
    ERROR_CODES.NORTHING_OUT_OF_RANGE
  );
});

test('分带查询非法输入', () => {
  expectError(() => utm.locateZone(181), ERROR_CODES.LON_OUT_OF_RANGE);
  expectError(() => utm.locateZone(-181), ERROR_CODES.LON_OUT_OF_RANGE);
  expectError(() => utm.locateZone('abc'), ERROR_CODES.INVALID_TYPE);
  expectError(() => utm.locateZone({}), ERROR_CODES.MISSING_FIELD);
  expectError(() => utm.locateZone({ lon: NaN }), ERROR_CODES.INVALID_TYPE);
});

test('错误对象带类型化 code，可供调用方区分处理', () => {
  const codes = [
    [() => utm.forward({ lat: 99, lon: 0 }), 'LAT_OUT_OF_RANGE'],
    [() => utm.forward({ lat: 0, lon: 199 }), 'LON_OUT_OF_RANGE'],
    [() => utm.forward({ lat: 0, lon: 0, zone: 99 }), 'INVALID_ZONE'],
  ];
  for (const [fn, code] of codes) {
    try { fn(); assert.fail('应抛错'); }
    catch (e) { assert.equal(e.code, code); }
  }
});
