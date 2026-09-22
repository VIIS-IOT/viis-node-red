"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toMysqlDate = toMysqlDate;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;
function toMysqlDate(value) {
    if (value == null || value === '')
        return undefined;
    if (typeof value === 'string' && DATE_ONLY.test(value))
        return value;
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) {
        return typeof value === 'string' ? value : undefined;
    }
    const ict = new Date(date.getTime() + ICT_OFFSET_MS);
    const year = ict.getUTCFullYear();
    const month = String(ict.getUTCMonth() + 1).padStart(2, '0');
    const day = String(ict.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
