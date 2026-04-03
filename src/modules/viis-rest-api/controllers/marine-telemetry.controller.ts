/**
 * @fileoverview Marine IoT Telemetry Controller
 * 
 * REST API endpoints for Marine IoT telemetry data
 * Path prefix: /api/v2/marine/telemetry
 * 
 * This controller is specific to Marine IoT systems and separate from
 * general telemetry endpoints to maintain clear domain separation.
 */

import 'reflect-metadata';
import { 
    JsonController, 
    Get, 
    Param, 
    QueryParams, 
    Authorized,
    HttpCode
} from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { MarineTelemetryService } from '../services/marine-telemetry.service';
import { NODE_TOKEN } from '../container/container.setup';
import {
    MarineTelemetryQueryDto,
    MarineTelemetryHistoryQueryDto,
    LatestTelemetryResponseDto,
    TelemetryHistoryResponseDto,
    MachinesSummaryResponseDto
} from '../dto/marine-telemetry.dto';

/**
 * Marine IoT Telemetry Controller
 * 
 * Endpoints:
 * - GET /api/v2/marine/telemetry/latest/:device_id - Get latest telemetry with machine aggregation
 * - GET /api/v2/marine/telemetry/history/:device_id - Get historical telemetry data
 * - GET /api/v2/marine/telemetry/machines/:device_id - Get machine summary info
 */
@JsonController('/marine/telemetry')
@Service()
export class MarineTelemetryController {
    constructor(
        @Inject() private marineTelemetryService: MarineTelemetryService,
        @Inject(NODE_TOKEN) private node: Node
    ) {
        if (!this.node) {
            console.error('[MARINE-API] MarineTelemetryController: Node injection failed');
            throw new Error('MarineTelemetryController initialization failed: Node not injected');
        }

        logger.info(this.node, 'MarineTelemetryController initialized with /marine/telemetry prefix');
    }

    /**
     * Get latest telemetry data with machine aggregation
     * GET /api/v2/marine/telemetry/latest/:device_id
     * 
     * Returns real-time telemetry data formatted for Marine IoT dashboard display.
     * Includes per-sensor data and aggregated machine-level calculations.
     * 
     * @param deviceId - Device ID (e.g., "ship_001")
     * @param query - Query parameters (optional keys filter)
     * @returns Latest telemetry with machine data
     * 
     * @example
     * GET /api/v2/marine/telemetry/latest/ship_001?keys=fs01,fs02,fs03,fs04,fs05,fs06
     * 
     * Response:
     * {
     *   "device_id": "ship_001",
     *   "timestamp": 1737369180000,
     *   "data": [
     *     {
     *       "key_name": "fs01",
     *       "value": 1000,
     *       "value_tons": 850.0,
     *       "oil_profile_id": "generator_do_001",
     *       "density_snapshot": 850,
     *       "machine_type": "GENERATOR"
     *     }
     *   ],
     *   "machines": {
     *     "GENERATOR": {
     *       "flow_in": { "key": "fs01", "m3h": 1000, "th": 850.0 },
     *       "flow_return": { "key": "fs02", "m3h": 980, "th": 833.0 },
     *       "consumption_rate": { "m3h": 20, "th": 17.0 },
     *       "oil_profile": "generator_do_001",
     *       "density": 850
     *     }
     *   }
     * }
     */
    @Get('/latest/:device_id')
    @HttpCode(200)
    @Authorized()
    async getLatestTelemetry(
        @Param('device_id') deviceId: string,
        @QueryParams() query: MarineTelemetryQueryDto
    ): Promise<LatestTelemetryResponseDto> {
        logger.info(this.node, `[Marine] Get latest telemetry for device: ${deviceId}`, {
            keys: query.keys
        });

        try {
            const keys = query.keys ? query.keys.split(',').map(k => k.trim()) : undefined;
            const result = await this.marineTelemetryService.getLatestTelemetry(deviceId, keys);

            logger.debug(this.node, `[Marine] Latest telemetry retrieved`, {
                deviceId,
                dataPointsCount: result.data.length,
                machinesCount: Object.keys(result.machines).length,
                timestamp: result.timestamp
            });

            return result;

        } catch (error) {
            logger.error(this.node, `[Marine] Failed to get latest telemetry`, {
                deviceId,
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * Get historical telemetry data
     * GET /api/v2/marine/telemetry/history/:device_id
     * 
     * Returns time-series telemetry data for charting and historical analysis.
     * Data is grouped by configurable time intervals.
     * 
     * @param deviceId - Device ID
     * @param query - Query parameters (time range, interval, filters)
     * @returns Historical telemetry data
     * 
     * @example
     * GET /api/v2/marine/telemetry/history/ship_001?start_time=1737280000000&end_time=1737369180000&interval=60000
     * 
     * Response:
     * {
     *   "device_id": "ship_001",
     *   "time_range": { "start": 1737280000000, "end": 1737369180000 },
     *   "interval": 60000,
     *   "data": [
     *     {
     *       "timestamp": 1737280000000,
     *       "fs01": 1000,
     *       "fs02": 980,
     *       "profiles": {
     *         "GENERATOR": { "id": "generator_do_001", "density": 850 }
     *       }
     *     }
     *   ]
     * }
     */
    @Get('/history/:device_id')
    @HttpCode(200)
    @Authorized()
    async getTelemetryHistory(
        @Param('device_id') deviceId: string,
        @QueryParams() query: MarineTelemetryHistoryQueryDto
    ): Promise<TelemetryHistoryResponseDto> {
        logger.info(this.node, `[Marine] Get telemetry history for device: ${deviceId}`, {
            startTime: query.start_time,
            endTime: query.end_time,
            interval: query.interval,
            machineType: query.machine_type
        });

        try {
            const keys = query.keys ? query.keys.split(',').map(k => k.trim()) : undefined;
            
            const result = await this.marineTelemetryService.getTelemetryHistory(
                deviceId,
                query.start_time,
                query.end_time,
                keys,
                query.interval,
                query.machine_type as any
            );

            logger.debug(this.node, `[Marine] Telemetry history retrieved`, {
                deviceId,
                dataPointsCount: result.data.length,
                timeRange: result.time_range,
                interval: result.interval
            });

            return result;

        } catch (error) {
            logger.error(this.node, `[Marine] Failed to get telemetry history`, {
                deviceId,
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * Get machines summary
     * GET /api/v2/marine/telemetry/machines/:device_id
     * 
     * Returns summary information for all machines on a device.
     * Includes current oil profiles, sensor mapping, and operational status.
     * 
     * @param deviceId - Device ID
     * @returns Machines summary
     * 
     * @example
     * GET /api/v2/marine/telemetry/machines/ship_001
     * 
     * Response:
     * {
     *   "device_id": "ship_001",
     *   "machines": [
     *     {
     *       "type": "MAIN_ENGINE",
     *       "sensors": { "flow_in": "fs03", "flow_return": "fs04" },
     *       "current_profile": {
     *         "id": "main_engine_bo_001",
     *         "oil_type": "BO",
     *         "density": 950,
     *         "label": "Main Engine BO"
     *       },
     *       "status": "OPERATIONAL",
     *       "last_update": 1737369180000
     *     }
     *   ]
     * }
     */
    @Get('/machines/:device_id')
    @HttpCode(200)
    @Authorized()
    async getMachinesSummary(
        @Param('device_id') deviceId: string
    ): Promise<MachinesSummaryResponseDto> {
        logger.info(this.node, `[Marine] Get machines summary for device: ${deviceId}`);

        try {
            const result = await this.marineTelemetryService.getMachineSummary(deviceId);

            logger.debug(this.node, `[Marine] Machines summary retrieved`, {
                deviceId,
                machinesCount: result.machines.length,
                statuses: result.machines.map(m => ({ type: m.type, status: m.status }))
            });

            return result;

        } catch (error) {
            logger.error(this.node, `[Marine] Failed to get machines summary`, {
                deviceId,
                error: (error as Error).message
            });
            throw error;
        }
    }
}
