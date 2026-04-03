"use strict";
/**
 * VIIS Aqara Device Node
 *
 * Controls Aqara IR devices via Open API
 * Loads credentials directly from global context
 *
 * Usage:
 *   global.set("aqaraCredentials", {
 *     appid: "your-app-id",
 *     keyid: "your-key-id",
 *     appkey: "your-app-key",
 *     accesstoken: "optional"
 *   });
 *
 * @module viis-aqara-device
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const axios_1 = __importDefault(require("axios"));
// ============================================================================
// Aqara Service Class
// ============================================================================
class AqaraService {
    constructor(credentials, requestDelay) {
        this.baseUrl = "https://open-sg.aqara.com/v3.0/open/api";
        this.lastRequestTime = 0;
        this.requestDelay = 2000;
        this.credentials = credentials;
        this.requestDelay = requestDelay || 2000;
        this.httpClient = axios_1.default.create({
            timeout: 10000,
            headers: {
                "Content-Type": "application/json",
            },
        });
    }
    generateAuthParams() {
        const time = Date.now().toString();
        const nonce = Math.random().toString(36).substring(2, 18);
        let signStr;
        if (this.credentials.accesstoken) {
            signStr = `accesstoken=${this.credentials.accesstoken}&appid=${this.credentials.appid}&keyid=${this.credentials.keyid}&nonce=${nonce}&time=${time}${this.credentials.appkey}`;
        }
        else {
            signStr = `appid=${this.credentials.appid}&keyid=${this.credentials.keyid}&nonce=${nonce}&time=${time}${this.credentials.appkey}`;
        }
        const sign = crypto_1.default
            .createHash("md5")
            .update(signStr.toLowerCase())
            .digest("hex");
        const headers = {
            'Content-Type': 'application/json',
            'Appid': this.credentials.appid,
            'Keyid': this.credentials.keyid,
            'Nonce': nonce,
            'Time': time,
            'Sign': sign,
        };
        if (this.credentials.accesstoken) {
            headers['Accesstoken'] = this.credentials.accesstoken;
        }
        return { headers, time, nonce };
    }
    async enforceRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.requestDelay) {
            const waitTime = this.requestDelay - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this.lastRequestTime = Date.now();
    }
    async sendCommand(command, enableRetry = true, maxRetries = 3, customUrl) {
        let lastError = null;
        const attempts = enableRetry ? maxRetries : 1;
        const url = customUrl || this.baseUrl;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                await this.enforceRateLimit();
                const { headers } = this.generateAuthParams();
                const response = await this.httpClient.post(url, command, { headers });
                const result = response.data;
                if (result.code !== 0) {
                    throw new AqaraApiError(result.message, result.code, result);
                }
                return result;
            }
            catch (error) {
                lastError = error;
                if (error instanceof AqaraApiError) {
                    const apiError = error;
                    if ([1001, 1002, 1003, 2001].includes(apiError.code)) {
                        throw apiError;
                    }
                }
                if (attempt < attempts) {
                    const backoffTime = 1000 * Math.pow(2, attempt - 1);
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                }
            }
        }
        throw lastError || new Error("Unknown error sending Aqara command");
    }
    async sendIrClick(deviceId, acKey, enableRetry, maxRetries, customUrl) {
        const command = {
            intent: "write.ir.click",
            data: {
                did: deviceId,
                acKey: acKey,
            },
        };
        return this.sendCommand(command, enableRetry, maxRetries, customUrl);
    }
    async sendCustomCommand(intent, data, enableRetry, maxRetries, customUrl) {
        const command = {
            intent,
            data,
        };
        return this.sendCommand(command, enableRetry, maxRetries, customUrl);
    }
    async readACState(deviceId, enableRetry, maxRetries) {
        try {
            const command = {
                intent: "query.ir.acState",
                data: { did: deviceId },
            };
            const response = await this.sendCommand(command, enableRetry, maxRetries);
            if (response.result && response.result.acState) {
                const parsedState = this.parseACState(response.result.acState);
                return { success: true, state: parsedState };
            }
            else {
                return { success: false, error: "No AC state data", errorCode: 3002 };
            }
        }
        catch (error) {
            return {
                success: false,
                error: error.message || "Failed to read AC state",
                errorCode: error.code || 3003,
            };
        }
    }
    parseACState(acState) {
        const modeNames = ['cooling', 'heating', 'auto', 'fan', 'dry'];
        const fanNames = ['auto', 'low', 'medium', 'high'];
        const powerMatch = acState.match(/P(\d)/);
        const modeMatch = acState.match(/_M(\d)_/);
        const tempMatch = acState.match(/_T(\d+)_/);
        const fanMatch = acState.match(/_S(\d)/);
        const dirMatch = acState.match(/_D(\d)/);
        return {
            power: powerMatch ? powerMatch[1] === '0' : true,
            mode: modeMatch ? parseInt(modeMatch[1]) : 0,
            modeName: modeMatch ? (modeNames[parseInt(modeMatch[1])] || 'unknown') : 'auto',
            temperature: tempMatch ? parseInt(tempMatch[1]) : 25,
            fanSpeed: fanMatch ? parseInt(fanMatch[1]) : 0,
            fanName: fanMatch ? (fanNames[parseInt(fanMatch[1])] || 'auto') : 'auto',
            direction: dirMatch ? parseInt(dirMatch[1]) : 0,
            rawState: acState,
        };
    }
    generateAcKey(power, mode, temperature, fanSpeed) {
        const powerCode = power ? "0" : "1";
        return `P${powerCode}_M${mode}_T${temperature}_S${fanSpeed}`;
    }
}
// ============================================================================
// Custom Error Class
// ============================================================================
class AqaraApiError extends Error {
    constructor(message, code, details) {
        super(message);
        this.name = "AqaraApiError";
        this.code = code;
        this.details = details;
    }
}
// ============================================================================
// Node-RED Node Implementation
// ============================================================================
module.exports = function (RED) {
    function ViisAqaraDeviceNode(config) {
        var _a, _b, _c;
        RED.nodes.createNode(this, config);
        const node = this;
        // Get credentials from global context
        const globalContext = node.context().global;
        const credentials = globalContext.get("aqaraCredentials");
        // Validate credentials
        if (!credentials || !credentials.appid || !credentials.keyid || !credentials.appkey) {
            node.error("Missing Aqara credentials in global context");
            node.status({ fill: "red", shape: "ring", text: "Credentials missing" });
            node.log("ERROR: Set global.aqaraCredentials in init function");
            return;
        }
        // Initialize Aqara service
        const deviceType = config.deviceType || "ac";
        const operationMode = config.operationMode || "auto";
        const defaultTemperature = config.defaultTemperature || 25;
        const defaultFanSpeed = (_a = config.defaultFanSpeed) !== null && _a !== void 0 ? _a : 2;
        const requestDelay = config.requestDelay || 2000;
        const enableRetry = (_b = config.enableRetry) !== null && _b !== void 0 ? _b : true;
        const maxRetries = (_c = config.maxRetries) !== null && _c !== void 0 ? _c : 3;
        const aqaraService = new AqaraService(credentials, requestDelay);
        node.log("Aqara device node initialized");
        node.status({ fill: "green", shape: "dot", text: "Ready" });
        node.on("input", async (msg) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
            try {
                // Check for standard Aqara API format: msg.payload = { intent: "...", data: {...} }
                if ((_a = msg.payload) === null || _a === void 0 ? void 0 : _a.intent) {
                    const intent = msg.payload.intent;
                    const data = msg.payload.data || {};
                    const url = msg.payload.url || msg.url;
                    node.status({ fill: "yellow", shape: "dot", text: "Calling API..." });
                    const response = await aqaraService.sendCustomCommand(intent, data, enableRetry, maxRetries, url);
                    node.status({ fill: "green", shape: "dot", text: "API success" });
                    // Return exact Aqara response
                    node.send({
                        payload: response,
                        topic: msg.topic || "aqara/api"
                    });
                    return;
                }
                if (operationMode === "auto" && ((_b = msg.payload) === null || _b === void 0 ? void 0 : _b.auto) === false) {
                    node.status({ fill: "blue", shape: "dot", text: "Manual mode" });
                    return;
                }
                const deviceId = msg.deviceId || ((_c = msg.payload) === null || _c === void 0 ? void 0 : _c.deviceId) || config.name;
                if (!deviceId) {
                    throw new Error("Device ID is required");
                }
                const action = ((_d = msg.payload) === null || _d === void 0 ? void 0 : _d.action) || msg.action || "write";
                if (action === "read" || action === "query") {
                    node.status({ fill: "yellow", shape: "dot", text: "Reading..." });
                    const readResult = await aqaraService.readACState(deviceId, enableRetry, maxRetries);
                    if (readResult.success && readResult.state) {
                        node.status({ fill: "green", shape: "dot", text: `Read: ${readResult.state.temperature}°C` });
                        node.send({
                            payload: {
                                success: true,
                                action: "read",
                                deviceId: deviceId,
                                acState: readResult.state,
                                temperature: readResult.state.temperature,
                                mode: readResult.state.mode,
                                modeName: readResult.state.modeName,
                                fanSpeed: readResult.state.fanSpeed,
                                fanName: readResult.state.fanName,
                                power: readResult.state.power,
                                rawState: readResult.state.rawState,
                                timestamp: Date.now()
                            },
                            topic: msg.topic || "aqara/state",
                        });
                    }
                    else {
                        node.status({ fill: "red", shape: "ring", text: `Read failed` });
                        node.send({
                            payload: {
                                success: false,
                                action: "read",
                                deviceId: deviceId,
                                error: readResult.error,
                                errorCode: readResult.errorCode,
                                timestamp: Date.now()
                            },
                            topic: msg.topic || "aqara/error"
                        });
                    }
                    return;
                }
                // WRITE operation
                let acKey;
                if ((_e = msg.payload) === null || _e === void 0 ? void 0 : _e.acKey) {
                    acKey = msg.payload.acKey;
                }
                else if (deviceType === "ac") {
                    const power = (_g = (_f = msg.payload) === null || _f === void 0 ? void 0 : _f.power) !== null && _g !== void 0 ? _g : true;
                    const mode = (_j = (_h = msg.payload) === null || _h === void 0 ? void 0 : _h.mode) !== null && _j !== void 0 ? _j : 0;
                    const temperature = (_l = (_k = msg.payload) === null || _k === void 0 ? void 0 : _k.temperature) !== null && _l !== void 0 ? _l : defaultTemperature;
                    const fanSpeed = (_o = (_m = msg.payload) === null || _m === void 0 ? void 0 : _m.fanSpeed) !== null && _o !== void 0 ? _o : defaultFanSpeed;
                    acKey = aqaraService.generateAcKey(power, mode, temperature, fanSpeed);
                }
                else {
                    const acKeyTemplate = config.acKeyTemplate || "P0_M0_T{temp}_S2";
                    acKey = acKeyTemplate
                        .replace("{power}", ((_p = msg.payload) === null || _p === void 0 ? void 0 : _p.power) ? "0" : "1")
                        .replace("{temp}", String((_r = (_q = msg.payload) === null || _q === void 0 ? void 0 : _q.temperature) !== null && _r !== void 0 ? _r : defaultTemperature))
                        .replace("{mode}", String((_t = (_s = msg.payload) === null || _s === void 0 ? void 0 : _s.mode) !== null && _t !== void 0 ? _t : 0))
                        .replace("{fan}", String((_v = (_u = msg.payload) === null || _u === void 0 ? void 0 : _u.fanSpeed) !== null && _v !== void 0 ? _v : defaultFanSpeed));
                }
                node.status({ fill: "yellow", shape: "dot", text: "Sending..." });
                const response = await aqaraService.sendIrClick(deviceId, acKey, enableRetry, maxRetries);
                node.status({ fill: "green", shape: "dot", text: "Command sent" });
                node.send({
                    payload: {
                        success: true,
                        action: "write",
                        deviceId,
                        acKey,
                        response: response.result,
                        timestamp: Date.now(),
                    },
                    topic: msg.topic || "aqara/command",
                });
            }
            catch (error) {
                const err = error;
                node.error(`Aqara command failed: ${err.message}`, msg);
                const errorCode = error.code;
                node.status({ fill: "red", shape: "ring", text: `Error: ${errorCode || "Unknown"}` });
                node.send({
                    payload: {
                        success: false,
                        error: err.message,
                        errorCode: error.code,
                        timestamp: Date.now(),
                    },
                    topic: msg.topic || "aqara/error",
                });
            }
        });
        node.on("close", (done) => {
            node.log("Aqara device node closing");
            done();
        });
    }
    RED.nodes.registerType("viis-aqara-device", ViisAqaraDeviceNode);
};
