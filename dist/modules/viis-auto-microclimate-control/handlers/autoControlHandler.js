"use strict";
/**
 * Auto Control Handler for VIIS Auto Microclimate Control Node
 * Main orchestrator for all control logic
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoControlHandler = void 0;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
const timeUtils_1 = require("../utils/timeUtils");
class AutoControlHandler {
    constructor(options, configService, sensorService, modbusService, fanControlService, waterPumpControlService, curtainControlService, pollingInterval = constants_1.CONTROL_CONFIG.POLLING_INTERVAL_MS) {
        this.controlTimer = null;
        this.controlActiveState = false;
        this.node = options.node;
        this.flowContext = options.flowContext;
        this.logger = new logger_1.Logger(options.node, options.nodeId);
        this.configService = configService;
        this.sensorService = sensorService;
        this.modbusService = modbusService;
        this.fanControlService = fanControlService;
        this.waterPumpControlService = waterPumpControlService;
        this.curtainControlService = curtainControlService;
        this.pollingInterval = pollingInterval;
    }
    /**
     * Execute a single control cycle
     */
    async executeControlCycle() {
        try {
            this.logger.debug("Starting control cycle");
            this.node.status({ fill: "blue", shape: "dot", text: constants_1.STATUS_MESSAGES.PROCESSING });
            // Check if enough time has passed since last execution
            const lastExecution = this.flowContext.get(constants_1.CONTEXT_KEYS.LAST_CONTROL_EXECUTION) || 0;
            if (!(0, timeUtils_1.hasTimeElapsed)(lastExecution, this.pollingInterval)) {
                this.logger.debug("Skipping control cycle - too soon since last execution");
                return;
            }
            // Update last execution time
            this.flowContext.set(constants_1.CONTEXT_KEYS.LAST_CONTROL_EXECUTION, (0, timeUtils_1.getCurrentTimestamp)());
            // Get configuration
            const config = this.configService.getConfig();
            this.logger.warn(`Configuration: ${JSON.stringify(config)}`);
            if (!this.configService.isConfigValid()) {
                this.logger.warn("Invalid configuration, skipping control cycle");
                this.node.status({ fill: "yellow", shape: "ring", text: "Invalid config" });
                return;
            }
            // Get sensor data and device status
            const sensorData = this.sensorService.getSensorData();
            const deviceStatus = this.sensorService.getDeviceStatus();
            this.logger.warn(`Sensor data: ${JSON.stringify(sensorData)}`);
            this.logger.warn(`Device status: ${JSON.stringify(deviceStatus)}`);
            if (!sensorData || !deviceStatus) {
                this.logger.warn("Missing sensor data or device status, skipping control cycle");
                this.node.status({ fill: "yellow", shape: "ring", text: "No sensor data" });
                return;
            }
            // if (!this.sensorService.isDataValid()) {
            //     this.logger.warn("Sensor data is invalid or too old, skipping control cycle");
            //     this.node.status({ fill: "yellow", shape: "ring", text: "Stale data" });
            //     return;
            // }
            // Check if Modbus is ready
            if (!this.modbusService.isReady()) {
                this.logger.warn("Modbus service not ready, skipping control cycle");
                this.node.status({ fill: "red", shape: "ring", text: "Modbus not ready" });
                return;
            }
            // Collect all control actions
            const allActions = [];
            // // 1. Process water pump control first (K4 priority check)
            // K4 override logic removed - K4 completely disabled
            // if (k4OverrideActions.length > 0) {
            //     // K4 override takes priority
            //     allActions.push(...k4OverrideActions);
            //     this.logger.log("K4 priority override activated for water pump");
            // } else {
            //     // Normal water pump control
            //     const waterPumpActions = await this.waterPumpControlService.processWaterPumpControl(config, sensorData, deviceStatus);
            //     allActions.push(...waterPumpActions);
            // }
            // 2. Process fan control
            const fanActions = await this.fanControlService.processFanControl(config, sensorData, deviceStatus);
            allActions.push(...fanActions);
            // 3. Process curtain control
            const curtainActions = await this.curtainControlService.processCurtainControl(config, sensorData, deviceStatus);
            allActions.push(...curtainActions);
            // Execute all actions
            if (allActions.length > 0) {
                this.logger.log(`Executing ${allActions.length} control actions`);
                const result = await this.modbusService.executeControlActions(allActions);
                if (result.success) {
                    this.node.status({ fill: "green", shape: "dot", text: `${result.actionsExecuted.length} actions executed` });
                    this.logger.log(`Control cycle completed successfully: ${result.actionsExecuted.length} actions executed`);
                }
                else {
                    this.node.status({ fill: "red", shape: "ring", text: `${result.errors.length} errors` });
                    this.logger.error(`Control cycle completed with errors: ${result.errors.join(', ')}`);
                }
                // Send output message with results
                this.sendOutputMessage(result, config, sensorData);
            }
            else {
                this.node.status({ fill: "green", shape: "ring", text: constants_1.STATUS_MESSAGES.READY });
                this.logger.debug("Control cycle completed - no actions needed");
            }
        }
        catch (error) {
            this.logger.error(`${constants_1.ERROR_MESSAGES.CONTROL_LOGIC_ERROR}: ${error.message}`);
            this.node.status({ fill: "red", shape: "ring", text: constants_1.STATUS_MESSAGES.ERROR });
        }
    }
    /**
     * Start the control loop
     */
    startControlLoop() {
        if (this.controlActiveState) {
            this.logger.warn("Control loop is already active");
            return;
        }
        this.logger.log(`Starting control loop with ${this.pollingInterval}ms interval`);
        this.controlActiveState = true;
        // Execute first cycle immediately
        this.executeControlCycle();
        // Set up recurring timer
        this.controlTimer = setInterval(() => {
            this.executeControlCycle();
        }, this.pollingInterval);
        this.node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.READY });
    }
    /**
     * Stop the control loop
     */
    stopControlLoop() {
        if (!this.controlActiveState) {
            this.logger.warn("Control loop is not active");
            return;
        }
        this.logger.log("Stopping control loop");
        this.controlActiveState = false;
        if (this.controlTimer) {
            clearInterval(this.controlTimer);
            this.controlTimer = null;
        }
        this.node.status({ fill: "grey", shape: "ring", text: constants_1.STATUS_MESSAGES.DISABLED });
    }
    /**
     * Check if control is active
     */
    isControlActive() {
        return this.controlActiveState;
    }
    /**
     * Update polling interval
     */
    updatePollingInterval(intervalMs) {
        if (intervalMs < 1000) {
            this.logger.warn("Polling interval too short, minimum is 1000ms");
            return;
        }
        this.pollingInterval = intervalMs;
        this.logger.log(`Updated polling interval to ${intervalMs}ms`);
        // Restart control loop if active
        if (this.controlActiveState) {
            this.stopControlLoop();
            this.startControlLoop();
        }
    }
    /**
     * Send output message with control results
     */
    sendOutputMessage(result, config, sensorData) {
        try {
            // Get detailed fan control debug information
            const fanDebugInfo = this.getFanControlDebugInfo(config, sensorData);
            const outputMessage = {
                payload: {
                    timestamp: result.timestamp,
                    success: result.success,
                    actionsExecuted: result.actionsExecuted.length,
                    errors: result.errors.length,
                    sensorData: {
                        temp_indoor: sensorData.temp_indoor,
                        humi_indoor: sensorData.humi_indoor,
                        light_indoor: sensorData.light_indoor,
                        temp_outdoor: sensorData.temp_outdoor,
                        humi_outdoor: sensorData.humi_outdoor,
                        light_outdoor: sensorData.light_outdoor
                    },
                    controlStatus: {
                        fanControlEnabled: config.set_mode_fan === 1,
                        waterPumpEnabled: config.set_mode_tuong_nuoc === 1,
                        curtainControlEnabled: config.set_mode_luoi === 1
                    },
                    fanControl: fanDebugInfo,
                    actions: result.actionsExecuted.map(action => ({
                        device: action.deviceKey,
                        value: action.value,
                        reason: action.reason
                    }))
                }
            };
            this.node.send(outputMessage);
        }
        catch (error) {
            this.logger.error(`Failed to send output message: ${error.message}`);
        }
    }
    /**
     * Get detailed fan control debugging information
     */
    getFanControlDebugInfo(config, sensorData) {
        try {
            if (config.set_mode_fan !== 1) {
                return {
                    enabled: false,
                    reason: "Fan control disabled"
                };
            }
            const temperature = sensorData.temp_indoor;
            const humidity = sensorData.humi_indoor;
            if (temperature === undefined || humidity === undefined) {
                return {
                    enabled: true,
                    error: "Missing temperature or humidity data"
                };
            }
            // Get temperature thresholds
            const thresholds = {
                k1: config.set_k1_fan || 25,
                k2: config.set_k2_fan || 30,
                k3: config.set_k3_fan || 35,
                // k4: config.set_k4_fan || 40
                k4: 99
            };
            // Determine current threshold level
            let currentThreshold = "BELOW_K1";
            let requiredFanCount = 0;
            // if (temperature >= thresholds.k4) {
            //     currentThreshold = "K4";
            //     requiredFanCount = -1; // K4 uses water wall + quat_tren_1 only
            // } else 
            if (temperature >= thresholds.k3) {
                currentThreshold = "K3";
                requiredFanCount = 3; // K3 uses 3 fans rotation
            }
            else if (temperature >= thresholds.k2) {
                currentThreshold = "K2";
                requiredFanCount = 2; // K2 uses 2 fans rotation
            }
            else if (temperature >= thresholds.k1) {
                currentThreshold = "K1";
                requiredFanCount = 1; // K1 uses 1 fan rotation
            }
            // Get current device status
            const deviceStatus = this.node.context().global.get('coilRegisterData') || {};
            const currentActiveFans = Object.keys(deviceStatus).filter(key => deviceStatus[key] === true && ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(key));
            // Get rotation state information
            const rotationInfo = this.getRotationStateInfo(config, requiredFanCount);
            // Get transition state information
            const transitionInfo = this.getTransitionStateInfo();
            // Get fan group information
            const fanGroupInfo = this.getFanGroupInfo(requiredFanCount, currentActiveFans);
            return {
                enabled: true,
                mode: config.set_auto_mode_fan === 1 ? "ROTATION" : "THRESHOLD",
                temperature: temperature,
                humidity: humidity,
                thresholds: thresholds,
                currentThreshold: currentThreshold,
                requiredFanCount: requiredFanCount,
                currentActiveFans: currentActiveFans,
                currentActiveFanCount: currentActiveFans.length,
                rotationInterval: config.set_time_alternate_fan || 15,
                fanGroups: fanGroupInfo,
                rotation: rotationInfo,
                transition: transitionInfo
            };
        }
        catch (error) {
            return {
                enabled: true,
                error: `Debug info error: ${error.message}`
            };
        }
    }
    /**
     * Get rotation state information for debugging
     */
    getRotationStateInfo(config, requiredFanCount) {
        try {
            if (config.set_auto_mode_fan === 1) {
                // Rotation mode
                const rotationState = this.flowContext.get('fanRotationState');
                return {
                    type: "ROTATION_MODE",
                    state: rotationState,
                    groupSize: config.set_gr_alternate_fan || 2
                };
            }
            else {
                // Threshold mode rotation
                const contextKey = `fanRotationState_threshold_${requiredFanCount}`;
                const thresholdRotationState = this.flowContext.get(contextKey);
                return {
                    type: "THRESHOLD_MODE",
                    state: thresholdRotationState,
                    contextKey: contextKey,
                    requiredFanCount: requiredFanCount
                };
            }
        }
        catch (error) {
            return {
                error: `Rotation info error: ${error.message}`
            };
        }
    }
    /**
     * Get transition state information for debugging
     */
    getTransitionStateInfo() {
        try {
            const transitionState = this.flowContext.get('fanGroupTransitionState');
            const lastCompletionTime = this.flowContext.get('fanGroupTransitionState_last_completion');
            return {
                isTransitioning: (transitionState === null || transitionState === void 0 ? void 0 : transitionState.isTransitioning) || false,
                phase: (transitionState === null || transitionState === void 0 ? void 0 : transitionState.phase) || null,
                previousGroup: (transitionState === null || transitionState === void 0 ? void 0 : transitionState.previousGroup) || [],
                nextGroup: (transitionState === null || transitionState === void 0 ? void 0 : transitionState.nextGroup) || [],
                reason: (transitionState === null || transitionState === void 0 ? void 0 : transitionState.reason) || null,
                lastCompletionTime: lastCompletionTime || 0,
                timeSinceLastCompletion: lastCompletionTime ? Date.now() - lastCompletionTime : null
            };
        }
        catch (error) {
            return {
                error: `Transition info error: ${error.message}`
            };
        }
    }
    /**
     * Get fan group information for debugging
     */
    getFanGroupInfo(requiredFanCount, currentActiveFans) {
        try {
            // Define fan group configurations
            const fanGroupConfigs = {
                "-1": [
                    [] // K4 uses no quat_1 to quat_5 fans, only water wall + quat_tren_1
                ],
                1: [
                    ["quat_1"], ["quat_2"], ["quat_3"], ["quat_4"], ["quat_5"], ["quat_6"]
                ],
                2: [
                    ["quat_1", "quat_2"], ["quat_3", "quat_4"], ["quat_5", "quat_6"]
                ],
                3: [
                    ["quat_1", "quat_2", "quat_3"], ["quat_2", "quat_3", "quat_4"],
                    ["quat_3", "quat_4", "quat_5"], ["quat_4", "quat_5", "quat_6"],
                    ["quat_5", "quat_6", "quat_1"], ["quat_6", "quat_1", "quat_2"]
                ],
                4: [
                    ["quat_1", "quat_2", "quat_3", "quat_4"],
                    ["quat_3", "quat_4", "quat_5", "quat_6"],
                    ["quat_5", "quat_6", "quat_1", "quat_2"]
                ],
                6: [
                    ["quat_1", "quat_2", "quat_3", "quat_4", "quat_5", "quat_6"]
                ]
            };
            const availableGroups = fanGroupConfigs[requiredFanCount.toString()] || [];
            // Find which group the current active fans match
            let currentGroupIndex = -1;
            let currentGroupName = "UNKNOWN";
            if (currentActiveFans.length > 0) {
                const sortedCurrentFans = [...currentActiveFans].sort();
                currentGroupIndex = availableGroups.findIndex(group => {
                    const sortedGroup = [...group].sort();
                    return sortedCurrentFans.length === sortedGroup.length &&
                        sortedCurrentFans.every((fan, index) => fan === sortedGroup[index]);
                });
                if (currentGroupIndex >= 0) {
                    currentGroupName = `GROUP_${currentGroupIndex + 1}`;
                }
                else {
                    currentGroupName = "CUSTOM";
                }
            }
            else {
                currentGroupName = "NONE";
            }
            return {
                requiredFanCount: requiredFanCount,
                availableGroups: availableGroups,
                totalAvailableGroups: availableGroups.length,
                currentGroupIndex: currentGroupIndex,
                currentGroupName: currentGroupName,
                currentActiveFans: currentActiveFans,
                isValidGroup: currentGroupIndex >= 0,
                groupDetails: availableGroups.map((group, index) => ({
                    groupIndex: index,
                    groupName: `GROUP_${index + 1}`,
                    fans: group,
                    isActive: currentGroupIndex === index
                }))
            };
        }
        catch (error) {
            return {
                error: `Fan group info error: ${error.message}`
            };
        }
    }
    /**
     * Get current control status
     */
    getControlStatus() {
        return {
            isActive: this.controlActiveState,
            pollingInterval: this.pollingInterval,
            lastExecution: this.flowContext.get(constants_1.CONTEXT_KEYS.LAST_CONTROL_EXECUTION) || 0,
            modbusStatus: this.modbusService.getStatus()
        };
    }
}
exports.AutoControlHandler = AutoControlHandler;
