/**
 * VIIS Config Loader Node
 * Auto-loads polling config and thresholds from global context (loaded by env-loader from device1.json)
 * 
 * Usage: Just drag this node into your flow, deploy, and it will automatically:
 * 1. Load modbusPollGroups from global context
 * 2. Load modbusPublishThresholds from global context
 * 3. Validate coverage (all keys in poll groups have thresholds)
 * 4. Save to pollingConfig and modbusThresholds for flow nodes to use
 */

import { NodeAPI, Node } from "node-red";
import { GlobalContextHelper } from "../../ultils/global-context-helper";

interface PollGroup {
    interval: number;
    coils?: string[];
    holding?: string[];
}

interface PollingConfig {
    [groupName: string]: PollGroup;
}

interface Thresholds {
    [key: string]: number;
}

module.exports = function (RED: NodeAPI) {
    function ViisConfigLoaderNode(this: Node, config: any) {
        RED.nodes.createNode(this, config);
        const node = this;

        const globalHelper = new GlobalContextHelper(node.context());

        (async () => {
            try {
                node.status({ fill: "yellow", shape: "ring", text: "Loading config..." });

                // Get configs from global context (loaded by env-loader from device1.json)
                // Note: env-loader stores as JSON strings, need to parse
                let pollingConfigRaw: any = 
                    node.context().global.get('modbus_poll_groups') || 
                    node.context().global.get('modbusPollGroups');
                
                let modbusThresholdsRaw: any = 
                    node.context().global.get('modbus_publish_thresholds') ||
                    node.context().global.get('modbusPublishThresholds');

                // Parse JSON strings if needed
                let pollingConfig: PollingConfig;
                let modbusThresholds: Thresholds;

                if (typeof pollingConfigRaw === 'string') {
                    try {
                        pollingConfig = JSON.parse(pollingConfigRaw);
                    } catch (e) {
                        node.error(`Failed to parse pollingConfig JSON: ${(e as Error).message}`);
                        node.status({ fill: "red", shape: "ring", text: "Invalid pollingConfig JSON" });
                        return;
                    }
                } else {
                    pollingConfig = pollingConfigRaw as PollingConfig;
                }

                if (typeof modbusThresholdsRaw === 'string') {
                    try {
                        modbusThresholds = JSON.parse(modbusThresholdsRaw);
                    } catch (e) {
                        node.error(`Failed to parse modbusThresholds JSON: ${(e as Error).message}`);
                        node.status({ fill: "red", shape: "ring", text: "Invalid thresholds JSON" });
                        return;
                    }
                } else {
                    modbusThresholds = modbusThresholdsRaw as Thresholds;
                }

                // Validate presence
                if (!pollingConfig) {
                    const errorMsg = "❌ Missing modbusPollGroups in device1.json";
                    node.error(errorMsg);
                    node.status({ fill: "red", shape: "ring", text: "Missing modbusPollGroups" });
                    return;
                }

                if (!modbusThresholds) {
                    const errorMsg = "❌ Missing modbusPublishThresholds in device1.json";
                    node.error(errorMsg);
                    node.status({ fill: "red", shape: "ring", text: "Missing modbusPublishThresholds" });
                    return;
                }

                // Save to global context for flow nodes to use
                node.context().global.set("pollingConfig", pollingConfig);
                node.context().global.set("modbusThresholds", modbusThresholds);

                // Get mappings for validation
                const coilsMap: Record<string, number> = node.context().global.get("modbus_board1_coils") as Record<string, number> || {};
                const holdingMap: Record<string, number> = node.context().global.get("modbus_board1_holding_registers") as Record<string, number> || {};
                
                // Validate and collect warnings
                const warnings: string[] = [];
                
                // Helper: Check if address is valid (not placeholder 999)
                const isValidAddress = (addr: number | undefined): boolean => {
                    return addr !== undefined && addr !== null && addr !== 999;
                };

                // Validate polling config keys
                for (const [groupName, groupConfig] of Object.entries(pollingConfig)) {
                    // Validate coils
                    if (groupConfig.coils) {
                        for (const coilKey of groupConfig.coils) {
                            const addr = coilsMap[coilKey];
                            if (addr === undefined) {
                                warnings.push(`[POLLING] Group "${groupName}": coil "${coilKey}" NOT FOUND in modbus_board1_coils`);
                            } else if (!isValidAddress(addr)) {
                                warnings.push(`[POLLING] Group "${groupName}": coil "${coilKey}" uses placeholder address 999 (unused)`);
                            }
                            
                            if (!(coilKey in modbusThresholds)) {
                                warnings.push(`[THRESHOLD] Missing threshold for coil "${coilKey}"`);
                            }
                        }
                    }

                    // Validate holding registers
                    if (groupConfig.holding) {
                        for (const holdingKey of groupConfig.holding) {
                            const addr = holdingMap[holdingKey];
                            if (addr === undefined) {
                                warnings.push(`[POLLING] Group "${groupName}": holding "${holdingKey}" NOT FOUND in modbus_board1_holding_registers`);
                            } else if (!isValidAddress(addr)) {
                                warnings.push(`[POLLING] Group "${groupName}": holding "${holdingKey}" uses placeholder address 999 (unused)`);
                            }
                            
                            if (!(holdingKey in modbusThresholds)) {
                                warnings.push(`[THRESHOLD] Missing threshold for holding "${holdingKey}"`);
                            }
                        }
                    }
                }

                // Validate full coverage (only warn for keys that are actually used)
                for (const [key, addr] of Object.entries(coilsMap)) {
                    if (isValidAddress(addr) && !(key in modbusThresholds)) {
                        warnings.push(`[COVERAGE] Coil "${key}" (addr ${addr}) has NO threshold defined`);
                    }
                }

                for (const [key, addr] of Object.entries(holdingMap)) {
                    if (isValidAddress(addr) && !(key in modbusThresholds)) {
                        warnings.push(`[COVERAGE] Holding "${key}" (addr ${addr}) has NO threshold defined`);
                    }
                }

                // Display status
                const groupCount = Object.keys(pollingConfig).length;
                const thresholdCount = Object.keys(modbusThresholds).length;

                if (warnings.length > 0) {
                    warnings.forEach(w => node.warn(w));
                    node.status({ 
                        fill: "yellow", 
                        shape: "ring", 
                        text: `✅ ${groupCount} groups, ${thresholdCount} thresholds | ⚠️ ${warnings.length} warnings` 
                    });
                    node.log(`Config loaded with ${warnings.length} warnings: ${groupCount} poll groups, ${thresholdCount} thresholds`);
                } else {
                    node.status({ 
                        fill: "green", 
                        shape: "dot", 
                        text: `✅ ${groupCount} groups, ${thresholdCount} thresholds (full coverage)` 
                    });
                    node.log(`Config loaded successfully: ${groupCount} poll groups, ${thresholdCount} thresholds (full coverage)`);
                }

            } catch (error) {
                const errorMsg = `Config loader error: ${(error as Error).message}`;
                node.error(errorMsg);
                node.status({ fill: "red", shape: "ring", text: "Error loading config" });
            }
        })();

        // Cleanup on node close
        node.on("close", () => {
            node.status({});
        });
    }

    RED.nodes.registerType("viis-config-loader", ViisConfigLoaderNode);
};
