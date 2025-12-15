/**
 * Constants for viis-ais-telemetry node
 * Centralizes magic numbers and configuration values
 */

// ===== AIS DECODING CONSTANTS =====

/** Divisor for converting raw AIS coordinates to degrees */
export const AIS_COORDINATE_DIVISOR = 600000.0;

/** Divisor for converting raw SOG to knots */
export const AIS_SOG_DIVISOR = 10.0;

/** Divisor for converting raw COG to degrees */
export const AIS_COG_DIVISOR = 10.0;

/** Invalid SOG value in AIS messages */
export const AIS_INVALID_SOG = 1023;

/** Invalid COG value in AIS messages */
export const AIS_INVALID_COG = 3600;

/** Invalid heading value in AIS messages */
export const AIS_INVALID_HEADING = 511;

/** Minimum required bits for AIS position report */
export const AIS_MIN_BITS_POSITION_REPORT = 168;

// ===== COORDINATE VALIDATION =====

export const COORDINATE_BOUNDS = {
  LAT_MIN: -90,
  LAT_MAX: 90,
  LON_MIN: -180,
  LON_MAX: 180
} as const;

// ===== GEOMETRY CONSTANTS =====

/** Earth radius in nautical miles */
export const EARTH_RADIUS_NM = 3440.065;

// ===== ALARM LIMITS =====

/** Maximum number of AIS alarms to store */
export const MAX_AIS_ALARMS = 50;

/** Maximum number of alarms to include in output */
export const MAX_ALARMS_IN_OUTPUT = 10;

// ===== DATABASE RETRY =====

/** Maximum database initialization attempts before giving up */
export const DB_MAX_INIT_ATTEMPTS = 10;

/** Maximum delay between database retry attempts (ms) */
export const DB_MAX_RETRY_DELAY_MS = 60000;

/** Base delay multiplier for exponential backoff */
export const DB_RETRY_BACKOFF_BASE = 1000;

/** Maximum exponent for backoff calculation */
export const DB_RETRY_MAX_EXPONENT = 6;

// ===== CONNECTION =====

/** Delay before reconnecting to AIS gateway (ms) */
export const RECONNECT_DELAY_MS = 5000;

// ===== DEFAULT CONFIGURATION =====

export const DEFAULT_CONFIG = {
  AIS_HOST: "192.168.20.246",
  AIS_PORT: 8899,
  OUTPUT_INTERVAL_MS: 300000,    // 5 minutes
  AIS_TTL_SEC: 3600,             // 1 hour
  NEARBY_RADIUS_NM: 10,
  NEARBY_MAX_AGE_SEC: 600        // 10 minutes
} as const;

// ===== AIS MESSAGE TYPES =====

export const AIS_MESSAGE_TYPES = {
  POSITION_REPORT_1: 1,
  POSITION_REPORT_2: 2,
  POSITION_REPORT_3: 3,
  CLASS_B_POSITION: 18
} as const;

// ===== NMEA SENTENCE TYPES =====

export const NMEA_TYPES = {
  VDM: "VDM",    // AIS data from other vessels
  VDO: "VDO",    // AIS data from own vessel
  RMC: "RMC",    // Recommended Minimum Navigation Information
  GGA: "GGA",    // GPS Fix Data
  GNS: "GNS",    // GNSS Fix Data
  GLL: "GLL",    // Geographic Position - Latitude/Longitude
  VTG: "VTG",    // Track Made Good and Ground Speed
  HDT: "HDT",    // Heading True
  ROT: "ROT",    // Rate of Turn
  VBW: "VBW",    // Dual Ground/Water Speed
  ZDA: "ZDA",    // Time & Date
  DTM: "DTM",    // Datum Reference
  ALR: "ALR"     // Set Alarm State
} as const;
