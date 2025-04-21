import { NodeAPI, NodeDef, Node, NodeContext } from "node-red";
import { ModbusData, ModbusClientCore } from "../../core/modbus-client";
import ClientRegistry from "../../core/client-registry";
import { MySqlConfig, MySqlClientCore } from "../../core/mysql-client";
import { MqttConfig, MqttClientCore } from "../../core/mqtt-client";
import { applyScaling, getChangedKeys, publishTelemetry, debugLog, TelemetryData, ScaleConfig } from './viis-telemetry-utils';

interface ViisTelemetryNodeDef extends NodeDef {
    pollIntervalCoil: string;
    pollIntervalInput: string;
    pollIntervalHolding: string;
    coilStartAddress: string;
    coilQuantity: string;
    inputStartAddress: string;
    inputQuantity: string;
    holdingStartAddress: string;
    holdingQuantity: string;
    scaleConfigs: string;
    enableDebugLog: boolean;
    thresholdConfig: string;
    pollingInterval: string;
    periodicSnapshotIntervalCoil: string;
    periodicSnapshotIntervalInput: string;
    periodicSnapshotIntervalHolding: string;
}

module.exports = function (RED: NodeAPI) {
    async function ViisTelemetryNode(this: Node, config: ViisTelemetryNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext: NodeContext = this.context();

        // Configuration for Modbus
        const modbusConfig = {
            type: (process.env.MODBUS_TYPE as "TCP" | "RTU") || "TCP",
            host: process.env.MODBUS_HOST || "localhost",
            tcpPort: parseInt(process.env.MODBUS_TCP_PORT || "1502", 10),
            serialPort: process.env.MODBUS_SERIAL_PORT || "/dev/ttyUSB0",
            baudRate: parseInt(process.env.MODBUS_BAUD_RATE || "9600", 10),
            parity: (process.env.MODBUS_PARITY as "none" | "even" | "odd") || "none",
            unitId: parseInt(process.env.MODBUS_UNIT_ID || "1", 10),
            timeout: parseInt(process.env.MODBUS_TIMEOUT || "5000", 10),
            reconnectInterval: parseInt(process.env.MODBUS_RECONNECT_INTERVAL || "5000", 10),
        };

        const deviceId = process.env.DEVICE_ID || "unknown";
        const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}") as { [key: string]: number };
        const modbusInputRegisters = JSON.parse(process.env.MODBUS_INPUT_REGISTERS || "{}") as { [key: string]: number };
        const modbusHoldingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}") as { [key: string]: number };

        // Configuration for local MQTT broker
        const localConfig = {
            host: process.env.EMQX_HOST || "emqx",
            port: parseInt(process.env.EMQX_PORT || "1883", 10),
            username: process.env.EMQX_USERNAME || "",
            password: process.env.EMQX_PASSWORD || "",
            pubSubTopic: `viis/things/v2/${deviceId}/telemetry`,
        };
        const localMqttConfig: MqttConfig = {
            broker: `mqtt://${localConfig.host}:${localConfig.port}`,
            clientId: `node-red-local-${Math.random().toString(16).substring(2, 10)}`,
            username: localConfig.username,
            password: localConfig.password,
            qos: 1,
        };

        // Configuration for ThingsBoard MQTT broker
        const thingsboardMqttConfig: MqttConfig = {
            broker: `mqtt://${process.env.THINGSBOARD_HOST || "mqtt.viis.tech"}:${process.env.THINGSBOARD_PORT || "1883"}`,
            clientId: `node-red-thingsboard-telemetry-${Math.random().toString(16).substring(2, 10)}`,
            username: process.env.DEVICE_ACCESS_TOKEN || "",
            password: process.env.THINGSBOARD_PASSWORD || "",
            qos: 1,
        };

        const mysqlConfig: MySqlConfig = {
            host: process.env.DATABASE_HOST || "localhost",
            port: parseInt(process.env.DATABASE_PORT || "3306", 10),
            user: process.env.DATABASE_USER || "root",
            password: process.env.DATABASE_PASSWORD || "",
            database: process.env.DATABASE_NAME || "your_database",
            connectionLimit: parseInt(process.env.DATABASE_CONNECTION_LIMIT || "10", 10),
        };

        // Ensure polling intervals are safe
        const MIN_POLLING_INTERVAL = 500;
        let pollIntervalCoil = parseInt(config.pollIntervalCoil, 10) || 1000;
        let pollIntervalInput = parseInt(config.pollIntervalInput, 10) || 1000;
        let pollIntervalHolding = parseInt(config.pollIntervalHolding, 10) || 5000;

        if (isNaN(pollIntervalCoil) || pollIntervalCoil < MIN_POLLING_INTERVAL) {
            node.warn(`Invalid coil polling interval: ${config.pollIntervalCoil}. Using minimum value: ${MIN_POLLING_INTERVAL}ms`);
            pollIntervalCoil = MIN_POLLING_INTERVAL;
        }
        if (isNaN(pollIntervalInput) || pollIntervalInput < MIN_POLLING_INTERVAL) {
            node.warn(`Invalid input polling interval: ${config.pollIntervalInput}. Using minimum value: ${MIN_POLLING_INTERVAL}ms`);
            pollIntervalInput = MIN_POLLING_INTERVAL;
        }
        if (isNaN(pollIntervalHolding) || pollIntervalHolding < MIN_POLLING_INTERVAL) {
            node.warn(`Invalid holding polling interval: ${config.pollIntervalHolding}. Using minimum value: ${MIN_POLLING_INTERVAL}ms`);
            pollIntervalHolding = MIN_POLLING_INTERVAL;
        }

        const coilStartAddress = parseInt(config.coilStartAddress, 10) || 0;
        const coilQuantity = parseInt(config.coilQuantity, 10) || 32;
        const inputStartAddress = parseInt(config.inputStartAddress, 10) || 0;
        const inputQuantity = parseInt(config.inputQuantity, 10) || 26;
        const holdingStartAddress = parseInt(config.holdingStartAddress, 10) || 0;
        const holdingQuantity = parseInt(config.holdingQuantity, 10) || 29;

        // FLOW CONTEXT SCALE CONFIG
        const flowContext = this.context().flow as NodeContext;
        const SCALE_CONFIG_KEY = `scaleConfigs_${this.id}`;
        let initialScaleConfigs: ScaleConfig[] = [];
        try {
            initialScaleConfigs = config.scaleConfigs ? JSON.parse(config.scaleConfigs) : [];
            if (!Array.isArray(initialScaleConfigs)) initialScaleConfigs = [];
        } catch {
            initialScaleConfigs = [];
        }
        flowContext.set(SCALE_CONFIG_KEY, initialScaleConfigs);

        // --- Cấu hình enable debug log từ config node (bổ sung trường này vào UI nếu chưa có) ---
        let enableDebugLog: boolean = config.enableDebugLog ?? false;
        enableDebugLog = false
        node.warn(`Debug log is disabled ${config.enableDebugLog}`);
        // --- Cấu hình threshold cho từng key (bổ sung trường này vào UI nếu chưa có) ---
        // Ví dụ: { temp: 1, humidity: 2 }
        const thresholdConfig: { [key: string]: number } = config.thresholdConfig ? JSON.parse(config.thresholdConfig) : {};

        // --- Cấu hình periodic snapshot interval riêng cho từng loại ---
        const periodicSnapshotIntervalCoil: number = parseInt(config.periodicSnapshotIntervalCoil ?? '0', 10);
        const periodicSnapshotIntervalInput: number = parseInt(config.periodicSnapshotIntervalInput ?? '0', 10);
        const periodicSnapshotIntervalHolding: number = parseInt(config.periodicSnapshotIntervalHolding ?? '0', 10);

        // Get clients
        const modbusClient: ModbusClientCore = ClientRegistry.getModbusClient(modbusConfig, node);
        const localClient: MqttClientCore = await ClientRegistry.getLocalMqttClient(localMqttConfig, node);
        const mysqlClient: MySqlClientCore = ClientRegistry.getMySqlClient(mysqlConfig, node);
        const thingsboardClient: MqttClientCore = await ClientRegistry.getThingsboardMqttClient(thingsboardMqttConfig, node);

        if (!modbusClient || !localClient || !mysqlClient || !thingsboardClient) {
            node.error("Failed to retrieve clients from registry");
            node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
            return;
        }

        // Initialize context
        nodeContext.set('previousState', {});
        nodeContext.set('lastSent', 0);
        nodeContext.set('lastEcUpdate', nodeContext.get('lastEcUpdate') || 0);
        nodeContext.set('mainPumpState', nodeContext.get('mainPumpState') || false);

        const CHANGE_THRESHOLD = 0.1;
        const MIN_PUBLISH_INTERVAL = 1000;
        let isPollingPaused = false;
        let isConfigUpdating = false;
        let coilInterval: NodeJS.Timeout | null = null;
        let inputInterval: NodeJS.Timeout | null = null;
        let holdingInterval: NodeJS.Timeout | null = null;

        // Polling flags
        let isPollingCoils = false;
        let isPollingInputs = false;
        let isPollingHoldings = false;

        // Failure counters
        let consecutiveCoilFailures = 0;
        let consecutiveInputFailures = 0;
        let consecutiveHoldingFailures = 0;
        const MAX_CONSECUTIVE_FAILURES = 5;
        const POLLING_BACKOFF_TIME = 30000;

        // Publish cache to prevent duplicates
        const publishCache: { [key: string]: { value: any; timestamp: number } } = {};

        // --- Publish telemetry sử dụng hàm đã test ---
        async function processState(currentState: TelemetryData, source: string) {
            const previousState: TelemetryData = nodeContext.get('previousState') as TelemetryData || {};
            const changedKeys = getChangedKeys(currentState, previousState, thresholdConfig);
            const now = Date.now();
            let lastSent = nodeContext.get('lastSent') as number ?? 0;

            // Chọn interval phù hợp theo loại source
            let periodicSnapshotInterval = 0;
            if (source === 'Coils') periodicSnapshotInterval = periodicSnapshotIntervalCoil;
            else if (source === 'Input Registers') periodicSnapshotInterval = periodicSnapshotIntervalInput;
            else if (source === 'Holding Registers') periodicSnapshotInterval = periodicSnapshotIntervalHolding;

            if (Object.keys(changedKeys).length > 0) {
                publishTelemetry({
                    data: changedKeys,
                    emqxClient: localClient,
                    thingsboardClient: thingsboardClient,
                    emqxTopic: localConfig.pubSubTopic,
                    thingsboardTopic: 'v1/devices/me/telemetry'
                });
                nodeContext.set('lastSent', now);
                debugLog({ enable: enableDebugLog, node, message: `[${source}] Published telemetry (threshold) ${JSON.stringify(thresholdConfig)}: ${JSON.stringify(changedKeys)}` });
            } else if (periodicSnapshotInterval > 0 && now - lastSent >= periodicSnapshotInterval) {
                publishTelemetry({
                    data: currentState,
                    emqxClient: localClient,
                    thingsboardClient: thingsboardClient,
                    emqxTopic: localConfig.pubSubTopic,
                    thingsboardTopic: 'v1/devices/me/telemetry'
                });
                nodeContext.set('lastSent', now);
                debugLog({ enable: enableDebugLog, node, message: `[${source}] Published telemetry (periodic): ${JSON.stringify(currentState)}` });
            } else {
                debugLog({ enable: enableDebugLog, node, message: `[${source}] No telemetry sent (no change, not timer)` });
            }

            Object.assign(previousState, currentState);
            nodeContext.set('previousState', previousState);
            node.send({ payload: currentState });
            node.status({ fill: 'green', shape: 'dot', text: `${source}: Data checked` });
        }

        // --- Apply scaling cho từng key khi đọc modbus ---
        function scaleTelemetry(keys: string[], values: number[], direction: 'read' | 'write', flowContext: NodeContext, scaleConfigKey: string): TelemetryData {
            const result: TelemetryData = {};
            const scaleConfigs: ScaleConfig[] = flowContext.get(scaleConfigKey) as ScaleConfig[] || [];            keys.forEach((key, idx) => {
                result[key] = applyScaling(key, values[idx], direction, scaleConfigs);
            });
            debugLog({ enable: true, node, message: `[Scale] Applied scaling: ${JSON.stringify(result)}, scale config: ${JSON.stringify(scaleConfigs)}` });
            return result;
        }

        async function pollCoils() {
            if (isPollingCoils || isPollingPaused || isConfigUpdating) return;
            if (consecutiveCoilFailures >= MAX_CONSECUTIVE_FAILURES) {
                node.warn(`Coil polling suspended due to ${consecutiveCoilFailures} failures. Retrying in ${POLLING_BACKOFF_TIME / 1000}s`);
                setTimeout(() => {
                    consecutiveCoilFailures = 0;
                    isPollingCoils = false;
                }, POLLING_BACKOFF_TIME);
                return;
            }

            isPollingCoils = true;
            const maxRetries = 3;
            let retryCount = 0;

            try {
                while (retryCount < maxRetries) {
                    try {
                        const result: ModbusData = await modbusClient.readCoils(coilStartAddress, coilQuantity);
                        const currentState: TelemetryData = {};
                        (result.data as boolean[]).forEach((value, index) => {
                            const key = Object.keys(modbusCoils).find((k) => modbusCoils[k] === index + coilStartAddress);
                            if (key) currentState[key] = value;
                            if (key === "main_pump") {
                                nodeContext.set('mainPumpState', value);
                            }
                        });
                        node.context().global.set("coilRegisterData", currentState);
                        await processState(currentState, "Coils");
                        consecutiveCoilFailures = 0;
                        break;
                    } catch (error) {
                        retryCount++;
                        node.error(`Coil polling error (attempt ${retryCount}/${maxRetries}): ${(error as Error).message}`);
                        if (retryCount === maxRetries) {
                            consecutiveCoilFailures++;
                            node.warn(`Consecutive coil failures: ${consecutiveCoilFailures}/${MAX_CONSECUTIVE_FAILURES}`);
                            throw error;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                }
            } catch {
                // Error handled in retry loop
            } finally {
                isPollingCoils = false;
                if (isConfigUpdating) {
                    nodeContext.set('previousState', {});
                    isConfigUpdating = false;
                }
            }
        }

        async function pollInputRegisters() {
            if (isPollingInputs || isPollingPaused || isConfigUpdating) return;
            if (consecutiveInputFailures >= MAX_CONSECUTIVE_FAILURES) {
                node.warn(`Input polling suspended due to ${consecutiveInputFailures} failures. Retrying in ${POLLING_BACKOFF_TIME / 1000}s`);
                setTimeout(() => {
                    consecutiveInputFailures = 0;
                    isPollingInputs = false;
                }, POLLING_BACKOFF_TIME);
                return;
            }

            isPollingInputs = true;
            const maxRetries = 3;
            let retryCount = 0;

            try {
                while (retryCount < maxRetries) {
                    try {
                        const result: ModbusData = await modbusClient.readInputRegisters(inputStartAddress, inputQuantity);
                        const keys = Object.keys(modbusInputRegisters);
                        const values = result.data as number[];
                        const scaleCfg = flowContext.get(SCALE_CONFIG_KEY) || [];
                        debugLog({
                            enable: enableDebugLog,
                            node,
                            message: `[InputRegisters][DEBUG] keys: ${JSON.stringify(keys)}, values: ${JSON.stringify(values)}, scaleConfigs: ${JSON.stringify(scaleCfg)}`
                        });
                        const currentState = scaleTelemetry(keys, values, 'read', flowContext, SCALE_CONFIG_KEY);
                        debugLog({
                            enable: enableDebugLog,
                            node,
                            message: `[InputRegisters][DEBUG] scaled currentState: ${JSON.stringify(currentState)}`
                        });
                        node.context().global.set("inputRegisterData", currentState);
                        await processState(currentState, "Input Registers");
                        consecutiveInputFailures = 0;
                        break;
                    } catch (error) {
                        retryCount++;
                        node.error(`Input polling error (attempt ${retryCount}/${maxRetries}): ${(error as Error).message}`);
                        if (retryCount === maxRetries) {
                            consecutiveInputFailures++;
                            node.warn(`Consecutive input failures: ${consecutiveInputFailures}/${MAX_CONSECUTIVE_FAILURES}`);
                            throw error;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                }
            } catch {
                // Error handled in retry loop
            } finally {
                isPollingInputs = false;
                if (isConfigUpdating) {
                    nodeContext.set('previousState', {});
                    isConfigUpdating = false;
                }
            }
        }

        async function pollHoldingRegisters() {
            if (isPollingHoldings || isPollingPaused || isConfigUpdating) return;
            if (consecutiveHoldingFailures >= MAX_CONSECUTIVE_FAILURES) {
                node.warn(`Holding polling suspended due to ${consecutiveHoldingFailures} failures. Retrying in ${POLLING_BACKOFF_TIME / 1000}s`);
                setTimeout(() => {
                    consecutiveHoldingFailures = 0;
                    isPollingHoldings = false;
                }, POLLING_BACKOFF_TIME);
                return;
            }

            isPollingHoldings = true;
            const maxRetries = 3;
            let retryCount = 0;

            try {
                while (retryCount < maxRetries) {
                    try {
                        const result: ModbusData = await modbusClient.readHoldingRegisters(holdingStartAddress, holdingQuantity);
                        const keys = Object.keys(modbusHoldingRegisters);
                        const values = result.data as number[];
                        const currentState = scaleTelemetry(keys, values, 'read', flowContext, SCALE_CONFIG_KEY);
                        node.context().global.set("holdingRegisterData", currentState);
                        await processState(currentState, "Holding Registers");
                        consecutiveHoldingFailures = 0;
                        break;
                    } catch (error) {
                        retryCount++;
                        node.error(`Holding polling error (attempt ${retryCount}/${maxRetries}): ${(error as Error).message}`);
                        if (retryCount === maxRetries) {
                            consecutiveHoldingFailures++;
                            node.warn(`Consecutive holding failures: ${consecutiveHoldingFailures}/${MAX_CONSECUTIVE_FAILURES}`);
                            throw error;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                }
            } catch {
                // Error handled in retry loop
            } finally {
                isPollingHoldings = false;
                if (isConfigUpdating) {
                    nodeContext.set('previousState', {});
                    isConfigUpdating = false;
                }
            }
        }

        // --- Helper để clear toàn bộ polling interval và reset state ---
        function clearPollingAndState(): void {
            if (coilInterval) clearInterval(coilInterval);
            if (inputInterval) clearInterval(inputInterval);
            if (holdingInterval) clearInterval(holdingInterval);
            coilInterval = null;
            inputInterval = null;
            holdingInterval = null;
            nodeContext.set('previousState', {});
            nodeContext.set('lastSent', 0);
            // Nếu có publishCache hoặc các biến global khác, cũng phải clear
            for (const key in publishCache) delete publishCache[key];
        }

        // Listen for client status changes
        modbusClient.on("modbus-status", (status: { status: string; error?: string }) => {
            if (status.status === "disconnected" && !isPollingPaused) {
                isPollingPaused = true;
                if (coilInterval) clearInterval(coilInterval);
                if (inputInterval) clearInterval(inputInterval);
                if (holdingInterval) clearInterval(holdingInterval);
                coilInterval = null;
                inputInterval = null;
                holdingInterval = null;
                node.warn("Modbus disconnected, polling paused");
                node.status({ fill: "red", shape: "ring", text: "Modbus disconnected" });
            } else if (status.status === "connected" && isPollingPaused) {
                resumePollingIfAllConnected();
            }
        });

        localClient.on("mqtt-status", (status: { status: string; error?: string }) => {
            if (status.status === "disconnected" && !isPollingPaused) {
                isPollingPaused = true;
                if (coilInterval) clearInterval(coilInterval);
                if (inputInterval) clearInterval(inputInterval);
                if (holdingInterval) clearInterval(holdingInterval);
                coilInterval = null;
                inputInterval = null;
                holdingInterval = null;
                node.warn("Local MQTT disconnected, polling paused");
                node.status({ fill: "red", shape: "ring", text: "Local MQTT disconnected" });
            } else if (status.status === "connected" && isPollingPaused) {
                resumePollingIfAllConnected();
            }
        });

        thingsboardClient.on("mqtt-status", (status: { status: string; error?: string }) => {
            if (status.status === "disconnected" && !isPollingPaused) {
                isPollingPaused = true;
                if (coilInterval) clearInterval(coilInterval);
                if (inputInterval) clearInterval(inputInterval);
                if (holdingInterval) clearInterval(holdingInterval);
                coilInterval = null;
                inputInterval = null;
                holdingInterval = null;
                node.warn("ThingsBoard MQTT disconnected, polling paused");
                node.status({ fill: "red", shape: "ring", text: "ThingsBoard MQTT disconnected" });
            } else if (status.status === "connected" && isPollingPaused) {
                resumePollingIfAllConnected();
            }
        });

        function resumePollingIfAllConnected() {
            if (modbusClient.isConnectedCheck() && localClient.isConnected() && thingsboardClient.isConnected()) {
                consecutiveCoilFailures = 0;
                consecutiveInputFailures = 0;
                consecutiveHoldingFailures = 0;
                isPollingCoils = false;
                isPollingInputs = false;
                isPollingHoldings = false;
                isPollingPaused = false;

                if (coilInterval) clearInterval(coilInterval);
                if (inputInterval) clearInterval(inputInterval);
                if (holdingInterval) clearInterval(holdingInterval);

                coilInterval = setInterval(pollCoils, pollIntervalCoil);
                inputInterval = setInterval(pollInputRegisters, pollIntervalInput);
                holdingInterval = setInterval(pollHoldingRegisters, pollIntervalHolding);

                node.status({ fill: "green", shape: "dot", text: "All clients connected, polling resumed" });
            }
        }

        // --- Ép buộc replace scaleConfigs, không bao giờ append ---
        node.on('input', (msg: any) => {
            if (msg.scaleConfigs) {
                try {
                    let newConfigs = Array.isArray(msg.scaleConfigs) ? msg.scaleConfigs : JSON.parse(msg.scaleConfigs);
                    if (!Array.isArray(newConfigs)) newConfigs = [];
                    flowContext.set(SCALE_CONFIG_KEY, newConfigs);
                    debugLog({ enable: true, node, message: '[Config] Scale configs replaced (no append): ' + JSON.stringify(newConfigs) });
                } catch (error) {
                    node.error(`Failed to update scaleConfigs: ${(error as Error).message}`);
                }
                resumePollingIfAllConnected();
            }
        });

        // --- Cleanup triệt để khi node bị xoá ---
        node.on('close', async () => {
            clearPollingAndState();
            flowContext.set(SCALE_CONFIG_KEY, []);
            ClientRegistry.releaseClient('modbus', node);
            ClientRegistry.releaseClient('local', node);
            ClientRegistry.releaseClient('mysql', node);
            await thingsboardClient.disconnect();
            debugLog({ enable: enableDebugLog, node, message: '[Node] Closed and cleaned up.' });
        });

        // Start polling if all clients are connected
        if (modbusClient.isConnectedCheck() && localClient.isConnected() && thingsboardClient.isConnected()) {
            coilInterval = setInterval(pollCoils, pollIntervalCoil);
            inputInterval = setInterval(pollInputRegisters, pollIntervalInput);
            holdingInterval = setInterval(pollHoldingRegisters, pollIntervalHolding);
            node.status({ fill: "green", shape: "dot", text: "Polling started" });
        } else {
            node.status({ fill: "red", shape: "ring", text: "Waiting for all clients to connect" });
            isPollingPaused = true;
        }
    }

    RED.nodes.registerType("viis-telemetry", ViisTelemetryNode);
};