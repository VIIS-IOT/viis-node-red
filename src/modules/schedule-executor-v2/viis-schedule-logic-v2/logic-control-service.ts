/**
 * Logic Control Service V2
 * Responsibility: Check control modes and safety conditions before allowing execution
 * 
 * This service extracts the logic control from the original ScheduleExecutor
 * It focuses ONLY on checking if schedules are allowed to run based on:
 * - Control mode (AUTO/MANUAL/OFF)
 * - Safety conditions (water level, emergency stop, errors)
 * - Command overlaps
 */

import { Node } from "node-red";
import {
    TabiotSchedule,
    ModbusCmd,
    LogicControlInput,
    LogicControlOutput,
    ControlMode,
    SafetyConditions,
    ActiveModbusCommands,
    ManualModbusOverrides
} from "../common/types";
import { GlobalContextHelper } from "../../../ultils/global-context-helper";
import { ProtectionGateService } from "../../viis-device-protection/services/protection-gate-service";

export class LogicControlService {
    private node: Node;
    private globalHelper: GlobalContextHelper;
    private debugEnable: boolean;
    private protectionGate: ProtectionGateService | null = null;

    constructor(node: Node, debugEnable: boolean = false) {
        this.node = node;
        this.debugEnable = debugEnable;
        this.globalHelper = new GlobalContextHelper(node.context());
    }

    /**
     * Set protection gate service for coil write protection
     */
    setProtectionGate(gate: ProtectionGateService): void {
        this.protectionGate = gate;
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
     * Read control mode from global context
     * @returns ControlMode - AUTO, MANUAL, or OFF
     */
    async readControlMode(): Promise<ControlMode> {
        try {
            // Read from global context (set by RPC commands or other nodes)
            const globalContext = this.node.context().global;
            const controlModeValue = globalContext.get('CONTROL_MODE') as number | null;

            if (controlModeValue !== null && controlModeValue !== undefined) {
                const mode = Number(controlModeValue);
                const mappedMode = this.mapControlModeValue(mode);
                this.debugLog(`Control mode: ${mappedMode} (value: ${controlModeValue})`);
                return mappedMode;
            }

            // Default to AUTO if not set
            this.debugLog("Control mode not set, defaulting to AUTO");
            return 'AUTO';
        } catch (error) {
            this.node.warn(`Error reading control mode: ${(error as Error).message}`);
            return 'AUTO'; // Default to AUTO on error
        }
    }

    /**
     * Map numeric control mode value to enum
     */
    private mapControlModeValue(value: number): ControlMode {
        // Typical mapping: 0=OFF, 1=AUTO, 2=MANUAL
        switch (value) {
            case 0:
                return 'OFF';
            case 1:
                return 'AUTO';
            case 2:
                return 'MANUAL';
            default:
                this.debugLog(`Unknown control mode value: ${value}, defaulting to AUTO`);
                return 'AUTO';
        }
    }

    /**
     * Read safety conditions from global context or Modbus
     * @returns SafetyConditions object
     */
    async readSafetyConditions(): Promise<SafetyConditions> {
        try {
            // Read from global context (populated by monitoring nodes)
            const globalContext = this.node.context().global;
            
            const conditions: SafetyConditions = {
                water_level_low: Boolean(globalContext.get('water_level_low') || false),
                water_level_high: Boolean(globalContext.get('water_level_high') || false),
                emergency_stop: Boolean(globalContext.get('emergency_stop') || false),
                pump_error: Boolean(globalContext.get('pump_error') || false),
                flow_error: Boolean(globalContext.get('flow_error') || false),
                ec_error: Boolean(globalContext.get('ec_error') || false),
                ph_error: Boolean(globalContext.get('ph_error') || false)
            };

            this.debugLog(`Safety conditions: ${JSON.stringify(conditions)}`);
            return conditions;
        } catch (error) {
            this.node.warn(`Error reading safety conditions: ${(error as Error).message}`);
            // Return safe defaults (all false = no blocking conditions)
            return {
                water_level_low: false,
                water_level_high: false,
                emergency_stop: false,
                pump_error: false,
                flow_error: false,
                ec_error: false,
                ph_error: false
            };
        }
    }

    /**
     * Check if execution is allowed based on control mode
     * @param mode - Current control mode
     * @returns Object with allowed flag and optional blocked reason
     */
    checkControlMode(mode: ControlMode): { allowed: boolean; blockedReason?: string } {
        if (mode === 'OFF') {
            this.debugLog(`❌ Execution BLOCKED: Control mode is OFF`);
            return {
                allowed: false,
                blockedReason: 'Control mode is OFF'
            };
        }

        if (mode === 'MANUAL') {
            this.debugLog(`⚠️ Control mode is MANUAL - schedules may be overridden`);
            // MANUAL mode allows execution but may have overrides
            return { allowed: true };
        }

        // AUTO mode
        this.debugLog(`✅ Control mode is AUTO - execution allowed`);
        return { allowed: true };
    }

    /**
     * Check if execution is allowed based on safety conditions
     * @param conditions - Current safety conditions
     * @returns Object with allowed flag and optional blocked reason
     */
    checkSafetyConditions(conditions: SafetyConditions): { allowed: boolean; blockedReason?: string } {
        // Critical blocking conditions
        if (conditions.emergency_stop) {
            this.debugLog(`🚨 Execution BLOCKED: Emergency stop is active`);
            return {
                allowed: false,
                blockedReason: 'Emergency stop is active'
            };
        }

        if (conditions.water_level_low) {
            this.debugLog(`💧 Execution BLOCKED: Water level is low`);
            return {
                allowed: false,
                blockedReason: 'Water level is low'
            };
        }

        if (conditions.pump_error) {
            this.debugLog(`⚙️ Execution BLOCKED: Pump error detected`);
            return {
                allowed: false,
                blockedReason: 'Pump error detected'
            };
        }

        if (conditions.flow_error) {
            this.debugLog(`🌊 Execution BLOCKED: Flow error detected`);
            return {
                allowed: false,
                blockedReason: 'Flow error detected'
            };
        }

        // Non-critical warnings (don't block but log)
        if (conditions.ec_error) {
            this.debugLog(`⚠️ WARNING: EC error detected (not blocking)`);
        }

        if (conditions.ph_error) {
            this.debugLog(`⚠️ WARNING: pH error detected (not blocking)`);
        }

        this.debugLog(`✅ Safety conditions check passed`);
        return { allowed: true };
    }

    /**
     * Check for command overlaps with active schedules
     * @param newCommands - Commands to check
     * @param activeCommands - Currently active commands
     * @returns true if there's an overlap
     */
    hasCommandOverlap(newCommands: ModbusCmd[], activeCommands: ActiveModbusCommands): boolean {
        const activeCmdKey = (cmd: ModbusCmd) => `${cmd.fc}_${cmd.address}`;
        const activeCmdSet = new Set<string>();

        // Build set of active command keys
        for (const scheduleId in activeCommands) {
            for (const cmd of activeCommands[scheduleId]) {
                activeCmdSet.add(activeCmdKey(cmd));
            }
        }

        // Check for overlaps
        for (const cmd of newCommands) {
            if (activeCmdSet.has(activeCmdKey(cmd))) {
                this.debugLog(`⚠️ Command overlap detected: ${cmd.key} at ${cmd.address}`);
                return true;
            }
        }

        return false;
    }

    /**
     * Get manual overrides for commands
     * @param commands - Commands to check
     * @returns Array of overridden commands
     */
    getManualOverrides(commands: ModbusCmd[]): { key: string; overrideValue: any }[] {
        const globalContext = this.node.context().global;
        const manualOverrides: ManualModbusOverrides = (globalContext.get('manualModbusOverrides') as ManualModbusOverrides) || {};
        const overrides: { key: string; overrideValue: any }[] = [];

        for (const cmd of commands) {
            const overrideKey = `${cmd.fc}_${cmd.address}`;
            if (manualOverrides[overrideKey]) {
                const override = manualOverrides[overrideKey];
                this.debugLog(`⚠️ Manual override detected for ${cmd.key}: ${override.value}`);
                overrides.push({
                    key: cmd.key,
                    overrideValue: override.value
                });
            }
        }

        return overrides;
    }

    /**
     * Apply manual overrides to commands
     * @param commands - Original commands
     * @returns Commands with overrides applied
     */
    applyManualOverrides(commands: ModbusCmd[]): ModbusCmd[] {
        const globalContext = this.node.context().global;
        const manualOverrides: ManualModbusOverrides = (globalContext.get('manualModbusOverrides') as ManualModbusOverrides) || {};
        
        return commands.map(cmd => {
            const overrideKey = `${cmd.fc}_${cmd.address}`;
            if (manualOverrides[overrideKey]) {
                const override = manualOverrides[overrideKey];
                this.debugLog(`Applying manual override to ${cmd.key}: ${cmd.value} -> ${override.value}`);
                return {
                    ...cmd,
                    value: override.value
                };
            }
            return cmd;
        });
    }

    /**
     * Main control check - combines all checks
     * @param input - Input with schedules and commands
     * @returns LogicControlOutput with decision
     */
    async checkBeforeExecute(input: LogicControlInput): Promise<LogicControlOutput> {
        this.debugLog(`🔍 Checking execution permissions for ${input.schedules.length} schedules`);

        // 1. Check control mode
        const mode = await this.readControlMode();
        const modeCheck = this.checkControlMode(mode);

        if (!modeCheck.allowed) {
            return {
                allowed: false,
                commands: [],
                mode,
                conditions: await this.readSafetyConditions(),
                blockedReason: modeCheck.blockedReason
            };
        }

        // 2. Check safety conditions
        const conditions = await this.readSafetyConditions();
        const safetyCheck = this.checkSafetyConditions(conditions);

        if (!safetyCheck.allowed) {
            return {
                allowed: false,
                commands: input.commands,
                mode,
                conditions,
                blockedReason: safetyCheck.blockedReason
            };
        }

        // 3. Check for command overlaps
        const activeCommands: ActiveModbusCommands = (this.node.context().global.get('activeModbusCommands') as ActiveModbusCommands) || {};
        
        if (this.hasCommandOverlap(input.commands, activeCommands)) {
            this.debugLog(`⚠️ Command overlap detected - execution may be blocked`);
            // Note: Overlaps don't necessarily block, but we log them
        }

        // 3.5 Protection gate check for coil commands
        let filteredCommands = input.commands;
        if (this.protectionGate) {
            const blockedCommands: { key: string; reason: string }[] = [];
            const allowedCommands: ModbusCmd[] = [];

            for (const cmd of input.commands) {
                if (cmd.fc === 5) { // Coil write
                    const gate = this.protectionGate.checkGate(cmd.key, Boolean(cmd.value), 'schedule');
                    if (!gate.allowed) {
                        blockedCommands.push({ key: cmd.key, reason: gate.reason });
                        this.debugLog(`🛡️ Protection BLOCKED: ${cmd.key}=${cmd.value} - ${gate.reason}`);
                    } else {
                        allowedCommands.push(cmd);
                    }
                } else {
                    allowedCommands.push(cmd);
                }
            }

            if (blockedCommands.length > 0) {
                this.debugLog(`🛡️ Protection blocked ${blockedCommands.length}/${input.commands.length} coil commands`);
                // Log blocked commands but don't block entire schedule
                for (const blocked of blockedCommands) {
                    this.node.warn(`[PROTECTION] Schedule coil blocked: ${blocked.key} - ${blocked.reason}`);
                }
            }

            filteredCommands = allowedCommands;
        }

        // 4. Apply manual overrides
        const finalCommands = this.applyManualOverrides(filteredCommands);
        const overrides = this.getManualOverrides(input.commands);

        if (overrides.length > 0) {
            this.debugLog(`Applied ${overrides.length} manual overrides`);
        }

        this.debugLog(`✅ Execution ALLOWED: Mode=${mode}, Conditions=OK`);

        return {
            allowed: true,
            commands: finalCommands,
            mode,
            conditions,
            blockedReason: undefined
        };
    }

    /**
     * Handle RPC command to set control mode
     * @param mode - New control mode
     * @returns true if successful
     */
    async handleRpcSetMode(mode: 'AUTO' | 'MANUAL' | 'OFF'): Promise<boolean> {
        try {
            this.debugLog(`📡 RPC: Setting control mode to ${mode}`);

            // Map mode to numeric value
            const modeValue = mode === 'OFF' ? 0 : mode === 'AUTO' ? 1 : 2;

            // Update global context - this is what readControlMode() reads
            const globalContext = this.node.context().global;
            globalContext.set('CONTROL_MODE', modeValue);
            
            this.debugLog(`✅ Control mode set to ${mode} (value: ${modeValue})`);
            return true;
        } catch (error) {
            this.node.error(`Failed to set control mode: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Clear manual override for a specific command
     * @param fc - Function code
     * @param address - Modbus address
     */
    clearManualOverride(fc: number, address: number): void {
        const globalContext = this.node.context().global;
        const manualOverrides: ManualModbusOverrides = (globalContext.get('manualModbusOverrides') as ManualModbusOverrides) || {};
        const overrideKey = `${fc}_${address}`;

        if (manualOverrides[overrideKey]) {
            delete manualOverrides[overrideKey];
            globalContext.set('manualModbusOverrides', manualOverrides);
            this.debugLog(`Cleared manual override for ${overrideKey}`);
        }
    }

    /**
     * Clear all manual overrides
     */
    clearAllManualOverrides(): void {
        const globalContext = this.node.context().global;
        globalContext.set('manualModbusOverrides', {});
        this.debugLog('Cleared all manual overrides');
    }
}
