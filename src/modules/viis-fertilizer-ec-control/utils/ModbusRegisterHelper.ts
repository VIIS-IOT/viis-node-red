/**
 * Modbus Register Lookup Helper
 *
 * Provides utility functions to lookup Modbus register addresses
 * from global context, similar to viis-rpc-control pattern.
 */

import { Node, NodeContext } from 'node-red';

export class ModbusRegisterHelper {
    private node: Node;
    private globalContext: any;
    private boardId: string;

    constructor(node: Node, nodeContext: NodeContext, boardId: string = 'board1') {
        this.node = node;
        this.globalContext = nodeContext.global;
        this.boardId = boardId;
    }

    /**
     * Get holding register address by key
     * @param key Register key (e.g., 'control_mode', 'current_ec')
     * @returns Modbus address or undefined if not found
     */
    getHoldingAddress(key: string): number | undefined {
        const mapKey = `modbus_${this.boardId}_holding_registers`;
        const holdingMap = this.globalContext.get(mapKey) || {};
        const address = holdingMap[key];

        if (address === undefined || address === 999) {
            // 999 is placeholder for unused registers
            return undefined;
        }

        return address;
    }

    /**
     * Get coil address by key
     * @param key Coil key (e.g., 'power', 'main_pump')
     * @returns Modbus address or undefined if not found
     */
    getCoilAddress(key: string): number | undefined {
        const mapKey = `modbus_${this.boardId}_coils`;
        const coilMap = this.globalContext.get(mapKey) || {};
        const address = coilMap[key];

        if (address === undefined || address === 999) {
            return undefined;
        }

        return address;
    }

    /**
     * Get all holding register mappings
     * @returns Object mapping keys to addresses
     */
    getAllHoldingRegisters(): Record<string, number> {
        const mapKey = `modbus_${this.boardId}_holding_registers`;
        return this.globalContext.get(mapKey) || {};
    }

    /**
     * Get all coil mappings
     * @returns Object mapping keys to addresses
     */
    getAllCoils(): Record<string, number> {
        const mapKey = `modbus_${this.boardId}_coils`;
        return this.globalContext.get(mapKey) || {};
    }

    /**
     * Validate that required keys exist in global context
     * @param requiredHoldingKeys Array of required holding register keys
     * @param requiredCoilKeys Array of required coil keys
     * @returns true if all keys found, false otherwise
     */
    validateKeys(requiredHoldingKeys: string[], requiredCoilKeys: string[] = []): boolean {
        const holdingMap = this.getAllHoldingRegisters();
        const coilMap = this.getAllCoils();

        const missingKeys: string[] = [];

        for (const key of requiredHoldingKeys) {
            const addr = holdingMap[key];
            if (addr === undefined || addr === 999) {
                missingKeys.push(`holding:${key}`);
            }
        }

        for (const key of requiredCoilKeys) {
            const addr = coilMap[key];
            if (addr === undefined || addr === 999) {
                missingKeys.push(`coil:${key}`);
            }
        }

        if (missingKeys.length > 0) {
            this.node.error(`Missing Modbus mappings: ${missingKeys.join(', ')}`);
            return false;
        }

        return true;
    }

    /**
     * Log current register mappings (for debugging)
     */
    logMappings(): void {
        const holdingMap = this.getAllHoldingRegisters();
        const coilMap = this.getAllCoils();

        this.node.warn(`[Modbus-${this.boardId}] Holding Registers: ${JSON.stringify(holdingMap)}`);
        this.node.warn(`[Modbus-${this.boardId}] Coils: ${JSON.stringify(coilMap)}`);
    }
}
