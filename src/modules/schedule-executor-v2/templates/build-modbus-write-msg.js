/**
 * Function Node Template: Build Modbus Write Message
 * 
 * Converts logic-v2 output to viis-modbus-flex input format.
 * Handles START/FINISH sequencing logic.
 * 
 * Input: msg.payload = { allowed, commands[], schedule, configParameters[] }
 * Output: msg.payload = { commands: [{ fc, unitid, address, value }], schedule, isStarting, isFinishing }
 */

// Extract input
const payload = msg.payload;
const allowed = payload.allowed;
const commands = payload.commands || [];
const schedule = payload.schedule;
const configParameters = payload.configParameters || [];

if (!allowed || commands.length === 0) {
    // Skip — execution not allowed or no commands
    msg.payload = { success: false, reason: payload.blockedReason || 'No commands' };
    return msg;
}

// Determine sequence type
const isStarting = schedule && schedule.status === 'running';
const isFinishing = schedule && schedule.status === 'finished';

// Categorize coils for sequencing
const holdingCommands = commands.filter(cmd => cmd.fc === 6);
const coilCommands = commands.filter(cmd => cmd.fc === 5);

const powerCoils = coilCommands.filter(cmd => cmd.key.includes('power'));
const pumpCoils = coilCommands.filter(cmd => cmd.key.includes('pump'));
const valveCoils = coilCommands.filter(cmd => cmd.key.includes('valve_'));
const otherCoils = coilCommands.filter(cmd =>
    !cmd.key.includes('power') && !cmd.key.includes('pump') && !cmd.key.includes('valve_'));

// Build sequenced command list
let sequencedCoils = [];

if (isStarting) {
    // START: power → valve → other → (pump after delay — handled by modbus-flex)
    sequencedCoils = [...powerCoils, ...valveCoils, ...otherCoils, ...pumpCoils];
} else if (isFinishing) {
    // FINISH: pump → other → (valve after delay — handled by modbus-flex) → power
    sequencedCoils = [...pumpCoils, ...otherCoils, ...valveCoils, ...powerCoils];
} else {
    // Default: no special ordering
    sequencedCoils = coilCommands;
}

// Build output for viis-modbus-flex (single command per message)
// viis-modbus-flex processes one command at a time
const modbusCommands = [...holdingCommands.map(cmd => ({
    fc: cmd.fc,
    unitid: cmd.unitid,
    address: cmd.address,
    value: cmd.value
})), ...sequencedCoils.map(cmd => ({
    fc: cmd.fc,
    unitid: cmd.unitid,
    address: cmd.address,
    value: cmd.value
}))];

// Store metadata for downstream nodes
msg.payload = {
    commands: modbusCommands,
    schedule,
    configParameters,
    isStarting,
    isFinishing,
    totalCommands: modbusCommands.length
};

msg.topic = "schedule-modbus-write";
msg.timestamp = Date.now();

return msg;
