"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidModbusRequestPayload = isValidModbusRequestPayload;
exports.isValidModbusWriteRequestPayload = isValidModbusWriteRequestPayload;
/**
 * Type guard for ModbusRequestPayload (READ)
 */
function isValidModbusRequestPayload(payload) {
    return (payload &&
        typeof payload === 'object' &&
        typeof payload.fc === 'number' &&
        typeof payload.unitid === 'number' &&
        typeof payload.address === 'number' &&
        typeof payload.quantity === 'number');
}
/**
 * Type guard for ModbusWriteRequestPayload (WRITE)
 */
function isValidModbusWriteRequestPayload(payload) {
    return (payload &&
        typeof payload === 'object' &&
        typeof payload.fc === 'number' &&
        typeof payload.unitid === 'number' &&
        typeof payload.address === 'number' &&
        payload.value !== undefined);
}
