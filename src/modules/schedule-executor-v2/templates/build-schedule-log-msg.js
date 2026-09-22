/**
 * Function Node Template: Build Schedule Log Message
 * 
 * Converts executor-v2 output to schedule log payload for backend API.
 * 
 * Input: msg.payload = { success, scheduleId, action, schedule }
 * Output: msg.payload = { method, url, headers, payload } for http out node
 */

const payload = msg.payload;
const schedule = payload.schedule;
const success = payload.success !== false;

if (!schedule) {
    return null;
}

const backendUrl = flow.get('backendUrl') || global.get('VIIS_BACKEND') || '';
const deviceAccessToken = flow.get('deviceAccessToken') || global.get('DEVICE_ACCESS_TOKEN') || '';

if (!backendUrl || !deviceAccessToken) {
    return null;
}

// Naive ICT wall (YYYY-MM-DD HH:mm:ss). Do not use toISOString() / UTC date.
const ictMs = Date.now() + 7 * 60 * 60 * 1000;
const todayDate = new Date(ictMs).toISOString().slice(0, 10);
const startClock = String(schedule.start_time || '00:00:00').length === 5
    ? `${schedule.start_time}:00`
    : (schedule.start_time || '00:00:00');
const endClock = String(schedule.end_time || '23:59:59').length === 5
    ? `${schedule.end_time}:00`
    : (schedule.end_time || '23:59:59');
const startTime = `${todayDate} ${startClock}`;
const endTime = `${todayDate} ${endClock}`;

const logPayload = {
    start_time: startTime,
    end_time: endTime,
    schedule_id: schedule.name,
    deleted: null
};

// Build output for http out node
msg.method = "POST";
msg.url = `${backendUrl}/api/v2/schedule/log?device_access_token=${encodeURIComponent(deviceAccessToken)}`;
msg.headers = { 'Content-Type': 'application/json' };
msg.payload = logPayload;

msg.topic = "schedule-log";
msg.timestamp = Date.now();

return msg;
