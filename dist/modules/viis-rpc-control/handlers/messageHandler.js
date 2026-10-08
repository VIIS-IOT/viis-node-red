"use strict";
/**
 * Message Handler for VIIS RPC Control Node
 * Handles message deduplication and processing
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageHandler = void 0;
const crypto = __importStar(require("crypto"));
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
const diagnostic_logger_1 = require("../../../core/observability/diagnostic-logger");
const trace_context_1 = require("../../../core/observability/trace-context");
const runtime_1 = require("../../../core/observability/runtime");
class MessageHandler {
    constructor(options, identity = {}) {
        this.duplicateTraceIds = new Map();
        this.cleanupTimers = new Set();
        this.processedMessages = new Set();
        this.logger = new logger_1.Logger(options.node, "MESSAGE-HANDLER");
        this.nodeId = options.node.id;
        this.diagnostic = new diagnostic_logger_1.DiagnosticLogger(options.node, "rpc-ingress");
        this.nodeInstanceId = identity.nodeInstanceId || crypto.randomUUID();
        this.brokerRole = identity.brokerRole || "none";
        this.deviceId = identity.deviceId;
    }
    /**
     * Generate a unique message ID based on payload content and node ID
     * Uses SHA256 hash to ensure the ENTIRE payload (including values) is considered
     *
     * BUG FIX: Previously used base64.slice(0,16) which only captured ~12 chars,
     * causing collisions when key names were long (e.g., "COIL_OUTPUT_WATER_IN")
     * and the value (true/false) was not included in the hash.
     */
    generateMessageId(payload) {
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
                    return Object.keys(value).sort().reduce((obj, k) => {
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
        }
        catch (error) {
            // Fallback về ID dựa trên timestamp nếu có lỗi
            this.logger.warn(`Failed to generate stable message ID: ${error.message}`);
            return `${Date.now()}_${Math.random().toString(16).substring(2, 10)}_${this.nodeId}`;
        }
    }
    /**
     * Check if a message has already been processed
     */
    isMessageProcessed(messageId) {
        return this.processedMessages.has(messageId);
    }
    /**
     * Mark a message as processed and schedule cleanup
     */
    markMessageProcessed(messageId) {
        this.markMessageProcessedWithTrace(messageId);
    }
    markMessageProcessedWithTrace(messageId, traceId) {
        this.processedMessages.add(messageId);
        if (traceId)
            this.duplicateTraceIds.set(messageId, traceId);
        // Schedule cleanup after TTL
        const timer = setTimeout(() => {
            this.processedMessages.delete(messageId);
            this.duplicateTraceIds.delete(messageId);
            this.cleanupTimers.delete(timer);
            // this.logger.warn(`Cleaned up processed message: ${messageId}`);
        }, constants_1.DEBOUNCE_CONFIG.MESSAGE_CACHE_TTL);
        this.cleanupTimers.add(timer);
        // this.logger.warn(`Marked message as processed: ${messageId}`);
    }
    /**
     * Clear all processed messages (useful for cleanup)
     */
    clearProcessedMessages() {
        const count = this.processedMessages.size;
        this.processedMessages.clear();
        this.duplicateTraceIds.clear();
        this.cleanupTimers.forEach(timer => clearTimeout(timer));
        this.cleanupTimers.clear();
        this.logger.warn(`Cleared ${count} processed messages`);
    }
    /**
     * Get the number of currently tracked processed messages
     */
    getProcessedMessageCount() {
        return this.processedMessages.size;
    }
    /**
     * Check if the processed message cache is getting too large
     */
    isCacheOverloaded(maxSize = 1000) {
        return this.processedMessages.size > maxSize;
    }
    /**
     * Force cleanup of old messages (emergency cleanup)
     */
    forceCleanup() {
        if (this.isCacheOverloaded()) {
            this.logger.warn("Message cache overloaded, performing force cleanup");
            this.clearProcessedMessages();
        }
    }
    /**
     * Process a message with deduplication
     */
    processMessage(payload, processor, context) {
        const messageId = this.generateMessageId(payload);
        // Check for duplicate
        if (this.isMessageProcessed(messageId)) {
            this.diagnostic.emit("warn", "rpc.duplicate", Object.assign(Object.assign({}, context), { dedupId: messageId, duplicateOfTraceId: this.duplicateTraceIds.get(messageId), dedupTtlMs: constants_1.DEBOUNCE_CONFIG.MESSAGE_CACHE_TTL }));
            return null;
        }
        else {
            // this.logger.warn(`New message detected: ${messageId}`);
        }
        // Mark as processed
        this.markMessageProcessedWithTrace(messageId, context === null || context === void 0 ? void 0 : context.traceId);
        this.diagnostic.emit("info", "rpc.accepted", Object.assign(Object.assign({}, context), { dedupId: messageId }));
        // Log processing
        // this.logger.warn(`Processing message: ${JSON.stringify(payload)} [ID: ${messageId}]`);
        // Process the message
        try {
            return processor(payload, context);
        }
        catch (error) {
            this.logger.error(`Message processing failed for ${messageId}: ${error.message}`);
            throw error;
        }
    }
    /**
     * Create a message processor with automatic deduplication
     */
    createDuplicateFilter(processor) {
        return (payload) => this.processMessage(payload, processor);
    }
    /**
     * Validate message structure
     */
    validateMessageStructure(message) {
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
    extractPayload(message) {
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
            }
            catch (error) {
                throw new Error(`Invalid MQTT JSON payload: ${error.message}`);
            }
        }
        // Return the message itself if no specific payload field
        // this.logger.warn(`[EXTRACT] No payload/message field found, returning entire message`);
        return message;
    }
    /**
     * Process MQTT message with topic validation
     */
    processMqttMessage(message, expectedTopicPrefix, processor, identity = {}) {
        var _a;
        let context = (0, trace_context_1.createTraceContext)({
            runtimeBootId: runtime_1.runtimeBootId,
            nodeId: this.nodeId,
            nodeInstanceId: identity.nodeInstanceId || this.nodeInstanceId,
            ingress: "mqtt",
            brokerRole: identity.brokerRole || this.brokerRole,
            deviceId: identity.deviceId || this.deviceId,
            topic: message === null || message === void 0 ? void 0 : message.topic,
        });
        this.diagnostic.emit("info", "rpc.received", Object.assign(Object.assign({}, context), { topic: typeof (message === null || message === void 0 ? void 0 : message.topic) === "string" ? message.topic.slice(0, 256) : undefined, payloadBytes: Buffer.byteLength(String((_a = message === null || message === void 0 ? void 0 : message.message) !== null && _a !== void 0 ? _a : ""), "utf8"), qos: message === null || message === void 0 ? void 0 : message.qos, retain: Boolean(message === null || message === void 0 ? void 0 : message.retain) }));
        try {
            // this.logger.warn(`[MSG-HANDLER] Processing MQTT message`);
            // this.logger.warn(`[MSG-HANDLER] Message topic: ${message.topic}`);
            // this.logger.warn(`[MSG-HANDLER] Expected topic prefix: ${expectedTopicPrefix}`);
            // this.logger.warn(`[MSG-HANDLER] Full message: ${JSON.stringify(message)}`);
            // Validate topic
            const cleanExpectedPrefix = expectedTopicPrefix.replace("+", "");
            // this.logger.warn(`[MSG-HANDLER] Clean expected prefix: ${cleanExpectedPrefix}`);
            if (!message.topic) {
                this.diagnostic.emit("warn", "rpc.rejected", Object.assign(Object.assign({}, context), { reason: "missing_topic" }));
                return null;
            }
            if (!message.topic.startsWith(cleanExpectedPrefix)) {
                this.diagnostic.emit("warn", "rpc.rejected", Object.assign(Object.assign({}, context), { reason: "topic_mismatch" }));
                return null;
            }
            // this.logger.warn(`[MSG-HANDLER] Topic validation passed`);
            // Extract and validate payload
            const payload = this.extractPayload(message);
            const attached = (0, trace_context_1.attachBusinessRequestId)(context, payload);
            context = attached.context;
            if (attached.invalidSource) {
                this.diagnostic.emit("warn", "rpc.request_id_invalid", Object.assign(Object.assign({}, context), { source: attached.invalidSource }));
            }
            // this.logger.warn(`[MSG-HANDLER] Extracted payload: ${JSON.stringify(payload)}`);
            // Process with deduplication
            const result = this.processMessage(payload, processor, context);
            // this.logger.warn(`[MSG-HANDLER] Process message result: ${result}`);
            return result;
        }
        catch (error) {
            this.diagnostic.emit("error", "rpc.parse_failed", Object.assign(Object.assign({}, context), { disposition: "rejected", error: { message: error.message } }));
            this.logger.error(`[MSG-HANDLER] MQTT message processing error: ${error.message}`);
            throw error;
        }
    }
    /**
     * Get statistics about message processing
     */
    getStatistics() {
        return {
            processedMessageCount: this.getProcessedMessageCount(),
            cacheOverloaded: this.isCacheOverloaded(),
            nodeId: this.nodeId,
        };
    }
    /**
     * Reset the message handler state
     */
    reset() {
        this.clearProcessedMessages();
        this.logger.warn("Message handler reset");
    }
}
exports.MessageHandler = MessageHandler;
