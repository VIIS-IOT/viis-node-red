/**
 * @fileoverview Retry utility for handling transient errors
 * Provides functions to retry operations with exponential backoff
 */

import { logger } from './logger';

/**
 * Retry options for configuring retry behavior
 */
export interface RetryOptions {
    /** Maximum number of retry attempts */
    maxRetries: number;
    /** Initial delay in milliseconds before first retry */
    initialDelay: number;
    /** Factor by which to increase delay on each retry */
    backoffFactor: number;
    /** Maximum delay in milliseconds */
    maxDelay: number;
}

/**
 * Default retry options
 */
const defaultOptions: RetryOptions = {
    maxRetries: 3,
    initialDelay: 1000,
    backoffFactor: 2,
    maxDelay: 10000,
};

/**
 * Executes an operation with retry capability
 * Uses exponential backoff strategy for retries
 * 
 * @template T The return type of the operation
 * @param operation - Function to execute
 * @param options - Retry configuration options
 * @returns Promise resolving to the operation result
 * @throws Last encountered error after all retries fail
 */
export const withRetry = async <T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {}
): Promise<T> => {
    const config = { ...defaultOptions, ...options };
    let delay = config.initialDelay;
    let lastError: Error | null = null;
    
    // Try initial attempt plus retries
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            // Execute the operation
            return await operation();
        } catch (error) {
            // Save error for potential re-throw
            lastError = error instanceof Error ? error : new Error(String(error));
            
            // If this was the last attempt, don't delay further
            if (attempt === config.maxRetries) {
                break;
            }
            
            // Log retry attempt
            logger.warn(null, `Operation failed, retrying (${attempt + 1}/${config.maxRetries}): ${lastError.message}`);
            
            // Wait before retry with exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Increase delay for next attempt (with maximum cap)
            delay = Math.min(delay * config.backoffFactor, config.maxDelay);
        }
    }
    
    // If we got here, all retries failed
    throw lastError || new Error('Operation failed after retries');
};
