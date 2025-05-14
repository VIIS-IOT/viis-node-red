"use strict";
/**
 * @fileoverview Date helper utilities for VIIS Sync Schedule module
 * Provides date manipulation and comparison functions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDate = exports.isValidDate = exports.isNewer = void 0;
/**
 * Compares two date strings to determine if first is newer than second
 * @param date1 - First date string in ISO format
 * @param date2 - Second date string in ISO format
 * @returns True if date1 is newer than date2, false otherwise
 */
const isNewer = (date1, date2) => {
    const d1 = date1 instanceof Date ? date1 : new Date(date1);
    const d2 = date2 instanceof Date ? date2 : new Date(date2);
    return d1.getTime() > d2.getTime();
};
exports.isNewer = isNewer;
/**
 * Validates if a string is a valid date
 * @param dateStr - Date string to validate
 * @returns True if dateStr is a valid date, false otherwise
 */
const isValidDate = (dateStr) => {
    if (!dateStr)
        return false;
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
};
exports.isValidDate = isValidDate;
/**
 * Formats a date to YYYY-MM-DD format
 * @param date - Date to format
 * @returns Formatted date string
 */
const formatDate = (date) => {
    if (!date)
        return null;
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime()))
        return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
exports.formatDate = formatDate;
