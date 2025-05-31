/**
 * Message Handler for VIIS RPC Control Node
 * Handles message deduplication and processing
 */

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
            // Tạo hash base64 từ paramsStr và lấy 16 ký tự đầu
            const base64Hash = Buffer.from(paramsStr).toString('base64').slice(0, 16);
            return `${base64Hash}_${this.nodeId}`;
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
            this.logger.debug(`Cleaned up processed message: ${messageId}`);
        }, DEBOUNCE_CONFIG.MESSAGE_CACHE_TTL);

        this.logger.debug(`Marked message as processed: ${messageId}`);
    }

    /**
     * Clear all processed messages (useful for cleanup)
     */
    clearProcessedMessages(): void {
        const count = this.processedMessages.size;
        this.processedMessages.clear();
        this.logger.log(`Cleared ${count} processed messages`);
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
            this.logger.debug(`Duplicate message detected and ignored: ${messageId}`);
            return null;
        }

        // Mark as processed
        this.markMessageProcessed(messageId);

        // Log processing
        this.logger.log(`Processing message: ${JSON.stringify(payload)} [ID: ${messageId}]`);

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
                this.logger.warn(`Failed to parse message content: ${(error as Error).message}`);
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
            if (!message.topic || !message.topic.startsWith(expectedTopicPrefix.replace("+", ""))) {
                this.logger.debug(`Message topic ${message.topic} does not match expected prefix ${expectedTopicPrefix}`);
                return null;
            }

            // Extract and validate payload
            const payload = this.extractPayload(message);
            this.logger.debug(`extracted payload: ${JSON.stringify(payload)}`)
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
        this.logger.log("Message handler reset");
    }
}
