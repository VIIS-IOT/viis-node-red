import { NodeDef } from "node-red";

export interface ModbusCmd {
    key: string;
    value: number | boolean;
    fc: number;
    unitid: number;
    address: number;
    quantity: number;
}

export interface ScaleConfig {
    key: string;
    operation: 'multiply' | 'divide';
    factor: number;
    direction: 'read' | 'write';
}

export interface ActiveModbusCommands {
    [scheduleId: string]: ModbusCmd[];
}


export interface ScheduleExecutorNodeDef extends NodeDef {
    name: string;
    scheduleInterval: number;
    description: string;
}




export interface RpcPayload {
    method: string;
    params?: {
        scheduleId?: string;
        [key: string]: any; // Support for RPC control commands
    };
}


export interface ManualModbusOverrides {
    [key: string]: { fc: number; value: any; timestamp: number };
}

export interface ScheduleConfigValues {
    [key: string]: any;
}

export interface RpcControlResult {
    success: boolean;
    action: 'modbus' | 'config';
    result?: any;
}

export interface ConfigParameter {
    key: string;
    value: any;
    type: 'number' | 'boolean' | 'string';
    timestamp: number;
    scheduleId: string;
}