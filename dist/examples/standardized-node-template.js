"use strict";
/**
 * Standardized Node Template using GlobalContextHelper
 * This template shows how to properly use GlobalContextHelper for environment variables
 * in TypeScript Node-RED custom nodes
 *
 * @author VIIS Team
 * @version 1.0.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
const configs_1 = require("../configs");
const global_context_helper_1 = require("../ultils/global-context-helper");
const dataSource_1 = require("../orm/dataSource");
module.exports = function (RED) {
    function StandardizedNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // ===== Method 1: Using createConfig with node context (RECOMMENDED) =====
        // This method automatically uses GlobalContextHelper with fallback to process.env
        const getConfigUsingFactory = () => {
            const appConfig = (0, configs_1.createConfig)(node.context());
            // All environment variables are now accessible as properties
            node.log(`Device ID: ${appConfig.deviceId}`);
            node.log(`Backend URL: ${appConfig.serverUrl}`);
            node.log(`Device Label: ${appConfig.deviceLabel}`);
            return appConfig;
        };
        // ===== Method 2: Direct GlobalContextHelper usage (for custom variables) =====
        const getConfigUsingHelper = () => {
            const helper = new global_context_helper_1.GlobalContextHelper(node.context());
            // Get individual variables
            const deviceId = helper.getEnvVar('DEVICE_ID');
            const deviceToken = helper.getEnvVar('DEVICE_ACCESS_TOKEN');
            // Get numeric variables
            const modbusTimeout = helper.getNumericEnvVar('MODBUS_TIMEOUT', 5000);
            const modbusPort = helper.getNumericEnvVar('MODBUS_TCP_PORT', 502);
            // Get boolean variables
            const isDebugMode = helper.getBooleanEnvVar('DEBUG_MODE', false);
            // Get JSON variables (Modbus mappings)
            const modbusHolding = helper.getJsonEnvVar('MODBUS_HOLDING_REGISTERS', {});
            const modbusInput = helper.getJsonEnvVar('MODBUS_INPUT_REGISTERS', {});
            return {
                deviceId,
                deviceToken,
                modbusTimeout,
                modbusPort,
                isDebugMode,
                modbusHolding,
                modbusInput
            };
        };
        // ===== Method 3: Using DataSource with context =====
        const initializeDatabase = async () => {
            try {
                // Create DataSource with node context for proper env access
                const dataSource = (0, dataSource_1.createDataSource)(node.context());
                if (!dataSource.isInitialized) {
                    await dataSource.initialize();
                    node.log("Database connected successfully");
                }
                return dataSource;
            }
            catch (error) {
                node.error(`Database connection failed: ${error.message}`);
                return null;
            }
        };
        // ===== Initialize node with configuration =====
        let nodeConfig = null;
        let dataSource = null;
        const initialize = async () => {
            try {
                // Load configuration using Method 1 (RECOMMENDED)
                nodeConfig = getConfigUsingFactory();
                // Initialize database if needed
                dataSource = await initializeDatabase();
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `Device: ${nodeConfig.deviceLabel || nodeConfig.deviceId}`
                });
            }
            catch (error) {
                node.error(`Failed to initialize: ${error.message}`);
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: "Init Error"
                });
            }
        };
        // Initialize on node creation
        initialize();
        // ===== Handle incoming messages =====
        node.on('input', async function (msg) {
            try {
                // Access configuration
                if (!nodeConfig) {
                    node.error("Configuration not loaded");
                    return;
                }
                // Example: Use configuration in message processing
                msg.deviceInfo = {
                    id: nodeConfig.deviceId,
                    label: nodeConfig.deviceLabel,
                    serial: nodeConfig.deviceSerial
                };
                // Example: Access database if needed
                if (dataSource && dataSource.isInitialized) {
                    // Perform database operations
                    // const repository = dataSource.getRepository(SomeEntity);
                    // const data = await repository.find();
                }
                // Send processed message
                node.send(msg);
            }
            catch (error) {
                node.error(`Error processing message: ${error.message}`, msg);
            }
        });
        // ===== Cleanup on node removal =====
        node.on('close', async function (done) {
            try {
                // Close database connection if exists
                if (dataSource && dataSource.isInitialized) {
                    await dataSource.destroy();
                    node.log("Database connection closed");
                }
                // Clear configuration
                nodeConfig = null;
                dataSource = null;
                done();
            }
            catch (error) {
                node.error(`Error during cleanup: ${error.message}`);
                done();
            }
        });
    }
    RED.nodes.registerType("standardized-node", StandardizedNode);
};
/**
 * MIGRATION GUIDE FROM OLD TO NEW APPROACH:
 *
 * OLD WAY (Direct process.env access):
 * ```typescript
 * const deviceId = process.env.DEVICE_ID;
 * const dbHost = process.env.DATABASE_HOST || 'localhost';
 * const modbusRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || '{}');
 * ```
 *
 * NEW WAY (Using createConfig):
 * ```typescript
 * const config = createConfig(node.context());
 * const deviceId = config.deviceId;
 * // Database config is handled internally by createDataSource
 * // Modbus mappings can be accessed via helper
 * ```
 *
 * NEW WAY (Using GlobalContextHelper directly):
 * ```typescript
 * const helper = new GlobalContextHelper(node.context());
 * const deviceId = helper.getEnvVar('DEVICE_ID');
 * const dbHost = helper.getEnvVar('DB_HOST', 'viis-local-mysql');
 * const modbusRegisters = helper.getJsonEnvVar('MODBUS_HOLDING_REGISTERS', {});
 * ```
 *
 * Benefits of the new approach:
 * 1. Hot reload support - no container restart needed
 * 2. Single source of truth - env files
 * 3. Global context sharing between nodes
 * 4. Fallback to process.env for backward compatibility
 * 5. Type safety with TypeScript
 */
