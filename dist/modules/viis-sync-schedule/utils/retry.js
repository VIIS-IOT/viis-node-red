"use strict";
/**
 * @fileoverview Retry utility for handling transient errors
 * Provides functions to retry operations with exponential backoff
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRetry = void 0;
const logger_1 = require("./logger");
/**
 * Default retry options
 */
const defaultOptions = {
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
const withRetry = async (operation, options = {}) => {
    const config = Object.assign(Object.assign({}, defaultOptions), options);
    let delay = config.initialDelay;
    let lastError = null;
    // Try initial attempt plus retries
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            // Execute the operation
            return await operation();
        }
        catch (error) {
            // Save error for potential re-throw
            lastError = error instanceof Error ? error : new Error(String(error));
            // If this was the last attempt, don't delay further
            if (attempt === config.maxRetries) {
                break;
            }
            // Log retry attempt
            logger_1.logger.warn(null, `Operation failed, retrying (${attempt + 1}/${config.maxRetries}): ${lastError.message}`);
            // Wait before retry with exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
            // Increase delay for next attempt (with maximum cap)
            delay = Math.min(delay * config.backoffFactor, config.maxDelay);
        }
    }
    // If we got here, all retries failed
    throw lastError || new Error('Operation failed after retries');
};
exports.withRetry = withRetry;
