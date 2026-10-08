"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoardScopedModbusClient = void 0;
class BoardScopedModbusClient {
    constructor(transport, unitId) {
        this.transport = transport;
        this.unitId = unitId;
    }
    /**
     * Multi-board clients share one transport per socket. Forward status events
     * so each viis-modbus-flex instance can subscribe without requiring the
     * wrapper itself to be an EventEmitter.
     */
    on(event, listener) {
        var _a, _b;
        (_b = (_a = this.statusEmitter).on) === null || _b === void 0 ? void 0 : _b.call(_a, event, listener);
        return this;
    }
    removeListener(event, listener) {
        var _a, _b;
        if (typeof this.statusEmitter.removeListener === "function") {
            this.statusEmitter.removeListener(event, listener);
        }
        else {
            (_b = (_a = this.statusEmitter).off) === null || _b === void 0 ? void 0 : _b.call(_a, event, listener);
        }
        return this;
    }
    off(event, listener) {
        return this.removeListener(event, listener);
    }
    get statusEmitter() {
        return this.transport;
    }
    readCoils(address, length, _unitId, context) {
        return context
            ? this.transport.readCoils(address, length, this.unitId, context)
            : this.transport.readCoils(address, length, this.unitId);
    }
    readInputRegisters(address, length, _unitId, context) {
        return context
            ? this.transport.readInputRegisters(address, length, this.unitId, context)
            : this.transport.readInputRegisters(address, length, this.unitId);
    }
    readHoldingRegisters(address, length, _unitId, context) {
        return context
            ? this.transport.readHoldingRegisters(address, length, this.unitId, context)
            : this.transport.readHoldingRegisters(address, length, this.unitId);
    }
    writeCoil(address, value, _unitId, context) {
        return context
            ? this.transport.writeCoil(address, value, this.unitId, context)
            : this.transport.writeCoil(address, value, this.unitId);
    }
    writeRegister(address, value, _unitId, context) {
        return context
            ? this.transport.writeRegister(address, value, this.unitId, context)
            : this.transport.writeRegister(address, value, this.unitId);
    }
    getDiagnosticStatus() {
        var _a, _b;
        return ((_b = (_a = this.transport).getDiagnosticStatus) === null || _b === void 0 ? void 0 : _b.call(_a, this.unitId)) || {
            unitId: this.unitId,
            connected: this.transport.isConnectedCheck(),
        };
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
