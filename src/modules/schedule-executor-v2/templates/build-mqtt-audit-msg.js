/**
 * Function Node Template: Build MQTT Audit Log Message
 * 
 * Builds audit log payload for MQTT publishing.
 * 
 * Input: msg.payload = { success, scheduleId, action, schedule, commands[] }
 * Output: msg.payload = { topic: string, payload: string } for viis-mqtt-client
 */

const payload = msg.payload;
const schedule = payload.schedule;
const action = payload.action || 'end';
const commands = payload.commands || [];
const success = payload.success !== false;

if (!schedule) {
    return null;
}

const { v4: uuidv4 } = require('uuid');
const requestId = uuidv4();

const allCommands = commands;
const actionText = action === 'start' ? 'bắt đầu' : 'kết thúc';
const statusText = success ? 'thành công' : 'thất bại';
const changedKeys = allCommands.map(cmd => `${cmd.key}=${cmd.value}`).join(', ');

let message: string;
if (success) {
    message = `Lịch trình "${schedule.label || schedule.name}" ${actionText}: ${changedKeys || 'không có thay đổi'}`;
} else {
    message = `Lịch trình "${schedule.label || schedule.name}" ${actionText} ${statusText}: Lỗi ghi Modbus`;
}

const auditLog = {
    from: "DEVICE_EXE_SCHEDULE",
    requestId: requestId,
    message: message,
    metadata: {
        status: success ? "SUCCESS" : "FAIL",
        schedule_id: schedule.name,
        schedule_label: schedule.label,
        action: action,
        changed_keys: allCommands.map(cmd => ({
            key: cmd.key,
            value: cmd.value,
            address: cmd.address,
            fc: cmd.fc
        })),
        timestamp: Date.now(),
        error: success ? null : 'Modbus write failed'
    }
};

// Build output for viis-mqtt-client
msg.payload = {
    topic: "v1/devices/me/telemetry",
    payload: JSON.stringify({ logs: auditLog })
};

msg.topic = "schedule-audit-log";
msg.timestamp = Date.now();

return msg;
