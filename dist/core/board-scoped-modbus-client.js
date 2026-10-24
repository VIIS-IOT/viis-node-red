"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoardScopedModbusClient = void 0;
class BoardScopedModbusClient {
    constructor(transport, unitId) {
        this.transport = transport;
        this.unitId = unitId;
        /** Listeners added through this wrapper, so a retarget can move them to the new transport. */
        this.listeners = [];
    }
    /**
     * Points every holder of this board client at another transport / unit id (the board's config changed
     * after the client was handed out). Status listeners move with it.
     */
    retarget(transport, unitId) {
        var _a, _b;
        if (transport !== this.transport) {
            for (const { event, listener } of this.listeners)
                this.detach(event, listener);
            this.transport = transport;
            for (const { event, listener } of this.listeners)
                (_b = (_a = this.statusEmitter).on) === null || _b === void 0 ? void 0 : _b.call(_a, event, listener);
        }
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
        this.listeners.push({ event, listener });
        return this;
    }
    removeListener(event, listener) {
        this.detach(event, listener);
        const index = this.listeners.findIndex(l => l.event === event && l.listener === listener);
        if (index >= 0)
            this.listeners.splice(index, 1);
        return this;
    }
    detach(event, listener) {
        var _a, _b;
        if (typeof this.statusEmitter.removeListener === "function") {
            this.statusEmitter.removeListener(event, listener);
        }
        else {
            (_b = (_a = this.statusEmitter).off) === null || _b === void 0 ? void 0 : _b.call(_a, event, listener);
        }
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
    readDiscreteInputs(address, length) {
        // Never fall back to readCoils: FC01 addresses a different table.
        if (!this.transport.readDiscreteInputs) {
            return Promise.reject(new Error("Modbus transport does not support FC02 (read discrete inputs)"));
        }
        return this.transport.readDiscreteInputs(address, length, this.unitId);
    }
    readInputRegisters(address, length) {
        return this.transport.readInputRegisters(address, length, this.unitId);
    }
    readHoldingRegisters(address, length) {
        return this.transport.readHoldingRegisters(address, length, this.unitId);
    }
    /** The board's own unitId is always used; the third argument only mirrors ModbusClientCore. */
    writeCoil(address, value, _unitId, options) {
        return options
            ? this.transport.writeCoil(address, value, this.unitId, options)
            : this.transport.writeCoil(address, value, this.unitId);
    }
    writeRegister(address, value, _unitId, options) {
        return options
            ? this.transport.writeRegister(address, value, this.unitId, options)
            : this.transport.writeRegister(address, value, this.unitId);
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
    /**
     * Manual reconnect of the shared transport (used by viis-rpc-control's
     * checkConnection). Without this, callers got "reconnect is not a function"
     * in multi-board mode.
     */
    async reconnect() {
        if (typeof this.transport.reconnect !== "function") {
            throw new Error("Shared Modbus transport does not support manual reconnect");
        }
        await this.transport.reconnect();
    }
}
exports.BoardScopedModbusClient = BoardScopedModbusClient;
