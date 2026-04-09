/**
 * Shared types and interfaces for Schedule Executor V2
 * These types are used across trigger-v2, logic-v2, and executor-v2 nodes
 */

import { NodeDef } from "node-red";

/**
 * Modbus command interface for executing Modbus operations
 */
export interface ModbusCmd {
    key: string;
    value: number | boolean;
    fc: number;
    unitid: number;
    address: number;
    quantity: number;
}

/**
 * Scale configuration for sensor values
 */
export interface ScaleConfig {
    key: string;
    operation: 'multiply' | 'divide';
    factor: number;
    direction: 'read' | 'write';
}

/**
 * Active Modbus commands tracked by schedule ID
 */
export interface ActiveModbusCommands {
    [scheduleId: string]: ModbusCmd[];
}

/**
 * Manual overrides for Modbus commands
 */
export interface ManualModbusOverrides {
    [key: string]: { fc: number; value: any; timestamp: number };
}

/**
 * Configuration parameter for unmapped keys
 */
export interface ConfigParameter {
    key: string;
    value: any;
    type: 'number' | 'boolean' | 'string';
    timestamp: number;
    scheduleId: string;
}

/**
 * Schedule configuration values
 */
export interface ScheduleConfigValues {
    [key: string]: any;
}

/**
 * RPC payload interface for remote commands
 */
export interface RpcPayload {
    method: string;
    params?: {
        scheduleId?: string;
        [key: string]: any;
    };
}

/**
 * RPC control result
 */
export interface RpcControlResult {
    success: boolean;
    action: 'modbus' | 'config';
    result?: any;
}

/**
 * Control mode for device operation
 */
export type ControlMode = 'AUTO' | 'MANUAL' | 'OFF';

/**
 * Safety conditions that must be met before execution
 */
export interface SafetyConditions {
    water_level_low: boolean;
    water_level_high: boolean;
    emergency_stop: boolean;
    pump_error: boolean;
    flow_error: boolean;
    ec_error: boolean;
    ph_error: boolean;
    [key: string]: boolean;
}

/**
 * Schedule trigger output interface
 */
export interface ScheduleTriggerOutput {
    schedules: TabiotSchedule[];
    timestamp: number;
    checkInterval: number;
}

/**
 * Logic control input interface
 */
export interface LogicControlInput {
    schedules: TabiotSchedule[];
    commands: ModbusCmd[];
}

/**
 * Logic control output interface
 */
export interface LogicControlOutput {
    allowed: boolean;
    commands: ModbusCmd[];
    mode: ControlMode;
    conditions: SafetyConditions;
    blockedReason?: string;
}

/**
 * Executor input interface
 */
export interface ExecutorInput {
    commands: {
        holdingCommands: ModbusCmd[];
        coilCommands: ModbusCmd[];
    };
    schedule?: TabiotSchedule;
    verifyAfterWrite: boolean;
}

/**
 * Executor output interface
 */
export interface ExecutorOutput {
    success: boolean;
    executedCommands: number;
    failedCommands: number;
    errorMessage?: string;
}

/**
 * Node definition for Schedule Executor V2 nodes
 */
export interface ScheduleExecutorV2NodeDef extends NodeDef {
    name: string;
    description: string;
    debugEnable: boolean;
    verifyAfterWrite?: boolean;
    boardMode?: 'auto' | 'single' | 'multi';
    boardId?: string;
    cleanupInterval?: number;
    checkInterval?: number;
}

/**
 * Tabiot Schedule interface (from ORM entity)
 */
export interface TabiotSchedule {
    name: string;
    label: string;
    device_label?: string;
    status: string;
    start_time: string;
    end_time: string;
    start_date?: string;
    end_date?: string;
    interval?: string;
    enable: number;
    is_deleted: number;
    device_id: string;
    machine_type?: string;
    action?: string;
    created: Date;
    modified: Date;
    type: 'fixed' | 'dynamic';
    deleted: number | null;
    schedulePlan?: {
        enable: number;
    };
}

/**
 * Schedule status history
 */
export interface ScheduleStatusHistory {
    [scheduleName: string]: string;
}

/**
 * Last check timestamps for schedules
 */
export interface ScheduleLastCheckTimestamps {
    [scheduleName: string]: number;
}
