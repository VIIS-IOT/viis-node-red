"use strict";
/**
 * viis-marine-telemetry Node (DH6400 Serial Only)
 * Simplified version - only DH6400 serial polling, no Modbus
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
const viis_marine_telemetry_processor_1 = require("./viis-marine-telemetry-processor");
const dataSource_1 = require("../../orm/dataSource");
const DH6400PollingService_1 = require("../../services/MarineIoT/DH6400PollingService");
process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (reason, promise) => {
    console.error('🚨 Unhandled Exception at:', promise, 'reason:', reason);
});
module.exports = function (RED) {
    /**
     * Main viis-marine-telemetry node implementation (DH6400 only)
     */
    function ViisMarinetTelemetryNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext = this.context();
        // Initialize GlobalContextHelper
        const globalHelper = new global_context_helper_1.GlobalContextHelper(this.context());
        // Variables to store clients for cleanup
        let thingsboardMqttClient = null;
        let marineProcessor = null;
        let dh6400PollingService = null;
        let dataSource = null;
        // MQTT publish throttle control
        const publishState = {
            lastFsPublishTime: 0,
            lastTfsPublishTime: 0,
            fsPublishInterval: config.fsPublishInterval || 600000, // Default: 10 minutes
            tfsPublishInterval: config.tfsPublishInterval || 3600000, // Default: 1 hour
            latestFlowData: {},
            latestTfsData: {}
        };
        // Marine IoT configuration
        const marineConfig = {
            enabled: config.enableMarineIoT !== false, // Default: true
            flowSensorKeys: (config.flowSensorKeys || 'fs01,fs02,fs03,fs04,fs05,fs06').split(',').map(k => k.trim()),
            profileCacheDuration: config.profileCacheDuration || 300000 // 5 minutes
        };
        // Wrap async initialization
        (async () => {
            try {
                node.log('[Marine] Initializing DH6400 serial polling node...');
                // Wait for env-loader to complete first
                node.log('[Marine] Waiting for env-loader to complete...');
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds for env-loader
                // Get device ID
                const deviceId = globalHelper.getEnvVar('DEVICE_ID', 'unknown-device');
                node.log(`[Marine] Device ID: ${deviceId}`);
                // Create MQTT clients (after env-loader has completed)
                const thingsboardMqttConfig = createThingsboardMqttConfig(globalHelper);
                thingsboardMqttClient = await client_registry_1.default.getThingsboardMqttClient(thingsboardMqttConfig, node);
                if (!thingsboardMqttClient) {
                    node.error("[Marine] Failed to initialize ThingsBoard MQTT client");
                    node.status({ fill: "red", shape: "ring", text: "MQTT init failed" });
                    return;
                }
                // Verify env variables are loaded
                const dbHost = globalHelper.getEnvVar('DATABASE_HOST', 'NOT_LOADED');
                node.log(`[Marine] DATABASE_HOST from global context: ${dbHost}`);
                // Load SCALE_CONFIGS from env and MERGE with existing global context
                const scaleConfigsJson = globalHelper.getEnvVar('SCALE_CONFIGS', '[]');
                try {
                    const newScaleConfigs = JSON.parse(scaleConfigsJson);
                    const existingConfigs = (nodeContext.global.get('scaleConfigs') || []);
                    // Merge using key+direction as unique identifier
                    const configMap = new Map();
                    for (const config of existingConfigs) {
                        const uniqueKey = `${config.key}_${config.direction}`;
                        configMap.set(uniqueKey, config);
                    }
                    for (const config of newScaleConfigs) {
                        const uniqueKey = `${config.key}_${config.direction}`;
                        configMap.set(uniqueKey, config);
                    }
                    const mergedConfigs = Array.from(configMap.values());
                    nodeContext.global.set('scaleConfigs', mergedConfigs);
                    node.log(`[Marine] Merged scale configs (${existingConfigs.length} existing + ${newScaleConfigs.length} from env = ${mergedConfigs.length} total)`);
                }
                catch (error) {
                    node.warn(`[Marine] Failed to parse SCALE_CONFIGS: ${error.message}`);
                    // Don't overwrite existing configs on parse error
                }
                dataSource = await (0, dataSource_1.createDataSource)(nodeContext);
                if (!dataSource.isInitialized) {
                    await dataSource.initialize();
                    node.log('[Marine] Database connection initialized');
                }
                // Initialize Marine IoT processor
                if (marineConfig.enabled) {
                    marineProcessor = new viis_marine_telemetry_processor_1.ViisMarinetTelemetryProcessor(node, nodeContext, dataSource, marineConfig, deviceId);
                    node.log(`[Marine] Marine IoT enabled for sensors: ${marineConfig.flowSensorKeys.join(', ')}`);
                }
                else {
                    node.log('[Marine] Marine IoT disabled');
                }
                // Initialize DH6400 Polling Service
                const dh6400Config = createDH6400Config(globalHelper, config);
                if (dh6400Config.enabled) {
                    dh6400PollingService = new DH6400PollingService_1.DH6400PollingService(node, nodeContext, dh6400Config);
                    node.log(`[Marine] DH6400 serial polling enabled for ${dh6400Config.enabledChannels.length} channels`);
                }
                else {
                    node.warn('[Marine] DH6400 serial polling disabled - this node requires DH6400 to be enabled');
                }
                // Setup DH6400 event handlers
                if (dh6400PollingService && marineProcessor) {
                    setupDH6400EventHandlers(node, dh6400PollingService, marineProcessor, thingsboardMqttClient, publishState);
                }
                // Setup input message handler
                setupInputHandler(node, marineProcessor);
                // Setup cleanup handler
                setupCleanupHandler(node, thingsboardMqttClient, dh6400PollingService, dataSource);
                // Start DH6400 polling if enabled
                if (dh6400PollingService) {
                    await dh6400PollingService.startPolling();
                    node.log('[Marine] DH6400 polling started');
                    node.status({ fill: "green", shape: "dot", text: "DH6400 polling active" });
                }
                else {
                    node.status({ fill: "yellow", shape: "ring", text: "DH6400 disabled" });
                }
            }
            catch (error) {
                node.error(`[Marine] Node initialization failed: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
            }
        })().catch((error) => {
            node.error(`[Marine] Async initialization failed: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Async init failed" });
        });
    }
    /**
     * Create ThingsBoard MQTT configuration
     */
    function createThingsboardMqttConfig(globalHelper) {
        const broker = globalHelper.getEnvVar('THINGSBOARD_MQTT_BROKER', 'mqtt://localhost:1883');
        const username = globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '');
        console.log('[Marine] MQTT Config - Broker:', broker);
        console.log('[Marine] MQTT Config - Token:', username ? '***' + username.slice(-4) : 'NOT_SET');
        return {
            broker,
            username,
            password: '',
            clientId: `thingsboard_${Date.now()}`,
            reconnectPeriod: 5000,
            qos: 1
        };
    }
    /**
     * Create DH6400 configuration
     */
    function createDH6400Config(globalHelper, config) {
        const enabled = true; // Hard-coded to always enable DH6400
        const serialPort = globalHelper.getEnvVar('DH6400_SERIAL_PORT', '/dev/ttyACM0');
        const baudRate = globalHelper.getNumericEnvVar('DH6400_BAUD_RATE', 9600);
        // Use config value if provided, otherwise use ENV or default to 10000ms (10 sec)
        const pollingInterval = config.dh6400PollingInterval
            || globalHelper.getNumericEnvVar('DH6400_POLLING_INTERVAL', 10000);
        const channelsStr = globalHelper.getEnvVar('DH6400_ENABLED_CHANNELS', '1,2,3,4,5,6');
        const enabledChannels = channelsStr.split(',')
            .map(ch => parseInt(ch.trim()))
            .filter(ch => ch >= 1 && ch <= 6);
        return {
            enabled,
            serialPort,
            baudRate,
            pollingInterval,
            enabledChannels
        };
    }
    /**
     * Setup DH6400 event handlers with Marine IoT processor
     */
    function setupDH6400EventHandlers(node, dh6400Service, marineProcessor, thingsboardMqtt, publishState) {
        // Handle DH6400 telemetry data
        dh6400Service.on('telemetry-data', async (event) => {
            try {
                node.log(`[Marine] Received DH6400 data for ${event.rawData.size} channels`);
                // Process flow sensor data (instantaneous flow - fsXX)
                const flowSensorData = await marineProcessor.processDH6400FlowData(event.rawData);
                // Process TFS data (total accumulated flow - tfsXX)
                const tfsData = await marineProcessor.processDH6400Data(event.rawData);
                const now = Date.now();
                let telemetryPayload = {};
                let shouldPublish = false;
                // Update latest flow data cache
                flowSensorData.forEach(data => {
                    publishState.latestFlowData[data.key_name] = data.float_value;
                });
                // Update latest TFS data cache
                tfsData.forEach(data => {
                    publishState.latestTfsData[data.key_name] = data.tfs_value;
                });
                // Check if it's time to publish fs data (instant flow)
                const timeSinceLastFsPublish = now - publishState.lastFsPublishTime;
                if (timeSinceLastFsPublish >= publishState.fsPublishInterval) {
                    // Add flow sensor data to payload
                    Object.assign(telemetryPayload, publishState.latestFlowData);
                    publishState.lastFsPublishTime = now;
                    shouldPublish = true;
                    node.log(`[Marine] Publishing fs data (interval: ${(timeSinceLastFsPublish / 1000 / 60).toFixed(1)}min)`);
                }
                // Check if it's time to publish tfs data (total accumulated)
                const timeSinceLastTfsPublish = now - publishState.lastTfsPublishTime;
                if (timeSinceLastTfsPublish >= publishState.tfsPublishInterval) {
                    // Add TFS data to payload
                    Object.assign(telemetryPayload, publishState.latestTfsData);
                    publishState.lastTfsPublishTime = now;
                    shouldPublish = true;
                    node.log(`[Marine] Publishing tfs data (interval: ${(timeSinceLastTfsPublish / 1000 / 60).toFixed(1)}min)`);
                }
                // Publish to ThingsBoard if there's data to send
                if (shouldPublish && Object.keys(telemetryPayload).length > 0) {
                    const topic = 'v1/devices/me/telemetry';
                    // Wrap publish in try-catch to prevent crash when network is down
                    try {
                        await thingsboardMqtt.publish(topic, JSON.stringify(telemetryPayload));
                        node.log(`[Marine] Published ${Object.keys(telemetryPayload).length} values to ThingsBoard`);
                    }
                    catch (publishError) {
                        // Log warning but don't crash - local services should continue working
                        node.warn(`[Marine] Failed to publish to ThingsBoard (network may be down): ${publishError.message}`);
                        node.status({ fill: "yellow", shape: "ring", text: "MQTT publish failed - continuing locally" });
                    }
                    // Send output message regardless of MQTT publish status
                    node.send({
                        topic: 'dh6400-telemetry',
                        payload: Object.assign(Object.assign({}, telemetryPayload), { _timestamp: event.timestamp })
                    });
                }
                else {
                    const fsTimeRemaining = Math.max(0, (publishState.fsPublishInterval - timeSinceLastFsPublish) / 1000 / 60);
                    const tfsTimeRemaining = Math.max(0, (publishState.tfsPublishInterval - timeSinceLastTfsPublish) / 1000 / 60);
                    node.log(`[Marine] Data cached, waiting for publish interval (fs: ${fsTimeRemaining.toFixed(1)}min, tfs: ${tfsTimeRemaining.toFixed(1)}min)`);
                }
            }
            catch (error) {
                node.error(`[Marine] Failed to process DH6400 data: ${error.message}`);
            }
        });
        // Handle DH6400 polling errors
        dh6400Service.on('polling-error', (event) => {
            try {
                node.warn(`[Marine] DH6400 polling error: ${event.err_code}`);
                // Send error message in format compatible with viis-error-trigger
                node.send({
                    topic: 'dh6400-error',
                    payload: {
                        err_code: event.err_code,
                        message: event.message,
                        severity: event.severity,
                        type: event.type,
                        entity: event.entity,
                        metadata: event.metadata
                    }
                });
                node.log(`[Marine] Error message sent to output: ${event.err_code}`);
            }
            catch (error) {
                node.error(`[Marine] Failed to handle polling error: ${error.message}`);
            }
        });
        // Handle DH6400 debug data - output successful reads to debug node
        dh6400Service.on('debug-data', (event) => {
            node.send({
                topic: 'dh6400-debug',
                payload: {
                    channel: event.channel,
                    sensorKey: event.sensorKey,
                    instantFlowM3h: event.instantFlowM3h,
                    totalAccumulatedM3: event.totalAccumulatedM3,
                    timestamp: event.timestamp,
                    rawHex: event.rawHex,
                    _debugMessage: `✅ ${event.sensorKey}: instant=${event.instantFlowM3h.toFixed(2)} m³/h, total=${event.totalAccumulatedM3.toFixed(4)} m³`
                }
            });
        });
    }
    /**
     * Setup input message handler
     */
    function setupInputHandler(node, marineProcessor) {
        node.on('input', (msg) => {
            try {
                // Handle Marine IoT specific commands
                if (marineProcessor) {
                    if (msg.clearProfileCache === true) {
                        marineProcessor.clearCache();
                        node.log('[Marine] Profile cache cleared via input message');
                    }
                    if (msg.getCacheStatus === true) {
                        const status = marineProcessor.getCacheStatus();
                        node.send({ payload: status, topic: 'marine-cache-status' });
                    }
                }
            }
            catch (error) {
                node.error(`[Marine] Failed to process input: ${error.message}`);
            }
        });
    }
    /**
     * Setup cleanup handler with proper port release
     */
    function setupCleanupHandler(node, thingsboardMqttClient, dh6400PollingService, dataSource) {
        node.on('close', async (done) => {
            const cleanupTimeout = setTimeout(() => {
                node.warn('[Marine] Cleanup timeout - forcing completion');
                done();
            }, 10000); // 10 second max cleanup time
            try {
                node.log('[Marine] Starting cleanup...');
                // Cleanup DH6400 polling service FIRST and wait for port release
                if (dh6400PollingService) {
                    try {
                        await dh6400PollingService.cleanup();
                        node.log('[Marine] DH6400 polling service cleaned up');
                        // Wait a bit for OS to fully release the port lock
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    catch (dh6400Error) {
                        node.warn(`[Marine] DH6400 cleanup warning: ${dh6400Error.message}`);
                    }
                }
                // Disconnect ThingsBoard MQTT
                if (thingsboardMqttClient) {
                    try {
                        thingsboardMqttClient.disconnect();
                        node.log('[Marine] ThingsBoard MQTT disconnected');
                    }
                    catch (mqttError) {
                        node.warn(`[Marine] MQTT cleanup warning: ${mqttError.message}`);
                    }
                }
                // Cleanup DataSource (singleton shared across nodes)
                // Only destroy if still initialized to avoid race conditions
                if (dataSource && dataSource.isInitialized) {
                    try {
                        await dataSource.destroy();
                        node.log('[Marine] Database connection closed');
                    }
                    catch (dbError) {
                        // Ignore if already closed by another node
                        if (!dbError.message.includes('not yet established')) {
                            node.warn(`[Marine] Database cleanup warning: ${dbError.message}`);
                        }
                    }
                }
                clearTimeout(cleanupTimeout);
                node.log('[Marine] Node closed and cleaned up');
                done();
            }
            catch (error) {
                clearTimeout(cleanupTimeout);
                node.error(`[Marine] Cleanup error: ${error.message}`);
                done();
            }
        });
    }
    RED.nodes.registerType("viis-marine-telemetry", ViisMarinetTelemetryNode);
};
