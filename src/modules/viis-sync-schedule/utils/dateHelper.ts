/**
 * @fileoverview Date helper utilities for VIIS Sync Schedule module
 * Provides date manipulation and comparison functions
 */

/**
 * Compares two date strings to determine if first is newer than second
 * @param date1 - First date string in ISO format
 * @param date2 - Second date string in ISO format
 * @returns True if date1 is newer than date2, false otherwise
 */
export const isNewer = (date1: string | Date, date2: string | Date): boolean => {
    const d1 = date1 instanceof Date ? date1 : new Date(date1);
    const d2 = date2 instanceof Date ? date2 : new Date(date2);
    
    return d1.getTime() > d2.getTime();
};

/**
 * Validates if a string is a valid date
 * @param dateStr - Date string to validate
 * @returns True if dateStr is a valid date, false otherwise
 */
export const isValidDate = (dateStr: string | null | undefined): boolean => {
    if (!dateStr) return false;
    
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
};

/**
 * Formats a date to YYYY-MM-DD format
 * @param date - Date to format
 * @returns Formatted date string
 */
export const formatDate = (date: Date | string | null | undefined): string | null => {
    if (!date) return null;
    
    const d = date instanceof Date ? date : new Date(date);
    
    if (isNaN(d.getTime())) return null;
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
};
