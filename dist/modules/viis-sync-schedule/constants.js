"use strict";
/**
 * Constants used throughout the VIIS Sync Schedule module
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYNC_DEFAULTS = exports.API_PATHS = void 0;
exports.API_PATHS = {
    /** API endpoint for schedule plans */
    SCHEDULE_PLAN: '/schedulePlan/device',
    /** Device-protocol dump of all plans + nested schedules */
    SCHEDULE_PLAN_ALL: '/schedulePlan/device/all',
};
exports.SYNC_DEFAULTS = {
    /** Default sync interval in minutes */
    INTERVAL: 240,
    /** Default timeout for API requests in milliseconds */
    TIMEOUT: 30000,
};
