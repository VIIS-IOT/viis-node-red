"use strict";
/**
 * @fileoverview Retry utility for handling transient errors
 * Provides functions to retry operations with exponential backoff
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
const withRetry = (operation_1, ...args_1) => __awaiter(void 0, [operation_1, ...args_1], void 0, function* (operation, options = {}) {
    const config = Object.assign(Object.assign({}, defaultOptions), options);
    let delay = config.initialDelay;
    let lastError = null;
    // Try initial attempt plus retries
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            // Execute the operation
            return yield operation();
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
            yield new Promise(resolve => setTimeout(resolve, delay));
            // Increase delay for next attempt (with maximum cap)
            delay = Math.min(delay * config.backoffFactor, config.maxDelay);
        }
    }
    // If we got here, all retries failed
    throw lastError || new Error('Operation failed after retries');
});
exports.withRetry = withRetry;
