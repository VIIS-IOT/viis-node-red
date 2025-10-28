/**
 * @fileoverview Trip Management Integration for VIIS REST API
 * 
 * Integrates trip accumulation worker with REST API service
 * Ensures worker starts when REST API initializes
 */

import { Node } from 'node-red';
import { DataSource } from 'typeorm';
import { TripAccumulationWorker } from '../../services/MarineIoT/TripAccumulationWorker';
import { TripAccumulationService } from '../../services/MarineIoT/TripAccumulationService';
import { FlowCheckpointService } from '../../services/MarineIoT/FlowCheckpointService';
import { logger } from './utils/logger';

export class TripIntegrationManager {
    private worker: TripAccumulationWorker | null = null;

    constructor(
        private dataSource: DataSource,
        private node: Node
    ) {}

    /**
     * Initialize and start trip accumulation worker
     */
    async initialize(): Promise<void> {
        try {
            logger.info(this.node, '[TRIP-INTEGRATION] Initializing trip accumulation system...');

            // Create services
            const tripAccumulationService = new TripAccumulationService(this.dataSource);
            const checkpointService = new FlowCheckpointService(this.dataSource);

            // Create and start worker
            this.worker = new TripAccumulationWorker(
                this.dataSource,
                tripAccumulationService,
                checkpointService,
                this.node
            );

            this.worker.start();

            logger.info(this.node, '[TRIP-INTEGRATION] ✅ Trip accumulation system initialized');

        } catch (error) {
            logger.error(this.node, `[TRIP-INTEGRATION] Initialization failed: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Stop the worker
     */
    async cleanup(): Promise<void> {
        if (this.worker) {
            this.worker.stop();
            logger.info(this.node, '[TRIP-INTEGRATION] Worker stopped');
        }
    }

    /**
     * Get worker status
     */
    getWorkerStatus() {
        return this.worker ? this.worker.getStats() : null;
    }
}
