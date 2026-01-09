"use strict";
/**
 * Constants for viis-ais-telemetry node
 * Centralizes magic numbers and configuration values
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NMEA_TYPES = exports.AIS_MESSAGE_TYPES = exports.DEFAULT_CONFIG = exports.RECONNECT_DELAY_MS = exports.DB_RETRY_MAX_EXPONENT = exports.DB_RETRY_BACKOFF_BASE = exports.DB_MAX_RETRY_DELAY_MS = exports.DB_MAX_INIT_ATTEMPTS = exports.MAX_ALARMS_IN_OUTPUT = exports.MAX_AIS_ALARMS = exports.EARTH_RADIUS_NM = exports.COORDINATE_BOUNDS = exports.AIS_MIN_BITS_POSITION_REPORT = exports.AIS_INVALID_HEADING = exports.AIS_INVALID_COG = exports.AIS_INVALID_SOG = exports.AIS_COG_DIVISOR = exports.AIS_SOG_DIVISOR = exports.AIS_COORDINATE_DIVISOR = void 0;
// ===== AIS DECODING CONSTANTS =====
/** Divisor for converting raw AIS coordinates to degrees */
exports.AIS_COORDINATE_DIVISOR = 600000.0;
/** Divisor for converting raw SOG to knots */
exports.AIS_SOG_DIVISOR = 10.0;
/** Divisor for converting raw COG to degrees */
exports.AIS_COG_DIVISOR = 10.0;
/** Invalid SOG value in AIS messages */
exports.AIS_INVALID_SOG = 1023;
/** Invalid COG value in AIS messages */
exports.AIS_INVALID_COG = 3600;
/** Invalid heading value in AIS messages */
exports.AIS_INVALID_HEADING = 511;
/** Minimum required bits for AIS position report */
exports.AIS_MIN_BITS_POSITION_REPORT = 168;
// ===== COORDINATE VALIDATION =====
exports.COORDINATE_BOUNDS = {
    LAT_MIN: -90,
    LAT_MAX: 90,
    LON_MIN: -180,
    LON_MAX: 180
};
// ===== GEOMETRY CONSTANTS =====
/** Earth radius in nautical miles */
exports.EARTH_RADIUS_NM = 3440.065;
// ===== ALARM LIMITS =====
/** Maximum number of AIS alarms to store */
exports.MAX_AIS_ALARMS = 50;
/** Maximum number of alarms to include in output */
exports.MAX_ALARMS_IN_OUTPUT = 10;
// ===== DATABASE RETRY =====
/** Maximum database initialization attempts before giving up */
exports.DB_MAX_INIT_ATTEMPTS = 10;
/** Maximum delay between database retry attempts (ms) */
exports.DB_MAX_RETRY_DELAY_MS = 60000;
/** Base delay multiplier for exponential backoff */
exports.DB_RETRY_BACKOFF_BASE = 1000;
/** Maximum exponent for backoff calculation */
exports.DB_RETRY_MAX_EXPONENT = 6;
// ===== CONNECTION =====
/** Delay before reconnecting to AIS gateway (ms) */
exports.RECONNECT_DELAY_MS = 5000;
// ===== DEFAULT CONFIGURATION =====
exports.DEFAULT_CONFIG = {
    AIS_HOST: "192.168.20.246",
    AIS_PORT: 8899,
    OUTPUT_INTERVAL_MS: 300000, // 5 minutes
    AIS_TTL_SEC: 3600, // 1 hour
    NEARBY_RADIUS_NM: 10,
    NEARBY_MAX_AGE_SEC: 600 // 10 minutes
};
// ===== AIS MESSAGE TYPES =====
exports.AIS_MESSAGE_TYPES = {
    POSITION_REPORT_1: 1,
    POSITION_REPORT_2: 2,
    POSITION_REPORT_3: 3,
    CLASS_B_POSITION: 18
};
// ===== NMEA SENTENCE TYPES =====
exports.NMEA_TYPES = {
    VDM: "VDM", // AIS data from other vessels
    VDO: "VDO", // AIS data from own vessel
    RMC: "RMC", // Recommended Minimum Navigation Information
    GGA: "GGA", // GPS Fix Data
    GNS: "GNS", // GNSS Fix Data
    GLL: "GLL", // Geographic Position - Latitude/Longitude
    VTG: "VTG", // Track Made Good and Ground Speed
    HDT: "HDT", // Heading True
    ROT: "ROT", // Rate of Turn
    VBW: "VBW", // Dual Ground/Water Speed
    ZDA: "ZDA", // Time & Date
    DTM: "DTM", // Datum Reference
    ALR: "ALR" // Set Alarm State
};
