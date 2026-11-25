// Legacy timestamps use UTC components as database wall-clock values.
// DATE values retain their supplied calendar date, even with an offset.
function normalizeTemporal(value, field) {
    if (value === undefined || value === null) return null;
    const invalid = () => { throw new Error(`Invalid temporal field: ${field}`); };
    if (Object.prototype.toString.call(value) === '[object Date]') {
        if (!Number.isFinite(Date.prototype.getTime.call(value))) return invalid();
        value = Date.prototype.toISOString.call(value);
    }
    if (typeof value !== 'string') return invalid();
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
    if (!match) return invalid();
    const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = '', zone = ''] = match;
    const y = Number(year), m = Number(month), d = Number(day);
    const h = Number(hour), min = Number(minute), sec = Number(second);
    if (y < 1000 || m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || sec > 59) return invalid();
    const time = new Date(Date.UTC(y, m - 1, d, h, min, sec));
    if (time.getUTCFullYear() !== y || time.getUTCMonth() !== m - 1 || time.getUTCDate() !== d) return invalid();
    if (zone && zone !== 'Z') {
        const zoneHour = Number(zone.slice(1, 3)), zoneMinute = Number(zone.slice(4, 6));
        if (zoneHour > 23 || zoneMinute > 59) return invalid();
        const direction = zone[0] === '+' ? 1 : -1;
        time.setUTCMinutes(time.getUTCMinutes() - direction * (zoneHour * 60 + zoneMinute));
    }
    if (field === 'start_date' || field === 'end_date') return `${year}-${month}-${day}`;
    if (time.getUTCFullYear() < 1000 || time.getUTCFullYear() > 9999) return invalid();
    return time.toISOString().slice(0, 19).replace('T', ' ') + fraction;
}

function normalizeTemporalRecord(record) {
    const normalized = { ...record };
    for (const field of ['creation', 'modified', 'start_date', 'end_date']) {
        normalized[field] = normalizeTemporal(record[field], field);
    }
    return normalized;
}

// Compare normalized values at DATETIME(6) precision without host timezone parsing.
function existingIsSameOrAfter(existing, incoming) {
    const left = normalizeTemporal(existing, 'modified');
    const right = normalizeTemporal(incoming, 'modified');
    if (left === null || right === null) return false;
    const key = value => value.slice(0, 19) + '.' + (value.split('.')[1] || '').padEnd(6, '0');
    return key(left) >= key(right);
}
