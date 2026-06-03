/**
 * Curtain Control Service for VIIS Auto Microclimate Control Node
 * Handles curtain (luoi) control logic with special 2-coil parsing
 */

import {
    ICurtainControlService,
    AutoControlConfig,
    SensorData,
    DeviceStatus,
    ControlAction,
    ServiceOptions,
    ILogger,
    CurtainToleranceTimer
} from "../interfaces/types";
import {
    CONTEXT_KEYS,
    CURTAIN_CONFIG,
    MODBUS_FUNCTION_CODES
} from "../constants";
import { Logger } from "../utils/logger";
import { minutesToMs, hasTimeElapsed, getCurrentTimestamp } from "../utils/timeUtils";

export class CurtainControlService implements ICurtainControlService {
    private flowContext: any;
    private globalContext: any;
    private logger: ILogger;

    constructor(options: ServiceOptions) {
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new Logger(options.node, options.nodeId);
    }

    /**
     * Process curtain control based on configuration and sensor data
     */
    async processCurtainControl(
        config: AutoControlConfig,
        sensorData: SensorData,
        deviceStatus: DeviceStatus
    ): Promise<ControlAction[]> {
        try {
            // Check if curtain control is enabled
            if (config.set_mode_luoi !== 1) {
                this.logger.debug("Curtain control is disabled");
                return [];
            }

            const lightOutdoor = sensorData.light_outdoor;
            const lightIndoor = sensorData.light_indoor;

            if (lightOutdoor === undefined) {
                this.logger.warn("Missing outdoor light data for curtain control");
                return [];
            }

            if (lightIndoor === undefined) {
                this.logger.warn("Missing indoor light data for curtain control");
                return [];
            }

            const actions: ControlAction[] = [];

            // Process luoi_1 control with both outdoor and indoor light
            const luoi1Actions = await this.processLuoiControl(
                "luoi_1",
                lightOutdoor,
                lightIndoor,
                config.set_light_dai_luoi_1 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.LIGHT_DAI,
                config.set_light_thu_luoi_1 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.LIGHT_THU,
                config.set_light_indoor_thu_luoi_1 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.LIGHT_INDOOR_THU,
                config.set_tolerance_light_luoi_1 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.TOLERANCE_TIME,
                deviceStatus
            );
            actions.push(...luoi1Actions);

            // Process luoi_2 control with both outdoor and indoor light
            const luoi2Actions = await this.processLuoiControl(
                "luoi_2",
                lightOutdoor,
                lightIndoor,
                config.set_light_dai_luoi_2 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.LIGHT_DAI,
                config.set_light_thu_luoi_2 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.LIGHT_THU,
                config.set_light_indoor_thu_luoi_2 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.LIGHT_INDOOR_THU,
                config.set_tolerance_light_luoi_2 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.TOLERANCE_TIME,
                deviceStatus
            );
            actions.push(...luoi2Actions);

            // Process luoi_3 control with both outdoor and indoor light
            const luoi3Actions = await this.processLuoiControl(
                "luoi_3",
                lightOutdoor,
                lightIndoor,
                config.set_light_dai_luoi_3 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.LIGHT_DAI,
                config.set_light_thu_luoi_3 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.LIGHT_THU,
                config.set_light_indoor_thu_luoi_3 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.LIGHT_INDOOR_THU,
                config.set_tolerance_light_luoi_3 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.TOLERANCE_TIME,
                deviceStatus
            );
            actions.push(...luoi3Actions);

            // Process luoi_4 control with both outdoor and indoor light
            const luoi4Actions = await this.processLuoiControl(
                "luoi_4",
                lightOutdoor,
                lightIndoor,
                config.set_light_dai_luoi_4 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.LIGHT_DAI,
                config.set_light_thu_luoi_4 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.LIGHT_THU,
                config.set_light_indoor_thu_luoi_4 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.LIGHT_INDOOR_THU,
                config.set_tolerance_light_luoi_4 || CURTAIN_CONFIG.DEFAULT_THRESHOLDS.TOLERANCE_TIME,
                deviceStatus
            );
            actions.push(...luoi4Actions);

            // Check and process tolerance timers
            const toleranceActions = await this.checkToleranceTimers(config, sensorData);
            actions.push(...toleranceActions);

            return actions;

        } catch (error) {
            this.logger.error(`Curtain control processing error: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Process control for a specific luoi based on both outdoor and indoor light
     */
    private async processLuoiControl(
        luoiKey: string,
        lightOutdoor: number,
        lightIndoor: number,
        daiThreshold: number,
        thuThreshold: number,
        indoorThuThreshold: number,
        toleranceMinutes: number,
        deviceStatus: DeviceStatus
    ): Promise<ControlAction[]> {
        try {
            // Get current luoi state
            const mapping = CURTAIN_CONFIG.LUOI_MAPPING[luoiKey as keyof typeof CURTAIN_CONFIG.LUOI_MAPPING];
            if (!mapping) {
                this.logger.warn(`No mapping found for luoi: ${luoiKey}`);
                return [];
            }

            const thuKey = mapping.thu;
            const daiKey = mapping.dai;
            const currentThuState = deviceStatus[thuKey as keyof DeviceStatus] || false;
            const currentDaiState = deviceStatus[daiKey as keyof DeviceStatus] || false;

            // Determine desired action based on light thresholds
            let desiredAction: "dai" | "thu" | "none" = "none";

            if (lightOutdoor >= daiThreshold) {
                // Outdoor light is high, should extend curtain (dai) to block sunlight
                if (!currentDaiState) {
                    desiredAction = "dai";
                }
            } else if (lightOutdoor <= thuThreshold) {
                // Should retract curtain (thu) if:
                // 1. Outdoor light is low (original logic)
                if (!currentThuState) {
                    desiredAction = "thu";

                    // Log the reason for better debugging
                    if (lightOutdoor <= thuThreshold) {
                        this.logger.debug(`${luoiKey}: thu action due to low outdoor light (${lightOutdoor} <= ${thuThreshold})`);
                    } else {
                        this.logger.debug(`${luoiKey}: thu action due to low indoor light (${lightIndoor} <= ${indoorThuThreshold})`);
                    }
                }
            }

            if (desiredAction === "none") {
                // No action needed
                return [];
            }

            // Check if we need to start a tolerance timer
            const toleranceTimers = this.getToleranceTimers();
            const existingTimer = toleranceTimers.find(timer => timer.luoiId === luoiKey);

            if (!existingTimer) {
                // Start new tolerance timer
                const newTimer: CurtainToleranceTimer = {
                    luoiId: luoiKey,
                    startTime: getCurrentTimestamp(),
                    targetAction: desiredAction,
                    lightValue: lightOutdoor // Store outdoor light value for reference
                };

                toleranceTimers.push(newTimer);
                this.saveToleranceTimers(toleranceTimers);

                this.logger.debug(`Started tolerance timer for ${luoiKey}: ${desiredAction} action (light_outdoor=${lightOutdoor}, light_indoor=${lightIndoor}, threshold=${desiredAction === 'dai' ? daiThreshold : thuThreshold})`);
                return [];
            }

            // Check if existing timer has elapsed and action is still needed
            if (existingTimer.targetAction === desiredAction) {
                const toleranceMs = minutesToMs(toleranceMinutes);

                if (hasTimeElapsed(existingTimer.startTime, toleranceMs)) {
                    // Execute the action
                    this.logger.warn(`Tolerance timer elapsed for ${luoiKey}: executing ${desiredAction} action`);

                    // Remove the timer
                    const updatedTimers = toleranceTimers.filter(timer => timer.luoiId !== luoiKey);
                    this.saveToleranceTimers(updatedTimers);

                    // Execute the luoi command
                    return await this.handleLuoiCommand(luoiKey, desiredAction);
                }
            } else {
                // Action changed, restart timer
                existingTimer.targetAction = desiredAction;
                existingTimer.startTime = getCurrentTimestamp();
                existingTimer.lightValue = lightOutdoor; // Update with current outdoor light
                this.saveToleranceTimers(toleranceTimers);

                this.logger.debug(`Restarted tolerance timer for ${luoiKey}: ${desiredAction} action`);
            }

            return [];

        } catch (error) {
            this.logger.error(`Luoi control processing error for ${luoiKey}: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Handle luoi command with special 2-coil logic (similar to luoiHandler.processRpcBody)
     */
    async handleLuoiCommand(luoiKey: string, action: "dai" | "thu"): Promise<ControlAction[]> {
        try {
            const mapping = CURTAIN_CONFIG.LUOI_MAPPING[luoiKey as keyof typeof CURTAIN_CONFIG.LUOI_MAPPING];
            if (!mapping) {
                this.logger.error(`No mapping found for luoi: ${luoiKey}`);
                return [];
            }

            const thuKey = mapping.thu;
            const daiKey = mapping.dai;
            const coilMapping = this.getCoilMapping();

            // Get coil addresses
            const thuAddress = coilMapping[thuKey];
            const daiAddress = coilMapping[daiKey];

            if (thuAddress === undefined || daiAddress === undefined) {
                this.logger.error(`Missing coil addresses for ${luoiKey}: thu=${thuAddress}, dai=${daiAddress}`);
                return [];
            }

            const actions: ControlAction[] = [];

            // Special 2-coil logic: each luoi has thu (retract) and dai (extend) coils
            // Only one can be active at a time
            if (action === "dai") {
                // Extend: turn off thu, turn on dai
                actions.push({
                    deviceKey: thuKey,
                    value: false,
                    address: thuAddress,
                    fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                    reason: `${luoiKey} extend: turn off retract coil`
                });

                actions.push({
                    deviceKey: daiKey,
                    value: true,
                    address: daiAddress,
                    fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                    reason: `${luoiKey} extend: turn on extend coil`
                });

                this.logger.warn(`${luoiKey} extending: ${thuKey}=OFF, ${daiKey}=ON`);

            } else if (action === "thu") {
                // Retract: turn off dai, turn on thu
                actions.push({
                    deviceKey: daiKey,
                    value: false,
                    address: daiAddress,
                    fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                    reason: `${luoiKey} retract: turn off extend coil`
                });

                actions.push({
                    deviceKey: thuKey,
                    value: true,
                    address: thuAddress,
                    fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                    reason: `${luoiKey} retract: turn on retract coil`
                });

                this.logger.warn(`${luoiKey} retracting: ${daiKey}=OFF, ${thuKey}=ON`);
            }

            return actions;

        } catch (error) {
            this.logger.error(`Luoi command handling error for ${luoiKey}: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Check and process tolerance timers
     */
    async checkToleranceTimers(config: AutoControlConfig, sensorData: SensorData): Promise<ControlAction[]> {
        try {
            const toleranceTimers = this.getToleranceTimers();
            const actions: ControlAction[] = [];

            // Clean up expired or invalid timers
            const validTimers = toleranceTimers.filter(timer => {
                const age = getCurrentTimestamp() - timer.startTime;
                const maxAge = minutesToMs(30); // Maximum 30 minutes

                if (age > maxAge) {
                    this.logger.debug(`Removing expired tolerance timer for ${timer.luoiId}`);
                    return false;
                }

                return true;
            });

            if (validTimers.length !== toleranceTimers.length) {
                this.saveToleranceTimers(validTimers);
            }

            return actions;

        } catch (error) {
            this.logger.error(`Tolerance timer check error: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Get tolerance timers from flow context
     */
    private getToleranceTimers(): CurtainToleranceTimer[] {
        const timers = this.flowContext.get(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
        return Array.isArray(timers) ? timers : [];
    }

    /**
     * Save tolerance timers to flow context
     */
    private saveToleranceTimers(timers: CurtainToleranceTimer[]): void {
        this.flowContext.set(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS, timers);
    }

    /**
     * Get coil mapping from global context or fallback to constants
     */
    private getCoilMapping(): Record<string, number> {
        const globalCoils = this.globalContext.get(CONTEXT_KEYS.GLOBAL_MODBUS_COILS) || {};

        // Merge with default mappings
        return {
            ...CURTAIN_CONFIG.COIL_MAPPING,
            ...globalCoils
        };
    }

    /**
     * Get current curtain status for monitoring
     */
    getCurtainStatus(): {
        isEnabled: boolean;
        toleranceTimers: CurtainToleranceTimer[];
        luoiStates: Record<string, { thu: boolean; dai: boolean }>;
    } {
        const toleranceTimers = this.getToleranceTimers();

        return {
            isEnabled: true, // This would come from config in a real implementation
            toleranceTimers: toleranceTimers,
            luoiStates: {} // This would be populated from device status in a real implementation
        };
    }
}
