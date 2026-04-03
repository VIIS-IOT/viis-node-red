/**
 * @fileoverview VIIS Error Trigger Node
 * Creates error/warning notifications from business logic in Node-RED flows
 * 
 * Features:
 * - Create notifications from business logic errors
 * - Flexible input format via msg.payload
 * - Support for all severity levels
 * - Custom metadata support
 * - Deduplication via ErrorNotificationService
 * 
 * @author VIIS Team
 * @version 1.0.0
 */

import { Node, NodeAPI, NodeDef } from 'node-red';
import { ErrorNotificationService, BusinessLogicError } from '../../services/error-notification.service';

interface ErrorTriggerConfig extends NodeDef {
    name: string;
    err_code?: string;
    message?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    notificationType?: 'alert' | 'warning' | 'info' | 'error';
    entity?: string;
}

module.exports = function (RED: NodeAPI) {
    function ViisErrorTriggerNode(this: Node, config: ErrorTriggerConfig) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize service
        const errorNotificationService = new ErrorNotificationService(node.context());

        node.on('input', async (msg: any, send: any, done: any) => {
            // For backward compatibility
            send = send || function() { node.send.apply(node, arguments); };
            done = done || function(err: any) { if (err) node.error(err, msg); };

            try {
                // Extract error data from msg.payload or config
                const payload = msg.payload || {};

                // Build error data with precedence: msg.payload > config > defaults
                const errorData: BusinessLogicError = {
                    err_code: payload.err_code || config.err_code || 'UNKNOWN_ERROR',
                    message: payload.message || config.message || 'An error occurred',
                    severity: payload.severity || config.severity || 'medium',
                    type: payload.type || config.notificationType || 'warning',
                    entity: payload.entity || config.entity || node.id,
                    metadata: payload.metadata || {}
                };

                // Validate required fields
                if (!errorData.err_code) {
                    node.error('err_code is required', msg);
                    done(new Error('err_code is required'));
                    return;
                }

                if (!errorData.message) {
                    node.error('message is required', msg);
                    done(new Error('message is required'));
                    return;
                }

                // Validate severity
                const validSeverities = ['low', 'medium', 'high', 'critical'];
                if (!validSeverities.includes(errorData.severity)) {
                    node.warn(`Invalid severity '${errorData.severity}', using 'medium'`);
                    errorData.severity = 'medium';
                }

                // Validate type
                const validTypes = ['alert', 'warning', 'info', 'error'];
                if (!validTypes.includes(errorData.type)) {
                    node.warn(`Invalid type '${errorData.type}', using 'warning'`);
                    errorData.type = 'warning';
                }

                node.status({ fill: 'blue', shape: 'dot', text: 'Creating notification...' });

                // Create notification
                const notification = await errorNotificationService.createFromBusinessLogic(errorData);

                // Update status based on severity
                const statusColor = {
                    low: 'green',
                    medium: 'yellow',
                    high: 'orange',
                    critical: 'red'
                }[errorData.severity] || 'yellow';

                node.status({
                    fill: statusColor as any,
                    shape: 'dot',
                    text: `${errorData.severity}: ${errorData.err_code}`
                });

                // Output notification info
                msg.notification = notification;
                msg.error_code = errorData.err_code;
                msg.severity = errorData.severity;

                send(msg);
                done();

                node.log(`Notification created: ${errorData.err_code} (${errorData.severity})`);

            } catch (error: any) {
                node.error(`Failed to create notification: ${error.message}`, msg);
                node.status({ fill: 'red', shape: 'ring', text: 'Error' });
                done(error);
            }
        });

        node.on('close', (done: () => void) => {
            node.status({});
            done();
        });

        // Initial status
        node.status({ fill: 'grey', shape: 'ring', text: 'Ready' });
        node.log('Error Trigger node initialized');
    }

    RED.nodes.registerType('viis-error-trigger', ViisErrorTriggerNode);
};
