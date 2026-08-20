"use strict";
/**
 * @fileoverview ThingsBoard RPC types and interfaces
 * Defines TypeScript interfaces for ThingsBoard RPC messages and telemetry data
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RETRY_CONFIG = exports.DEFAULT_RPC_OPTIONS = exports.THINGSBOARD_TOPICS = exports.RpcMethod = void 0;
/**
 * ThingsBoard RPC method types
 */
var RpcMethod;
(function (RpcMethod) {
    RpcMethod["SET_TELEMETRY"] = "setTelemetry";
    RpcMethod["GET_TELEMETRY"] = "getTelemetry";
    RpcMethod["SET_ATTRIBUTES"] = "setAttributes";
    RpcMethod["GET_ATTRIBUTES"] = "getAttributes";
    RpcMethod["CONTROL_DEVICE"] = "controlDevice";
    RpcMethod["UPDATE_FIRMWARE"] = "updateFirmware";
    RpcMethod["REBOOT_DEVICE"] = "rebootDevice";
    RpcMethod["CUSTOM_COMMAND"] = "customCommand";
})(RpcMethod || (exports.RpcMethod = RpcMethod = {}));
/**
 * ThingsBoard topic patterns
 */
exports.THINGSBOARD_TOPICS = {
    RPC_REQUEST: 'v1/device',
    RPC_RESPONSE: 'v1/device',
    TELEMETRY: 'v1/device',
    ATTRIBUTES: 'v1/device',
    DEVICE_STATUS: 'v1/device'
};
/**
 * Default RPC processing options
 */
exports.DEFAULT_RPC_OPTIONS = {
    qos: 1,
    retain: false,
    timeout: 30000,
    retries: 3,
    retryDelay: 1000
};
/**
 * Default retry configuration
 */
exports.DEFAULT_RETRY_CONFIG = {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2,
    maxRetryDelay: 10000
};
