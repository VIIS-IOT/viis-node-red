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
