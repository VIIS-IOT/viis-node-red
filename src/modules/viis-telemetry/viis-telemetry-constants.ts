/**
 * Constants for viis-telemetry node
 */

/**
 * VIIS Telemetry global context keys.
 */

/** Minimum polling interval to prevent system overload */
export const MIN_POLLING_INTERVAL = 500;

/** Minimum publish interval to prevent spam */
export const MIN_PUBLISH_INTERVAL = 1000;

/** Default change threshold for numeric values */
export const DEFAULT_CHANGE_THRESHOLD = 0.1;

/** Maximum consecutive failures before suspending polling */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** Backoff time when polling is suspended due to failures */
export const POLLING_BACKOFF_TIME = 30000;

/** Maximum retry attempts for each polling operation */
export const MAX_RETRY_ATTEMPTS = 3;

/** Delay between retry attempts */
export const RETRY_DELAY = 1000;

/** Default polling intervals for different register types */
export const DEFAULT_POLLING_INTERVALS = {
  COIL: 1000,
  INPUT: 1000,
  HOLDING: 5000,
} as const;

/** Default register configurations */
export const DEFAULT_REGISTER_CONFIG = {
  COIL: {
    START_ADDRESS: 0,
    QUANTITY: 32,
  },
  INPUT: {
    START_ADDRESS: 0,
    QUANTITY: 26,
  },
  HOLDING: {
    START_ADDRESS: 0,
    QUANTITY: 29,
  },
} as const;

/** MQTT topics */
export const MQTT_TOPICS = {
  THINGSBOARD: 'v1/devices/me/telemetry',
  EMQX_PATTERN: 'viis/things/v2/{deviceId}/telemetry',
} as const;

/** Context keys for flow storage */
export const CONTEXT_KEYS = {
  DEBUG_LOG: 'enableDebugLog',
  THRESHOLD_CONFIG: 'thresholdConfig',
  PREVIOUS_STATE: 'previousState',
  LAST_SENT: 'lastSent',
  LAST_EC_UPDATE: 'lastEcUpdate',
  MAIN_PUMP_STATE: 'mainPumpState',
} as const;

/** Global context keys for data storage */
export const GLOBAL_CONTEXT_KEYS = {
  SCALE_CONFIGS: 'scaleConfigs',
  COIL_REGISTER_DATA: 'coilRegisterData',
  INPUT_REGISTER_DATA: 'inputRegisterData',
  HOLDING_REGISTER_DATA: 'holdingRegisterData',
} as const;

/** Register types */
export const REGISTER_TYPES = {
  COILS: 'Coils',
  INPUT_REGISTERS: 'Input Registers',
  HOLDING_REGISTERS: 'Holding Registers',
} as const;

/** Connection timeout for clients */
export const CONNECTION_TIMEOUT = 30000;

/** Default environment variable keys */
export const ENV_KEYS = {
  DEVICE_ID: 'DEVICE_ID',
  MODBUS_COILS: 'MODBUS_COILS',
  MODBUS_INPUT_REGISTERS: 'MODBUS_INPUT_REGISTERS',
  MODBUS_HOLDING_REGISTERS: 'MODBUS_HOLDING_REGISTERS',
} as const;
