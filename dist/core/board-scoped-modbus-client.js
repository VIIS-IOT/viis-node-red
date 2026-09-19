"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoardScopedModbusClient = void 0;
class BoardScopedModbusClient {
    constructor(transport, unitId) {
        this.transport = transport;
        this.unitId = unitId;
    }
    readCoils(address, length) {
        return this.transport.readCoils(address, length, this.unitId);
    }
    readInputRegisters(address, length) {
        return this.transport.readInputRegisters(address, length, this.unitId);
    }
    readHoldingRegisters(address, length) {
        return this.transport.readHoldingRegisters(address, length, this.unitId);
    }
    writeCoil(address, value) {
        return this.transport.writeCoil(address, value, this.unitId);
    }
    writeRegister(address, value) {
        return this.transport.writeRegister(address, value, this.unitId);
    }
    get isConnected() {
        return this.transport.isConnectedCheck();
    }
    isConnectedCheck() {
        return this.transport.isConnectedCheck();
    }
    disconnect() {
        this.transport.disconnect();
    }
}
exports.BoardScopedModbusClient = BoardScopedModbusClient;
