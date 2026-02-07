import { Node, NodeDef } from 'node-red';

/**
 * Node configuration interface for viis-fertilizer-ec-control
 */
export interface ViisFertilizerEcControlNodeDef extends NodeDef {
    /** Board ID for multi-board Modbus support */
    boardId?: string;

    /** Enable debug logging */
    debugEnable: boolean;
}

/**
 * Lookup point structure (matches database entity)
 */
export interface LookupPoint {
    id?: number;
    device_id: string;
    ec_setpoint: number;
    time_on_valve_01: number;
    time_on_valve_02: number;
    time_on_valve_03: number;
    time_on_valve_04: number;
    time_on_valve_05: number;
    actual_ec_avg?: number;
    actual_flow_01?: number;
    actual_flow_02?: number;
    actual_flow_03?: number;
    actual_flow_04?: number;
    actual_flow_05?: number;
    sample_count: number;
    data_type: 'Actual' | 'Interpolated';
    last_server_sync?: Date;
    last_updated: Date;
}

/**
 * Irrigation run structure (matches database entity)
 */
export interface IrrigationRun {
    id?: number;
    device_id: string;
    schedule_name?: string;
    ec_setpoint: number;
    ec_achieved_avg?: number;
    flow_achieved_01_avg?: number;
    flow_achieved_02_avg?: number;
    flow_achieved_03_avg?: number;
    flow_achieved_04_avg?: number;
    flow_achieved_05_avg?: number;
    time_on_valve_01: number;
    time_on_valve_02: number;
    time_on_valve_03: number;
    time_on_valve_04: number;
    time_on_valve_05: number;
    start_time: Date;
    end_time?: Date;
    duration_seconds?: number;
    status: 'Running' | 'Completed' | 'Failed' | 'Interrupted';
    error_code?: string;
    error_message?: string;
    is_synced_to_server: number;
    synced_at?: Date;
    sync_attempts: number;
    sync_error?: string;
    created_at: Date;
}

/**
 * Valve times structure (for Modbus write)
 */
export interface ValveTimes {
    time_on_valve_01: number;
    time_on_valve_02: number;
    time_on_valve_03: number;
    time_on_valve_04: number;
    time_on_valve_05: number;
}

/**
 * Sensor readings structure (from Modbus read)
 */
export interface SensorReadings {
    current_ec: number;
    current_flow_1: number;
    current_flow_2: number;
    current_flow_3: number;
    current_flow_4: number;
    current_flow_5: number;
    pump_pressure?: number;
    current_temp?: number;
}

/**
 * EC Control state machine states
 */
export type EcControlState =
    | 'IDLE'
    | 'STARTING'
    | 'RAMPING_UP'
    | 'RUNNING'
    | 'STOPPING'
    | 'COMPLETED'
    | 'ERROR';

/**
 * EC Control context (internal state)
 */
export interface EcControlContext {
    state: EcControlState;
    currentRun?: IrrigationRun;
    ecBuffer: number[];
    flowBuffers: {
        flow_1: number[];
        flow_2: number[];
        flow_3: number[];
        flow_4: number[];
        flow_5: number[];
    };
    rampUpEndTime?: number;
    lastAdjustmentTime?: number;
    currentValveTimes: ValveTimes;
    targetEc: number;
}

/**
 * Input message for EC control node
 */
export interface EcControlInputMsg {
    action: 'start' | 'stop' | 'getValveTimes' | 'status';
    ec_setpoint?: number;
    schedule_name?: string;
    duration_seconds?: number;
    payload?: any;
}

/**
 * Output message from EC control node
 */
export interface EcControlOutputMsg {
    topic: string;
    payload: {
        action: string;
        success: boolean;
        data?: any;
        error?: string;
    };
    valve_times?: ValveTimes;
    modbus_writes?: ModbusWrite[];
}

/**
 * Modbus write command
 */
export interface ModbusWrite {
    register: string;
    value: number;
    address?: number;
}

/**
 * Interpolation result
 */
export interface InterpolationResult {
    valveTimes: ValveTimes;
    lowerPoint?: LookupPoint;
    upperPoint?: LookupPoint;
    interpolated: boolean;
    confidence: 'exact' | 'interpolated' | 'extrapolated' | 'default';
}

/**
 * Backend sync request payload
 */
export interface IrrigationFinishedPayload {
    device_id: string;
    start_time: string; // ISO 8601
    end_time: string;   // ISO 8601
    ec_setpoint: number;
    time_on_valve_01: number;
    time_on_valve_02: number;
    time_on_valve_03: number;
    time_on_valve_04: number;
    time_on_valve_05: number;
}

/**
 * ThingsBoard lookup table format (as stored in shared attributes)
 */
export interface TbLookupTableEntry {
    ec_setpoint: number;
    time_on_valve_01: number;
    time_on_valve_02: number;
    time_on_valve_03: number;
    time_on_valve_04: number;
    time_on_valve_05: number;
    actual_ec_avg?: number;
    sample_count?: number;
    data_type?: string;
}
