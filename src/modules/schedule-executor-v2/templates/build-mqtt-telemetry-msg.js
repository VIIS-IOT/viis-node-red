/**
 * Function Node Template: Build MQTT Telemetry Message
 * 
 * Converts executor-v2 output to MQTT publish format for viis-mqtt-client.
 * Publishes to ThingsBoard + EMQX with deduplication.
 * 
 * Input: msg.payload = { success, scheduleId, action, schedule, commands[] }
 * Output: msg.payload = { topic: string, payload: string } for viis-mqtt-client
 */

const payload = msg.payload;
const schedule = payload.schedule;
const action = payload.action || 'end';
const commands = payload.commands || [];

if (!schedule) {
    // No schedule info — skip telemetry
    return null;
}

// Build telemetry data matching V1 format
const telemetryData = {
    ts: Date.now(),
    _schedule_action: action,
    _schedule_id: schedule.name,
    _schedule_label: schedule.label,
};

// Add Modbus command values
for (const cmd of commands) {
    telemetryData[cmd.key] = cmd.value;
}

// Add config parameter values if present
const configParameters = payload.configParameters || [];
for (const cp of configParameters) {
    telemetryData[cp.key] = cp.value;
}

// Deduplication: check if same data was published recently
const lastPublishedKey = `telemetryLastPublished_${schedule.name}_${action}`;
const lastPublished = flow.get(lastPublishedKey);
const currentHash = JSON.stringify(telemetryData);

if (lastPublished && lastPublished.hash === currentHash && (Date.now() - lastPublished.timestamp) < 5000) {
    // Same data published within 5 seconds — skip
    return null;
}

// Store for dedup
flow.set(lastPublishedKey, { hash: currentHash, timestamp: Date.now() });

// Build output for viis-mqtt-client
const deviceId = global.get("device_id") || "unknown";
msg.payload = {
    topic: `v1/device/${deviceId}/telemetry`,
    payload: JSON.stringify(telemetryData)
};

msg.topic = "schedule-telemetry";
msg.timestamp = Date.now();

return msg;
