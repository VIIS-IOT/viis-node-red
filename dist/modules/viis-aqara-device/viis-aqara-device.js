"use strict";
/**
 * VIIS Aqara Device Control Node
 *
 * Node-RED custom node for controlling Aqara devices via Open API
 * Supports IR control for air conditioners and other IR devices
 * Supports READ operations for stateful AC devices (query.ir.acState)
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
        this.requestDelay = 2000; // Default 2 seconds
        this.credentials = credentials;
        this.requestDelay = requestDelay || 2000;
        this.httpClient = axios_1.default.create({
            timeout: 10000,
            headers: {
                "Content-Type": "application/json",
            },
        });
    }
    /**
     * Generate authentication signature
     */
    generateAuthParams() {
        const time = Date.now();
        const nonce = time; // Use same timestamp for nonce
        // Build pre-sign string
        let preSign = "";
        if (this.credentials.accesstoken) {
            preSign = `Accesstoken=${this.credentials.accesstoken}&`;
        }
        preSign +=
            `Appid=${this.credentials.appid}&` +
                `Keyid=${this.credentials.keyid}&` +
                `Nonce=${nonce}&` +
                `Time=${time}` +
                this.credentials.appkey;
        // Generate MD5 hash
        const sign = crypto_1.default
            .createHash("md5")
            .update(preSign.toLowerCase())
            .digest("hex");
        // Build headers
        const headers = {
            Appid: this.credentials.appid,
            Keyid: this.credentials.keyid,
            Time: time.toString(),
            Nonce: nonce.toString(),
            Sign: sign,
        };
        if (this.credentials.accesstoken) {
            headers.Accesstoken = this.credentials.accesstoken;
        }
        return { headers, time, nonce };
    }
    /**
     * Wait for specified delay since last request
     */
    async enforceRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.requestDelay) {
            const waitTime = this.requestDelay - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this.lastRequestTime = Date.now();
    }
    /**
     * Send command to Aqara device with retry logic
     */
    async sendCommand(command, enableRetry = true, maxRetries = 3) {
        let lastError = null;
        const attempts = enableRetry ? maxRetries : 1;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                // Enforce rate limiting
                await this.enforceRateLimit();
                // Generate fresh auth params for each request
                const { headers } = this.generateAuthParams();
                const response = await this.httpClient.post(this.baseUrl, command, { headers });
                const result = response.data;
                // Check for API-level errors
                if (result.code !== 0) {
                    throw new AqaraApiError(result.message, result.code, result);
                }
                return result;
            }
            catch (error) {
                lastError = error;
                // Don't retry on certain errors
                if (error instanceof AqaraApiError) {
                    const apiError = error;
                    if ([1001, 1002, 1003, 2001].includes(apiError.code)) {
                        throw apiError; // Don't retry authentication/device errors
                    }
                }
                // Wait before retry (exponential backoff)
                if (attempt < attempts) {
                    const backoffTime = 1000 * Math.pow(2, attempt - 1);
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                }
            }
        }
        throw lastError || new Error("Unknown error sending Aqara command");
    }
    /**
     * Send IR click command (for AC control)
     */
    async sendIrClick(deviceId, acKey, enableRetry, maxRetries) {
        const command = {
            intent: "write.ir.click",
            data: {
                did: deviceId,
                acKey: acKey,
            },
        };
        return this.sendCommand(command, enableRetry, maxRetries);
    }
    /**
     * Generate AC key from parameters
     */
    generateAcKey(power, mode, temperature, fanSpeed) {
        const powerCode = power ? "0" : "1";
        return `P${powerCode}_M${mode}_T${temperature}_S${fanSpeed}`;
    }
    /**
     * Parse AC state string into structured data
     * Format: Px_Mm_Ty_Ss_Dd
     */
    parseACState(acState) {
        const modeNames = ['cooling', 'heating', 'auto', 'fan', 'dry'];
        const fanNames = ['auto', 'low', 'medium', 'high'];
        // Parse state string (e.g., "P0_M0_T26_S0_D0")
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
            rawState: acState
        };
    }
    /**
     * Read AC state (temperature, mode, fan speed) from stateful AC
     * Uses query.ir.acState intent
     */
    async readACState(deviceId, enableRetry, maxRetries) {
        try {
            const command = {
                intent: "query.ir.acState",
                data: {
                    did: deviceId
                }
            };
            const response = await this.sendCommand(command, enableRetry, maxRetries);
            if (response.result && response.result.acState) {
                const parsedState = this.parseACState(response.result.acState);
                return {
                    success: true,
                    state: parsedState
                };
            }
            else {
                return {
                    success: false,
                    error: "No AC state data in response",
                    errorCode: 3002
                };
            }
        }
        catch (error) {
            return {
                success: false,
                error: error.message || "Failed to read AC state",
                errorCode: error.code || 3003
            };
        }
    }
    /**
     * Query device information
     * Uses query.ir.info intent
     */
    async queryDeviceInfo(deviceId, enableRetry, maxRetries) {
        const command = {
            intent: "query.ir.info",
            data: {
                did: deviceId
            }
        };
        return this.sendCommand(command, enableRetry, maxRetries);
    }
}
// ============================================================================
// Custom Error Classes
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
        // Get configuration
        const configNode = RED.nodes.getNode(config.configNode);
        const deviceType = config.deviceType || "ac";
        const operationMode = config.operationMode || "auto";
        const acKeyTemplate = config.acKeyTemplate || "P0_M0_T{temp}_S2";
        const defaultTemperature = config.defaultTemperature || 25;
        const defaultFanSpeed = (_a = config.defaultFanSpeed) !== null && _a !== void 0 ? _a : 2;
        const requestDelay = config.requestDelay || 2000;
        const enableRetry = (_b = config.enableRetry) !== null && _b !== void 0 ? _b : true;
        const maxRetries = (_c = config.maxRetries) !== null && _c !== void 0 ? _c : 3;
        // Initialize Aqara service
        let aqaraService = null;
        if (configNode) {
            const credentials = configNode.getCredentials();
            aqaraService = new AqaraService(credentials, requestDelay);
            node.log("Aqara device node initialized");
            node.status({ fill: "green", shape: "dot", text: "Ready" });
        }
        else {
            node.error("Missing Aqara config node");
            node.status({ fill: "red", shape: "ring", text: "Config missing" });
            return;
        }
        /**
         * Process incoming message and send command to Aqara device
         */
        node.on("input", async (msg) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
            try {
                // Check auto mode
                if (operationMode === "auto" && ((_a = msg.payload) === null || _a === void 0 ? void 0 : _a.auto) === false) {
                    node.log("Skipping command - not in auto mode");
                    node.status({ fill: "blue", shape: "dot", text: "Manual mode" });
                    return;
                }
                // Extract device ID from message or config
                const deviceId = msg.deviceId || ((_b = msg.payload) === null || _b === void 0 ? void 0 : _b.deviceId) || config.name;
                if (!deviceId) {
                    throw new Error("Device ID is required");
                }
                // Check if this is a READ operation
                const action = ((_c = msg.payload) === null || _c === void 0 ? void 0 : _c.action) || msg.action || "write";
                if (action === "read" || action === "query") {
                    // READ operation - Query AC state
                    node.status({ fill: "yellow", shape: "dot", text: "Reading..." });
                    const readResult = await aqaraService.readACState(deviceId, enableRetry, maxRetries);
                    if (readResult.success && readResult.state) {
                        node.status({ fill: "green", shape: "dot", text: `Read: ${readResult.state.temperature}°C` });
                        // Send success response
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
                            topic: msg.topic || "aqara/state"
                        });
                    }
                    else {
                        // Read failed
                        node.status({ fill: "red", shape: "ring", text: `Read failed: ${readResult.errorCode}` });
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
                // WRITE operation - Send IR command
                let acKey;
                if ((_d = msg.payload) === null || _d === void 0 ? void 0 : _d.acKey) {
                    // Use provided AC key
                    acKey = msg.payload.acKey;
                }
                else if (deviceType === "ac") {
                    // Generate AC key from parameters
                    const power = (_f = (_e = msg.payload) === null || _e === void 0 ? void 0 : _e.power) !== null && _f !== void 0 ? _f : true;
                    const mode = (_h = (_g = msg.payload) === null || _g === void 0 ? void 0 : _g.mode) !== null && _h !== void 0 ? _h : 0; // 0 = auto
                    const temperature = (_k = (_j = msg.payload) === null || _j === void 0 ? void 0 : _j.temperature) !== null && _k !== void 0 ? _k : defaultTemperature;
                    const fanSpeed = (_m = (_l = msg.payload) === null || _l === void 0 ? void 0 : _l.fanSpeed) !== null && _m !== void 0 ? _m : defaultFanSpeed;
                    acKey = aqaraService.generateAcKey(power, mode, temperature, fanSpeed);
                }
                else {
                    // Use template
                    acKey = acKeyTemplate
                        .replace("{power}", ((_o = msg.payload) === null || _o === void 0 ? void 0 : _o.power) ? "0" : "1")
                        .replace("{temp}", String((_q = (_p = msg.payload) === null || _p === void 0 ? void 0 : _p.temperature) !== null && _q !== void 0 ? _q : defaultTemperature))
                        .replace("{mode}", String((_s = (_r = msg.payload) === null || _r === void 0 ? void 0 : _r.mode) !== null && _s !== void 0 ? _s : 0))
                        .replace("{fan}", String((_u = (_t = msg.payload) === null || _t === void 0 ? void 0 : _t.fanSpeed) !== null && _u !== void 0 ? _u : defaultFanSpeed));
                }
                // Send command
                node.status({ fill: "yellow", shape: "dot", text: "Sending..." });
                const response = await aqaraService.sendIrClick(deviceId, acKey, enableRetry, maxRetries);
                // Update status
                node.status({ fill: "green", shape: "dot", text: "Command sent" });
                // Send success response
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
                // Set error status
                const errorCode = error.code;
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: `Error: ${errorCode || "Unknown"}`
                });
                // Send error response
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
        /**
         * Handle node close
         */
        node.on("close", (done) => {
            node.log("Aqara device node closing");
            aqaraService = null;
            node.status({});
            done();
        });
    }
    // Register node type
    RED.nodes.registerType("viis-aqara-device", ViisAqaraDeviceNode);
};
