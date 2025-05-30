/**
 * Time utility functions for VIIS Auto Microclimate Control Node
 * Handles time-based calculations and conversions
 */

/**
 * Convert minutes to milliseconds
 */
export function minutesToMs(minutes: number): number {
    return minutes * 60 * 1000;
}

/**
 * Convert milliseconds to minutes
 */
export function msToMinutes(ms: number): number {
    return ms / (60 * 1000);
}

/**
 * Check if enough time has passed since last execution
 */
export function hasTimeElapsed(lastTime: number, intervalMs: number): boolean {
    const now = Date.now();
    return (now - lastTime) >= intervalMs;
}

/**
 * Get current timestamp in milliseconds
 */
export function getCurrentTimestamp(): number {
    return Date.now();
}

/**
 * Format timestamp to readable string
 */
export function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toISOString();
}

/**
 * Calculate time remaining until next execution
 */
export function getTimeRemaining(lastTime: number, intervalMs: number): number {
    const now = Date.now();
    const elapsed = now - lastTime;
    return Math.max(0, intervalMs - elapsed);
}

/**
 * Check if current time is within a specific time range (24-hour format)
 */
export function isWithinTimeRange(startHour: number, startMinute: number, endHour: number, endMinute: number): boolean {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    const startTimeInMinutes = startHour * 60 + startMinute;
    const endTimeInMinutes = endHour * 60 + endMinute;
    
    if (startTimeInMinutes <= endTimeInMinutes) {
        // Same day range
        return currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes <= endTimeInMinutes;
    } else {
        // Overnight range
        return currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes <= endTimeInMinutes;
    }
}

/**
 * Get time difference in minutes between two timestamps
 */
export function getTimeDifferenceInMinutes(timestamp1: number, timestamp2: number): number {
    return Math.abs(timestamp1 - timestamp2) / (60 * 1000);
}

/**
 * Create a delay promise
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Debounce function to prevent rapid successive calls
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    waitMs: number
): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout | null = null;
    
    return (...args: Parameters<T>) => {
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
export function throttle<T extends (...args: any[]) => any>(
    func: T,
    limitMs: number
): (...args: Parameters<T>) => void {
    let lastExecution = 0;
    
    return (...args: Parameters<T>) => {
        const now = Date.now();
        
        if (now - lastExecution >= limitMs) {
            lastExecution = now;
            func(...args);
        }
    };
}
