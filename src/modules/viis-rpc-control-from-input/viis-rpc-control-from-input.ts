import { NodeAPI, NodeDef, Node } from "node-red";
import ClientRegistry from "../../core/client-registry";
import { ModbusData } from "../../core/modbus-client";

interface ViisRpcControlFromInputNodeDef extends NodeDef {
    configKeys: string;
    scaleConfigs: string;
}

interface ScaleConfig {
    key: string;
    operation: "multiply" | "divide";
    factor: number;
    direction: "read" | "write";
}

interface ConfigKey {
    [key: string]: "number" | "boolean" | "string";
}

interface ConfigKeyValues {
    [key: string]: number | boolean | string;
}

interface RpcMessage {
    method?: string;
    params?: Record<string, any>;
    [key: string]: any;
}

interface ModbusMappingResult {
    address: number;
    fc: number;
    value: number | boolean;
}

module.exports = function (RED: NodeAPI) {
    function ViisRpcControlFromInputNode(config: ViisRpcControlFromInputNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Log when node is initialized
        node.warn("VIIS RPC Control From Input Node initialized");
        console.log("VIIS RPC Control From Input Node initialized");
        
        // Flow context cho config
        const flowContext = node.context().flow;
        const SCALE_CONFIG_KEY = `scaleConfigs_${node.id}`;
        const CONFIG_KEYS_KEY = `configKeys_${node.id}`;
        const CONFIG_VALUES_KEY = `configKeyValues_${node.id}`;
        const MANUAL_OVERRIDES_KEY = `manualModbusOverrides_${node.id}`;
        
        // Parse configurations
        let configKeys: ConfigKey = {};
        let scaleConfigs: ScaleConfig[] = [];
        try {
            configKeys = config.configKeys ? JSON.parse(config.configKeys) : {};
            if (typeof configKeys !== 'object' || Array.isArray(configKeys) || configKeys === null) configKeys = {};
        } catch {
            configKeys = {};
        }
        try {
            scaleConfigs = config.scaleConfigs ? JSON.parse(config.scaleConfigs) : [];
            if (!Array.isArray(scaleConfigs)) scaleConfigs = [];
        } catch {
            scaleConfigs = [];
        }
        
        // Validate và lưu vào flow context
        flowContext.set(CONFIG_KEYS_KEY, configKeys);
        flowContext.set(SCALE_CONFIG_KEY, scaleConfigs);
        if (!flowContext.get(CONFIG_VALUES_KEY)) flowContext.set(CONFIG_VALUES_KEY, {});
        if (!flowContext.get(MANUAL_OVERRIDES_KEY)) flowContext.set(MANUAL_OVERRIDES_KEY, {});
        
        // Helper functions
        function getConfigKeys(): ConfigKey {
            return flowContext.get(CONFIG_KEYS_KEY) as ConfigKey || {};
        }
        
        function getScaleConfigs(): ScaleConfig[] {
            return flowContext.get(SCALE_CONFIG_KEY) as ScaleConfig[] || [];
        }
        
        function getConfigKeyValues(): ConfigKeyValues {
            return flowContext.get(CONFIG_VALUES_KEY) as ConfigKeyValues || {};
        }
        
        function setConfigKeyValues(values: ConfigKeyValues): void {
            flowContext.set(CONFIG_VALUES_KEY, values);
        }
        
        // Environment variables
        const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}");
        const modbusInputRegisters = JSON.parse(process.env.MODBUS_INPUT_REGISTERS || "{}");
        const modbusHoldingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");
        
        // Initialize modbus client
        const modbusConfig = {
            type: (process.env.MODBUS_TYPE as "TCP" | "RTU") || "TCP",
            host: process.env.MODBUS_HOST || "localhost",
            tcpPort: parseInt(process.env.MODBUS_TCP_PORT || "502", 10),
            serialPort: process.env.MODBUS_SERIAL_PORT || "/dev/ttyUSB0",
            baudRate: parseInt(process.env.MODBUS_BAUD_RATE || "9600", 10),
            parity: (process.env.MODBUS_PARITY as "none" | "even" | "odd") || "none",
            unitId: parseInt(process.env.MODBUS_UNIT_ID || "1", 10),
            timeout: parseInt(process.env.MODBUS_TIMEOUT || "5000", 10),
            reconnectInterval: parseInt(process.env.MODBUS_RECONNECT_INTERVAL || "5000", 10),
        };
        
        const modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);
        
        if (!modbusClient) {
            node.error("Failed to initialize modbus client");
            node.status({ fill: "red", shape: "ring", text: "Modbus client initialization failed" });
            return;
        }
        
        // Utility functions
        function scaleValue(key: string, value: number, direction: "read" | "write"): number {
            const config = getScaleConfigs().find((c) => c.key === key && c.direction === direction);
            if (!config) return value;
            const shouldMultiply = config.operation === "multiply";
            const scaledValue = shouldMultiply ? value * config.factor : value / config.factor;
            return scaledValue;
        }
        
        function validateAndConvertValue(key: string, value: any): any {
            const expectedType = getConfigKeys()[key];
            if (!expectedType) return value;
            try {
                switch (expectedType) {
                    case "number":
                        const num = Number(value);
                        if (isNaN(num)) throw new Error(`Invalid number value for ${key}`);
                        return num;
                    case "boolean":
                        if (typeof value === "string") return value.toLowerCase() === "true";
                        return Boolean(value);
                    case "string":
                        return String(value);
                    default:
                        return value;
                }
            } catch (error) {
                throw new Error(`Value conversion failed for ${key}: ${(error as Error).message}`);
            }
        }
        
        function findModbusMapping(key: string): ModbusMappingResult | null {
            if (modbusHoldingRegisters[key] !== undefined) {
                return { address: modbusHoldingRegisters[key], fc: 6, value: 0 };
            }
            if (modbusCoils[key] !== undefined) {
                return { address: modbusCoils[key], fc: 5, value: false };
            }
            if (modbusInputRegisters[key] !== undefined) {
                return { address: modbusInputRegisters[key], fc: 4, value: 0 };
            }
            return null;
        }
        
        async function writeToModbus(key: string, mapping: ModbusMappingResult, value: number | boolean): Promise<void> {
            try {
                let writeValue = value;
                if (typeof value === "number") {
                    writeValue = scaleValue(key, value, "write");
                }
                if (mapping.fc === 6) {
                    await modbusClient.writeRegister(mapping.address, writeValue as number);
                    node.log(`Wrote to modbus register: address=${mapping.address}, value=${writeValue}`);
                } else if (mapping.fc === 5) {
                    await modbusClient.writeCoil(mapping.address, value as boolean);
                    node.log(`Wrote to modbus coil: address=${mapping.address}, value=${writeValue}`);
                }
                
                // Lưu thông tin lệnh thủ công
                const manualOverrides = flowContext.get(MANUAL_OVERRIDES_KEY) as { [address: string]: { fc: number, value: any, timestamp: number } } || {};
                manualOverrides[`${mapping.address}-${mapping.fc}`] = {
                    fc: mapping.fc,
                    value: writeValue,
                    timestamp: Date.now()
                };
                flowContext.set(MANUAL_OVERRIDES_KEY, manualOverrides);
            } catch (error) {
                throw new Error(`Modbus write failed for ${key}: ${(error as Error).message}`);
            }
        }
        
        async function readFromModbus(key: string, mapping: ModbusMappingResult): Promise<number | boolean> {
            try {
                const readFc = mapping.fc === 6 ? 3 : mapping.fc === 5 ? 1 : 4;
                let result: ModbusData;

                if (readFc === 1) {
                    result = await modbusClient.readCoils(mapping.address, 1);
                } else if (readFc === 3) {
                    result = await modbusClient.readHoldingRegisters(mapping.address, 1);
                } else {
                    result = await modbusClient.readInputRegisters(mapping.address, 1);
                }

                let readValue = result.data[0];
                if (typeof readValue === "number") {
                    readValue = scaleValue(key, readValue, "read");
                }
                return readValue;
            } catch (error) {
                throw new Error(`Modbus read failed for ${key}: ${(error as Error).message}`);
            }
        }
        
        async function handleRpcRequest(rpcBody: RpcMessage): Promise<void> {
            try {
                if (rpcBody.method === "set_state" && rpcBody.params) {
                    for (const [key, rawValue] of Object.entries(rpcBody.params)) {
                        const mapping = findModbusMapping(key);
                        if (mapping) {
                            const value = validateAndConvertValue(key, rawValue);
                            node.warn(`Writing to modbus: key=${key}, value=${value}`);
                            await writeToModbus(key, mapping, value);
                            const readValue = await readFromModbus(key, mapping);
                            
                            // Tạo payload để send đi
                            const resultPayload = {
                                ts: Date.now(),
                                [key]: readValue,
                            };
                            node.send({ payload: resultPayload });
                            node.status({ fill: "green", shape: "dot", text: `Set: ${key}=${readValue}` });
                        } else {
                            const value = validateAndConvertValue(key, rawValue);
                            const currentConfig = getConfigKeyValues();
                            currentConfig[key] = value;
                            setConfigKeyValues(currentConfig);

                            const resultPayload = {
                                ts: Date.now(),
                                [key]: value,
                                note: "Config key updated (no Modbus mapping)",
                            };
                            node.send({ payload: resultPayload });
                            node.status({ fill: "yellow", shape: "dot", text: `Config key: ${key}=${value}` });
                        }
                    }
                } else {
                    node.warn(`Unsupported RPC method: ${rpcBody.method}`);
                    node.status({ fill: "yellow", shape: "ring", text: "Unsupported method" });
                }
            } catch (error) {
                node.error(`RPC handling error: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "RPC error" });
            }
        }
        
        // Handle input messages
        node.on('input', function (msg) {
            // Log receipt of message
            node.warn("VIIS-RPC-CONTROL-INPUT: INPUT RECEIVED");
            console.log("VIIS-RPC-CONTROL-INPUT: INPUT RECEIVED");
            node.warn(`Input msg: ${JSON.stringify(msg)}`);
            
            // Set node status
            node.status({ fill: "blue", shape: "dot", text: "Processing input" });
            
            // Xử lý dynamic config updates nếu có
            if (msg.scaleConfigs) {
                try {
                    let newConfigs = Array.isArray(msg.scaleConfigs) ? msg.scaleConfigs : JSON.parse(msg.scaleConfigs);
                    if (!Array.isArray(newConfigs)) newConfigs = [];
                    flowContext.set(SCALE_CONFIG_KEY, newConfigs);
                    node.warn(`[Config] scaleConfigs updated: ${JSON.stringify(newConfigs)}`);
                } catch (error) {
                    node.error(`Failed to update scaleConfigs: ${(error as Error).message}`);
                }
            }
            
            if (msg.configKeys) {
                try {
                    let newKeys = typeof msg.configKeys === 'object' ? msg.configKeys : JSON.parse(msg.configKeys);
                    if (typeof newKeys !== 'object' || Array.isArray(newKeys) || newKeys === null) newKeys = {};
                    flowContext.set(CONFIG_KEYS_KEY, newKeys);
                    node.warn(`[Config] configKeys updated: ${JSON.stringify(newKeys)}`);
                } catch (error) {
                    node.error(`Failed to update configKeys: ${(error as Error).message}`);
                }
            }
            
            // Xử lý RPC command từ input
            const rpcBody: RpcMessage = {};
            
            if (msg.payload && typeof msg.payload === 'object' && msg.payload.method === 'set_state') {
                // Format: { payload: { method: "set_state", params: { key: value } } }
                rpcBody.method = msg.payload.method;
                rpcBody.params = msg.payload.params;
                node.warn(`Processing RPC from payload: ${JSON.stringify(rpcBody)}`);
            } else if (typeof msg.method === 'string' && msg.method === 'set_state' && msg.params) {
                // Format: { method: "set_state", params: { key: value } }
                rpcBody.method = msg.method;
                rpcBody.params = msg.params;
                node.warn(`Processing RPC from direct properties: ${JSON.stringify(rpcBody)}`);
            } else if (typeof msg.payload === 'object') {
                // Format: { payload: { key: value } } -> convert to set_state format
                rpcBody.method = 'set_state';
                rpcBody.params = msg.payload;
                node.warn(`Converting payload to RPC format: ${JSON.stringify(rpcBody)}`);
            } else {
                node.warn('Invalid input format. Expected RPC command format or direct values.');
                node.status({ fill: "red", shape: "ring", text: "Invalid format" });
                return;
            }
            
            if (rpcBody.method && rpcBody.params) {
                // Process the RPC command
                handleRpcRequest(rpcBody);
            }
        });

        // Cleanup on close
        node.on('close', function () {
            try {
                flowContext.set(SCALE_CONFIG_KEY, []);
                flowContext.set(CONFIG_KEYS_KEY, {});
                flowContext.set(CONFIG_VALUES_KEY, {});
                flowContext.set(MANUAL_OVERRIDES_KEY, {});
                ClientRegistry.releaseClient("modbus", node);
                node.warn("VIIS RPC Control Input Node closed and context cleaned");
            } catch (error) {
                node.error(`Close error: ${(error as Error).message}`);
            }
        });
    }

    RED.nodes.registerType("viis-rpc-control-from-input", ViisRpcControlFromInputNode);
};
