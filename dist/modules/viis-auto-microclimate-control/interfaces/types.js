"use strict";
/**
 * Type definitions for VIIS Auto Microclimate Control Node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidSensorData = isValidSensorData;
exports.isValidDeviceStatus = isValidDeviceStatus;
exports.isValidConfig = isValidConfig;
function isValidSensorData(data) {
    return data && typeof data === 'object' && typeof data.ts === 'number';
}
function isValidDeviceStatus(data) {
    return data && typeof data === 'object' && typeof data.ts === 'number';
}
function isValidConfig(config) {
    return config && typeof config === 'object';
}
