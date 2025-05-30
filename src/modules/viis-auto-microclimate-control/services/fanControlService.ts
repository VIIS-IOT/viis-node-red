/**
 * Fan Control Service for VIIS Auto Microclimate Control Node
 * Handles fan control logic including rotation and threshold modes
 */

import {
    IFanControlService,
    AutoControlConfig,
    SensorData,
    DeviceStatus,
    ControlAction,
    ServiceOptions,
    ILogger,
    FanRotationState
} from "../interfaces/types";
import { 
    CONTEXT_KEYS, 
    FAN_CONFIG,
    FAN_DAO_CONFIG,
    MODBUS_FUNCTION_CODES
} from "../constants";
import { Logger } from "../utils/logger";
import { 
    getFanGroups, 
    getNextGroupIndex, 
    createFanGroupActions,
    createFanDaoActions,
    getRecommendedGroupSize,
    getAllFanKeys
} from "../utils/groupUtils";
import { minutesToMs, hasTimeElapsed, getCurrentTimestamp } from "../utils/timeUtils";

export class FanControlService implements IFanControlService {
    private flowContext: any;
    private globalContext: any;
    private logger: ILogger;
    private nodeId: string;

    constructor(options: ServiceOptions) {
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new Logger(options.node, options.nodeId);
        this.nodeId = options.nodeId;
    }

    /**
     * Process fan control based on configuration and sensor data
     */
    async processFanControl(
        config: AutoControlConfig, 
        sensorData: SensorData, 
        deviceStatus: DeviceStatus
    ): Promise<ControlAction[]> {
        const actions: ControlAction[] = [];

        try {
            // Check if fan control is enabled
            if (config.set_mode_fan !== 1) {
                this.logger.debug("Fan control is disabled");
                // Turn off all fans if control is disabled
                return this.createTurnOffAllFansActions("Fan control disabled");
            }

            // Process based on auto mode
            if (config.set_auto_mode_fan === 1) {
                // Rotation mode
                const rotationActions = await this.processRotationMode(config);
                actions.push(...rotationActions);
            } else {
                // Threshold mode (default)
                const thresholdActions = await this.processThresholdMode(config, sensorData);
                actions.push(...thresholdActions);
            }

            // Process fan dao control
            const fanDaoActions = await this.processFanDaoControl(config);
            actions.push(...fanDaoActions);

            return actions;

        } catch (error) {
            this.logger.error(`Fan control processing error: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Process rotation mode fan control
     */
    async processRotationMode(config: AutoControlConfig): Promise<ControlAction[]> {
        try {
            const groupSize = config.set_gr_alternate_fan || 2;
            const rotationInterval = minutesToMs(config.set_time_alternate_fan || 15);
            
            // Get fan groups
            const fanGroups = this.getFanGroups(groupSize);
            if (fanGroups.length === 0) {
                this.logger.warn("No fan groups available for rotation");
                return [];
            }

            // Get current rotation state
            let rotationState = this.getRotationState();
            
            // Check if it's time to rotate
            if (hasTimeElapsed(rotationState.lastRotationTime, rotationInterval)) {
                // Move to next group
                rotationState.currentGroupIndex = getNextGroupIndex(
                    rotationState.currentGroupIndex, 
                    fanGroups.length
                );
                rotationState.lastRotationTime = getCurrentTimestamp();
                rotationState.activeGroup = fanGroups[rotationState.currentGroupIndex];
                
                // Save updated state
                this.saveRotationState(rotationState);
                
                this.logger.log(`Fan rotation: switching to group ${rotationState.currentGroupIndex + 1}/${fanGroups.length} (${rotationState.activeGroup.join(', ')})`);
            }

            // Create actions for current active group
            const coilMapping = this.getCoilMapping();
            return createFanGroupActions(
                rotationState.activeGroup,
                true,
                `Rotation mode: group ${rotationState.currentGroupIndex + 1}`,
                coilMapping
            );

        } catch (error) {
            this.logger.error(`Rotation mode processing error: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Process threshold mode fan control
     */
    async processThresholdMode(config: AutoControlConfig, sensorData: SensorData): Promise<ControlAction[]> {
        try {
            const tempIndoor = sensorData.temp_indoor;
            const humiIndoor = sensorData.humi_indoor;

            if (tempIndoor === undefined || humiIndoor === undefined) {
                this.logger.warn("Missing temperature or humidity data for threshold mode");
                return [];
            }

            // Get temperature thresholds
            const thresholds = {
                k1: config.set_k1_fan || 25,
                k2: config.set_k2_fan || 30,
                k3: config.set_k3_fan || 35,
                k4: config.set_k4_fan || 40
            };

            // Determine required group size based on thresholds
            const requiredGroupSize = getRecommendedGroupSize(tempIndoor, humiIndoor, thresholds);
            
            this.logger.debug(`Threshold mode: temp=${tempIndoor}°C, humidity=${humiIndoor}%, required group size=${requiredGroupSize}`);

            if (requiredGroupSize === 0) {
                // No fans needed
                return this.createTurnOffAllFansActions("Temperature/humidity below K1 threshold");
            }

            // Get appropriate fan groups
            const fanGroups = this.getFanGroups(requiredGroupSize);
            if (fanGroups.length === 0) {
                this.logger.warn(`No fan groups available for size ${requiredGroupSize}`);
                return [];
            }

            // For threshold mode, use the first group of the required size
            const targetGroup = fanGroups[0];
            const reason = this.getThresholdReason(tempIndoor, humiIndoor, thresholds);

            const coilMapping = this.getCoilMapping();
            return createFanGroupActions(targetGroup, true, reason, coilMapping);

        } catch (error) {
            this.logger.error(`Threshold mode processing error: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Process fan dao (reverse fan) control
     */
    async processFanDaoControl(config: AutoControlConfig): Promise<ControlAction[]> {
        try {
            // Check if fan dao control is enabled
            if (config.set_mode_fan_dao !== 1) {
                this.logger.debug("Fan dao control is disabled");
                const coilMapping = this.getCoilMapping();
                return createFanDaoActions(false, "Fan dao control disabled", coilMapping);
            }

            const alternateInterval = minutesToMs(config.set_time_alternate_fan_dao || 5);
            
            // Get last fan dao state change time
            const lastFanDaoTime = this.flowContext.get(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_time`) || 0;
            const currentFanDaoState = this.flowContext.get(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_state`) || false;

            // Check if it's time to toggle fan dao state
            if (hasTimeElapsed(lastFanDaoTime, alternateInterval)) {
                const newState = !currentFanDaoState;
                
                // Save new state
                this.flowContext.set(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_time`, getCurrentTimestamp());
                this.flowContext.set(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_state`, newState);
                
                this.logger.log(`Fan dao alternating: switching to ${newState ? 'ON' : 'OFF'}`);
                
                const coilMapping = this.getCoilMapping();
                return createFanDaoActions(newState, `Fan dao alternating mode: ${newState ? 'ON' : 'OFF'}`, coilMapping);
            }

            // No change needed
            return [];

        } catch (error) {
            this.logger.error(`Fan dao control processing error: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Get fan groups based on group size
     */
    getFanGroups(groupSize: number): string[][] {
        return getFanGroups(groupSize);
    }

    /**
     * Get current rotation state
     */
    private getRotationState(): FanRotationState {
        const saved = this.flowContext.get(CONTEXT_KEYS.FAN_ROTATION_STATE);
        
        if (saved && typeof saved === 'object') {
            return saved;
        }

        // Initialize default state
        const defaultState: FanRotationState = {
            currentGroupIndex: 0,
            lastRotationTime: 0,
            activeGroup: []
        };

        this.saveRotationState(defaultState);
        return defaultState;
    }

    /**
     * Save rotation state
     */
    private saveRotationState(state: FanRotationState): void {
        this.flowContext.set(CONTEXT_KEYS.FAN_ROTATION_STATE, state);
    }

    /**
     * Get coil mapping from global context or fallback to constants
     */
    private getCoilMapping(): Record<string, number> {
        const globalCoils = this.globalContext.get(CONTEXT_KEYS.GLOBAL_MODBUS_COILS) || {};
        
        // Merge with default mappings
        return {
            ...FAN_CONFIG.COIL_MAPPING,
            ...FAN_DAO_CONFIG.COIL_MAPPING,
            ...globalCoils
        };
    }

    /**
     * Create actions to turn off all fans
     */
    private createTurnOffAllFansActions(reason: string): ControlAction[] {
        const actions: ControlAction[] = [];
        const coilMapping = this.getCoilMapping();

        getAllFanKeys().forEach(fanKey => {
            const address = coilMapping[fanKey];
            if (address !== undefined) {
                actions.push({
                    deviceKey: fanKey,
                    value: false,
                    address: address,
                    fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                    reason: reason
                });
            }
        });

        return actions;
    }

    /**
     * Get reason string for threshold mode
     */
    private getThresholdReason(temperature: number, humidity: number, thresholds: any): string {
        if (temperature >= thresholds.k4 || humidity < 75) {
            return `K4 threshold: temp=${temperature}°C (≥${thresholds.k4}) or humidity=${humidity}% (<75%)`;
        } else if (temperature >= thresholds.k3 || humidity < 55) {
            return `K3 threshold: temp=${temperature}°C (≥${thresholds.k3}) or humidity=${humidity}% (<55%)`;
        } else if (temperature >= thresholds.k2 || humidity < 65) {
            return `K2 threshold: temp=${temperature}°C (≥${thresholds.k2}) or humidity=${humidity}% (<65%)`;
        } else if (temperature >= thresholds.k1) {
            return `K1 threshold: temp=${temperature}°C (≥${thresholds.k1})`;
        }
        
        return `Below thresholds: temp=${temperature}°C, humidity=${humidity}%`;
    }
}
