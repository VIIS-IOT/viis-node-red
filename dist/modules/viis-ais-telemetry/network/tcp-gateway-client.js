"use strict";
/**
 * TCP Gateway Client for AIS data
 * Handles connection to AIS gateway with auto-reconnect
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TcpGatewayClient = void 0;
const net = __importStar(require("net"));
const events_1 = require("events");
const constants_1 = require("../constants");
class TcpGatewayClient extends events_1.EventEmitter {
    constructor(config, logger) {
        var _a;
        super();
        this.client = null;
        this.buffer = "";
        this.reconnectTimer = null;
        this.isClosing = false;
        this._status = "disconnected";
        this.config = {
            host: config.host,
            port: config.port,
            reconnectDelayMs: (_a = config.reconnectDelayMs) !== null && _a !== void 0 ? _a : constants_1.RECONNECT_DELAY_MS
        };
        this.logger = logger;
    }
    get status() {
        return this._status;
    }
    get isConnected() {
        var _a;
        return ((_a = this.client) === null || _a === void 0 ? void 0 : _a.readable) === true;
    }
    setStatus(status) {
        if (this._status !== status) {
            this._status = status;
            this.emit("statusChange", status);
        }
    }
    /**
     * Connect to the AIS gateway
     */
    connect() {
        if (this.isClosing)
            return;
        this.logger.info(`[AIS] Connecting to ${this.config.host}:${this.config.port}...`);
        this.setStatus("connecting");
        this.client = new net.Socket();
        this.client.on("connect", () => {
            this.logger.info("[AIS] Connected to AIS Gateway");
            this.setStatus("connected");
            this.buffer = "";
            this.emit("connect");
        });
        this.client.on("data", (data) => {
            this.handleData(data);
        });
        this.client.on("error", (err) => {
            this.logger.error(`[AIS] Connection error: ${err.message}`);
            this.setStatus("error");
            this.emit("error", err);
        });
        this.client.on("close", () => {
            this.logger.info("[AIS] Connection closed");
            this.setStatus("disconnected");
            this.emit("close");
            if (!this.isClosing) {
                this.scheduleReconnect();
            }
        });
        this.client.connect(this.config.port, this.config.host);
    }
    handleData(data) {
        this.buffer += data.toString();
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() || "";
        for (const line of lines) {
            if (line.trim()) {
                this.emit("data", line);
            }
        }
    }
    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        this.logger.debug(`[AIS] Scheduling reconnect in ${this.config.reconnectDelayMs}ms`);
        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, this.config.reconnectDelayMs);
    }
    /**
     * Disconnect from the gateway
     */
    disconnect() {
        this.isClosing = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.client) {
            this.client.destroy();
            this.client = null;
        }
        this.setStatus("disconnected");
    }
    /**
     * Check if client is connected and readable
     */
    isReadable() {
        var _a;
        return ((_a = this.client) === null || _a === void 0 ? void 0 : _a.readable) === true;
    }
}
exports.TcpGatewayClient = TcpGatewayClient;
