/**
 * Auto Control Handler for VIIS Auto Microclimate Control Node
 * Main orchestrator for all control logic
 */

import {
    IAutoControlHandler,
    ServiceOptions,
    ILogger,
    IConfigService,
    ISensorService,
    IModbusService,
    IFanControlService,
    IWaterPumpControlService,
    ICurtainControlService,
    ControlAction,
    ControlExecutionResult
} from "../interfaces/types";
import {
    CONTEXT_KEYS,
    CONTROL_CONFIG,
    STATUS_MESSAGES,
    ERROR_MESSAGES
} from "../constants";
import { Logger } from "../utils/logger";
import { hasTimeElapsed, getCurrentTimestamp } from "../utils/timeUtils";

export class AutoControlHandler implements IAutoControlHandler {
    private node: any;
    private flowContext: any;
    private logger: ILogger;
    private configService: IConfigService;
    private sensorService: ISensorService;
    private modbusService: IModbusService;
    private fanControlService: IFanControlService;
    private waterPumpControlService: IWaterPumpControlService;
    private curtainControlService: ICurtainControlService;

    private controlTimer: NodeJS.Timeout | null = null;
    private controlActiveState: boolean = false;
    private pollingInterval: number;

    constructor(
        options: ServiceOptions,
        configService: IConfigService,
        sensorService: ISensorService,
        modbusService: IModbusService,
        fanControlService: IFanControlService,
        waterPumpControlService: IWaterPumpControlService,
        curtainControlService: ICurtainControlService,
        pollingInterval: number = CONTROL_CONFIG.POLLING_INTERVAL_MS
    ) {
        this.node = options.node;
        this.flowContext = options.flowContext;
        this.logger = new Logger(options.node, options.nodeId);
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
    async executeControlCycle(): Promise<void> {
        try {
            this.logger.debug("Starting control cycle");
            this.node.status({ fill: "blue", shape: "dot", text: STATUS_MESSAGES.PROCESSING });

            // Check if enough time has passed since last execution
            const lastExecution = this.flowContext.get(CONTEXT_KEYS.LAST_CONTROL_EXECUTION) || 0;
            if (!hasTimeElapsed(lastExecution, this.pollingInterval)) {
                this.logger.debug("Skipping control cycle - too soon since last execution");
                return;
            }

            // Update last execution time
            this.flowContext.set(CONTEXT_KEYS.LAST_CONTROL_EXECUTION, getCurrentTimestamp());

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

            if (!this.sensorService.isDataValid()) {
                this.logger.warn("Sensor data is invalid or too old, skipping control cycle");
                this.node.status({ fill: "yellow", shape: "ring", text: "Stale data" });
                return;
            }

            // Check if Modbus is ready
            if (!this.modbusService.isReady()) {
                this.logger.warn("Modbus service not ready, skipping control cycle");
                this.node.status({ fill: "red", shape: "ring", text: "Modbus not ready" });
                return;
            }

            // Collect all control actions
            const allActions: ControlAction[] = [];

            // 1. Process water pump control first (K4 priority check)
            const k4OverrideActions = this.waterPumpControlService.checkK4PriorityOverride(config, sensorData);
            if (k4OverrideActions.length > 0) {
                // K4 override takes priority
                allActions.push(...k4OverrideActions);
                this.logger.log("K4 priority override activated for water pump");
            } else {
                // Normal water pump control
                const waterPumpActions = await this.waterPumpControlService.processWaterPumpControl(config, sensorData, deviceStatus);
                allActions.push(...waterPumpActions);
            }

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
                } else {
                    this.node.status({ fill: "red", shape: "ring", text: `${result.errors.length} errors` });
                    this.logger.error(`Control cycle completed with errors: ${result.errors.join(', ')}`);
                }

                // Send output message with results
                this.sendOutputMessage(result, config, sensorData);
            } else {
                this.node.status({ fill: "green", shape: "ring", text: STATUS_MESSAGES.READY });
                this.logger.debug("Control cycle completed - no actions needed");
            }

        } catch (error) {
            this.logger.error(`${ERROR_MESSAGES.CONTROL_LOGIC_ERROR}: ${(error as Error).message}`);
            this.node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.ERROR });
        }
    }

    /**
     * Start the control loop
     */
    startControlLoop(): void {
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

        this.node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });
    }

    /**
     * Stop the control loop
     */
    stopControlLoop(): void {
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

        this.node.status({ fill: "grey", shape: "ring", text: STATUS_MESSAGES.DISABLED });
    }

    /**
     * Check if control is active
     */
    isControlActive(): boolean {
        return this.controlActiveState;
    }

    /**
     * Update polling interval
     */
    updatePollingInterval(intervalMs: number): void {
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
    private sendOutputMessage(
        result: ControlExecutionResult,
        config: any,
        sensorData: any
    ): void {
        try {
            const outputMessage = {
                payload: {
                    timestamp: result.timestamp,
                    success: result.success,
                    actionsExecuted: result.actionsExecuted.length,
                    errors: result.errors.length,
                    sensorData: {
                        temp_indoor: sensorData.temp_indoor,
                        humi_indoor: sensorData.humi_indoor,
                        light_indoor: sensorData.light_indoor
                    },
                    controlStatus: {
                        fanControlEnabled: config.set_mode_fan === 1,
                        waterPumpEnabled: config.set_mode_tuong_nuoc === 1,
                        curtainControlEnabled: config.set_mode_luoi === 1
                    },
                    actions: result.actionsExecuted.map(action => ({
                        device: action.deviceKey,
                        value: action.value,
                        reason: action.reason
                    }))
                }
            };

            this.node.send(outputMessage);

        } catch (error) {
            this.logger.error(`Failed to send output message: ${(error as Error).message}`);
        }
    }

    /**
     * Get current control status
     */
    getControlStatus(): {
        isActive: boolean;
        pollingInterval: number;
        lastExecution: number;
        modbusStatus: string;
    } {
        return {
            isActive: this.controlActiveState,
            pollingInterval: this.pollingInterval,
            lastExecution: this.flowContext.get(CONTEXT_KEYS.LAST_CONTROL_EXECUTION) || 0,
            modbusStatus: this.modbusService.getStatus()
        };
    }
}
