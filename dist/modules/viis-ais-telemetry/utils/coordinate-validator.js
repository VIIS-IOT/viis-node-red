"use strict";
/**
 * Coordinate validation and conversion utilities
 * DRY solution for coordinate handling in AIS decoding
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoordinateValidator = void 0;
const constants_1 = require("../constants");
class CoordinateValidator {
    /**
     * Validate and convert raw AIS coordinate to degrees
     * @param raw - Raw coordinate value from AIS message
     * @param divisor - Divisor for conversion (default: 600000.0)
     * @param min - Minimum valid value
     * @param max - Maximum valid value
     * @returns Converted value or null if invalid
     */
    static validateAndConvert(raw, divisor, min, max) {
        const value = raw / divisor;
        return (value < min || value > max) ? null : value;
    }
    /**
     * Convert and validate raw AIS latitude
     * @param rawLat - Raw latitude value from AIS message
     * @returns Latitude in degrees or null if invalid
     */
    static convertLatitude(rawLat) {
        return this.validateAndConvert(rawLat, constants_1.AIS_COORDINATE_DIVISOR, constants_1.COORDINATE_BOUNDS.LAT_MIN, constants_1.COORDINATE_BOUNDS.LAT_MAX);
    }
    /**
     * Convert and validate raw AIS longitude
     * @param rawLon - Raw longitude value from AIS message
     * @returns Longitude in degrees or null if invalid
     */
    static convertLongitude(rawLon) {
        return this.validateAndConvert(rawLon, constants_1.AIS_COORDINATE_DIVISOR, constants_1.COORDINATE_BOUNDS.LON_MIN, constants_1.COORDINATE_BOUNDS.LON_MAX);
    }
    /**
     * Parse NMEA lat/lon (ddmm.mmmm format)
     * @returns Object with lat and lon in decimal degrees
     */
    static parseNmeaLatLon(latStr, latHem, lonStr, lonHem) {
        let lat = null;
        let lon = null;
        if (latStr && latHem) {
            const v = parseFloat(latStr);
            if (!isNaN(v)) {
                const deg = Math.floor(v / 100);
                const min = v - deg * 100;
                lat = deg + min / 60.0;
                if (latHem === "S")
                    lat = -lat;
            }
        }
        if (lonStr && lonHem) {
            const v = parseFloat(lonStr);
            if (!isNaN(v)) {
                const deg = Math.floor(v / 100);
                const min = v - deg * 100;
                lon = deg + min / 60.0;
                if (lonHem === "W")
                    lon = -lon;
            }
        }
        return { lat, lon };
    }
}
exports.CoordinateValidator = CoordinateValidator;
