/**
 * Type definitions for VIIS Auto Microclimate Control Node
 */

import { NodeDef } from "node-red";

// Node configuration interface
export interface ViisAutoMicroclimateControlNodeDef extends NodeDef {
    pollingInterval: number;
    enableFanControl: boolean;
    enableWaterPumpControl: boolean;
    enableCurtainControl: boolean;
}

// Configuration interface for all control settings
export interface AutoControlConfig {
    // Operational settings
    operational_script?: number;
    script_run_day?: number;

    // Fan control
    set_mode_fan?: number;
    set_auto_mode_fan?: number;
    set_k1_fan?: number;
    set_k2_fan?: number;
    set_k3_fan?: number;
    set_k4_fan?: number;
    set_gr_alternate_fan?: number;
    set_time_alternate_fan?: number;
    set_time_fan_on?: number;
    set_time_fan_off?: number;
    set_fan_group_transition_delay?: number; // Fan group transition delay in seconds
    set_fan_group_off_delay?: number; // Delay after turning off fans before turning on new group (seconds)

    // Fan dao control
    set_mode_fan_dao?: number;
    set_auto_mode_fan_dao?: number;
    set_threshold_on_fan_dao?: number;
    set_threshold_off_fan_dao?: number;
    set_time_alternate_fan_dao?: number;

    // Water pump control
    set_mode_tuong_nuoc?: number;
    set_threshold_low_water_bump?: number;
    set_threshold_high_water_bump?: number;

    // Curtain control
    set_mode_luoi?: number;
    set_auto_mode_luoi?: number;
    set_light_dai_luoi_1?: number;
    set_light_thu_luoi_1?: number;
    set_light_indoor_thu_luoi_1?: number; // New: indoor light threshold for luoi_1
    set_tolerance_light_luoi_1?: number;
    set_light_dai_luoi_2?: number;
    set_light_thu_luoi_2?: number;
    set_light_indoor_thu_luoi_2?: number; // New: indoor light threshold for luoi_2
    set_tolerance_light_luoi_2?: number;
    set_light_dai_luoi_3?: number;
    set_light_thu_luoi_3?: number;
    set_light_indoor_thu_luoi_3?: number; // New: indoor light threshold for luoi_3
    set_tolerance_light_luoi_3?: number;
    set_light_dai_luoi_4?: number;
    set_light_thu_luoi_4?: number;
    set_light_indoor_thu_luoi_4?: number; // New: indoor light threshold for luoi_4
    set_tolerance_light_luoi_4?: number;

    // Environmental settings
    ideal_light_time?: number;
    time_on_cooling?: number;
    time_off_cooling?: number;
    time_cut_off_sunlight?: number;
    time_off_cut_off_sunlight?: number;
    ideal_temperature?: number;
    ideal_humi?: number;
    ideal_light?: number;
}

// Sensor data interface
export interface SensorData {
    ts: number;
    temp_outdoor?: number;
    temp_indoor?: number;
    humi_indoor?: number;
    humi_outdoor?: number;
    light_indoor?: number;
    light_outdoor?: number;
}

// Device status interface
export interface DeviceStatus {
    ts: number;
    quat_1?: boolean;
    quat_2?: boolean;
    quat_3?: boolean;
    quat_4?: boolean;
    quat_5?: boolean;
    quat_6?: boolean;
    quat_dao_1?: boolean;
    quat_dao_2?: boolean;
    quat_dao_3?: boolean;
    bom_nuoc_1?: boolean;
    lamp_1?: boolean;
    lamp_2?: boolean;
    luoi_2_thu?: boolean;
    luoi_2_dai?: boolean;
    luoi_1_thu?: boolean;
    luoi_1_dai?: boolean;
    luoi_3_thu?: boolean;
    luoi_3_dai?: boolean;
    // Index signature to allow string indexing
    [key: string]: boolean | number | undefined;
}

// Fan rotation state
export interface FanRotationState {
    currentGroupIndex: number;
    lastRotationTime: number;
    activeGroup: string[];
}

// Fan control state machine states
export enum FanControlState {
    IDLE = 'idle',
    ROTATION_ACTIVE = 'rotation_active',
    THRESHOLD_ACTIVE = 'threshold_active',
    TRANSITIONING = 'transitioning',
    ERROR = 'error',
    EMERGENCY_STOP = 'emergency_stop'
}

// Fan control mode types
export enum FanControlMode {
    ROTATION = 'rotation',
    THRESHOLD = 'threshold',
    DISABLED = 'disabled'
}

// Transition phase types
export enum TransitionPhase {
    OFF = 'off',
    DELAY = 'delay',
    ON = 'on',
    COMPLETE = 'complete'
}

// Enhanced fan group transition state
export interface FanGroupTransitionState {
    isTransitioning: boolean;
    phase: TransitionPhase;
    previousGroup: string[];
    nextGroup: string[];
    transitionStartTime: number;
    offDelayStartTime: number;
    reason: string;
    retryCount: number;
    maxRetries: number;
}

// Centralized fan control state
export interface CentralizedFanState {
    // Core state
    currentState: FanControlState;
    previousState: FanControlState;
    controlMode: FanControlMode;
    lastStateChange: number;

    // Rotation state management
    rotationState: FanRotationState;

    // Threshold-specific rotation states (per group size)
    thresholdRotationStates: Map<number, FanRotationState>;

    // Transition management
    transitionState: FanGroupTransitionState | null;

    // Error tracking
    errorCount: number;
    lastError: string | null;
    lastErrorTime: number;

    // Resource management
    createdAt: number;
    lastCleanup: number;
    version: number;
}

// State operation result
export interface StateOperationResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    rollbackData?: any;
}

// State validation result
export interface StateValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

// Curtain tolerance timer state
export interface CurtainToleranceTimer {
    luoiId: string;
    startTime: number;
    targetAction: "dai" | "thu";
    lightValue: number;
}

// Modbus mapping result
export interface ModbusMappingResult {
    address: number;
    fc: number;
    value: number | boolean;
}

// Control action interface
export interface ControlAction {
    deviceKey: string;
    value: boolean | number;
    address: number;
    fc: number;
    reason: string;
    delay?: number; // Optional delay in milliseconds before executing action
}

// Control execution result
export interface ControlExecutionResult {
    success: boolean;
    actionsExecuted: ControlAction[];
    errors: string[];
    timestamp: number;
}

// Environment configuration
export interface EnvironmentConfig {
    deviceId: string;
    modbusCoils: Record<string, number>;
    modbusInputRegisters: Record<string, number>;
    modbusHoldingRegisters: Record<string, number>;
}

// Modbus client configuration
export interface ModbusClientConfig {
    type: "TCP" | "RTU";
    host: string;
    tcpPort: number;
    serialPort: string;
    baudRate: number;
    parity: "none" | "even" | "odd";
    unitId: number;
    timeout: number;
    reconnectInterval: number;
}

// Service options interface
export interface ServiceOptions {
    node: any;
    flowContext: any;
    globalContext: any;
    nodeId: string;
    environmentConfig: EnvironmentConfig;
}

// Config service interface
export interface IConfigService {
    getConfig(): AutoControlConfig;
    isConfigValid(): boolean;
    getConfigValue<T>(key: keyof AutoControlConfig): T | undefined;
}

// Sensor service interface
export interface ISensorService {
    getSensorData(): SensorData | null;
    getDeviceStatus(): DeviceStatus | null;
    isDataValid(): boolean;
}

// Modbus service interface
export interface IModbusService {
    writeCoil(address: number, value: boolean): Promise<void>;
    writeRegister(address: number, value: number): Promise<void>;
    readCoil(address: number): Promise<boolean>;
    readRegister(address: number): Promise<number>;
    findCoilAddress(deviceKey: string): number | null;
    executeControlActions(actions: ControlAction[]): Promise<ControlExecutionResult>;
    isReady(): boolean;
    getStatus(): string;
}

// Fan control service interface
export interface IFanControlService {
    processFanControl(config: AutoControlConfig, sensorData: SensorData, deviceStatus: DeviceStatus): Promise<ControlAction[]>;
    processRotationMode(config: AutoControlConfig): Promise<ControlAction[]>;
    processThresholdMode(config: AutoControlConfig, sensorData: SensorData): Promise<ControlAction[]>;
    getFanGroups(groupSize: number): string[][];
}

// Water pump control service interface
export interface IWaterPumpControlService {
    processWaterPumpControl(config: AutoControlConfig, sensorData: SensorData, deviceStatus: DeviceStatus): Promise<ControlAction[]>;
    // K4 priority override method removed - K4 logic completely disabled
}

// Curtain control service interface
export interface ICurtainControlService {
    processCurtainControl(config: AutoControlConfig, sensorData: SensorData, deviceStatus: DeviceStatus): Promise<ControlAction[]>;
    handleLuoiCommand(luoiKey: string, action: "dai" | "thu"): Promise<ControlAction[]>;
    checkToleranceTimers(config: AutoControlConfig, sensorData: SensorData): Promise<ControlAction[]>;
}

// Auto control handler interface
export interface IAutoControlHandler {
    executeControlCycle(): Promise<void>;
    startControlLoop(): void;
    stopControlLoop(): void;
    isControlActive(): boolean;
}

// Logger interface
export interface ILogger {
    log(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}

// Type guards
export type SupportedDataType = "number" | "boolean" | "string";

export function isValidSensorData(data: any): data is SensorData {
    return data && typeof data === 'object' && typeof data.ts === 'number';
}

export function isValidDeviceStatus(data: any): data is DeviceStatus {
    return data && typeof data === 'object' && typeof data.ts === 'number';
}

export function isValidConfig(config: any): config is AutoControlConfig {
    return config && typeof config === 'object';
}
