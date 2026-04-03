/**
 * Message Handler for VIIS RPC Control Node
 * Handles message deduplication and processing
 */

import * as crypto from 'crypto';
import {
    IMessageHandler,
    ServiceOptions
} from "../interfaces/types";
import { DEBOUNCE_CONFIG } from "../constants";
import { Logger } from "../utils/logger";

export class MessageHandler implements IMessageHandler {
    private processedMessages: Set<string>;
    private logger: Logger;
    private nodeId: string;

    constructor(options: ServiceOptions) {
        this.processedMessages = new Set();
        this.logger = new Logger(options.node, "MESSAGE-HANDLER");
        this.nodeId = options.node.id;
    }

    /**
     * Generate a unique message ID based on payload content and node ID
     * Uses SHA256 hash to ensure the ENTIRE payload (including values) is considered
     * 
     * BUG FIX: Previously used base64.slice(0,16) which only captured ~12 chars,
     * causing collisions when key names were long (e.g., "COIL_OUTPUT_WATER_IN")
     * and the value (true/false) was not included in the hash.
     */
    generateMessageId(payload: any): string {
        try {
            // Kiểm tra payload và params
            if (!payload || !payload.params) {
                throw new Error('Missing params in payload');
            }
            // Tạo chuỗi ổn định dựa trên cả key và value của params
            // Sắp xếp key để đảm bảo tính ổn định khi string hóa
            const paramsStr = JSON.stringify(payload.params, (key, value) => {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    // Sắp xếp key của object để đảm bảo thứ tự nhất quán
                    return Object.keys(value).sort().reduce((obj: any, k: string) => {
                        obj[k] = value[k];
                        return obj;
                    }, {});
                }
                return value;
            });
            // Use SHA256 hash to capture the ENTIRE paramsStr (including values)
            // This fixes the bug where only the first 12 chars were considered,
            // causing true/false values to produce the same messageId
            const hash = crypto.createHash('sha256').update(paramsStr).digest('hex').slice(0, 16);
            return `${hash}_${this.nodeId}`;
        } catch (error) {
            // Fallback về ID dựa trên timestamp nếu có lỗi
            this.logger.warn(`Failed to generate stable message ID: ${(error as Error).message}`);
            return `${Date.now()}_${Math.random().toString(16).substring(2, 10)}_${this.nodeId}`;
        }
    }

    /**
     * Check if a message has already been processed
     */
    isMessageProcessed(messageId: string): boolean {
        return this.processedMessages.has(messageId);
    }

    /**
     * Mark a message as processed and schedule cleanup
     */
    markMessageProcessed(messageId: string): void {
        this.processedMessages.add(messageId);

        // Schedule cleanup after TTL
        setTimeout(() => {
            this.processedMessages.delete(messageId);
            // this.logger.warn(`Cleaned up processed message: ${messageId}`);
        }, DEBOUNCE_CONFIG.MESSAGE_CACHE_TTL);

        // this.logger.warn(`Marked message as processed: ${messageId}`);
    }

    /**
     * Clear all processed messages (useful for cleanup)
     */
    clearProcessedMessages(): void {
        const count = this.processedMessages.size;
        this.processedMessages.clear();
        this.logger.warn(`Cleared ${count} processed messages`);
    }

    /**
     * Get the number of currently tracked processed messages
     */
    getProcessedMessageCount(): number {
        return this.processedMessages.size;
    }

    /**
     * Check if the processed message cache is getting too large
     */
    isCacheOverloaded(maxSize: number = 1000): boolean {
        return this.processedMessages.size > maxSize;
    }

    /**
     * Force cleanup of old messages (emergency cleanup)
     */
    forceCleanup(): void {
        if (this.isCacheOverloaded()) {
            this.logger.warn("Message cache overloaded, performing force cleanup");
            this.clearProcessedMessages();
        }
    }

    /**
     * Process a message with deduplication
     */
    processMessage<T>(payload: any, processor: (payload: any) => Promise<T> | T): Promise<T> | T | null {
        const messageId = this.generateMessageId(payload);

        // Check for duplicate
        if (this.isMessageProcessed(messageId)) {
            // this.logger.warn(`Duplicate message detected and ignored: ${messageId}`);
            return null;
        }
        else {
            // this.logger.warn(`New message detected: ${messageId}`);
        }

        // Mark as processed
        this.markMessageProcessed(messageId);

        // Log processing
        // this.logger.warn(`Processing message: ${JSON.stringify(payload)} [ID: ${messageId}]`);

        // Process the message
        try {
            return processor(payload);
        } catch (error) {
            this.logger.error(`Message processing failed for ${messageId}: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Create a message processor with automatic deduplication
     */
    createDuplicateFilter<T>(processor: (payload: any) => Promise<T> | T): (payload: any) => Promise<T> | T | null {
        return (payload: any) => this.processMessage(payload, processor);
    }

    /**
     * Validate message structure
     */
    validateMessageStructure(message: any): boolean {
        if (!message || typeof message !== 'object') {
            this.logger.warn("Invalid message: not an object");
            return false;
        }

        // Add more validation rules as needed
        return true;
    }

    /**
     * Extract payload from different message formats
     */
    extractPayload(message: any): any {
        // this.logger.warn(`[EXTRACT] Extracting payload from message: ${JSON.stringify(message)}`);

        if (!this.validateMessageStructure(message)) {
            // this.logger.warn(`[EXTRACT] Invalid message structure`);
            throw new Error("Invalid message structure");
        }

        // Handle different message formats
        if (message.payload !== undefined) {
            // this.logger.warn(`[EXTRACT] Found payload field: ${JSON.stringify(message.payload)}`);
            return message.payload;
        }

        if (message.message !== undefined) {
            // this.logger.warn(`[EXTRACT] Found message field: ${message.message}`);
            try {
                const parsed = JSON.parse(message.message.toString());
                // this.logger.warn(`[EXTRACT] Successfully parsed message: ${JSON.stringify(parsed)}`);
                return parsed;
            } catch (error) {
                // this.logger.warn(`[EXTRACT] Failed to parse message content: ${(error as Error).message}`);
                // this.logger.warn(`[EXTRACT] Returning raw message string: ${message.message.toString()}`);
                return message.message.toString();
            }
        }

        // Return the message itself if no specific payload field
        // this.logger.warn(`[EXTRACT] No payload/message field found, returning entire message`);
        return message;
    }

    /**
     * Process MQTT message with topic validation
     */
    processMqttMessage(message: any, expectedTopicPrefix: string, processor: (payload: any) => Promise<void> | void): Promise<void> | void | null {
        try {
            // this.logger.warn(`[MSG-HANDLER] Processing MQTT message`);
            // this.logger.warn(`[MSG-HANDLER] Message topic: ${message.topic}`);
            // this.logger.warn(`[MSG-HANDLER] Expected topic prefix: ${expectedTopicPrefix}`);
            // this.logger.warn(`[MSG-HANDLER] Full message: ${JSON.stringify(message)}`);

            // Validate topic
            const cleanExpectedPrefix = expectedTopicPrefix.replace("+", "");
            // this.logger.warn(`[MSG-HANDLER] Clean expected prefix: ${cleanExpectedPrefix}`);

            if (!message.topic) {
                // this.logger.warn(`[MSG-HANDLER] Message has no topic - rejecting`);
                return null;
            }

            if (!message.topic.startsWith(cleanExpectedPrefix)) {
                // this.logger.warn(`[MSG-HANDLER] Topic mismatch - rejecting. Topic: ${message.topic}, Expected prefix: ${cleanExpectedPrefix}`);
                return null;
            }

            // this.logger.warn(`[MSG-HANDLER] Topic validation passed`);

            // Extract and validate payload
            const payload = this.extractPayload(message);
            // this.logger.warn(`[MSG-HANDLER] Extracted payload: ${JSON.stringify(payload)}`);

            // Process with deduplication
            const result = this.processMessage(payload, processor);
            // this.logger.warn(`[MSG-HANDLER] Process message result: ${result}`);
            return result;
        } catch (error) {
            this.logger.error(`[MSG-HANDLER] MQTT message processing error: ${(error as Error).message}`);
            this.logger.error(`[MSG-HANDLER] Error stack: ${(error as Error).stack}`);
            throw error;
        }
    }

    /**
     * Get statistics about message processing
     */
    getStatistics(): {
        processedMessageCount: number;
        cacheOverloaded: boolean;
        nodeId: string;
    } {
        return {
            processedMessageCount: this.getProcessedMessageCount(),
            cacheOverloaded: this.isCacheOverloaded(),
            nodeId: this.nodeId,
        };
    }

    /**
     * Reset the message handler state
     */
    reset(): void {
        this.clearProcessedMessages();
        this.logger.warn("Message handler reset");
    }
}
