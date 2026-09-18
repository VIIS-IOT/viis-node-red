"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getModbusTransportKey = getModbusTransportKey;
function getModbusTransportKey(config) {
    var _a;
    if (config.type === "TCP") {
        return `tcp:${config.host}:${(_a = config.tcpPort) !== null && _a !== void 0 ? _a : 502}`;
    }
    return `rtu:${config.serialPort}`;
}
