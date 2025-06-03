"use strict";
/**
 * Time utility functions for VIIS Auto Microclimate Control Node
 * Handles time-based calculations and conversions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.minutesToMs = minutesToMs;
exports.msToMinutes = msToMinutes;
exports.hasTimeElapsed = hasTimeElapsed;
exports.getCurrentTimestamp = getCurrentTimestamp;
exports.formatTimestamp = formatTimestamp;
exports.getTimeRemaining = getTimeRemaining;
exports.isWithinTimeRange = isWithinTimeRange;
exports.getTimeDifferenceInMinutes = getTimeDifferenceInMinutes;
exports.delay = delay;
exports.debounce = debounce;
exports.throttle = throttle;
/**
 * Convert minutes to milliseconds
 */
function minutesToMs(minutes) {
    return minutes * 60 * 1000;
}
/**
 * Convert milliseconds to minutes
 */
function msToMinutes(ms) {
    return ms / (60 * 1000);
}
/**
 * Check if enough time has passed since last execution
 */
function hasTimeElapsed(lastTime, intervalMs) {
    const now = Date.now();
    return (now - lastTime) >= intervalMs;
}
/**
 * Get current timestamp in milliseconds
 */
function getCurrentTimestamp() {
    return Date.now();
}
/**
 * Format timestamp to readable string
 */
function formatTimestamp(timestamp) {
    return new Date(timestamp).toISOString();
}
/**
 * Calculate time remaining until next execution
 */
function getTimeRemaining(lastTime, intervalMs) {
    const now = Date.now();
    const elapsed = now - lastTime;
    return Math.max(0, intervalMs - elapsed);
}
/**
 * Check if current time is within a specific time range (24-hour format)
 */
function isWithinTimeRange(startHour, startMinute, endHour, endMinute) {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    const startTimeInMinutes = startHour * 60 + startMinute;
    const endTimeInMinutes = endHour * 60 + endMinute;
    if (startTimeInMinutes <= endTimeInMinutes) {
        // Same day range
        return currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes <= endTimeInMinutes;
    }
    else {
        // Overnight range
        return currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes <= endTimeInMinutes;
    }
}
/**
 * Get time difference in minutes between two timestamps
 */
function getTimeDifferenceInMinutes(timestamp1, timestamp2) {
    return Math.abs(timestamp1 - timestamp2) / (60 * 1000);
}
/**
 * Create a delay promise
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Debounce function to prevent rapid successive calls
 */
function debounce(func, waitMs) {
    let timeoutId = null;
    return (...args) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            func(...args);
        }, waitMs);
    };
}
/**
 * Throttle function to limit execution frequency
 */
function throttle(func, limitMs) {
    let lastExecution = 0;
    return (...args) => {
        const now = Date.now();
        if (now - lastExecution >= limitMs) {
            lastExecution = now;
            func(...args);
        }
    };
}
