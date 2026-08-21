"use strict";
/**
 * Device-protocol identity for Demeter schedule APIs.
 *
 * Local MySQL (Frappe-shaped) keeps PK `name` and display `label`.
 * Demeter persistence uses UUID `id` + `runtime_key`; the device wire is:
 *   id   = runtime_key  = local.name
 *   name = display      = local.label
 *
 * Do not migrate the local PK. Map only at the HTTP/RPC edge.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deviceProtocolKey = deviceProtocolKey;
exports.toDeviceSchedule = toDeviceSchedule;
exports.fromDeviceSchedule = fromDeviceSchedule;
exports.toDeviceSchedulePlan = toDeviceSchedulePlan;
exports.fromDeviceSchedulePlan = fromDeviceSchedulePlan;
exports.toDeviceScheduleLog = toDeviceScheduleLog;
exports.unwrapDevicePlanList = unwrapDevicePlanList;
function text(value) {
    return value === undefined || value === null ? '' : String(value).trim();
}
function toEnableInt(value) {
    if (typeof value === 'string')
        return value === 'true' || value === '1' ? 1 : 0;
    if (typeof value === 'number')
        return value === 1 ? 1 : 0;
    return value ? 1 : 0;
}
/**
 * Protocol key on a Demeter (or legacy VIIS) wire object.
 * Prefer `id`; fall back to `name` only when `id` is absent (old Frappe payloads).
 */
function deviceProtocolKey(row) {
    const id = text(row === null || row === void 0 ? void 0 : row.id);
    if (id)
        return id;
    return text(row === null || row === void 0 ? void 0 : row.name);
}
function toDeviceSchedule(row) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
    const protocolId = text(row === null || row === void 0 ? void 0 : row.name);
    const display = text(row === null || row === void 0 ? void 0 : row.label) || protocolId;
    return {
        id: protocolId,
        name: display,
        device_id: (_a = row === null || row === void 0 ? void 0 : row.device_id) !== null && _a !== void 0 ? _a : null,
        action: row === null || row === void 0 ? void 0 : row.action,
        enable: toEnableInt(row === null || row === void 0 ? void 0 : row.enable),
        interval: (_b = row === null || row === void 0 ? void 0 : row.interval) !== null && _b !== void 0 ? _b : null,
        time: (_d = (_c = row === null || row === void 0 ? void 0 : row.time) !== null && _c !== void 0 ? _c : row === null || row === void 0 ? void 0 : row.set_time) !== null && _d !== void 0 ? _d : null,
        set_time: (_f = (_e = row === null || row === void 0 ? void 0 : row.set_time) !== null && _e !== void 0 ? _e : row === null || row === void 0 ? void 0 : row.time) !== null && _f !== void 0 ? _f : null,
        start_date: (_g = row === null || row === void 0 ? void 0 : row.start_date) !== null && _g !== void 0 ? _g : null,
        end_date: (_h = row === null || row === void 0 ? void 0 : row.end_date) !== null && _h !== void 0 ? _h : null,
        start_time: (_j = row === null || row === void 0 ? void 0 : row.start_time) !== null && _j !== void 0 ? _j : null,
        end_time: (_k = row === null || row === void 0 ? void 0 : row.end_time) !== null && _k !== void 0 ? _k : null,
        type: (_l = row === null || row === void 0 ? void 0 : row.type) !== null && _l !== void 0 ? _l : null,
        is_deleted: toEnableInt(row === null || row === void 0 ? void 0 : row.is_deleted),
        status: (_m = row === null || row === void 0 ? void 0 : row.status) !== null && _m !== void 0 ? _m : null,
        schedule_plan_id: (_o = row === null || row === void 0 ? void 0 : row.schedule_plan_id) !== null && _o !== void 0 ? _o : null,
        creation: (_p = row === null || row === void 0 ? void 0 : row.creation) !== null && _p !== void 0 ? _p : null,
        modified: (_q = row === null || row === void 0 ? void 0 : row.modified) !== null && _q !== void 0 ? _q : null,
    };
}
function fromDeviceSchedule(row) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const protocolId = deviceProtocolKey(row);
    const display = text(row === null || row === void 0 ? void 0 : row.id) && text(row === null || row === void 0 ? void 0 : row.name)
        ? text(row.name)
        : text(row === null || row === void 0 ? void 0 : row.label) || text(row === null || row === void 0 ? void 0 : row.name) || protocolId;
    return {
        name: protocolId,
        label: display,
        device_id: (_a = row === null || row === void 0 ? void 0 : row.device_id) !== null && _a !== void 0 ? _a : null,
        action: row === null || row === void 0 ? void 0 : row.action,
        enable: toEnableInt(row === null || row === void 0 ? void 0 : row.enable),
        interval: (_b = row === null || row === void 0 ? void 0 : row.interval) !== null && _b !== void 0 ? _b : null,
        set_time: (_d = (_c = row === null || row === void 0 ? void 0 : row.set_time) !== null && _c !== void 0 ? _c : row === null || row === void 0 ? void 0 : row.time) !== null && _d !== void 0 ? _d : null,
        start_date: (_e = row === null || row === void 0 ? void 0 : row.start_date) !== null && _e !== void 0 ? _e : null,
        end_date: (_f = row === null || row === void 0 ? void 0 : row.end_date) !== null && _f !== void 0 ? _f : null,
        start_time: (_g = row === null || row === void 0 ? void 0 : row.start_time) !== null && _g !== void 0 ? _g : null,
        end_time: (_h = row === null || row === void 0 ? void 0 : row.end_time) !== null && _h !== void 0 ? _h : null,
        type: (_j = row === null || row === void 0 ? void 0 : row.type) !== null && _j !== void 0 ? _j : null,
        is_deleted: toEnableInt(row === null || row === void 0 ? void 0 : row.is_deleted),
        status: (_k = row === null || row === void 0 ? void 0 : row.status) !== null && _k !== void 0 ? _k : null,
        schedule_plan_id: (_l = row === null || row === void 0 ? void 0 : row.schedule_plan_id) !== null && _l !== void 0 ? _l : null,
        creation: (_m = row === null || row === void 0 ? void 0 : row.creation) !== null && _m !== void 0 ? _m : null,
        modified: (_o = row === null || row === void 0 ? void 0 : row.modified) !== null && _o !== void 0 ? _o : null,
    };
}
function toDeviceSchedulePlan(row) {
    var _a, _b, _c, _d, _e, _f;
    const protocolId = text(row === null || row === void 0 ? void 0 : row.name);
    const display = text(row === null || row === void 0 ? void 0 : row.label) || protocolId;
    return {
        id: protocolId,
        name: display,
        schedule_count: Number((row === null || row === void 0 ? void 0 : row.schedule_count) || 0),
        status: (_a = row === null || row === void 0 ? void 0 : row.status) !== null && _a !== void 0 ? _a : null,
        enable: toEnableInt(row === null || row === void 0 ? void 0 : row.enable),
        is_deleted: toEnableInt(row === null || row === void 0 ? void 0 : row.is_deleted),
        device_id: (_b = row === null || row === void 0 ? void 0 : row.device_id) !== null && _b !== void 0 ? _b : null,
        start_date: (_c = row === null || row === void 0 ? void 0 : row.start_date) !== null && _c !== void 0 ? _c : null,
        end_date: (_d = row === null || row === void 0 ? void 0 : row.end_date) !== null && _d !== void 0 ? _d : null,
        creation: (_e = row === null || row === void 0 ? void 0 : row.creation) !== null && _e !== void 0 ? _e : null,
        modified: (_f = row === null || row === void 0 ? void 0 : row.modified) !== null && _f !== void 0 ? _f : null,
    };
}
function fromDeviceSchedulePlan(row) {
    var _a, _b, _c, _d, _e, _f;
    const protocolId = deviceProtocolKey(row);
    const display = text(row === null || row === void 0 ? void 0 : row.id) && text(row === null || row === void 0 ? void 0 : row.name)
        ? text(row.name)
        : text(row === null || row === void 0 ? void 0 : row.label) || text(row === null || row === void 0 ? void 0 : row.name) || protocolId;
    const schedules = Array.isArray(row === null || row === void 0 ? void 0 : row.schedules)
        ? row.schedules.map((schedule) => fromDeviceSchedule(schedule))
        : undefined;
    return {
        name: protocolId,
        label: display,
        schedule_count: Number((row === null || row === void 0 ? void 0 : row.schedule_count) || 0),
        status: (_a = row === null || row === void 0 ? void 0 : row.status) !== null && _a !== void 0 ? _a : null,
        enable: toEnableInt(row === null || row === void 0 ? void 0 : row.enable),
        is_deleted: toEnableInt(row === null || row === void 0 ? void 0 : row.is_deleted),
        device_id: (_b = row === null || row === void 0 ? void 0 : row.device_id) !== null && _b !== void 0 ? _b : null,
        start_date: (_c = row === null || row === void 0 ? void 0 : row.start_date) !== null && _c !== void 0 ? _c : null,
        end_date: (_d = row === null || row === void 0 ? void 0 : row.end_date) !== null && _d !== void 0 ? _d : null,
        creation: (_e = row === null || row === void 0 ? void 0 : row.creation) !== null && _e !== void 0 ? _e : null,
        modified: (_f = row === null || row === void 0 ? void 0 : row.modified) !== null && _f !== void 0 ? _f : null,
        schedules,
    };
}
function toDeviceScheduleLog(body) {
    return Object.assign(Object.assign({}, body), { schedule_id: text(body.schedule_id) });
}
function unwrapDevicePlanList(payload) {
    var _a;
    if (Array.isArray(payload))
        return payload;
    const envelope = payload && typeof payload === 'object' ? payload : {};
    const result = (_a = envelope.result) !== null && _a !== void 0 ? _a : envelope;
    if (Array.isArray(result))
        return result;
    if (result && typeof result === 'object') {
        const data = result.data;
        if (Array.isArray(data))
            return data;
    }
    return [];
}
