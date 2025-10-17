"use strict";
/**
 * @fileoverview VIIS Modbus Error Monitor Node
 * Monitors Modbus registers/coils for errors and automatically creates notifications
 *
 * Features:
 * - Periodic polling of Modbus error registers
 * - Automatic notification creation via ErrorNotificationService
 * - Auto-resolve when errors clear
 * - Multi-board support
 * - Configurable poll interval
 *
 * @author VIIS Team
 * @version 1.0.0
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const error_notification_service_1 = require("../../services/error-notification.service");
const error_mapping_service_1 = require("../../services/error-mapping.service");
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
module.exports = function (RED) {
    function ViisModbusErrorMonitorNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Initialize services
        const errorNotificationService = new error_notification_service_1.ErrorNotificationService(node.context());
        const errorMappingService = new error_mapping_service_1.ErrorMappingService(node.context());
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        // Get Modbus client
        let modbusClient = null;
        try {
            if (config.boardId) {
                modbusClient = client_registry_1.default.getModbusClientV2(config.boardId, node);
            }
            else {
                // Use default/first board for single-board setup
                modbusClient = client_registry_1.default.getModbusClient({ type: 'TCP' }, node);
            }
        }
        catch (error) {
            node.error(`Failed to initialize Modbus client: ${error}`);
            node.status({ fill: 'red', shape: 'dot', text: 'Modbus connection failed' });
            return;
        }
        let pollInterval = null;
        let isPolling = false;
        /**
         * Poll Modbus registers for errors
         */
        const pollErrors = async () => {
            if (isPolling) {
                return; // Prevent overlapping polls
            }
            isPolling = true;
            node.status({ fill: 'blue', shape: 'dot', text: 'Polling...' });
            try {
                // Get error code mapping for this device type
                const mapping = errorMappingService.getMappingForDeviceType(config.deviceType);
                if (!mapping) {
                    node.warn(`No error mapping found for device type: ${config.deviceType}`);
                    node.status({ fill: 'yellow', shape: 'ring', text: 'No mapping found' });
                    return;
                }
                let errorCount = 0;
                let resolvedCount = 0;
                // Poll each register in the mapping
                for (const map of mapping.mappings) {
                    try {
                        let value;
                        // Read register based on type
                        if (map.register_type === 'holding') {
                            const result = await modbusClient.readHoldingRegisters(map.address, 1);
                            value = result.data[0];
                        }
                        else if (map.register_type === 'input') {
                            const result = await modbusClient.readInputRegisters(map.address, 1);
                            value = result.data[0];
                        }
                        else if (map.register_type === 'coil') {
                            const result = await modbusClient.readCoils(map.address, 1);
                            value = result.data[0];
                        }
                        // Check if error exists
                        const hasError = (map.register_type === 'coil') ? value === true : value !== 0;
                        if (hasError) {
                            // Create notification for error
                            const notification = await errorNotificationService.createFromModbus({
                                register_type: map.register_type,
                                address: map.address,
                                value
                            }, config.deviceType, config.entity || node.id);
                            if (notification) {
                                errorCount++;
                                node.send([{
                                        payload: {
                                            action: 'error_detected',
                                            notification,
                                            register: map.address,
                                            value
                                        },
                                        topic: 'error'
                                    }, null]);
                            }
                        }
                        else if (config.enableAutoResolve) {
                            // Auto-resolve if error cleared
                            const resolved = await errorNotificationService.autoResolveIfClear({
                                register_type: map.register_type,
                                address: map.address,
                                value
                            }, config.deviceType, config.entity || node.id);
                            if (resolved) {
                                resolvedCount++;
                                node.send([null, {
                                        payload: {
                                            action: 'error_resolved',
                                            register: map.address,
                                            deviceType: config.deviceType
                                        },
                                        topic: 'resolved'
                                    }]);
                            }
                        }
                    }
                    catch (error) {
                        node.warn(`Failed to read register ${map.address}: ${error}`);
                    }
                }
                // Update status
                if (errorCount > 0) {
                    node.status({
                        fill: 'red',
                        shape: 'dot',
                        text: `${errorCount} error(s) detected`
                    });
                }
                else if (resolvedCount > 0) {
                    node.status({
                        fill: 'green',
                        shape: 'dot',
                        text: `${resolvedCount} error(s) resolved`
                    });
                }
                else {
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: 'No errors'
                    });
                }
            }
            catch (error) {
                node.error(`Polling error: ${error}`);
                node.status({ fill: 'red', shape: 'ring', text: 'Polling failed' });
            }
            finally {
                isPolling = false;
            }
        };
        // Start polling
        const startPolling = () => {
            if (!modbusClient) {
                node.error('Modbus client not initialized');
                return;
            }
            const interval = config.pollInterval || 5000;
            node.log(`Starting error monitoring with ${interval}ms interval`);
            // Initial poll
            pollErrors();
            // Setup interval
            pollInterval = setInterval(pollErrors, interval);
        };
        // Stop polling
        const stopPolling = () => {
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
                node.status({ fill: 'grey', shape: 'ring', text: 'Stopped' });
            }
        };
        // Handle input messages (for manual trigger)
        node.on('input', async (msg) => {
            if (msg.payload === 'poll' || msg.topic === 'poll') {
                await pollErrors();
            }
            else if (msg.payload === 'start' || msg.topic === 'start') {
                stopPolling();
                startPolling();
            }
            else if (msg.payload === 'stop' || msg.topic === 'stop') {
                stopPolling();
            }
        });
        // Cleanup on close
        node.on('close', (done) => {
            stopPolling();
            done();
        });
        // Start monitoring
        startPolling();
        node.log(`Modbus Error Monitor initialized for device type: ${config.deviceType}`);
    }
    RED.nodes.registerType('viis-modbus-error-monitor', ViisModbusErrorMonitorNode);
};
