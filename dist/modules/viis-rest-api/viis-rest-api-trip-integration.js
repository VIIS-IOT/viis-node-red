"use strict";
/**
 * @fileoverview Trip Management Integration for VIIS REST API
 *
 * Integrates trip accumulation worker with REST API service
 * Ensures worker starts when REST API initializes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TripIntegrationManager = void 0;
const TripAccumulationWorker_1 = require("../../services/MarineIoT/TripAccumulationWorker");
const TripAccumulationService_1 = require("../../services/MarineIoT/TripAccumulationService");
const FlowCheckpointService_1 = require("../../services/MarineIoT/FlowCheckpointService");
const logger_1 = require("./utils/logger");
class TripIntegrationManager {
    constructor(dataSource, node) {
        this.dataSource = dataSource;
        this.node = node;
        this.worker = null;
    }
    /**
     * Initialize and start trip accumulation worker
     */
    async initialize() {
        try {
            logger_1.logger.info(this.node, '[TRIP-INTEGRATION] Initializing trip accumulation system...');
            // Create services
            const tripAccumulationService = new TripAccumulationService_1.TripAccumulationService(this.dataSource);
            const checkpointService = new FlowCheckpointService_1.FlowCheckpointService(this.dataSource);
            // Create and start worker
            this.worker = new TripAccumulationWorker_1.TripAccumulationWorker(this.dataSource, tripAccumulationService, checkpointService, this.node);
            this.worker.start();
            logger_1.logger.info(this.node, '[TRIP-INTEGRATION] ✅ Trip accumulation system initialized');
        }
        catch (error) {
            logger_1.logger.error(this.node, `[TRIP-INTEGRATION] Initialization failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Stop the worker
     */
    async cleanup() {
        if (this.worker) {
            this.worker.stop();
            logger_1.logger.info(this.node, '[TRIP-INTEGRATION] Worker stopped');
        }
    }
    /**
     * Get worker status
     */
    getWorkerStatus() {
        return this.worker ? this.worker.getStats() : null;
    }
}
exports.TripIntegrationManager = TripIntegrationManager;
