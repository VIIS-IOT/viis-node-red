"use strict";
/**
 * Constants for viis-telemetry node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENV_KEYS = exports.CONNECTION_TIMEOUT = exports.REGISTER_TYPES = exports.GLOBAL_CONTEXT_KEYS = exports.CONTEXT_KEYS = exports.MQTT_TOPICS = exports.DEFAULT_REGISTER_CONFIG = exports.DEFAULT_POLLING_INTERVALS = exports.RETRY_DELAY = exports.MAX_RETRY_ATTEMPTS = exports.POLLING_BACKOFF_TIME = exports.MAX_CONSECUTIVE_FAILURES = exports.DEFAULT_CHANGE_THRESHOLD = exports.MIN_PUBLISH_INTERVAL = exports.MIN_POLLING_INTERVAL = void 0;
/**
 * VIIS Telemetry global context keys.
 */
/** Minimum polling interval to prevent system overload */
exports.MIN_POLLING_INTERVAL = 500;
/** Minimum publish interval to prevent spam */
exports.MIN_PUBLISH_INTERVAL = 1000;
/** Default change threshold for numeric values */
exports.DEFAULT_CHANGE_THRESHOLD = 0.1;
/** Maximum consecutive failures before suspending polling */
exports.MAX_CONSECUTIVE_FAILURES = 5;
/** Backoff time when polling is suspended due to failures */
exports.POLLING_BACKOFF_TIME = 30000;
/** Maximum retry attempts for each polling operation */
exports.MAX_RETRY_ATTEMPTS = 3;
/** Delay between retry attempts */
exports.RETRY_DELAY = 1000;
/** Default polling intervals for different register types */
exports.DEFAULT_POLLING_INTERVALS = {
    COIL: 1000,
    INPUT: 1000,
    HOLDING: 5000,
};
/** Default register configurations */
exports.DEFAULT_REGISTER_CONFIG = {
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
};
/** MQTT topics */
exports.MQTT_TOPICS = {
    THINGSBOARD: 'v1/devices/me/telemetry',
    EMQX_PATTERN: 'viis/things/v2/{deviceId}/telemetry',
};
/** Context keys for flow storage */
exports.CONTEXT_KEYS = {
    DEBUG_LOG: 'enableDebugLog',
    THRESHOLD_CONFIG: 'thresholdConfig',
    PREVIOUS_STATE: 'previousState',
    LAST_SENT: 'lastSent',
    LAST_EC_UPDATE: 'lastEcUpdate',
    MAIN_PUMP_STATE: 'mainPumpState',
};
/** Global context keys for data storage */
exports.GLOBAL_CONTEXT_KEYS = {
    SCALE_CONFIGS: 'scaleConfigs',
    COIL_REGISTER_DATA: 'coilRegisterData',
    INPUT_REGISTER_DATA: 'inputRegisterData',
    HOLDING_REGISTER_DATA: 'holdingRegisterData',
};
/** Register types */
exports.REGISTER_TYPES = {
    COILS: 'Coils',
    INPUT_REGISTERS: 'Input Registers',
    HOLDING_REGISTERS: 'Holding Registers',
};
/** Connection timeout for clients */
exports.CONNECTION_TIMEOUT = 30000;
/** Default environment variable keys */
exports.ENV_KEYS = {
    DEVICE_ID: 'DEVICE_ID',
    MODBUS_COILS: 'MODBUS_COILS',
    MODBUS_INPUT_REGISTERS: 'MODBUS_INPUT_REGISTERS',
    MODBUS_HOLDING_REGISTERS: 'MODBUS_HOLDING_REGISTERS',
};
