"use strict";
/**
 * VIIS Aqara Configuration Node
 *
 * Manages Aqara Open API credentials and provides authentication
 * services to Aqara device nodes.
 *
 * @module viis-aqara-config
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
// ============================================================================
// Node-RED Config Node Implementation
// ============================================================================
module.exports = function (RED) {
    // Config node constructor
    function ViisAqaraConfigNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Store credentials securely
        const credentials = {
            appid: config.appid || "",
            keyid: config.keyid || "",
            appkey: config.appkey || "",
            accesstoken: config.accesstoken || "",
        };
        // Validate credentials on node initialization
        if (!credentials.appid || !credentials.keyid || !credentials.appkey) {
            node.error("Missing required Aqara credentials");
            node.status({ fill: "red", shape: "ring", text: "Credentials missing" });
        }
        else {
            node.status({ fill: "green", shape: "dot", text: "Configured" });
        }
        /**
         * Get credentials (called by device nodes)
         */
        node.getCredentials = () => {
            return Object.assign({}, credentials);
        };
        /**
         * Generate authentication signature (utility function)
         */
        node.generateAuthParams = () => {
            const time = Date.now();
            const nonce = time;
            // Build pre-sign string
            let preSign = "";
            if (credentials.accesstoken) {
                preSign = `Accesstoken=${credentials.accesstoken}&`;
            }
            preSign +=
                `Appid=${credentials.appid}&` +
                    `Keyid=${credentials.keyid}&` +
                    `Nonce=${nonce}&` +
                    `Time=${time}` +
                    credentials.appkey;
            // Generate MD5 hash
            const sign = crypto_1.default
                .createHash("md5")
                .update(preSign.toLowerCase())
                .digest("hex");
            // Build headers
            const headers = {
                Appid: credentials.appid,
                Keyid: credentials.keyid,
                Time: time.toString(),
                Nonce: nonce.toString(),
                Sign: sign,
            };
            if (credentials.accesstoken) {
                headers.Accesstoken = credentials.accesstoken;
            }
            return { headers, time, nonce, sign };
        };
        /**
         * Test connection to Aqara API
         */
        node.testConnection = async () => {
            try {
                const axios = await Promise.resolve().then(() => __importStar(require("axios")));
                const { headers } = node.generateAuthParams();
                // Test with a simple API call (you may need to adjust based on available test endpoints)
                const response = await axios.default.post("https://open-sg.aqara.com/v3.0/open/api", {
                    intent: "read.device.info",
                    data: {
                        did: "test",
                    },
                }, { headers, timeout: 5000 });
                if (response.data.code === 0) {
                    return { success: true, message: "Connection successful" };
                }
                else {
                    return {
                        success: false,
                        message: `API error: ${response.data.message}`,
                    };
                }
            }
            catch (error) {
                return {
                    success: false,
                    message: error.message || "Connection failed",
                };
            }
        };
        node.log("Aqara config node initialized");
    }
    // Register config node type
    RED.nodes.registerType("viis-aqara-config", ViisAqaraConfigNode, {
        credentials: {
            appid: { type: "text" },
            keyid: { type: "text" },
            appkey: { type: "password" },
            accesstoken: { type: "password" },
        },
    });
};
