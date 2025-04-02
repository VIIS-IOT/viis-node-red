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
    mqttBroker: string;
    scheduleInterval: number;
    description: string;
}


export interface ModbusCmd {
    key: string,
    value: number | boolean
    fc: number,
    unitid: number,
    address: number,
    quantity: number
}

export interface RpcPayload {
    method: string;
    params?: {
        scheduleId?: string;
    };
}


export interface ManualModbusOverrides {
    [key: string]: { fc: number; value: any; timestamp: number };
}