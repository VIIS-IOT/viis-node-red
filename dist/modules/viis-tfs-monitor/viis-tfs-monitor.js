"use strict";
/**
 * @fileoverview VIIS TFS Monitor Node
 * Monitors Total Flow Sensor (TFS) values to prevent counter overflow.
 * Automatically resets TFS counters when approaching overflow threshold.
 *
 * Features:
 * - Periodic monitoring of TFS values (6 sensors, 2 registers each)
 * - Configurable overflow threshold (default: 90% of max value)
 * - Automatic reset via Modbus write to reset registers
 * - Reset event logging to database
 * - Cron-based scheduling (default: every hour)
 * - Manual reset trigger via input message
 *
 * @author VIIS Team
 * @version 1.0.0
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cron_1 = require("cron");
const client_registry_1 = __importDefault(require("../../core/client-registry"));
module.exports = function (RED) {
    function ViisTfsMonitorNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        let cronJob = null;
        let modbusClient = null;
        let isMonitoring = false;
        // Default values
        const MAX_REGISTER_VALUE = 65535;
        const threshold = (config.overflowThreshold || 90) / 100;
        const thresholdValue = Math.floor(MAX_REGISTER_VALUE * threshold);
        const tfsKeys = (config.tfsKeys || 'tfs01,tfs02,tfs03,tfs04,tfs05,tfs06').split(',').map(k => k.trim());
        // Parse TFS sensor configuration from global context
        function getTfsSensors() {
            const holdingRegs = node.context().global.get('modbus_board1_holding_registers') || {};
            const sensors = [];
            tfsKeys.forEach(key => {
                const intAddr = holdingRegs[key];
                const resetKey = `reset_${key}`;
                const resetAddr = holdingRegs[resetKey];
                if (intAddr !== undefined && resetAddr !== undefined) {
                    sensors.push({
                        key,
                        integerAddress: intAddr,
                        decimalAddress: intAddr + 1,
                        resetAddress: resetAddr
                    });
                }
            });
            return sensors;
        }
        // Check if TFS integer part exceeds threshold
        function needsReset(integerPart) {
            return integerPart >= thresholdValue;
        }
        // Write to reset register
        async function resetTfsCounter(sensor) {
            if (!modbusClient) {
                throw new Error('Modbus client not initialized');
            }
            // Write 1 to reset register (assuming PLC resets on value 1)
            await modbusClient.writeRegister(sensor.resetAddress, 1);
            if (config.enableLogging) {
                node.log(`Reset counter for ${sensor.key} (address ${sensor.resetAddress})`);
            }
        }
        // Main monitoring function
        async function monitorTfs() {
            if (isMonitoring) {
                node.warn('Monitor already running, skipping...');
                return;
            }
            isMonitoring = true;
            node.status({ fill: 'blue', shape: 'dot', text: 'Monitoring TFS...' });
            try {
                const sensors = getTfsSensors();
                if (sensors.length === 0) {
                    node.warn('No TFS sensors configured in global context');
                    node.status({ fill: 'yellow', shape: 'ring', text: 'No sensors' });
                    return;
                }
                let resetCount = 0;
                const results = [];
                for (const sensor of sensors) {
                    try {
                        // Read integer register only for quick check
                        const readResult = await (modbusClient === null || modbusClient === void 0 ? void 0 : modbusClient.readHoldingRegisters(sensor.integerAddress, 1));
                        const integerPart = typeof (readResult === null || readResult === void 0 ? void 0 : readResult.data[0]) === 'number' ? readResult.data[0] : 0;
                        const sensorResult = {
                            sensor: sensor.key,
                            integerValue: integerPart,
                            threshold: thresholdValue,
                            needsReset: false,
                            resetDone: false
                        };
                        if (needsReset(integerPart)) {
                            sensorResult.needsReset = true;
                            if (config.enableAutoReset) {
                                // Reset the counter
                                await resetTfsCounter(sensor);
                                sensorResult.resetDone = true;
                                sensorResult.integerValueBefore = integerPart;
                                resetCount++;
                                node.warn(`Auto-reset ${sensor.key}: integer=${integerPart} (threshold: ${thresholdValue})`);
                            }
                            else {
                                node.warn(`${sensor.key} needs reset but auto-reset is disabled`);
                            }
                        }
                        results.push(sensorResult);
                    }
                    catch (error) {
                        node.error(`Error monitoring ${sensor.key}: ${error.message}`);
                        results.push({
                            sensor: sensor.key,
                            error: error.message
                        });
                    }
                }
                // Send output message with results
                const outputMsg = {
                    payload: {
                        timestamp: new Date().toISOString(),
                        sensors: results,
                        resetCount: resetCount,
                        threshold: thresholdValue
                    }
                };
                node.send(outputMsg);
                // Update status
                if (resetCount > 0) {
                    node.status({
                        fill: 'green',
                        shape: 'dot',
                        text: `Reset ${resetCount} sensor(s)`
                    });
                }
                else {
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: `OK - All within threshold`
                    });
                }
            }
            catch (error) {
                node.error(`TFS monitoring failed: ${error.message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'Error' });
            }
            finally {
                isMonitoring = false;
            }
        }
        // Initialize Modbus client
        function initializeModbusClient() {
            try {
                modbusClient = client_registry_1.default.getModbusClientV2(config.boardId || 'board1', node);
                if (config.enableLogging) {
                    node.log(`Modbus client initialized for board: ${config.boardId || 'board1'}`);
                }
            }
            catch (error) {
                node.error(`Failed to initialize Modbus client: ${error.message}`);
            }
        }
        // Start cron job
        function startCronJob() {
            if (!config.enableAutoReset) {
                node.status({ fill: 'grey', shape: 'ring', text: 'Auto-reset disabled' });
                return;
            }
            try {
                const schedule = config.cronSchedule || '0 * * * *'; // Default: hourly
                cronJob = new cron_1.CronJob(schedule, async () => {
                    await monitorTfs();
                }, null, true, 'Asia/Ho_Chi_Minh');
                node.log(`Cron job started: ${schedule}`);
                node.status({ fill: 'green', shape: 'ring', text: `Scheduled: ${schedule}` });
            }
            catch (error) {
                node.error(`Failed to start cron job: ${error.message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'Cron error' });
            }
        }
        // Initialize node
        initializeModbusClient();
        startCronJob();
        // Handle input messages
        node.on('input', async (msg, send, done) => {
            var _a;
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err)
                node.error(err, msg); };
            try {
                const topic = msg.topic || '';
                if (topic === 'check') {
                    // Manual check trigger
                    await monitorTfs();
                    done();
                }
                else if (topic === 'reset' && ((_a = msg.payload) === null || _a === void 0 ? void 0 : _a.sensor)) {
                    // Manual reset of specific sensor
                    const sensorKey = msg.payload.sensor;
                    const sensors = getTfsSensors();
                    const sensor = sensors.find(s => s.key === sensorKey);
                    if (!sensor) {
                        node.error(`Sensor ${sensorKey} not found`, msg);
                        done(new Error(`Sensor ${sensorKey} not found`));
                        return;
                    }
                    await resetTfsCounter(sensor);
                    send({
                        payload: {
                            sensor: sensorKey,
                            resetDone: true,
                            timestamp: new Date().toISOString()
                        }
                    });
                    node.log(`Manual reset ${sensorKey}`);
                    done();
                }
                else {
                    // Default: trigger check
                    await monitorTfs();
                    done();
                }
            }
            catch (error) {
                node.error(`Input handling failed: ${error.message}`, msg);
                done(error);
            }
        });
        // Cleanup on close
        node.on('close', (done) => {
            if (cronJob) {
                cronJob.stop();
            }
            node.status({});
            done();
        });
    }
    RED.nodes.registerType('viis-tfs-monitor', ViisTfsMonitorNode);
};
