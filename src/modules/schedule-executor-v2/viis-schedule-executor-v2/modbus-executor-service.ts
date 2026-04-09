/**
 * Modbus Executor Service V2
 * Responsibility: Execute Modbus commands and verify writes
 * 
 * This service extracts the Modbus execution logic from the original ScheduleExecutor
 * It focuses ONLY on:
 * - Executing Modbus commands (coils and holding registers)
 * - Verifying writes
 * - Tracking active commands
 * - Resetting commands
 */

import { Node } from "node-red";
import { ModbusClientCore } from "../../../core/modbus-client";
import {
    ModbusCmd,
    TabiotSchedule,
    ActiveModbusCommands,
    ExecutorInput,
    ExecutorOutput,
    ScaleConfig
} from "../common/types";
import { GlobalContextHelper } from "../../../ultils/global-context-helper";

export class ModbusExecutorService {
    private node: Node;
    private globalHelper: GlobalContextHelper;
    private debugEnable: boolean;
    private verifyAfterWrite: boolean;

    constructor(node: Node, verifyAfterWrite: boolean = true, debugEnable: boolean = false) {
        this.node = node;
        this.verifyAfterWrite = verifyAfterWrite;
        this.debugEnable = debugEnable;
        this.globalHelper = new GlobalContextHelper(node.context());
    }

    /**
     * Debug logging helper
     */
    private debugLog(message: string): void {
        if (this.debugEnable) {
            this.node.warn(message);
        }
    }

    /**
     * Scale a value based on configuration
     */
    private scaleValue(key: string, value: number, direction: 'read' | 'write'): number {
        const scaleConfigs = (this.node.context().global.get("scaleConfigs") as ScaleConfig[]) || [];
        const config = scaleConfigs.find(c => c.key === key && c.direction === direction);

        if (!config) {
            return value;
        }

        const shouldMultiply = config.operation === 'multiply';
        return shouldMultiply ? value * config.factor : value / config.factor;
    }

    /**
     * Sleep/delay utility
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Execute holding register commands
     */
    private async executeHoldingCommands(
        modbusClient: ModbusClientCore,
        commands: ModbusCmd[],
        schedule?: TabiotSchedule
    ): Promise<{ success: number; failed: number }> {
        let success = 0;
        let failed = 0;

        for (const cmd of commands) {
            try {
                const writeValue = this.scaleValue(cmd.key, cmd.value as number, 'write');
                await modbusClient.writeRegister(cmd.address, Number(writeValue));
                this.debugLog(`✓ Wrote register ${cmd.key} at ${cmd.address} = ${writeValue}`);
                await this.delay(100);
                success++;
            } catch (error) {
                const errorMessage = (error as Error).message;
                if (schedule) {
                    this.node.warn(`❌ ${schedule.name} | Failed to write holding register ${cmd.key} at ${cmd.address} | ${errorMessage}`);
                }
                this.node.error(`Error executing holding command ${cmd.key}: ${errorMessage}`);
                failed++;
            }
        }

        return { success, failed };
    }

    /**
     * Execute coil commands with proper sequencing
     * Valves first, then pumps/power with delays
     */
    private async executeCoilCommands(
        modbusClient: ModbusClientCore,
        commands: ModbusCmd[],
        schedule?: TabiotSchedule,
        isStarting?: boolean,
        isFinishing?: boolean
    ): Promise<{ success: number; failed: number }> {
        let success = 0;
        let failed = 0;

        // Categorize coils
        const valveCoils = commands.filter(cmd => cmd.key.includes('valve_'));
        const controlCoils = commands.filter(cmd =>
            cmd.key.includes('pump') || cmd.key.includes('power')
        );
        const otherCoils = commands.filter(cmd =>
            !cmd.key.includes('valve_') && !cmd.key.includes('pump') && !cmd.key.includes('power')
        );

        if (isStarting) {
            // START sequence: valves first, delay, then pumps/power
            this.debugLog(`🔧 START sequence for ${schedule?.name}`);
            this.debugLog(`  ├─ Writing ${valveCoils.length} valve coils`);
            this.debugLog(`  ├─ Delay 5 seconds`);
            this.debugLog(`  └─ Writing ${controlCoils.length} pump/power coils`);

            // Write valves
            for (const cmd of valveCoils) {
                try {
                    await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                    this.debugLog(`✓ Wrote valve ${cmd.key} at ${cmd.address}`);
                    await this.delay(100);
                    success++;
                } catch (error) {
                    this.node.warn(`❌ ${schedule?.name} | Failed to write valve ${cmd.key} | ${(error as Error).message}`);
                    this.node.error(`Error executing valve command ${cmd.key}: ${(error as Error).message}`);
                    failed++;
                }
            }

            // Write other coils
            for (const cmd of otherCoils) {
                try {
                    await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                    this.debugLog(`✓ Wrote coil ${cmd.key} at ${cmd.address}`);
                    await this.delay(100);
                    success++;
                } catch (error) {
                    this.node.error(`Error executing coil command ${cmd.key}: ${(error as Error).message}`);
                    failed++;
                }
            }

            // Delay before pumps/power
            if (controlCoils.length > 0) {
                this.debugLog('⏱️ Delaying 5 seconds before pumps/power');
                await this.delay(5000);

                // Write pumps/power
                for (const cmd of controlCoils) {
                    try {
                        await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                        this.debugLog(`✓ Wrote pump/power ${cmd.key} at ${cmd.address}`);
                        await this.delay(100);
                        success++;
                    } catch (error) {
                        this.node.error(`Error executing control command ${cmd.key}: ${(error as Error).message}`);
                        failed++;
                    }
                }
            }
        } else if (isFinishing) {
            // FINISH sequence: pumps/power first, delay, then valves
            this.debugLog(`🛑 FINISH sequence for ${schedule?.name}`);
            this.debugLog(`  ├─ Writing ${controlCoils.length} pump/power coils`);
            this.debugLog(`  ├─ Delay 5 seconds`);
            this.debugLog(`  └─ Writing ${valveCoils.length} valve coils`);

            // Write pumps/power first
            for (const cmd of controlCoils) {
                try {
                    await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                    this.debugLog(`✓ Wrote pump/power ${cmd.key} at ${cmd.address}`);
                    await this.delay(100);
                    success++;
                } catch (error) {
                    this.node.warn(`❌ ${schedule?.name} | Failed to write pump/power ${cmd.key} | ${(error as Error).message}`);
                    this.node.error(`Error executing control command ${cmd.key}: ${(error as Error).message}`);
                    failed++;
                }
            }

            // Write other coils
            for (const cmd of otherCoils) {
                try {
                    await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                    this.debugLog(`✓ Wrote coil ${cmd.key} at ${cmd.address}`);
                    await this.delay(100);
                    success++;
                } catch (error) {
                    this.node.error(`Error executing coil command ${cmd.key}: ${(error as Error).message}`);
                    failed++;
                }
            }

            // Delay before valves
            if (valveCoils.length > 0) {
                this.debugLog('⏱️ Delaying 5 seconds before valves');
                await this.delay(5000);

                // Write valves
                for (const cmd of valveCoils) {
                    try {
                        await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                        this.debugLog(`✓ Wrote valve ${cmd.key} at ${cmd.address}`);
                        await this.delay(100);
                        success++;
                    } catch (error) {
                        this.node.error(`Error executing valve command ${cmd.key}: ${(error as Error).message}`);
                        failed++;
                    }
                }
            }
        } else {
            // Default sequence: no special ordering
            this.debugLog('Executing coils in default order');

            for (const cmd of commands) {
                try {
                    await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                    this.debugLog(`✓ Wrote coil ${cmd.key} at ${cmd.address}`);
                    await this.delay(100);
                    success++;
                } catch (error) {
                    this.node.error(`Error executing coil command ${cmd.key}: ${(error as Error).message}`);
                    failed++;
                }
            }
        }

        return { success, failed };
    }

    /**
     * Main execution function - execute all Modbus commands
     */
    async executeModbusCommands(
        modbusClient: ModbusClientCore,
        commands: { holdingCommands: ModbusCmd[]; coilCommands: ModbusCmd[] },
        schedule?: TabiotSchedule
    ): Promise<void> {
        this.debugLog(`Executing ${commands.holdingCommands.length} holding commands and ${commands.coilCommands.length} coil commands`);

        // Determine if starting or finishing
        const isStarting = schedule && schedule.status === 'running';
        const isFinishing = schedule && schedule.status === 'finished';

        // Execute holding registers first
        if (commands.holdingCommands.length > 0) {
            this.debugLog(`Executing ${commands.holdingCommands.length} holding register commands`);
            await this.executeHoldingCommands(modbusClient, commands.holdingCommands, schedule);
        }

        // Execute coils with proper sequencing
        if (commands.coilCommands.length > 0) {
            await this.executeCoilCommands(modbusClient, commands.coilCommands, schedule, isStarting, isFinishing);
        }

        this.debugLog('Modbus command execution complete');
    }

    /**
     * Verify Modbus writes by reading back values
     */
    async verifyModbusWrite(modbusClient: ModbusClientCore, commands: ModbusCmd[]): Promise<boolean> {
        // Separate coils and holding registers
        const coilCommands = commands.filter(cmd => cmd.fc === 5);
        const holdingCommands = commands.filter(cmd => cmd.fc === 6);

        // Log if verification is disabled for holding registers
        if (!this.verifyAfterWrite && holdingCommands.length > 0) {
            this.debugLog(`Verification disabled for ${holdingCommands.length} holding commands`);
        }

        // Commands to verify (always verify coils, conditionally verify holding)
        const commandsToVerify = [
            ...coilCommands,
            ...(this.verifyAfterWrite ? holdingCommands : [])
        ];

        if (commandsToVerify.length === 0) {
            this.debugLog('No commands to verify');
            return true;
        }

        this.debugLog(`Verifying ${commandsToVerify.length} commands (${coilCommands.length} coils${this.verifyAfterWrite ? `, ${holdingCommands.length} holding` : ''})`);

        for (const cmd of commandsToVerify) {
            try {
                let readValue: number | boolean;

                if (cmd.fc === 5) {
                    // Read coil
                    const readResult = await modbusClient.readCoils(cmd.address, 1);
                    readValue = Boolean(readResult.data[0]);
                } else if (cmd.fc === 6) {
                    // Read holding register
                    const readResult = await modbusClient.readHoldingRegisters(cmd.address, 1);
                    const rawValue = Number(readResult.data[0]);
                    readValue = this.scaleValue(cmd.key, rawValue, 'read');
                } else {
                    continue;
                }

                // Compare with expected value
                this.debugLog(`Verify ${cmd.key}: expected=${cmd.value}, read=${readValue}`);

                if (readValue !== cmd.value) {
                    this.node.warn(`❌ VERIFICATION FAILED: ${cmd.key} at ${cmd.address} | Expected: ${cmd.value}, Got: ${readValue}`);
                    return false;
                }

                this.debugLog(`✓ Verified ${cmd.key} at ${cmd.address}`);
            } catch (error) {
                this.node.warn(`❌ VERIFICATION ERROR: ${cmd.key} | ${(error as Error).message}`);
                this.node.error(`Error verifying ${cmd.key}: ${(error as Error).message}`);
                return false;
            }
        }

        this.node.warn(`✅ VERIFICATION SUCCESS: ${commandsToVerify.length} commands verified`);
        return true;
    }

    /**
     * Reset Modbus commands to safe state
     */
    async resetModbusCommands(
        modbusClient: ModbusClientCore,
        commands: ModbusCmd[]
    ): Promise<boolean> {
        this.debugLog(`Resetting ${commands.length} commands to safe state`);

        let allSuccess = true;

        for (const cmd of commands) {
            try {
                if (cmd.fc === 5) {
                    // Reset coil to false
                    await modbusClient.writeCoil(cmd.address, false);
                    this.debugLog(`✓ Reset coil ${cmd.key} to OFF`);
                } else if (cmd.fc === 6) {
                    // Reset holding register to 0
                    await modbusClient.writeRegister(cmd.address, 0);
                    this.debugLog(`✓ Reset holding ${cmd.key} to 0`);
                }
                await this.delay(100);
            } catch (error) {
                this.node.warn(`❌ Failed to reset ${cmd.key}: ${(error as Error).message}`);
                this.node.error(`Error resetting ${cmd.key}: ${(error as Error).message}`);
                allSuccess = false;
            }
        }

        if (allSuccess) {
            this.debugLog(`✅ All ${commands.length} commands reset successfully`);
        } else {
            this.node.warn(`⚠️ Some commands failed to reset`);
        }

        return allSuccess;
    }

    /**
     * Track active commands for a schedule
     */
    trackActiveCommands(scheduleId: string, commands: ModbusCmd[]): void {
        const globalContext = this.node.context().global;
        const activeCommands = (globalContext.get('activeModbusCommands') as ActiveModbusCommands) || {};

        this.debugLog(`Tracking ${commands.length} active commands for ${scheduleId}`);
        activeCommands[scheduleId] = commands;
        globalContext.set('activeModbusCommands', activeCommands);
    }

    /**
     * Clear active commands for a schedule
     */
    clearActiveCommands(scheduleId: string): void {
        const globalContext = this.node.context().global;
        const activeCommands = (globalContext.get('activeModbusCommands') as ActiveModbusCommands) || {};

        if (activeCommands[scheduleId]) {
            this.debugLog(`Clearing ${activeCommands[scheduleId].length} active commands for ${scheduleId}`);
            delete activeCommands[scheduleId];
            globalContext.set('activeModbusCommands', activeCommands);
        }
    }

    /**
     * Get active commands for a schedule
     */
    getActiveCommands(scheduleId: string): ModbusCmd[] {
        const globalContext = this.node.context().global;
        const activeCommands = (globalContext.get('activeModbusCommands') as ActiveModbusCommands) || {};
        return activeCommands[scheduleId] || [];
    }

    /**
     * Check if commands can be executed (no conflicts)
     */
    canExecuteCommands(commands: ModbusCmd[], excludeScheduleId?: string): boolean {
        const globalContext = this.node.context().global;
        const activeCommands = (globalContext.get('activeModbusCommands') as ActiveModbusCommands) || {};

        const activeCmdKey = (cmd: ModbusCmd) => `${cmd.fc}_${cmd.address}`;
        const activeCmdSet = new Set<string>();

        // Build set of active command keys (excluding specified schedule)
        for (const scheduleId in activeCommands) {
            if (scheduleId === excludeScheduleId) continue;
            
            for (const cmd of activeCommands[scheduleId]) {
                activeCmdSet.add(activeCmdKey(cmd));
            }
        }

        // Check for conflicts
        for (const cmd of commands) {
            if (activeCmdSet.has(activeCmdKey(cmd))) {
                this.debugLog(`⚠️ Conflict detected: ${cmd.key} at ${cmd.address} is already active`);
                return false;
            }
        }

        return true;
    }

    /**
     * Main executor entry point
     */
    async execute(input: ExecutorInput): Promise<ExecutorOutput> {
        this.debugLog(`🚀 Executor starting for ${input.schedule?.name || 'unknown schedule'}`);

        try {
            // Note: Modbus client should be passed in from the node
            // This is a simplified version - actual implementation would need client injection
            return {
                success: false,
                executedCommands: 0,
                failedCommands: 0,
                errorMessage: 'Modbus client not injected - use executeModbusCommands directly'
            };
        } catch (error) {
            const errorMessage = (error as Error).message;
            this.node.error(`Executor failed: ${errorMessage}`);
            
            return {
                success: false,
                executedCommands: 0,
                failedCommands: 0,
                errorMessage
            };
        }
    }
}
