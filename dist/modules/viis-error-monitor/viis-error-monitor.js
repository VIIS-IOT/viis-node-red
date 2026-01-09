"use strict";
/**
 * @fileoverview VIIS Error Monitor Node
 * Monitors Modbus data (holding registers, input registers, coils) for errors
 * and creates/resolves notifications automatically based on error code mappings.
 *
 * Features:
 * - Auto-detect errors from Modbus data arrays
 * - Support holding registers, input registers, and coils
 * - Auto-resolve when errors clear
 * - Uses error code mappings from global context
 * - Deduplication via ErrorNotificationService
 * - Configurable via UI or msg properties
 *
 * @author VIIS Team
 * @version 1.0.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
const error_notification_service_1 = require("../../services/error-notification.service");
const error_mapping_service_1 = require("../../services/error-mapping.service");
module.exports = function (RED) {
    function ViisErrorMonitorNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Initialize services
        const errorNotificationService = new error_notification_service_1.ErrorNotificationService(node.context());
        const errorMappingService = new error_mapping_service_1.ErrorMappingService(node.context());
        let stats = {
            totalChecked: 0,
            errorsDetected: 0,
            errorsResolved: 0,
            lastCheck: null
        };
        node.on('input', async (msg, send, done) => {
            var _a;
            // For backward compatibility
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err)
                node.error(err, msg); };
            try {
                // Get config from msg or node config
                const boardId = msg.boardId || config.boardId;
                const registerType = msg.registerType || config.registerType;
                const startAddress = msg.startAddress !== undefined ? msg.startAddress : config.startAddress;
                const entity = msg.entity || config.entity || msg.deviceId || node.id;
                // Validate required fields
                if (!boardId) {
                    node.error('boardId is required (config or msg.boardId)', msg);
                    done(new Error('boardId is required'));
                    return;
                }
                if (!registerType) {
                    node.error('registerType is required (config or msg.registerType)', msg);
                    done(new Error('registerType is required'));
                    return;
                }
                if (startAddress === undefined || startAddress === null) {
                    node.error('startAddress is required (config or msg.startAddress)', msg);
                    done(new Error('startAddress is required'));
                    return;
                }
                // Get data array from msg.payload
                let dataArray = [];
                if (Array.isArray(msg.payload)) {
                    dataArray = msg.payload;
                }
                else if (((_a = msg.payload) === null || _a === void 0 ? void 0 : _a.data) && Array.isArray(msg.payload.data)) {
                    // Support viis-modbus-flex format: { success: true, data: [...] }
                    dataArray = msg.payload.data;
                }
                else {
                    node.error('msg.payload must be an array or { data: [...] }', msg);
                    done(new Error('Invalid payload format'));
                    return;
                }
                if (dataArray.length === 0) {
                    node.warn('Data array is empty, skipping error check');
                    send(msg);
                    done();
                    return;
                }
                node.status({ fill: 'blue', shape: 'dot', text: `Checking ${dataArray.length} values...` });
                // Track notifications created/resolved in this run
                const notifications = {
                    created: [],
                    resolved: []
                };
                // Check each value in the array
                for (let i = 0; i < dataArray.length; i++) {
                    const address = startAddress + i;
                    const value = dataArray[i];
                    stats.totalChecked++;
                    // Prepare Modbus error source
                    const source = {
                        register_type: registerType,
                        address: address,
                        value: value
                    };
                    // Check if value indicates error
                    const hasError = registerType === 'coil' ? value === true : value !== 0;
                    if (hasError) {
                        // Error detected - try to create notification (use boardId)
                        try {
                            const notification = await errorNotificationService.createFromModbusByBoardId(source, boardId, entity);
                            if (notification) {
                                stats.errorsDetected++;
                                notifications.created.push({
                                    address,
                                    value,
                                    err_code: notification.err_code,
                                    message: notification.message,
                                    severity: notification.severity
                                });
                                node.warn(`Error detected at ${registerType} ${address}: ${notification.err_code}`);
                            }
                        }
                        catch (dbError) {
                            // Silently skip if database not ready
                            if ((dbError === null || dbError === void 0 ? void 0 : dbError.message) !== 'Database not initialized') {
                                node.error(`Failed to create notification: ${dbError.message}`);
                            }
                        }
                        // If no notification created, means no mapping found (silent skip)
                    }
                    else {
                        // No error - try to auto-resolve (use boardId)
                        try {
                            const resolved = await errorNotificationService.autoResolveIfClearByBoardId(source, boardId, entity);
                            if (resolved) {
                                stats.errorsResolved++;
                                notifications.resolved.push({ address, value });
                            }
                        }
                        catch (dbError) {
                            // Silently skip if database not ready
                            if ((dbError === null || dbError === void 0 ? void 0 : dbError.message) !== 'Database not initialized') {
                                node.error(`Failed to resolve notification: ${dbError.message}`);
                            }
                        }
                    }
                }
                stats.lastCheck = new Date();
                // Update msg with notification info
                msg.errorMonitor = {
                    checked: dataArray.length,
                    notifications: notifications,
                    stats: Object.assign({}, stats)
                };
                // Update status
                const errorsFound = notifications.created.length;
                if (errorsFound > 0) {
                    node.status({
                        fill: 'red',
                        shape: 'dot',
                        text: `${errorsFound} error(s) detected`
                    });
                }
                else if (notifications.resolved.length > 0) {
                    node.status({
                        fill: 'green',
                        shape: 'dot',
                        text: `${notifications.resolved.length} error(s) resolved`
                    });
                }
                else {
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: `OK (checked ${dataArray.length})`
                    });
                }
                send(msg);
                done();
            }
            catch (error) {
                node.error(`Error monitoring failed: ${error.message}`, msg);
                node.status({ fill: 'red', shape: 'ring', text: 'Error' });
                done(error);
            }
        });
        node.on('close', (done) => {
            node.status({});
            done();
        });
        // Initial status
        node.status({ fill: 'grey', shape: 'ring', text: 'Ready' });
        node.log(`Error Monitor initialized for board ${config.boardId} (${config.registerType})`);
    }
    RED.nodes.registerType('viis-error-monitor', ViisErrorMonitorNode);
};
