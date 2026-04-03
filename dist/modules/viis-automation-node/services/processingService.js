"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessingService = void 0;
const deviceIntents_1 = require("../../../core/deviceIntents");
const logger_1 = require("../utils/logger");
/**
 * Service for processing automation intents
 * - Evaluates intent conditions
 * - Generates device actions
 * - Manages processing state
 */
class ProcessingService {
    constructor(options) {
        this.node = options.node;
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new logger_1.Logger(this.node, "PROCESSING");
    }
    /**
     * Process automation intents with device data
     */
    async processIntents(intents, devicesData) {
        try {
            this.logger.log(`Processing ${intents.length} intents with ${devicesData.length} devices`);
            this.node.status({
                fill: "blue",
                shape: "dot",
                text: "Processing intents..."
            });
            // Use existing DeviceIntentService for logic
            const intentService = new deviceIntents_1.DeviceIntentService(intents, devicesData);
            const results = await intentService.processDeviceIntents();
            this.node.status({
                fill: "green",
                shape: "dot",
                text: "Processing complete"
            });
            this.logger.log(`Processing complete. Generated ${results.length} results`);
            return results;
        }
        catch (error) {
            this.logger.error(`Intent processing failed: ${error.message}`);
            this.node.status({
                fill: "yellow",
                shape: "ring",
                text: `Processing error: ${error.message}`
            });
            throw error;
        }
    }
    /**
     * Build output payload for successful processing
     */
    buildSuccessPayload(intents, devicesData, results) {
        return {
            intents,
            devices_data: devicesData,
            results
        };
    }
    /**
     * Build output payload for error
     */
    buildErrorPayload(error) {
        return {
            error: true,
            message: error.message,
            timestamp: Date.now()
        };
    }
}
exports.ProcessingService = ProcessingService;
