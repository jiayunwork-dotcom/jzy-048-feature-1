'use strict';

/**
 * 结构化错误类型。所有非法输入都抛出 ValidationError，
 * 携带机器可读的错误码（error.code）与可读说明（error.message）。
 */
class ValidationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;                 // 机器可读错误码
    this.details = details || null;   // 可选的字段级说明
  }
}

// 统一错误码表，保证“带类型区分的错误响应”
const ERROR_CODES = Object.freeze({
  LAT_OUT_OF_RANGE: 'LAT_OUT_OF_RANGE',         // 纬度超出 UTM 适用范围
  LON_OUT_OF_RANGE: 'LON_OUT_OF_RANGE',         // 经度不在 [-180, 180]
  INVALID_ZONE: 'INVALID_ZONE',                 // 带号非法
  EASTING_OUT_OF_RANGE: 'EASTING_OUT_OF_RANGE', // 东坐标明显越界
  NORTHING_OUT_OF_RANGE: 'NORTHING_OUT_OF_RANGE', // 北坐标明显越界
  INVALID_HEMISPHERE: 'INVALID_HEMISPHERE',     // 半球标识非法
  INVALID_TYPE: 'INVALID_TYPE',                 // 字段类型不是有限数
  MISSING_FIELD: 'MISSING_FIELD',               // 必填字段缺失
  INVERSE_OUT_OF_DOMAIN: 'INVERSE_OUT_OF_DOMAIN', // 反算结果落在投影域外
});

module.exports = { ValidationError, ERROR_CODES };
