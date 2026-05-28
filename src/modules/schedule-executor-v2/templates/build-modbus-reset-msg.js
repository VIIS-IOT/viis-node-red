/**
 * Function Node Template: Build Modbus Reset Message
 * 
 * Builds reset commands for active commands + time_valve_*/set_flow* registers.
 * Used when stopping a schedule or handling RPC disable.
 * 
 * Input: msg.payload = { scheduleId, activeCommands[], holdingRegisters{} }
 * Output: msg.payload = { commands: [{ fc, unitid, address, value: 0/false }] }
 */

const payload = msg.payload;
const scheduleId = payload.scheduleId;
const activeCommands = payload.activeCommands || [];
const holdingRegisters = payload.holdingRegisters || {};

if (!scheduleId || activeCommands.length === 0) {
    return null;
}

const resetCommands = [];

// Reset active commands to safe state
for (const cmd of activeCommands) {
    if (cmd.fc === 5) {
        // Coil → reset to false
        resetCommands.push({
            fc: 5,
            unitid: cmd.unitid || 1,
            address: cmd.address,
            value: false
        });
    } else if (cmd.fc === 6) {
        // Holding register → reset to 0
        resetCommands.push({
            fc: 6,
            unitid: cmd.unitid || 1,
            address: cmd.address,
            value: 0
        });
    }
}

// Also reset time_valve_* and set_flow* registers to 0
const activeCmdKeys = new Set(activeCommands.map(cmd => `${cmd.fc}_${cmd.address}`));

for (const [key, address] of Object.entries(holdingRegisters)) {
    if (key.startsWith('time_valve_') || key.startsWith('set_flow')) {
        const cmdKey = `6_${address}`;
        if (!activeCmdKeys.has(cmdKey)) {
            resetCommands.push({
                fc: 6,
                unitid: 1,
                address: Number(address),
                value: 0
            });
        }
    }
}

// Build output for viis-modbus-flex
msg.payload = {
    commands: resetCommands,
    scheduleId,
    isReset: true
};

msg.topic = "schedule-modbus-reset";
msg.timestamp = Date.now();

return msg;
