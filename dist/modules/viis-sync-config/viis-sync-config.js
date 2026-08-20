"use strict";
/**
 * @fileoverview Sync Config Node for VIIS IoT system
 * Receives RPC "sync-full-config" signal from backend, fetches full device config,
 * and writes to device*.json file. env-loader's FileWatcher auto-detects the change
 * and reloads into global context.
 *
 * @author VIIS Team
 * @version 1.0.1
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
const global_context_helper_1 = require("../../ultils/global-context-helper");
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const viis_telemetry_constants_1 = require("../viis-telemetry/viis-telemetry-constants");
const resolve_backend_url_1 = require("../../ultils/resolve-backend-url");
const RPC_METHOD = 'sync-full-config';
const TOPIC_RPC_REQUEST = 'v1/devices/me/rpc/request/+';
const TB_DEFAULT_HOST = 'mqtt.viis.tech';
const TB_DEFAULT_PORT = '1883';
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const CONFIGS_DIR = '/usr/src/app/env/configs';
const log = {
    info: (node, msg) => {
        console.info(`[VIIS-SYNC-CONFIG] INFO: ${msg}`);
        node.log(msg);
    },
    warn: (node, msg) => {
        console.warn(`[VIIS-SYNC-CONFIG] WARN: ${msg}`);
        node.warn(msg);
    },
    error: (node, msg) => {
        console.error(`[VIIS-SYNC-CONFIG] ERROR: ${msg}`);
        node.error(msg);
    },
};
module.exports = function (RED) {
    function ViisSyncConfigNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const configFile = config.configFile || 'device1.json';
        const configPath = path.join(CONFIGS_DIR, configFile);
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        const deviceId = globalHelper.getEnvVar('DEVICE_ID', '');
        const accessToken = globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '');
        if (!deviceId) {
            log.error(node, 'DEVICE_ID not found. Ensure env-loader node is configured.');
            node.status({ fill: 'red', shape: 'ring', text: 'Missing DEVICE_ID' });
            return;
        }
        if (!accessToken) {
            log.error(node, 'DEVICE_ACCESS_TOKEN not found. Ensure env-loader node is configured.');
            node.status({ fill: 'red', shape: 'ring', text: 'Missing DEVICE_ACCESS_TOKEN' });
            return;
        }
        function resolveBackendUrl() {
            return (0, resolve_backend_url_1.resolveViisBackendUrl)(node, config.backendUrl);
        }
        let isSyncing = false;
        let mqttClient = null;
        log.info(node, `Initialized. Config file: ${configPath}`);
        log.info(node, 'Backend URL is resolved at request time from VIIS_BACKEND/BACKEND_URL (common.json via env-loader)');
        log.info(node, `  config.backendUrl: "${config.backendUrl}"`);
        log.info(node, `  VIIS_BACKEND (at init): "${globalHelper.getEnvVar('VIIS_BACKEND', '')}"`);
        log.info(node, `  BACKEND_URL (at init): "${globalHelper.getEnvVar('BACKEND_URL', '')}"`);
        log.info(node, `Device ID: ${deviceId}`);
        // ── Initialize MQTT subscription ──────────────────────────────────────
        (async () => {
            try {
                const tbHost = globalHelper.getEnvVar('THINGSBOARD_HOST', TB_DEFAULT_HOST);
                const tbPort = globalHelper.getEnvVar('THINGSBOARD_PORT', TB_DEFAULT_PORT);
                const mqttConfig = {
                    broker: `mqtt://${tbHost}:${tbPort}`,
                    clientId: `node-red-sync-config-${Math.random().toString(16).substring(2, 10)}`,
                    username: accessToken,
                    password: globalHelper.getEnvVar('THINGSBOARD_PASSWORD', ''),
                    qos: 1,
                };
                log.info(node, `Connecting to MQTT: mqtt://${tbHost}:${tbPort}`);
                mqttClient = await client_registry_1.default.getThingsboardMqttClient(mqttConfig, node);
                // Wait for connection
                if (!mqttClient.isConnected()) {
                    log.info(node, 'Waiting for MQTT connection...');
                    await mqttClient.waitForConnection(10000);
                }
                // Subscribe to RPC topic
                await mqttClient.subscribe(TOPIC_RPC_REQUEST);
                log.info(node, `Subscribed to ${TOPIC_RPC_REQUEST}`);
                // Listen for messages
                mqttClient.on('mqtt-message', handleMqttMessage);
                node.status({ fill: 'green', shape: 'ring', text: 'Ready' });
                log.info(node, 'Ready - listening for sync-full-config RPC');
            }
            catch (error) {
                const errMsg = error.message;
                log.error(node, `MQTT initialization failed: ${errMsg}`);
                node.status({ fill: 'red', shape: 'ring', text: 'MQTT failed' });
            }
        })();
        // ── MQTT message handler ──────────────────────────────────────────────
        function handleMqttMessage(event) {
            try {
                const { topic, message } = event.message || event;
                if (!topic || !topic.includes('rpc/request/'))
                    return;
                const rawMsg = typeof message === 'string' ? message : message.toString();
                const parsed = JSON.parse(rawMsg);
                if (parsed.method !== RPC_METHOD)
                    return;
                log.info(node, `Received ${RPC_METHOD} RPC from topic: ${topic}`);
                log.info(node, `RPC params: ${JSON.stringify(parsed.params || {})}`);
                handleSync(parsed.params);
            }
            catch (err) {
                // Ignore non-JSON or unrelated messages
            }
        }
        // ── Core sync logic ───────────────────────────────────────────────────
        async function handleSync(params) {
            var _a, _b, _c;
            if (isSyncing) {
                log.warn(node, 'Sync already in progress, skipping');
                return;
            }
            isSyncing = true;
            node.status({ fill: 'blue', shape: 'dot', text: 'Syncing...' });
            try {
                // Step 1: Build config URL
                // Prefer editor override, then common.json via env-loader (lazy — after node construct)
                const backendUrl = resolveBackendUrl();
                const configUrl = `${backendUrl}/api/v2/device/env-config/${deviceId}/export-nodered`;
                log.info(node, `Config URL: ${configUrl}`);
                log.info(node, `Device ID in URL: ${deviceId}`);
                // Step 2: Fetch config from backend
                const fetchedConfig = await fetchWithRetry(configUrl);
                // Log raw response for debugging
                log.info(node, `Response type: ${typeof fetchedConfig}`);
                log.info(node, `Response keys: ${fetchedConfig ? Object.keys(fetchedConfig).join(', ') : 'null'}`);
                // Unwrap { result: { ... } } wrapper if present (backend API response format)
                const config = (fetchedConfig === null || fetchedConfig === void 0 ? void 0 : fetchedConfig.result) || fetchedConfig;
                log.info(node, `Config deviceIdentity.DEVICE_ID: ${((_a = config === null || config === void 0 ? void 0 : config.deviceIdentity) === null || _a === void 0 ? void 0 : _a.DEVICE_ID) || 'MISSING'}`);
                // Step 3: Validate
                if (!((_b = config === null || config === void 0 ? void 0 : config.deviceIdentity) === null || _b === void 0 ? void 0 : _b.DEVICE_ID)) {
                    throw new Error('Invalid config: missing deviceIdentity.DEVICE_ID');
                }
                if (!((_c = config === null || config === void 0 ? void 0 : config.deviceIdentity) === null || _c === void 0 ? void 0 : _c.DEVICE_ACCESS_TOKEN)) {
                    throw new Error('Invalid config: missing deviceIdentity.DEVICE_ACCESS_TOKEN');
                }
                log.info(node, `Config fetched for device: ${config.deviceIdentity.DEVICE_ID}`);
                // Step 4: Check if config actually changed
                let configChanged = true;
                if (fs.existsSync(configPath)) {
                    try {
                        const currentContent = fs.readFileSync(configPath, 'utf8');
                        const currentConfig = JSON.parse(currentContent);
                        if (JSON.stringify(currentConfig) === JSON.stringify(config)) {
                            configChanged = false;
                            log.info(node, 'Config unchanged, skipping write');
                        }
                    }
                    catch (_d) {
                        // If current file is invalid, we'll overwrite it
                    }
                }
                if (configChanged) {
                    // Step 5: Backup current file
                    if (fs.existsSync(configPath)) {
                        const backupPath = `${configPath}.bak`;
                        fs.copyFileSync(configPath, backupPath);
                        log.info(node, `Backed up to ${backupPath}`);
                    }
                    // Step 6: Write new config
                    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
                    log.info(node, `Config written to ${configPath}`);
                }
                // Step 7: Update global context directly (backup plan for FileWatcher)
                updateGlobalContext(config);
                // Done
                node.status({ fill: 'green', shape: 'dot', text: configChanged ? 'Synced' : 'Up to date' });
                setTimeout(() => {
                    node.status({ fill: 'green', shape: 'ring', text: 'Ready' });
                }, 5000);
                node.send({
                    payload: {
                        synced: true,
                        configChanged,
                        configFile,
                        timestamp: new Date().toISOString(),
                    },
                });
            }
            catch (error) {
                const errMsg = error.message;
                log.error(node, `Sync failed: ${errMsg}`);
                node.status({ fill: 'red', shape: 'ring', text: `Error: ${errMsg.substring(0, 30)}` });
                node.send({ payload: { synced: false, error: errMsg } });
            }
            finally {
                isSyncing = false;
            }
        }
        // ── Fetch with retry + detailed error logging ────────────────────────
        async function fetchWithRetry(url) {
            var _a, _b, _c, _d;
            let lastError = null;
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    log.info(node, `HTTP GET ${url} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
                    const response = await axios_1.default.get(url, { timeout: 30000 });
                    log.info(node, `HTTP ${response.status} OK - ${response.data ? JSON.stringify(response.data).length : 0} bytes`);
                    return response.data;
                }
                catch (error) {
                    const axiosErr = error;
                    const status = ((_a = axiosErr.response) === null || _a === void 0 ? void 0 : _a.status) || 'N/A';
                    const statusText = ((_b = axiosErr.response) === null || _b === void 0 ? void 0 : _b.statusText) || 'N/A';
                    const responseData = ((_c = axiosErr.response) === null || _c === void 0 ? void 0 : _c.data)
                        ? JSON.stringify(axiosErr.response.data).substring(0, 200)
                        : 'no response body';
                    const requestUrl = ((_d = axiosErr.config) === null || _d === void 0 ? void 0 : _d.url) || url;
                    lastError = error;
                    log.warn(node, `HTTP ${status} ${statusText} | URL: ${requestUrl} | Response: ${responseData}`);
                    if (attempt < MAX_RETRIES) {
                        const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), 10000);
                        log.warn(node, `Retrying in ${delay}ms...`);
                        await new Promise((r) => setTimeout(r, delay));
                    }
                }
            }
            throw lastError || new Error('Fetch failed after retries');
        }
        // ── Update global context ─────────────────────────────────────────────
        function updateGlobalContext(config) {
            const ctx = node.context().global;
            const identity = config.deviceIdentity || {};
            ctx.set('device_id', identity.DEVICE_ID || '');
            ctx.set('device_access_token', identity.DEVICE_ACCESS_TOKEN || '');
            ctx.set('device_serial', identity.DEVICE_SERIAL || '');
            ctx.set('device_label', identity.DEVICE_LABEL || '');
            ctx.set('device_profile_id', identity.DEVICE_PROFILE_ID || '');
            ctx.set('device_profile_label', identity.DEVICE_PROFILE_LABEL || '');
            if (config.modbusBoards) {
                ctx.set('modbus_boards', config.modbusBoards);
                ctx.set('MODBUS_BOARDS', JSON.stringify(config.modbusBoards));
            }
            if (config.modbusDefaultBoard !== undefined) {
                ctx.set('modbus_default_board', config.modbusDefaultBoard);
            }
            if (config.modbusMappings) {
                ctx.set('modbusMappings', config.modbusMappings);
                for (const [boardId, mappings] of Object.entries(config.modbusMappings)) {
                    const m = mappings;
                    if (m.coils)
                        ctx.set(`modbus_${boardId}_coils`, m.coils);
                    if (m.holdingRegisters)
                        ctx.set(`modbus_${boardId}_holding_registers`, m.holdingRegisters);
                    if (m.inputRegisters)
                        ctx.set(`modbus_${boardId}_input_registers`, m.inputRegisters);
                }
            }
            if (config.modbusPollGroups) {
                ctx.set('modbusPollGroups', config.modbusPollGroups);
                ctx.set('modbus_poll_groups', config.modbusPollGroups);
                ctx.set('pollingConfig', config.modbusPollGroups);
            }
            if (config.modbusPublishThresholds) {
                ctx.set('modbusPublishThresholds', config.modbusPublishThresholds);
                ctx.set('modbus_publish_thresholds', config.modbusPublishThresholds);
                ctx.set('modbusThresholds', config.modbusPublishThresholds);
            }
            if (config.scaleConfigs !== undefined) {
                ctx.set(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS, config.scaleConfigs);
            }
            log.info(node, 'Global context updated');
        }
        // ── Manual trigger via input ──────────────────────────────────────────
        node.on('input', async () => {
            await handleSync({});
        });
        // ── Cleanup ───────────────────────────────────────────────────────────
        node.on('close', async (done) => {
            log.info(node, 'Node closing');
            if (mqttClient) {
                mqttClient.removeListener('mqtt-message', handleMqttMessage);
                client_registry_1.default.releaseClient('thingsboard', node);
            }
            done();
        });
    }
    RED.nodes.registerType('viis-sync-config', ViisSyncConfigNode);
};
