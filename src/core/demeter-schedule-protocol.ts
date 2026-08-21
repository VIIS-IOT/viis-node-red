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

import { isoUtcToMysqlUtcDatetime, mysqlUtcDatetimeToIso } from './farm-time';

function wireInstant(value: string | Date | null | undefined): string | Date | null {
    return mysqlUtcDatetimeToIso(value);
}

function localInstant(value: string | Date | null | undefined): string | Date | null {
    return isoUtcToMysqlUtcDatetime(value);
}

export interface LocalScheduleLike {
    name?: string | null;
    label?: string | null;
    device_id?: string | null;
    action?: unknown;
    enable?: number | boolean | string | null;
    interval?: string | null;
    set_time?: string | null;
    time?: string | null;
    start_date?: string | Date | null;
    end_date?: string | Date | null;
    start_time?: string | null;
    end_time?: string | null;
    type?: string | null;
    is_deleted?: number | boolean | null;
    status?: string | null;
    schedule_plan_id?: string | null;
    creation?: string | Date | null;
    modified?: string | Date | null;
}

export interface LocalSchedulePlanLike {
    name?: string | null;
    label?: string | null;
    schedule_count?: number | null;
    status?: string | null;
    enable?: number | boolean | string | null;
    is_deleted?: number | boolean | null;
    device_id?: string | null;
    start_date?: string | Date | null;
    end_date?: string | Date | null;
    creation?: string | Date | null;
    modified?: string | Date | null;
    schedules?: LocalScheduleLike[] | null;
}

export interface DeviceScheduleWire {
    id: string;
    name: string;
    device_id?: string | null;
    action?: unknown;
    enable?: number | boolean;
    interval?: string | null;
    time?: string | null;
    set_time?: string | null;
    start_date?: string | Date | null;
    end_date?: string | Date | null;
    start_time?: string | null;
    end_time?: string | null;
    type?: string | null;
    is_deleted?: number | boolean;
    status?: string | null;
    schedule_plan_id?: string | null;
    creation?: string | Date | null;
    modified?: string | Date | null;
    label?: string | null;
}

export interface DeviceSchedulePlanWire {
    id: string;
    name: string;
    schedule_count?: number;
    status?: string | null;
    enable?: number | boolean;
    is_deleted?: number | boolean;
    device_id?: string | null;
    start_date?: string | Date | null;
    end_date?: string | Date | null;
    creation?: string | Date | null;
    modified?: string | Date | null;
    label?: string | null;
    schedules?: DeviceScheduleWire[] | null;
}

function text(value: unknown): string {
    return value === undefined || value === null ? '' : String(value).trim();
}

function toEnableInt(value: unknown): number {
    if (typeof value === 'string') return value === 'true' || value === '1' ? 1 : 0;
    if (typeof value === 'number') return value === 1 ? 1 : 0;
    return value ? 1 : 0;
}

/**
 * Protocol key on a Demeter (or legacy VIIS) wire object.
 * Prefer `id`; fall back to `name` only when `id` is absent (old Frappe payloads).
 */
export function deviceProtocolKey(row: { id?: string | null; name?: string | null } | null | undefined): string {
    const id = text(row?.id);
    if (id) return id;
    return text(row?.name);
}

export function toDeviceSchedule(row: LocalScheduleLike | null | undefined): DeviceScheduleWire {
    const protocolId = text(row?.name);
    const display = text(row?.label) || protocolId;
    return {
        id: protocolId,
        name: display,
        device_id: row?.device_id ?? null,
        action: row?.action,
        enable: toEnableInt(row?.enable),
        interval: row?.interval ?? null,
        time: row?.time ?? row?.set_time ?? null,
        set_time: row?.set_time ?? row?.time ?? null,
        start_date: row?.start_date ?? null,
        end_date: row?.end_date ?? null,
        start_time: row?.start_time ?? null,
        end_time: row?.end_time ?? null,
        type: row?.type ?? null,
        is_deleted: toEnableInt(row?.is_deleted),
        status: row?.status ?? null,
        schedule_plan_id: row?.schedule_plan_id ?? null,
        creation: wireInstant(row?.creation),
        modified: wireInstant(row?.modified),
    };
}

export function fromDeviceSchedule(row: DeviceScheduleWire | LocalScheduleLike | null | undefined): LocalScheduleLike {
    const protocolId = deviceProtocolKey(row as DeviceScheduleWire);
    const display =
        text((row as DeviceScheduleWire)?.id) && text((row as DeviceScheduleWire)?.name)
            ? text((row as DeviceScheduleWire).name)
            : text((row as LocalScheduleLike)?.label) || text((row as DeviceScheduleWire)?.name) || protocolId;
    return {
        name: protocolId,
        label: display,
        device_id: (row as DeviceScheduleWire)?.device_id ?? null,
        action: (row as DeviceScheduleWire)?.action,
        enable: toEnableInt((row as DeviceScheduleWire)?.enable),
        interval: (row as DeviceScheduleWire)?.interval ?? null,
        set_time: (row as DeviceScheduleWire)?.set_time ?? (row as DeviceScheduleWire)?.time ?? null,
        start_date: (row as DeviceScheduleWire)?.start_date ?? null,
        end_date: (row as DeviceScheduleWire)?.end_date ?? null,
        start_time: (row as DeviceScheduleWire)?.start_time ?? null,
        end_time: (row as DeviceScheduleWire)?.end_time ?? null,
        type: '',
        is_deleted: toEnableInt((row as DeviceScheduleWire)?.is_deleted),
        status: (row as DeviceScheduleWire)?.status ?? null,
        schedule_plan_id: (row as DeviceScheduleWire)?.schedule_plan_id ?? null,
        creation: localInstant((row as DeviceScheduleWire)?.creation),
        modified: localInstant((row as DeviceScheduleWire)?.modified),
    };
}

export function toDeviceSchedulePlan(row: LocalSchedulePlanLike | null | undefined): DeviceSchedulePlanWire {
    const protocolId = text(row?.name);
    const display = text(row?.label) || protocolId;
    return {
        id: protocolId,
        name: display,
        schedule_count: Number(row?.schedule_count || 0),
        status: row?.status ?? null,
        enable: toEnableInt(row?.enable),
        is_deleted: toEnableInt(row?.is_deleted),
        device_id: row?.device_id ?? null,
        start_date: row?.start_date ?? null,
        end_date: row?.end_date ?? null,
        creation: wireInstant(row?.creation),
        modified: wireInstant(row?.modified),
    };
}

export function fromDeviceSchedulePlan(
    row: DeviceSchedulePlanWire | LocalSchedulePlanLike | null | undefined
): LocalSchedulePlanLike {
    const protocolId = deviceProtocolKey(row as DeviceSchedulePlanWire);
    const display =
        text((row as DeviceSchedulePlanWire)?.id) && text((row as DeviceSchedulePlanWire)?.name)
            ? text((row as DeviceSchedulePlanWire).name)
            : text((row as LocalSchedulePlanLike)?.label) || text((row as DeviceSchedulePlanWire)?.name) || protocolId;
    const schedules = Array.isArray((row as DeviceSchedulePlanWire)?.schedules)
        ? (row as DeviceSchedulePlanWire).schedules!.map((schedule) => fromDeviceSchedule(schedule))
        : undefined;
    return {
        name: protocolId,
        label: display,
        schedule_count: Number((row as DeviceSchedulePlanWire)?.schedule_count || 0),
        status: (row as DeviceSchedulePlanWire)?.status ?? null,
        enable: toEnableInt((row as DeviceSchedulePlanWire)?.enable),
        is_deleted: toEnableInt((row as DeviceSchedulePlanWire)?.is_deleted),
        device_id: (row as DeviceSchedulePlanWire)?.device_id ?? null,
        start_date: (row as DeviceSchedulePlanWire)?.start_date ?? null,
        end_date: (row as DeviceSchedulePlanWire)?.end_date ?? null,
        creation: localInstant((row as DeviceSchedulePlanWire)?.creation),
        modified: localInstant((row as DeviceSchedulePlanWire)?.modified),
        schedules,
    };
}

export function toDeviceScheduleLog(body: { schedule_id?: string | null; start_time?: unknown; end_time?: unknown; name?: string | null }) {
    return {
        ...body,
        schedule_id: text(body.schedule_id),
    };
}

export function unwrapDevicePlanList(payload: unknown): DeviceSchedulePlanWire[] {
    if (Array.isArray(payload)) return payload as DeviceSchedulePlanWire[];
    const envelope = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const result = envelope.result ?? envelope;
    if (Array.isArray(result)) return result as DeviceSchedulePlanWire[];
    if (result && typeof result === 'object') {
        const data = (result as Record<string, unknown>).data;
        if (Array.isArray(data)) return data as DeviceSchedulePlanWire[];
    }
    return [];
}
