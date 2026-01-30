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
        }, DEBOUNCE_CONFIG.MESSAGE_CACHE_TTL);
    }

    /**
     * Clear all processed messages (useful for cleanup)
     */
    clearProcessedMessages(): void {
        const count = this.processedMessages.size;
        this.processedMessages.clear();
        this.logger.debug(`Cleared ${count} processed messages`);
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
            this.logger.debug(`Duplicate message ignored: ${messageId}`);
            return null;
        }

        // Mark as processed
        this.markMessageProcessed(messageId);

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
            this.logger.debug("Invalid message: not an object");
            return false;
        }

        // Add more validation rules as needed
        return true;
    }

    /**
     * Extract payload from different message formats
     */
    extractPayload(message: any): any {
        if (!this.validateMessageStructure(message)) {
            throw new Error("Invalid message structure");
        }

        // Handle different message formats
        if (message.payload !== undefined) {
            return message.payload;
        }

        if (message.message !== undefined) {
            try {
                return JSON.parse(message.message.toString());
            } catch (error) {
                return message.message.toString();
            }
        }

        // Return the message itself if no specific payload field
        return message;
    }

    /**
     * Process MQTT message with topic validation
     */
    processMqttMessage(message: any, expectedTopicPrefix: string, processor: (payload: any) => Promise<void> | void): Promise<void> | void | null {
        try {
            // Validate topic
            const cleanExpectedPrefix = expectedTopicPrefix.replace("+", "");

            if (!message.topic) {
                return null;
            }

            if (!message.topic.startsWith(cleanExpectedPrefix)) {
                return null;
            }

            // Extract and validate payload
            const payload = this.extractPayload(message);

            // Process with deduplication
            return this.processMessage(payload, processor);
        } catch (error) {
            this.logger.error(`MQTT message processing error: ${(error as Error).message}`);
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
        this.logger.debug("Message handler reset");
    }
}
