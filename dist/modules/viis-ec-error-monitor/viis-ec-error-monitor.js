"use strict";
/**
 * @fileoverview VIIS EC Error Monitor Node
 * Monitors Electrical Conductivity (EC) values and detects out-of-range errors
 * Creates notifications via ErrorNotificationService and sends to backend API
 *
 * Features:
 * - Monitors current EC against EC_max and EC_min thresholds
 * - Detects F1 errors (EC too high) and F2 errors (EC too low)
 * - Auto-stops pump on critical EC errors
 * - Uses shared ErrorNotificationService for backend sync
 * - Debouncing to prevent error spam
 * - Only checks when machine is running
 *
 * @author VIIS Team
 * @version 1.0.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
const error_notification_service_1 = require("../../services/error-notification.service");
const global_context_helper_1 = require("../../ultils/global-context-helper");
module.exports = function (RED) {
    function ViisECErrorMonitorNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const errorNotificationService = new error_notification_service_1.ErrorNotificationService(node.context());
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        // Configuration with defaults
        const debounceMinutes = config.debounceMinutes || 5;
        const minRunningMinutes = config.minRunningMinutes || 1;
        node.on('input', async (msg, send, done) => {
            send = send || ((...args) => node.send.apply(node, args));
            done = done || ((err) => { if (err)
                node.error(err, msg); });
            // Debug: Log input received
            node.warn(`EC Monitor received input: ${JSON.stringify({ topic: msg.topic, testNotification: msg.testNotification })}`);
            // Handle test notification request
            if (msg.topic === 'test-notification' || msg.testNotification === true) {
                try {
                    const globalContext = node.context().global;
                    const moment = globalContext.get('moment');
                    if (!moment) {
                        node.error('moment library not available');
                        done(new Error('moment library not available'));
                        return;
                    }
                    const now = moment().add(7, 'hours');
                    const deviceLabel = globalContext.get('device_label') || globalHelper.getEnvVar('DEVICE_ID', 'unknown');
                    const deviceId = globalHelper.getEnvVar('DEVICE_ID', 'unknown');
                    const testError = {
                        err_code: 'TEST_EC',
                        message: `[TEST] EC Error Monitor - Test notification sent at ${now.format('YYYY-MM-DD HH:mm:ss')}`,
                        severity: 'low',
                        type: 'info',
                        entity: deviceId,
                        entity_label: deviceLabel,
                        metadata: {
                            test_mode: true,
                            node_type: 'ec-error-monitor',
                            ts: now.format('YYYY-MM-DD HH:mm:ss')
                        }
                    };
                    try {
                        await errorNotificationService.createFromBusinessLogic(testError);
                        node.warn('✅ Test notification sent successfully');
                        node.status({ fill: 'green', shape: 'dot', text: 'Test notification sent' });
                    }
                    catch (err) {
                        node.error(`Test notification failed: ${err.message}`);
                        node.status({ fill: 'red', shape: 'ring', text: 'Test failed' });
                        throw err;
                    }
                    setTimeout(() => {
                        node.status({ fill: 'grey', shape: 'ring', text: 'Ready' });
                    }, 3000);
                    done();
                    return;
                }
                catch (err) {
                    node.error(`Test notification failed: ${err.message}`);
                    node.status({ fill: 'red', shape: 'ring', text: 'Test failed' });
                    done(err);
                    return;
                }
            }
            try {
                const globalContext = node.context().global;
                // Get moment library
                const moment = globalContext.get('moment');
                if (!moment) {
                    node.error('moment library not available in global context');
                    done(new Error('moment library not available'));
                    return;
                }
                const now = moment().add(7, 'hours');
                // Get data from global context
                const inputRegisterData = globalContext.get('inputRegisterData') || {};
                const coilRegisterData = globalContext.get('coilRegisterData') || {};
                const errMapping = globalContext.get('modbusErrMap') || {};
                const modbusCoils = globalContext.get('modbusCoils') || {};
                const deviceLabel = globalContext.get('device_label') || globalHelper.getEnvVar('DEVICE_ID', 'unknown');
                const deviceId = globalHelper.getEnvVar('DEVICE_ID', 'unknown');
                // Get EC values from configKeyValues
                const configKeyValues = globalContext.get('configKeyValues') || {};
                const currentEC = inputRegisterData.current_ec;
                const ecMax = configKeyValues.EC_max;
                const ecMin = configKeyValues.EC_min;
                // Validate EC data
                if (currentEC === undefined || currentEC === null) {
                    node.warn('current_ec not available in inputRegisterData');
                    done();
                    return;
                }
                if (ecMax === undefined || ecMin === undefined) {
                    node.warn('EC_max or EC_min not set in global context');
                    done();
                    return;
                }
                // State from node context
                let previousTimestamp = node.context().get('previousTimestamp');
                let elapsedRunTime = node.context().get('elapsedRunTime') || 0;
                let lastErrorTime = node.context().get('lastErrorTime') || 0;
                const currentTimestamp = now.valueOf();
                // Check if machine is running
                const isMachineRunning = coilRegisterData.main_pump === 1 || coilRegisterData.power === 1;
                // === HELPER FUNCTIONS ===
                function shouldSendError(lastTime, currentTime) {
                    if (lastTime === 0)
                        return true;
                    const elapsedMinutes = (currentTime - lastTime) / 60000;
                    return elapsedMinutes > debounceMinutes;
                }
                async function createECError(type, currentValue, thresholdValue) {
                    var _a;
                    const errorCode = type === 'max' ? 'F1' : 'F2';
                    const errorDescription = ((_a = errMapping[errorCode]) === null || _a === void 0 ? void 0 : _a.description) || 'Unknown EC error';
                    const message = `${errorDescription} - EC hiện tại: ${currentValue.toFixed(2)}, ${type.toUpperCase()}: ${thresholdValue.toFixed(2)}.`;
                    const errorData = {
                        err_code: errorCode,
                        message: message,
                        severity: 'high',
                        type: 'error',
                        entity: deviceId,
                        entity_label: deviceLabel,
                        metadata: {
                            current_ec: currentValue,
                            threshold: thresholdValue,
                            threshold_type: type,
                            ts: now.format('YYYY-MM-DD HH:mm:ss')
                        }
                    };
                    try {
                        await errorNotificationService.createFromBusinessLogic(errorData);
                        node.warn(`EC Error notification created: ${errorCode} - ${message}`);
                    }
                    catch (e) {
                        if ((e === null || e === void 0 ? void 0 : e.message) !== 'Database not initialized') {
                            node.error(`Failed to create EC error notification: ${e.message}`);
                        }
                    }
                }
                function stopPump() {
                    if (modbusCoils.hasOwnProperty('power')) {
                        const address = modbusCoils['power'];
                        const stopMsg = {
                            payload: {
                                value: 0,
                                fc: 5,
                                unitid: 1,
                                address,
                                quantity: 1
                            }
                        };
                        node.send(stopMsg);
                        node.warn('Pump stopped due to EC error');
                    }
                }
                function resetMachineState() {
                    node.context().set('previousTimestamp', null);
                    node.context().set('elapsedRunTime', 0);
                }
                // === MAIN LOGIC ===
                // Machine not running - reset state
                if (!isMachineRunning) {
                    resetMachineState();
                    node.status({ fill: 'green', shape: 'ring', text: 'Idle' });
                    done();
                    return;
                }
                // Machine is running - calculate elapsed time
                if (!previousTimestamp) {
                    previousTimestamp = currentTimestamp;
                }
                const timeSinceLastCheck = (currentTimestamp - previousTimestamp) / 60000;
                elapsedRunTime += timeSinceLastCheck;
                node.context().set('previousTimestamp', currentTimestamp);
                // Wait for minimum running time before checking
                if (elapsedRunTime < minRunningMinutes) {
                    node.status({
                        fill: 'blue',
                        shape: 'ring',
                        text: `Waiting ${elapsedRunTime.toFixed(1)}/${minRunningMinutes} min`
                    });
                    node.context().set('elapsedRunTime', elapsedRunTime);
                    done();
                    return;
                }
                // Check EC thresholds
                let errorDetected = false;
                if (currentEC > ecMax) {
                    // EC too high (F1)
                    if (shouldSendError(lastErrorTime, currentTimestamp)) {
                        await createECError('max', currentEC, ecMax);
                        node.context().set('lastErrorTime', currentTimestamp);
                        // Stop pump on high EC
                        stopPump();
                        errorDetected = true;
                        node.status({
                            fill: 'red',
                            shape: 'dot',
                            text: `EC HIGH: ${currentEC.toFixed(2)} > ${ecMax.toFixed(2)}`
                        });
                    }
                    else {
                        node.warn(`EC too high (${currentEC.toFixed(2)} > ${ecMax.toFixed(2)}), but within debounce period`);
                        node.status({
                            fill: 'yellow',
                            shape: 'dot',
                            text: `EC HIGH (debounced): ${currentEC.toFixed(2)}`
                        });
                    }
                }
                else if (currentEC < ecMin) {
                    // EC too low (F2)
                    if (shouldSendError(lastErrorTime, currentTimestamp)) {
                        await createECError('min', currentEC, ecMin);
                        node.context().set('lastErrorTime', currentTimestamp);
                        errorDetected = true;
                        node.status({
                            fill: 'red',
                            shape: 'ring',
                            text: `EC LOW: ${currentEC.toFixed(2)} < ${ecMin.toFixed(2)}`
                        });
                    }
                    else {
                        node.warn(`EC too low (${currentEC.toFixed(2)} < ${ecMin.toFixed(2)}), but within debounce period`);
                        node.status({
                            fill: 'yellow',
                            shape: 'ring',
                            text: `EC LOW (debounced): ${currentEC.toFixed(2)}`
                        });
                    }
                }
                else {
                    // EC within range
                    node.status({
                        fill: 'green',
                        shape: 'dot',
                        text: `EC OK: ${currentEC.toFixed(2)} (${ecMin.toFixed(2)}-${ecMax.toFixed(2)})`
                    });
                }
                // Save state
                node.context().set('elapsedRunTime', elapsedRunTime);
                done();
            }
            catch (err) {
                node.error(`EC error monitor failed: ${err.message}`, msg);
                node.warn(`EC error monitor error details: ${JSON.stringify({ message: err.message, stack: err.stack })}`);
                node.status({ fill: 'red', shape: 'ring', text: 'Error' });
                done(err);
            }
        });
        node.on('close', (done) => {
            node.status({});
            done();
        });
        // Initial status
        node.status({ fill: 'grey', shape: 'ring', text: 'Ready' });
        node.log(`EC Error Monitor initialized (debounce: ${debounceMinutes}min, minRunning: ${minRunningMinutes}min)`);
        // Register HTTP endpoint for test button
        RED.httpAdmin.post('/viis-ec-error-monitor/:id', (req, res) => {
            const nodeId = req.params.id;
            const targetNode = RED.nodes.getNode(nodeId);
            if (targetNode) {
                // Send test message to the node
                targetNode.receive({
                    topic: 'test-notification',
                    testNotification: true,
                    payload: {}
                });
                res.json({ success: true, message: 'Test notification triggered' });
            }
            else {
                res.status(404).json({ success: false, message: 'Node not found' });
            }
        });
    }
    RED.nodes.registerType('viis-ec-error-monitor', ViisECErrorMonitorNode);
};
