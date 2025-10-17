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

import { Node, NodeAPI, NodeDef } from 'node-red';
import { ErrorNotificationService } from '../../services/error-notification.service';
import { ErrorMappingService } from '../../services/error-mapping.service';
import ClientRegistry from '../../core/client-registry';
import { GlobalContextHelper } from '../../ultils/global-context-helper';

interface ModbusErrorMonitorConfig extends NodeDef {
    name: string;
    deviceType: string;
    pollInterval: number;
    boardId?: string;
    entity: string;
    enableAutoResolve: boolean;
}

module.exports = function (RED: NodeAPI) {
    function ViisModbusErrorMonitorNode(this: Node, config: ModbusErrorMonitorConfig) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize services
        const errorNotificationService = new ErrorNotificationService(node.context());
        const errorMappingService = new ErrorMappingService(node.context());
        const globalHelper = new GlobalContextHelper(node.context());

        // Get Modbus client
        let modbusClient: any = null;
        try {
            if (config.boardId) {
                modbusClient = ClientRegistry.getModbusClientV2(config.boardId, node);
            } else {
                // Use default/first board for single-board setup
                modbusClient = ClientRegistry.getModbusClient({ type: 'TCP' } as any, node);
            }
        } catch (error) {
            node.error(`Failed to initialize Modbus client: ${error}`);
            node.status({ fill: 'red', shape: 'dot', text: 'Modbus connection failed' });
            return;
        }

        let pollInterval: NodeJS.Timeout | null = null;
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
                        let value: any;

                        // Read register based on type
                        if (map.register_type === 'holding') {
                            const result = await modbusClient.readHoldingRegisters(map.address, 1);
                            value = result.data[0];
                        } else if (map.register_type === 'input') {
                            const result = await modbusClient.readInputRegisters(map.address, 1);
                            value = result.data[0];
                        } else if (map.register_type === 'coil') {
                            const result = await modbusClient.readCoils(map.address, 1);
                            value = result.data[0];
                        }

                        // Check if error exists
                        const hasError = (map.register_type === 'coil') ? value === true : value !== 0;

                        if (hasError) {
                            // Create notification for error
                            const notification = await errorNotificationService.createFromModbus(
                                {
                                    register_type: map.register_type,
                                    address: map.address,
                                    value
                                },
                                config.deviceType,
                                config.entity || node.id
                            );

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
                        } else if (config.enableAutoResolve) {
                            // Auto-resolve if error cleared
                            const resolved = await errorNotificationService.autoResolveIfClear(
                                {
                                    register_type: map.register_type,
                                    address: map.address,
                                    value
                                },
                                config.deviceType,
                                config.entity || node.id
                            );

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
                    } catch (error) {
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
                } else if (resolvedCount > 0) {
                    node.status({
                        fill: 'green',
                        shape: 'dot',
                        text: `${resolvedCount} error(s) resolved`
                    });
                } else {
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: 'No errors'
                    });
                }
            } catch (error) {
                node.error(`Polling error: ${error}`);
                node.status({ fill: 'red', shape: 'ring', text: 'Polling failed' });
            } finally {
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
        node.on('input', async (msg: any) => {
            if (msg.payload === 'poll' || msg.topic === 'poll') {
                await pollErrors();
            } else if (msg.payload === 'start' || msg.topic === 'start') {
                stopPolling();
                startPolling();
            } else if (msg.payload === 'stop' || msg.topic === 'stop') {
                stopPolling();
            }
        });

        // Cleanup on close
        node.on('close', (done: () => void) => {
            stopPolling();
            done();
        });

        // Start monitoring
        startPolling();

        node.log(`Modbus Error Monitor initialized for device type: ${config.deviceType}`);
    }

    RED.nodes.registerType('viis-modbus-error-monitor', ViisModbusErrorMonitorNode);
};
