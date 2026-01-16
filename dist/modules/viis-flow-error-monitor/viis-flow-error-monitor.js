"use strict";
/**
 * @fileoverview VIIS Flow Error Monitor Node
 * Monitors flow rate errors by comparing actual volumes with expected set flow rates
 * Creates notifications via ErrorNotificationService and sends to backend API
 *
 * Features:
 * - Monitors irrigation flow rates across multiple channels
 * - Detects F4 errors (flow rate deviation)
 * - Detects F5 errors (air leak or fertilizer exhaustion in first minute)
 * - Auto-stops pump on critical first-minute errors
 * - Uses shared ErrorNotificationService for backend sync
 * - Debouncing to prevent error spam
 *
 * @author VIIS Team
 * @version 1.0.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
const error_notification_service_1 = require("../../services/error-notification.service");
const global_context_helper_1 = require("../../ultils/global-context-helper");
module.exports = function (RED) {
    function ViisFlowErrorMonitorNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const errorNotificationService = new error_notification_service_1.ErrorNotificationService(node.context());
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        // Configuration with defaults
        const toleranceRunning = config.toleranceRunning || 0.2;
        const toleranceStopped = config.toleranceStopped || 0.03;
        const debounceMinutes = config.debounceMinutes || 3;
        const enableDebugLogs = config.enableDebugLogs || false;
        node.on('input', async (msg, send, done) => {
            send = send || ((...args) => node.send.apply(node, args));
            done = done || ((err) => { if (err)
                node.error(err, msg); });
            // Debug: Only log test notifications or errors (avoid log spam)
            if (enableDebugLogs && (msg.topic === 'test-notification' || msg.testNotification === true)) {
                node.warn(`Flow Monitor received test notification request`);
            }
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
                    // Create test message that looks like production F4 error
                    const testChannel = 'A1';
                    const testActualFlow = 8.5;
                    const testExpectedFlow = 10.0;
                    const testElapsedTime = 5.2;
                    const testMessage = `[TEST] Lưu lượng kênh ${testChannel} không đạt chuẩn sau khi dừng, cần kiểm tra hệ thống tưới. Thực tế: ${testActualFlow.toFixed(2)} lít, Mong đợi: ${testExpectedFlow.toFixed(2)} lít, Thời gian: ${testElapsedTime.toFixed(2)} phút`;
                    const testError = {
                        err_code: 'F4',
                        message: testMessage,
                        severity: 'high',
                        type: 'error',
                        entity: deviceId,
                        entity_label: deviceLabel,
                        metadata: {
                            test_mode: true,
                            node_type: 'flow-error-monitor',
                            channel: testChannel,
                            actualVolume: testActualFlow,
                            expectedVolume: testExpectedFlow,
                            elapsedMinutes: testElapsedTime,
                            tolerance: 0.03,
                            ts: now.format('YYYY-MM-DD HH:mm:ss')
                        }
                    };
                    node.warn(`[DEBUG] Sending test notification: ${JSON.stringify(testError)}`);
                    try {
                        await errorNotificationService.createFromBusinessLogic(testError);
                        node.warn('✅ Test notification sent successfully');
                        node.status({ fill: 'green', shape: 'dot', text: 'Test notification sent' });
                    }
                    catch (err) {
                        node.error(`Test notification failed: ${err.message}`);
                        node.status({ fill: 'red', shape: 'ring', text: 'Test failed' });
                        throw err; // Re-throw all errors for visibility
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
                const holdingRegisterData = globalContext.get('holdingRegisterData') || {};
                const coilRegisterData = globalContext.get('coilRegisterData') || {};
                const errMapping = globalContext.get('modbusErrMap') || {};
                const modbusCoils = globalContext.get('modbusCoils') || {};
                const deviceLabel = globalContext.get('device_label') || globalHelper.getEnvVar('DEVICE_ID', 'unknown');
                const deviceId = globalHelper.getEnvVar('DEVICE_ID', 'unknown');
                // Get volume data from input registers
                const volumeData = {
                    A1: inputRegisterData.volume_A1,
                    B1: inputRegisterData.volume_B1,
                    B2: inputRegisterData.volume_B2,
                    A2: inputRegisterData.volume_A2,
                    A3: inputRegisterData.volume_A3,
                    B3: inputRegisterData.volume_B3
                };
                // Get set flow data from holding registers (per minute)
                const setFlowData = {
                    A1: holdingRegisterData.set_flow_A1,
                    B1: holdingRegisterData.set_flow_B1,
                    B2: holdingRegisterData.set_flow_B2,
                    A2: holdingRegisterData.set_flow_A2,
                    A3: holdingRegisterData.set_flow_A3,
                    B3: holdingRegisterData.set_flow_B3
                };
                // Get time valve data (in seconds)
                const timeValveData = {
                    A1: holdingRegisterData.time_valve_A1,
                    B1: holdingRegisterData.time_valve_B1,
                    B2: holdingRegisterData.time_valve_B2,
                    A2: holdingRegisterData.time_valve_A2,
                    A3: holdingRegisterData.time_valve_A3,
                    B3: holdingRegisterData.time_valve_B3
                };
                // Irrigation time count down in seconds from device
                const irriTimeCountCountDown = inputRegisterData.set_irrigation_time_count || 0;
                // State from node context
                const previousMachineState = node.context().get('previousMachineState') || false;
                let previousTimestamp = node.context().get('previousTimestamp');
                let elapsedRunTime = node.context().get('elapsedRunTime') || 0;
                let lastErrorTime = node.context().get('lastErrorTime') || 0;
                const currentTimestamp = now.valueOf();
                // Check if machine is running
                const isMachineRunning = coilRegisterData.main_pump === 1 || coilRegisterData.power === 1;
                // === HELPER FUNCTIONS ===
                function shouldLogError(lastTime, currentTime) {
                    const elapsedMinutes = (currentTime - lastTime) / 60000;
                    return elapsedMinutes >= debounceMinutes;
                }
                async function createBusinessError(errCode, msgText, metadata = {}) {
                    const errorData = {
                        err_code: errCode,
                        message: msgText,
                        severity: 'high',
                        type: 'error',
                        entity: deviceId,
                        entity_label: deviceLabel,
                        metadata: Object.assign(Object.assign({}, metadata), { ts: now.format('YYYY-MM-DD HH:mm:ss') })
                    };
                    try {
                        await errorNotificationService.createFromBusinessLogic(errorData);
                        node.warn(`Error notification created: ${errCode} - ${msgText}`);
                    }
                    catch (e) {
                        if ((e === null || e === void 0 ? void 0 : e.message) !== 'Database not initialized') {
                            node.error(`Failed to create error notification: ${e.message}`);
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
                        node.warn('Pump stopped due to critical flow error');
                    }
                }
                function buildF4Error(channel, actualFlow, expectedFlow, elapsedMinutes) {
                    const a = Math.round(actualFlow * 100) / 100;
                    const e = Math.round(expectedFlow * 100) / 100;
                    const t = Math.round(elapsedMinutes * 100) / 100;
                    return `Lưu lượng kênh ${channel} không đạt chuẩn sau khi dừng, cần kiểm tra hệ thống tưới. Thực tế: ${a} lít, Mong đợi: ${e} lít, Thời gian: ${t} phút`;
                }
                function buildF5Error(channel, actualFlow, expectedFlow, elapsedMinutes) {
                    const a = Math.round(actualFlow * 100) / 100;
                    const e = Math.round(expectedFlow * 100) / 100;
                    const t = Math.round(elapsedMinutes * 100) / 100;
                    return `Phát hiện lọt khí hoặc hết phân tại kênh ${channel}, hệ thống sẽ tự động dừng bơm để bảo vệ thiết bị. Lưu lượng thực tế: ${a} lít, Mong đợi: ${e} lít, Thời gian: ${t} phút`;
                }
                function checkFlow(channel, actualVolume, setFlow, elapsedTimeMinutes, tolerance) {
                    const roundedElapsedTime = Math.round(elapsedTimeMinutes * 10) / 10;
                    if (enableDebugLogs) {
                        node.log(`Checking flow for channel ${channel}: actual=${actualVolume}, setFlow=${setFlow}, time=${roundedElapsedTime}, tolerance=${tolerance}`);
                    }
                    const expectedVolume = setFlow * roundedElapsedTime;
                    const lowerBound = expectedVolume * (1 - tolerance);
                    const upperBound = expectedVolume * (1 + tolerance);
                    if (actualVolume < lowerBound || actualVolume > upperBound) {
                        return {
                            hasError: true,
                            message: buildF4Error(channel, actualVolume, expectedVolume, roundedElapsedTime),
                            metadata: {
                                channel,
                                actualVolume,
                                expectedVolume,
                                setFlow,
                                elapsedMinutes: roundedElapsedTime,
                                tolerance,
                                lowerBound,
                                upperBound
                            }
                        };
                    }
                    return null;
                }
                async function checkInitialFlow(channel, actualVolume, setFlow, elapsedTimeMinutes) {
                    const expectedVolume = setFlow * elapsedTimeMinutes;
                    const lowerBound = expectedVolume * 0.8; // 80% of expected
                    if (actualVolume < lowerBound) {
                        node.warn(`WARNING: Flow channel ${channel} below 80% expected. Stopping pump.`);
                        stopPump();
                        if (shouldLogError(lastErrorTime, currentTimestamp)) {
                            const message = buildF5Error(channel, actualVolume, expectedVolume, elapsedTimeMinutes);
                            await createBusinessError('F5', message, {
                                channel,
                                actualVolume,
                                expectedVolume,
                                setFlow,
                                elapsedMinutes: elapsedTimeMinutes,
                                threshold: 0.8
                            });
                            node.context().set('lastErrorTime', currentTimestamp);
                        }
                        return true; // Stop pump triggered
                    }
                    return false;
                }
                async function checkFlowWithToleranceWhenFinish(tolerance) {
                    const errors = [];
                    for (const channel in volumeData) {
                        if (!setFlowData[channel] || setFlowData[channel] === 0) {
                            continue;
                        }
                        // Calculate actual irrigation time from device
                        const actualIrriTimeMinutes = (timeValveData[channel] - irriTimeCountCountDown) / 60;
                        if (actualIrriTimeMinutes > 0) {
                            const error = checkFlow(channel, volumeData[channel] || 0, setFlowData[channel], actualIrriTimeMinutes, tolerance);
                            if (error) {
                                errors.push(error);
                            }
                        }
                    }
                    if (errors.length > 0 && shouldLogError(lastErrorTime, currentTimestamp)) {
                        for (const error of errors) {
                            await createBusinessError('F4', error.message, error.metadata);
                        }
                        node.context().set('lastErrorTime', currentTimestamp);
                        if (enableDebugLogs) {
                            node.warn(`Detected ${errors.length} flow error(s) after machine stopped`);
                        }
                    }
                    else if (errors.length > 0) {
                        if (enableDebugLogs) {
                            node.log('Flow errors detected but within debounce period');
                        }
                    }
                }
                function resetMachineState() {
                    node.context().set('previousTimestamp', null);
                    node.context().set('elapsedRunTime', 0);
                    node.context().set('previousMachineState', isMachineRunning);
                }
                // === MAIN LOGIC ===
                // Machine not running
                if (!isMachineRunning) {
                    if (previousMachineState) {
                        // Machine just stopped - check final flow with strict tolerance
                        if (enableDebugLogs) {
                            node.warn('Machine stopped. Checking flow with strict tolerance.');
                        }
                        await checkFlowWithToleranceWhenFinish(toleranceStopped);
                    }
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
                // Wait for at least 1 minute before checking
                if (elapsedRunTime < 1) {
                    node.status({ fill: 'blue', shape: 'ring', text: `Running ${elapsedRunTime.toFixed(2)} min` });
                    node.context().set('elapsedRunTime', elapsedRunTime);
                    node.context().set('previousMachineState', isMachineRunning);
                    done();
                    return;
                }
                // First minute check (1 to 1.5 minutes)
                if (elapsedRunTime < 1.5) {
                    if (enableDebugLogs) {
                        node.warn(`Machine running ${elapsedRunTime.toFixed(2)} min. Checking initial flow rates.`);
                    }
                    for (const channel in volumeData) {
                        if (setFlowData[channel] > 0 && timeValveData[channel] > 0) {
                            await checkInitialFlow(channel, volumeData[channel] || 0, setFlowData[channel], elapsedRunTime // Use original logic: global elapsedRunTime
                            );
                        }
                    }
                    node.context().set('elapsedRunTime', elapsedRunTime);
                    node.context().set('previousMachineState', isMachineRunning);
                    node.status({ fill: 'yellow', shape: 'dot', text: `Initial check ${elapsedRunTime.toFixed(2)} min` });
                    done();
                    return;
                }
                // Normal running check (currently disabled, only check on stop)
                // You can enable this if you want continuous monitoring during runtime
                // await checkFlowWithToleranceWhenRunning(toleranceRunning);
                // Save state
                node.context().set('elapsedRunTime', elapsedRunTime);
                node.context().set('previousMachineState', isMachineRunning);
                node.status({ fill: 'green', shape: 'dot', text: `Running ${elapsedRunTime.toFixed(2)} min` });
                done();
            }
            catch (err) {
                node.error(`Flow error monitor failed: ${err.message}`, msg);
                if (enableDebugLogs) {
                    node.warn(`Flow error monitor error details: ${JSON.stringify({ message: err.message, stack: err.stack })}`);
                }
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
        node.log(`Flow Error Monitor initialized (toleranceStopped: ${toleranceStopped}, debounce: ${debounceMinutes}min)`);
        // Register HTTP endpoint for test button
        RED.httpAdmin.post('/viis-flow-error-monitor/:id', (req, res) => {
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
    RED.nodes.registerType('viis-flow-error-monitor', ViisFlowErrorMonitorNode);
};
