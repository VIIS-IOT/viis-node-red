import { NodeDef, Node } from "node-red";

/**
 * Node configuration interface
 */
export interface ViisModbusGetterNodeDef extends NodeDef {
    name: string;
}

/**
 * Modbus request payload interface
 */
export interface ModbusRequestPayload {
    fc: number;          // Function code (1, 2, 3, 4)
    unitid: number;      // Unit ID
    address: number;     // Starting address
    quantity: number;    // Number of registers/coils to read
}

/**
 * Modbus response interface
 */
export interface ModbusResponse {
    address: number;
    data: number[] | boolean[];
}

/**
 * Service options interface
 */
export interface ServiceOptions {
    node: Node;
    nodeId: string;
}

/**
 * Node status interface
 */
export interface NodeStatus {
    fill: "red" | "green" | "yellow" | "blue" | "grey";
    shape: "ring" | "dot";
    text: string;
}

/**
 * Error response interface
 */
export interface ErrorResponse {
    error: string;
    code?: string;
    timestamp: number;
}

/**
 * Success response interface
 */
export interface SuccessResponse {
    success: true;
    data: number[] | boolean[];
    address: number;
    quantity: number;
    functionCode: number;
    timestamp: number;
}

/**
 * Type guard for ModbusRequestPayload
 */
export function isValidModbusRequestPayload(payload: any): payload is ModbusRequestPayload {
    return (
        payload &&
        typeof payload === 'object' &&
        typeof payload.fc === 'number' &&
        typeof payload.unitid === 'number' &&
        typeof payload.address === 'number' &&
        typeof payload.quantity === 'number'
    );
}
