import { NodeDef, Node } from "node-red";

/**
 * Node configuration interface
 */
export interface ViisModbusGetterNodeDef extends NodeDef {
    name: string;
    enableLogging: boolean; // Add logging enable/disable option
    boardMode?: 'auto' | 'single' | 'multi'; // Board selection mode
    boardId?: string; // Board ID for multi-board mode
}

/**
 * Modbus request payload interface
 */
export interface ModbusRequestPayload {
    fc: number;          // Function code (1, 2, 3, 4)
    unitid: number;      // Unit ID
    address: number;     // Starting address
    quantity: number;    // Number of registers/coils to read
    boardId?: string;    // Optional board ID for multi-board mode
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
    enableLogging: boolean; // Add logging flag to service options
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
