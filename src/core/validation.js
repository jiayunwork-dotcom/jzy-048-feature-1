'use strict';

const { UTM, LIMITS } = require('./constants');
const { meridianArc } = require('./meridian');
const { degToRad } = require('./angles');
const { ValidationError, ERROR_CODES } = require('./errors');
const { isValidZone } = require('./zones');

/**
 * 输入校验（独立模块）。
 * 所有函数在非法输入时抛 ValidationError（带类型化错误码），
 * 服务层统一捕获并转成结构化 JSON 错误响应，绝不“硬算”。
 */

/** 必须是有限实数（拒绝 NaN/Infinity/字符串/布尔/null） */
function assertFiniteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(
      ERROR_CODES.INVALID_TYPE,
      `字段 "${field}" 必须是有限数值，收到: ${JSON.stringify(value)}`,
      { field, received: value }
    );
  }
}

/** 必填字段存在性 */
function assertPresent(obj, field) {
  if (obj == null || obj[field] === undefined || obj[field] === null) {
    throw new ValidationError(
      ERROR_CODES.MISSING_FIELD,
      `缺少必填字段 "${field}"`,
      { field }
    );
  }
}

/** 取必填数值字段并做类型检查 */
function requireNumberField(obj, field) {
  assertPresent(obj, field);
  assertFiniteNumber(obj[field], field);
  return obj[field];
}

/** 纬度（度），UTM 合法域约为 [-80, 84] */
function validateLatitude(lat) {
  assertFiniteNumber(lat, 'lat');
  if (lat < LIMITS.LAT_MIN || lat > LIMITS.LAT_MAX) {
    throw new ValidationError(
      ERROR_CODES.LAT_OUT_OF_RANGE,
      `纬度 ${lat} 超出 UTM 投影适用范围 [${LIMITS.LAT_MIN}, ${LIMITS.LAT_MAX}] 度`,
      { lat, min: LIMITS.LAT_MIN, max: LIMITS.LAT_MAX }
    );
  }
  return lat;
}

/** 经度（度），合法域 [-180, 180] */
function validateLongitude(lon) {
  assertFiniteNumber(lon, 'lon');
  if (lon < LIMITS.LON_MIN || lon > LIMITS.LON_MAX) {
    throw new ValidationError(
      ERROR_CODES.LON_OUT_OF_RANGE,
      `经度 ${lon} 超出合法范围 [-180, 180] 度`,
      { lon, min: LIMITS.LON_MIN, max: LIMITS.LON_MAX }
    );
  }
  return lon;
}

/** 带号必须是 1..60 的整数；字符串数字（如 "50"）会被拒绝，避免静默歧义 */
function validateZone(zone) {
  if (typeof zone !== 'number' || !Number.isInteger(zone) || !isValidZone(zone)) {
    throw new ValidationError(
      ERROR_CODES.INVALID_ZONE,
      `带号必须是 1..60 之间的整数，收到: ${JSON.stringify(zone)}`,
      { zone, min: UTM.FIRST_ZONE, max: UTM.LAST_ZONE }
    );
  }
  return zone;
}

/** 必填带号字段：缺失（undefined/null）报 MISSING_FIELD，类型不对报 INVALID_ZONE */
function requireZone(input) {
  if (input == null || input.zone === undefined || input.zone === null) {
    throw new ValidationError(ERROR_CODES.MISSING_FIELD, '缺少必填字段 "zone"', { field: 'zone' });
  }
  return validateZone(input.zone);
}

/** 可选带号：缺省（undefined）时由经度自动分带；显式给值时必须合法（含 null） */
function validateOptionalZone(zone) {
  if (zone === undefined) return null;
  return validateZone(zone);
}

/** 半球标识：仅接受 'N' / 'S'（大小写不敏感），缺省视为北半球 */
function validateHemisphere(hemisphere) {
  if (hemisphere === undefined || hemisphere === null) return 'N';
  if (typeof hemisphere !== 'string' || !['N', 'S'].includes(hemisphere.toUpperCase())) {
    throw new ValidationError(
      ERROR_CODES.INVALID_HEMISPHERE,
      `半球标识必须为 "N" 或 "S"，收到: ${JSON.stringify(hemisphere)}`,
      { hemisphere }
    );
  }
  return hemisphere.toUpperCase();
}

/**
 * 东坐标合理性检查（UTM 带内物理上约为 166km..834km，这里略放宽）。
 * 最终是否落在投影带内，由反算后的经纬度域校验兜底。
 */
function validateEasting(easting) {
  assertFiniteNumber(easting, 'easting');
  if (easting <= 0 || easting >= 1000000) {
    throw new ValidationError(
      ERROR_CODES.EASTING_OUT_OF_RANGE,
      `东坐标 ${easting} 明显越界（合法 UTM 东坐标约在 (0, 1000000) 米之间，典型值 160000..840000）`,
      { easting, min: 0, max: 1000000 }
    );
  }
  if (easting < LIMITS.EASTING_MIN || easting > LIMITS.EASTING_MAX) {
    throw new ValidationError(
      ERROR_CODES.EASTING_OUT_OF_RANGE,
      `东坐标 ${easting} 超出本投影带的合理范围 [${LIMITS.EASTING_MIN}, ${LIMITS.EASTING_MAX}] 米`,
      { easting, min: LIMITS.EASTING_MIN, max: LIMITS.EASTING_MAX }
    );
  }
  return easting;
}

// 北坐标粗检范围按“投影域边界纬度对应的子午线弧长 × k0”确定。
// 余量 2000 米用于容纳带边缘处级数高次项造成的南北向轻微伸缩
// （粗检只是第一道闸；反算后 validateInverseResult 会做权威的经纬度域校验）。
const NORTH_SPAN = UTM.K0 * meridianArc(degToRad(LIMITS.LAT_MAX)) + 2000;
const SOUTH_SPAN = UTM.K0 * -meridianArc(degToRad(LIMITS.LAT_MIN)) + 2000;

/**
 * 北坐标合理性检查。
 * 北半球（无假北偏移）：[0, 约933万米]
 * 南半球（已加 1000 万米假北偏移）：[1000万−约887万, 1000万] ≈ [113万, 1000万]
 */
function validateNorthing(northing, hemisphere) {
  assertFiniteNumber(northing, 'northing');
  const hemi = hemisphere === 'S' ? 'S' : 'N';
  if (hemi === 'N') {
    if (northing < 0 || northing > NORTH_SPAN) {
      throw new ValidationError(
        ERROR_CODES.NORTHING_OUT_OF_RANGE,
        `北半球北坐标 ${northing} 越界（合法范围约 [0, ${Math.round(NORTH_SPAN)}] 米）`,
        { northing, hemisphere: 'N', min: 0, max: NORTH_SPAN }
      );
    }
  } else {
    const min = UTM.FALSE_NORTHING - SOUTH_SPAN;
    if (northing < min || northing > UTM.FALSE_NORTHING) {
      throw new ValidationError(
        ERROR_CODES.NORTHING_OUT_OF_RANGE,
        `南半球北坐标 ${northing} 越界（合法范围约 [${Math.round(min)}, ${UTM.FALSE_NORTHING}] 米）`,
        { northing, hemisphere: 'S', min, max: UTM.FALSE_NORTHING }
      );
    }
  }
  return northing;
}

/** 反算得到经纬度后，再用投影域做一次权威复核 */
function validateInverseResult(latDeg, lonDeg) {
  // 1e-6 度（约 0.1 米）容差容纳级数截断，只放行边界上的合法点，
  // 真正越界（跨带、极端坐标）误差远大于此，仍会被拦下
  const TOL = 1e-6;
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    throw new ValidationError(
      ERROR_CODES.INVERSE_OUT_OF_DOMAIN,
      '反算结果不是有限经纬度，输入平面坐标可能严重越界'
    );
  }
  if (latDeg < LIMITS.LAT_MIN - TOL || latDeg > LIMITS.LAT_MAX + TOL) {
    throw new ValidationError(
      ERROR_CODES.INVERSE_OUT_OF_DOMAIN,
      `反算纬度 ${latDeg.toFixed(6)} 超出 UTM 投影适用范围 [${LIMITS.LAT_MIN}, ${LIMITS.LAT_MAX}] 度`,
      { lat: latDeg }
    );
  }
  if (lonDeg < LIMITS.LON_MIN - TOL || lonDeg > LIMITS.LON_MAX + TOL) {
    throw new ValidationError(
      ERROR_CODES.INVERSE_OUT_OF_DOMAIN,
      `反算经度 ${lonDeg.toFixed(6)} 超出 [-180, 180] 度，东坐标很可能跨带越界`,
      { lon: lonDeg }
    );
  }
}

module.exports = {
  ERROR_CODES,
  assertFiniteNumber,
  assertPresent,
  requireNumberField,
  validateLatitude,
  validateLongitude,
  validateZone,
  requireZone,
  validateOptionalZone,
  validateHemisphere,
  validateEasting,
  validateNorthing,
  validateInverseResult,
};
