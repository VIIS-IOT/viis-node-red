"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidModbusRequestPayload = isValidModbusRequestPayload;
/**
 * Type guard for ModbusRequestPayload
 */
function isValidModbusRequestPayload(payload) {
    return (payload &&
        typeof payload === 'object' &&
        typeof payload.fc === 'number' &&
        typeof payload.unitid === 'number' &&
        typeof payload.address === 'number' &&
        typeof payload.quantity === 'number');
}
