/**
 * @fileoverview Flow Accumulation Controller
 * 
 * REST API endpoints for hourly flow accumulation data
 * Path prefix: /api/v2/marine/accumulation
 * 
 * This controller provides access to aggregated hourly flow data for Marine IoT systems.
 */

import 'reflect-metadata';
import { 
    JsonController, 
    Get, 
    Param, 
    QueryParams, 
    Authorized,
    HttpCode,
    Post,
    Body
} from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { FlowAccumulationService } from '../../../services/MarineIoT/FlowAccumulationService';
import { NODE_TOKEN } from '../container/container.setup';
import { DataSource } from 'typeorm';
import { createDataSource } from '../../../orm/dataSource';

interface AccumulationQueryParams {
    /** Start time (ISO date or timestamp) */
    start_time?: string | number;
    /** End time (ISO date or timestamp) */
    end_time?: string | number;
    /** Sensor keys filter (comma-separated: fs01,fs02) */
    sensor_keys?: string;
    /** Group by: hour, day, week, month */
    group_by?: 'hour' | 'day' | 'week' | 'month';
}

interface BackfillRequestBody {
    start_date: string;
    end_date: string;
}

/**
 * Flow Accumulation Controller
 * 
 * Endpoints:
 * - GET /api/v2/marine/accumulation/latest/:device_id - Get latest hourly accumulation
 * - GET /api/v2/marine/accumulation/history/:device_id - Get historical accumulation data
 * - GET /api/v2/marine/accumulation/daily/:device_id - Get daily totals
 * - GET /api/v2/marine/accumulation/summary/:device_id - Get summary statistics
 * - POST /api/v2/marine/accumulation/backfill/:device_id - Trigger backfill calculation
 */
@JsonController('/marine/accumulation')
@Service()
export class FlowAccumulationController {
    private dataSource: DataSource | null = null;
    private flowAccumulationService: FlowAccumulationService | null = null;

    constructor(
        @Inject(NODE_TOKEN) private node: Node
    ) {
        if (!this.node) {
            console.error('[ACCUMULATION-API] FlowAccumulationController: Node injection failed');
            throw new Error('FlowAccumulationController initialization failed: Node not injected');
        }

        logger.info(this.node, 'FlowAccumulationController initialized with /marine/accumulation prefix');
        
        // Initialize DataSource and Service
        this.initializeServices();
    }

    private async initializeServices() {
        try {
            this.dataSource = await createDataSource(this.node.context());
            if (!this.dataSource.isInitialized) {
                await this.dataSource.initialize();
            }
            
            this.flowAccumulationService = new FlowAccumulationService(this.dataSource);
            logger.info(this.node, '[ACCUMULATION-API] FlowAccumulationService initialized');
        } catch (error) {
            logger.error(this.node, '[ACCUMULATION-API] Failed to initialize services', {
                error: (error as Error).message
            });
        }
    }

    /**
     * Ensure DataSource is initialized before using
     */
    private async ensureDataSource(): Promise<DataSource> {
        if (!this.dataSource) {
            await this.initializeServices();
        }
        
        if (!this.dataSource) {
            throw new Error('DataSource initialization failed');
        }
        
        return this.dataSource;
    }

    /**
     * Get latest hourly accumulation data
     * GET /api/v2/marine/accumulation/latest/:device_id
     * 
     * Returns the most recent hourly accumulation for all sensors
     * 
     * @example
     * GET /api/v2/marine/accumulation/latest/ship_001?sensor_keys=fs01,fs02,fs03
     * 
     * Response:
     * {
     *   "device_id": "ship_001",
     *   "hour_start": "2025-01-20T14:00:00Z",
     *   "hour_end": "2025-01-20T15:00:00Z",
     *   "data": [
     *     {
     *       "sensor_key": "fs01",
     *       "avg_flow_m3h": 25.5,
     *       "accumulated_m3": 25.5,
     *       "accumulated_tons": 24.225,
     *       "oil_profile_id": "BO_Generator",
     *       "density_used": 950,
     *       "sample_count": 720
     *     }
     *   ]
     * }
     */
    @Get('/latest/:device_id')
    @HttpCode(200)
    @Authorized()
    async getLatestAccumulation(
        @Param('device_id') deviceId: string,
        @QueryParams() query: AccumulationQueryParams
    ) {
        logger.info(this.node, `[ACCUMULATION] Get latest accumulation for device: ${deviceId}`);

        const dataSource = await this.ensureDataSource();

        try {
            const repo = dataSource.getRepository('TabiotFlowAccumulation');
            
            let queryBuilder = repo.createQueryBuilder('acc')
                .where('acc.device_id = :deviceId', { deviceId })
                .orderBy('acc.hour_start', 'DESC');

            if (query.sensor_keys) {
                const sensorKeys = query.sensor_keys.split(',').map(k => k.trim());
                queryBuilder = queryBuilder.andWhere('acc.sensor_key IN (:...sensorKeys)', { sensorKeys });
            }

            queryBuilder = queryBuilder.limit(6); // Latest 6 sensors

            const records = await queryBuilder.getMany();

            if (records.length === 0) {
                return {
                    device_id: deviceId,
                    hour_start: null,
                    hour_end: null,
                    data: []
                };
            }

            return {
                device_id: deviceId,
                hour_start: records[0].hour_start,
                hour_end: records[0].hour_end,
                data: records.map(r => ({
                    sensor_key: r.sensor_key,
                    avg_flow_m3h: r.avg_flow_m3h,
                    accumulated_m3: r.accumulated_m3,
                    accumulated_tons: r.accumulated_tons,
                    oil_profile_id: r.oil_profile_id,
                    density_used: r.density_used,
                    sample_count: r.sample_count
                }))
            };

        } catch (error) {
            logger.error(this.node, `[ACCUMULATION] Failed to get latest accumulation`, {
                deviceId,
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * Get historical accumulation data
     * GET /api/v2/marine/accumulation/history/:device_id
     * 
     * Returns time-series accumulation data for specified date range
     * 
     * @example
     * GET /api/v2/marine/accumulation/history/ship_001?start_time=2025-01-20T00:00:00Z&end_time=2025-01-21T00:00:00Z
     * 
     * Response:
     * {
     *   "device_id": "ship_001",
     *   "time_range": { "start": "2025-01-20T00:00:00Z", "end": "2025-01-21T00:00:00Z" },
     *   "total_records": 144,
     *   "data": [
     *     {
     *       "hour_start": "2025-01-20T00:00:00Z",
     *       "hour_end": "2025-01-20T01:00:00Z",
     *       "fs01": { "m3": 25.5, "tons": 24.225, "samples": 720 },
     *       "fs02": { "m3": 30.2, "tons": 28.69, "samples": 720 }
     *     }
     *   ]
     * }
     */
    @Get('/history/:device_id')
    @HttpCode(200)
    @Authorized()
    async getAccumulationHistory(
        @Param('device_id') deviceId: string,
        @QueryParams() query: AccumulationQueryParams
    ) {
        logger.info(this.node, `[ACCUMULATION] Get history for device: ${deviceId}`, query);

        const dataSource = await this.ensureDataSource();

        try {
            const repo = dataSource.getRepository('TabiotFlowAccumulation');
            
            let queryBuilder = repo.createQueryBuilder('acc')
                .where('acc.device_id = :deviceId', { deviceId });

            // Apply time filters
            if (query.start_time) {
                const startDate = typeof query.start_time === 'number' 
                    ? new Date(query.start_time) 
                    : new Date(parseInt(query.start_time as string, 10));
                queryBuilder = queryBuilder.andWhere('acc.hour_start >= :startTime', { startTime: startDate });
            }

            if (query.end_time) {
                const endDate = typeof query.end_time === 'number' 
                    ? new Date(query.end_time) 
                    : new Date(parseInt(query.end_time as string, 10));
                queryBuilder = queryBuilder.andWhere('acc.hour_start < :endTime', { endTime: endDate });
            }

            if (query.sensor_keys) {
                const sensorKeys = query.sensor_keys.split(',').map(k => k.trim());
                queryBuilder = queryBuilder.andWhere('acc.sensor_key IN (:...sensorKeys)', { sensorKeys });
            }

            queryBuilder = queryBuilder.orderBy('acc.hour_start', 'DESC').addOrderBy('acc.sensor_key', 'ASC');

            const records = await queryBuilder.getMany();

            // Group by hour
            const groupedData = new Map<string, any>();
            
            records.forEach(record => {
                const hourKey = record.hour_start.toISOString();
                
                if (!groupedData.has(hourKey)) {
                    groupedData.set(hourKey, {
                        hour_start: record.hour_start,
                        hour_end: record.hour_end
                    });
                }

                const hourData = groupedData.get(hourKey);
                hourData[record.sensor_key] = {
                    m3: record.accumulated_m3,
                    tons: record.accumulated_tons,
                    avg_flow: record.avg_flow_m3h,
                    samples: record.sample_count,
                    oil_profile: record.oil_profile_id,
                    density: record.density_used
                };
            });

            return {
                device_id: deviceId,
                time_range: {
                    start: query.start_time || 'Not specified',
                    end: query.end_time || 'Not specified'
                },
                total_records: groupedData.size,
                data: Array.from(groupedData.values())
            };

        } catch (error) {
            logger.error(this.node, `[ACCUMULATION] Failed to get history`, {
                deviceId,
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * Get daily accumulation totals
     * GET /api/v2/marine/accumulation/daily/:device_id
     * 
     * Returns daily aggregated totals for all sensors
     * 
     * @example
     * GET /api/v2/marine/accumulation/daily/ship_001?start_time=2025-01-01&end_time=2025-01-31
     * 
     * Response:
     * {
     *   "device_id": "ship_001",
     *   "data": [
     *     {
     *       "date": "2025-01-20",
     *       "sensor_key": "fs01",
     *       "total_m3": 612.0,
     *       "total_tons": 581.4,
     *       "avg_flow_rate": 25.5,
     *       "hours_recorded": 24
     *     }
     *   ]
     * }
     */
    @Get('/daily/:device_id')
    @HttpCode(200)
    @Authorized()
    async getDailyTotals(
        @Param('device_id') deviceId: string,
        @QueryParams() query: AccumulationQueryParams
    ) {
        logger.info(this.node, `[ACCUMULATION] Get daily totals for device: ${deviceId}`);

        const dataSource = await this.ensureDataSource();

        try {
            let queryString = `
                SELECT 
                    sensor_key,
                    DATE(hour_start) as date,
                    COUNT(*) as hours_recorded,
                    SUM(accumulated_m3) as total_m3,
                    SUM(accumulated_tons) as total_tons,
                    AVG(avg_flow_m3h) as avg_flow_rate,
                    MIN(oil_profile_id) as oil_profile
                FROM tabiot_flow_accumulation
                WHERE device_id = ?
            `;

            const params: any[] = [deviceId];

            if (query.start_time) {
                queryString += ` AND hour_start >= ?`;
                const startDate = typeof query.start_time === 'number'
                    ? new Date(query.start_time)
                    : new Date(parseInt(query.start_time as string, 10));
                params.push(startDate);
            }

            if (query.end_time) {
                queryString += ` AND hour_start < ?`;
                const endDate = typeof query.end_time === 'number'
                    ? new Date(query.end_time)
                    : new Date(parseInt(query.end_time as string, 10));
                params.push(endDate);
            }

            if (query.sensor_keys) {
                const keys = query.sensor_keys.split(',').map(k => k.trim());
                queryString += ` AND sensor_key IN (${keys.map(() => '?').join(',')})`;
                params.push(...keys);
            }

            queryString += ` GROUP BY sensor_key, DATE(hour_start) ORDER BY date DESC, sensor_key`;

            const results = await dataSource.query(queryString, params);

            return {
                device_id: deviceId,
                data: results
            };

        } catch (error) {
            logger.error(this.node, `[ACCUMULATION] Failed to get daily totals`, {
                deviceId,
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * Get accumulation summary statistics
     * GET /api/v2/marine/accumulation/summary/:device_id
     * 
     * Returns summary statistics by machine type
     * 
     * @example
     * GET /api/v2/marine/accumulation/summary/ship_001?start_time=2025-01-20&end_time=2025-01-21
     * 
     * Response:
     * {
     *   "device_id": "ship_001",
     *   "time_range": { "start": "2025-01-20", "end": "2025-01-21" },
     *   "machines": {
     *     "GENERATOR": {
     *       "total_m3": 1224.0,
     *       "total_tons": 1162.8,
     *       "sensors": ["fs01", "fs02"]
     *     }
     *   }
     * }
     */
    @Get('/summary/:device_id')
    @HttpCode(200)
    @Authorized()
    async getAccumulationSummary(
        @Param('device_id') deviceId: string,
        @QueryParams() query: AccumulationQueryParams
    ) {
        logger.info(this.node, `[ACCUMULATION] Get summary for device: ${deviceId}`);

        const dataSource = await this.ensureDataSource();

        try {
            const repo = dataSource.getRepository('TabiotFlowAccumulation');
            
            let queryBuilder = repo.createQueryBuilder('acc')
                .where('acc.device_id = :deviceId', { deviceId });

            if (query.start_time) {
                const startTime = typeof query.start_time === 'number' 
                    ? new Date(query.start_time) 
                    : new Date(parseInt(query.start_time as string, 10));
                queryBuilder = queryBuilder.andWhere('acc.hour_start >= :startTime', { startTime });
            }

            if (query.end_time) {
                const endTime = typeof query.end_time === 'number' 
                    ? new Date(query.end_time) 
                    : new Date(parseInt(query.end_time as string, 10));
                queryBuilder = queryBuilder.andWhere('acc.hour_start < :endTime', { endTime });
            }

            const records = await queryBuilder.getMany();

            // Machine sensor mapping (NEW 4-machine configuration)
            // BOILER: fs01 (direct consumption)
            // MAIN_ENGINE: fs02-fs03, GENERATOR_HFO: fs03-fs04, GENERATOR_DO: fs05-fs06
            const machineMap = {
                'BOILER': ['fs01'],
                'MAIN_ENGINE': ['fs02', 'fs03'],
                'GENERATOR_HFO': ['fs03', 'fs04'],
                'GENERATOR_DO': ['fs05', 'fs06']
            };

            const machines: any = {};

            Object.entries(machineMap).forEach(([machineType, sensors]) => {
                const machineRecords = records.filter(r => sensors.includes(r.sensor_key));
                
                if (machineRecords.length > 0) {
                    machines[machineType] = {
                        total_m3: machineRecords.reduce((sum, r) => sum + (r.accumulated_m3 || 0), 0),
                        total_tons: machineRecords.reduce((sum, r) => sum + (r.accumulated_tons || 0), 0),
                        avg_flow_rate: machineRecords.reduce((sum, r) => sum + (r.avg_flow_m3h || 0), 0) / machineRecords.length,
                        sensors: sensors,
                        records_count: machineRecords.length / sensors.length
                    };
                }
            });

            return {
                device_id: deviceId,
                time_range: {
                    start: query.start_time || 'Not specified',
                    end: query.end_time || 'Not specified'
                },
                machines
            };

        } catch (error) {
            logger.error(this.node, `[ACCUMULATION] Failed to get summary`, {
                deviceId,
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * Trigger backfill calculation for historical data
     * POST /api/v2/marine/accumulation/backfill/:device_id
     * 
     * Triggers accumulation calculation for a date range
     * 
     * @example
     * POST /api/v2/marine/accumulation/backfill/ship_001
     * Body: { "start_date": "2025-01-01T00:00:00Z", "end_date": "2025-01-10T00:00:00Z" }
     * 
     * Response:
     * {
     *   "status": "success",
     *   "message": "Backfill started for 240 hours",
     *   "device_id": "ship_001",
     *   "start_date": "2025-01-01T00:00:00Z",
     *   "end_date": "2025-01-10T00:00:00Z"
     * }
     */
    @Post('/backfill/:device_id')
    @HttpCode(202)
    @Authorized()
    async triggerBackfill(
        @Param('device_id') deviceId: string,
        @Body() body: BackfillRequestBody
    ) {
        logger.info(this.node, `[ACCUMULATION] Backfill requested for device: ${deviceId}`, body);

        if (!this.flowAccumulationService) {
            throw new Error('FlowAccumulationService not initialized');
        }

        try {
            const startDate = new Date(body.start_date);
            const endDate = new Date(body.end_date);

            const hoursDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60));

            // Trigger backfill asynchronously
            this.flowAccumulationService.backfillAccumulation(deviceId, startDate, endDate)
                .then(() => {
                    logger.info(this.node, `[ACCUMULATION] Backfill completed for ${deviceId}`);
                })
                .catch((error) => {
                    logger.error(this.node, `[ACCUMULATION] Backfill failed for ${deviceId}`, {
                        error: (error as Error).message
                    });
                });

            return {
                status: 'success',
                message: `Backfill started for ${hoursDiff} hours`,
                device_id: deviceId,
                start_date: body.start_date,
                end_date: body.end_date
            };

        } catch (error) {
            logger.error(this.node, `[ACCUMULATION] Failed to trigger backfill`, {
                deviceId,
                error: (error as Error).message
            });
            throw error;
        }
    }
}
