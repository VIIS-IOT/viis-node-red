"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const global_context_helper_1 = require("../../ultils/global-context-helper");
module.exports = function (RED) {
    function ViisConfigLoaderNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        (async () => {
            try {
                node.status({ fill: "yellow", shape: "ring", text: "Loading config..." });
                // Get configs from global context (loaded by env-loader from device1.json)
                // Note: env-loader stores as JSON strings, need to parse
                let pollingConfigRaw = node.context().global.get('modbus_poll_groups') ||
                    node.context().global.get('modbusPollGroups');
                let modbusThresholdsRaw = node.context().global.get('modbus_publish_thresholds') ||
                    node.context().global.get('modbusPublishThresholds');
                // Parse JSON strings if needed
                let pollingConfig;
                let modbusThresholds;
                if (typeof pollingConfigRaw === 'string') {
                    try {
                        pollingConfig = JSON.parse(pollingConfigRaw);
                    }
                    catch (e) {
                        node.error(`Failed to parse pollingConfig JSON: ${e.message}`);
                        node.status({ fill: "red", shape: "ring", text: "Invalid pollingConfig JSON" });
                        return;
                    }
                }
                else {
                    pollingConfig = pollingConfigRaw;
                }
                if (typeof modbusThresholdsRaw === 'string') {
                    try {
                        modbusThresholds = JSON.parse(modbusThresholdsRaw);
                    }
                    catch (e) {
                        node.error(`Failed to parse modbusThresholds JSON: ${e.message}`);
                        node.status({ fill: "red", shape: "ring", text: "Invalid thresholds JSON" });
                        return;
                    }
                }
                else {
                    modbusThresholds = modbusThresholdsRaw;
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
                const coilsMap = node.context().global.get("modbus_board1_coils") || {};
                const holdingMap = node.context().global.get("modbus_board1_holding_registers") || {};
                // Validate and collect warnings
                const warnings = [];
                // Helper: Check if address is valid (not placeholder 999)
                const isValidAddress = (addr) => {
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
                            }
                            else if (!isValidAddress(addr)) {
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
                            }
                            else if (!isValidAddress(addr)) {
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
                }
                else {
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `✅ ${groupCount} groups, ${thresholdCount} thresholds (full coverage)`
                    });
                    node.log(`Config loaded successfully: ${groupCount} poll groups, ${thresholdCount} thresholds (full coverage)`);
                }
            }
            catch (error) {
                const errorMsg = `Config loader error: ${error.message}`;
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
