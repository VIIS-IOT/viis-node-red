/**
 * Constants used throughout the VIIS Sync Schedule module
 */

export const API_PATHS = {
    /** API endpoint for schedule plans */
    SCHEDULE_PLAN: '/schedulePlan/device',
    /** API endpoint for all schedule plans and their schedules */
    SCHEDULE_PLAN_ALL: '/schedulePlan/device/all',
};

export const SYNC_DEFAULTS = {
    /** Default sync interval in minutes */
    INTERVAL: 15,
    /** Default timeout for API requests in milliseconds */
    TIMEOUT: 30000,
};
