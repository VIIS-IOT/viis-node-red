/**
 * Function Node Template: Build HTTP Notification Message
 * 
 * Converts executor-v2 output to HTTP POST payload for http out node.
 * Sends alarm notification to backend API.
 * 
 * Input: msg.payload = { success, scheduleId, action, schedule }
 * Output: msg.payload = { method, url, headers, payload } for http out node
 */

const payload = msg.payload;
const schedule = payload.schedule;
const action = payload.action || 'end';
const success = payload.success !== false;

if (!schedule) {
    return null;
}

// Get device info from flow context or global context
const deviceId = flow.get('deviceId') || global.get('DEVICE_ID') || 'unknown';
const backendUrl = flow.get('backendUrl') || global.get('VIIS_BACKEND') || '';
const deviceAccessToken = flow.get('deviceAccessToken') || global.get('DEVICE_ACCESS_TOKEN') || '';

if (!backendUrl || !deviceAccessToken) {
    return null; // Skip if config not available
}

// Build notification payload matching V1 format
const isStart = action === 'start';
const severity = !success ? 'error' : 'notification';
const alarmStatus = isStart ? 'Pending' : 'Clear';

let message: string;
let messageKey: string | null = null;
let messageParams: Record<string, any> | null = null;

if (isStart) {
    if (success) {
        message = `Lịch trình "${schedule.label || schedule.name}" đã bắt đầu chạy thành công`;
        messageKey = 'iot.notification.schedule.started';
        messageParams = { scheduleName: schedule.label || schedule.name };
    } else {
        message = `Lịch trình "${schedule.label || schedule.name}" không thể bắt đầu - Lỗi ghi Modbus`;
        messageKey = 'iot.notification.schedule.failed';
        messageParams = { scheduleName: schedule.label || schedule.name };
    }
} else {
    if (success) {
        message = `Lịch trình "${schedule.label || schedule.name}" đã hoàn thành`;
        messageKey = 'iot.notification.schedule.completed';
        messageParams = { scheduleName: schedule.label || schedule.name };
    } else {
        message = `Lịch trình "${schedule.label || schedule.name}" đã kết thúc nhưng KHÔNG THỂ TẮT thiết bị`;
        messageKey = 'iot.notification.schedule.failed';
        messageParams = { scheduleName: schedule.label || schedule.name };
    }
}

const httpPayload = {
    alarm_name: schedule.label || schedule.name,
    id: deviceId,
    msg: message,
    message_key: messageKey,
    message_params: messageParams,
    message_locale: 'vi-VN',
    severity: severity,
    trigger_time: new Date().toISOString(),
    tb_alarm_id: schedule.name,
    alarm_status: alarmStatus,
    clear_by: isStart ? '' : 'Value',
    clear_by_user_id: '',
    entity: deviceId
};

// Build output for http out node
msg.method = "POST";
msg.url = `${backendUrl}/api/v2/alarm/notification-by-token?device_access_token=${encodeURIComponent(deviceAccessToken)}`;
msg.headers = { 'Content-Type': 'application/json' };
msg.payload = httpPayload;

msg.topic = "schedule-http-notification";
msg.timestamp = Date.now();

return msg;
