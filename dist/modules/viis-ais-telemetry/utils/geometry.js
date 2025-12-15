"use strict";
/**
 * Geometry helper functions for navigation calculations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toRad = toRad;
exports.toDeg = toDeg;
exports.distanceNm = distanceNm;
exports.bearingDeg = bearingDeg;
const constants_1 = require("../constants");
/**
 * Convert degrees to radians
 */
function toRad(deg) {
    return deg * Math.PI / 180;
}
/**
 * Convert radians to degrees
 */
function toDeg(rad) {
    return rad * 180 / Math.PI;
}
/**
 * Calculate distance between two points in nautical miles using Haversine formula
 * @returns Distance in nautical miles, or null if any coordinate is null
 */
function distanceNm(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
        return null;
    }
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return constants_1.EARTH_RADIUS_NM * c;
}
/**
 * Calculate bearing from point 1 to point 2 in degrees
 * @returns Bearing in degrees (0-360), or null if any coordinate is null
 */
function bearingDeg(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
        return null;
    }
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const λ1 = toRad(lon1);
    const λ2 = toRad(lon2);
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
        Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    const θ = Math.atan2(y, x);
    return (toDeg(θ) + 360) % 360;
}
