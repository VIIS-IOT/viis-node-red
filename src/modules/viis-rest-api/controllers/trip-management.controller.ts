/**
 * @fileoverview Trip Management Controller
 * 
 * REST API endpoints for managing trips/voyages
 */

import { JsonController, Get, Post, Param, Body, QueryParams, HttpCode, Authorized } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { Node } from 'node-red';
import { TripManagementService } from '../../../services/MarineIoT/TripManagementService';
import { TripAccumulationService } from '../../../services/MarineIoT/TripAccumulationService';
import { NODE_TOKEN } from '../container/container.setup';
import { 
    StartTripDto, 
    EndTripDto, 
    CancelTripDto,
    TripHistoryQueryDto,
    TripResponseDto,
    TripWithStatsResponseDto,
    TripAccumulationResponseDto
} from '../dto/trip-management.dto';
import { logger } from '../utils/logger';

@JsonController('/marine/trip')
@Service()
export class TripManagementController {
    constructor(
        @Inject() private tripManagementService: TripManagementService,
        @Inject() private tripAccumulationService: TripAccumulationService,
        @Inject(NODE_TOKEN) private node: Node
    ) {
        if (!this.node) {
            console.error('[TRIP-API] TripManagementController: Node injection failed');
            throw new Error('TripManagementController initialization failed: Node not injected');
        }
        logger.info(this.node, 'TripManagementController initialized with /marine/trip prefix');
    }

    /**
     * Start a new trip
     * POST /api/v2/marine/trip/start
     */
    @Post('/start')
    @HttpCode(201)
    @Authorized()
    async startTrip(@Body() body: StartTripDto): Promise<TripResponseDto> {
        try {
            logger.info(this.node, `[TRIP-API] Starting trip for device ${body.device_id}`);

            const trip = await this.tripManagementService.startTrip({
                deviceId: body.device_id,
                tripName: body.trip_name,
                notes: body.notes
            });

            logger.info(this.node, `[TRIP-API] Trip started: ${trip.id}`);

            return {
                id: trip.id,
                device_id: trip.device_id,
                trip_name: trip.trip_name,
                start_time: trip.start_time,
                end_time: trip.end_time,
                status: trip.status,
                notes: trip.notes,
                created_at: trip.created_at.toISOString(),
                updated_at: trip.updated_at?.toISOString() || null
            };
        } catch (error) {
            logger.error(this.node, `[TRIP-API] Start trip failed: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * End a trip
     * POST /api/v2/marine/trip/:id/end
     */
    @Post('/:id/end')
    @HttpCode(200)
    @Authorized()
    async endTrip(@Param('id') tripId: string): Promise<TripWithStatsResponseDto> {
        try {
            logger.info(this.node, `[TRIP-API] Ending trip ${tripId}`);

            await this.tripManagementService.endTrip(tripId);
            const tripWithStats = await this.tripManagementService.getTripWithStats(tripId);

            if (!tripWithStats) {
                throw new Error('Trip not found');
            }

            logger.info(this.node, `[TRIP-API] Trip ended: ${tripId}`);

            return {
                id: tripWithStats.id,
                device_id: tripWithStats.device_id,
                trip_name: tripWithStats.trip_name,
                start_time: tripWithStats.start_time,
                end_time: tripWithStats.end_time,
                status: tripWithStats.status,
                notes: tripWithStats.notes,
                created_at: tripWithStats.created_at.toISOString(),
                updated_at: tripWithStats.updated_at?.toISOString() || null,
                total_consumption_m3: tripWithStats.total_consumption_m3 || 0,
                total_consumption_tons: tripWithStats.total_consumption_tons || 0,
                duration_hours: tripWithStats.duration_hours || 0
            };
        } catch (error) {
            logger.error(this.node, `[TRIP-API] End trip failed: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Cancel a trip
     * POST /api/v2/marine/trip/:id/cancel
     */
    @Post('/:id/cancel')
    @HttpCode(200)
    @Authorized()
    async cancelTrip(
        @Param('id') tripId: string,
        @Body() body: { reason?: string }
    ): Promise<TripResponseDto> {
        try {
            logger.info(this.node, `[TRIP-API] Cancelling trip ${tripId}`);

            const trip = await this.tripManagementService.cancelTrip(tripId, body.reason);

            if (!trip) {
                throw new Error('Trip not found');
            }

            logger.info(this.node, `[TRIP-API] Trip cancelled: ${tripId}`);

            return {
                id: trip.id,
                device_id: trip.device_id,
                trip_name: trip.trip_name,
                start_time: trip.start_time,
                end_time: trip.end_time,
                status: trip.status,
                notes: trip.notes,
                created_at: trip.created_at.toISOString(),
                updated_at: trip.updated_at?.toISOString() || null
            };
        } catch (error) {
            logger.error(this.node, `[TRIP-API] Cancel trip failed: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Get active trip for a device
     * GET /api/v2/marine/trip/active/:device_id
     */
    @Get('/active/:device_id')
    @HttpCode(200)
    @Authorized()
    async getActiveTrip(@Param('device_id') deviceId: string): Promise<TripWithStatsResponseDto | null> {
        try {
            const trip = await this.tripManagementService.getActiveTrip(deviceId);

            if (!trip) {
                return null;
            }

            const tripWithStats = await this.tripManagementService.getTripWithStats(trip.id);

            if (!tripWithStats) {
                return null;
            }

            return {
                id: tripWithStats.id,
                device_id: tripWithStats.device_id,
                trip_name: tripWithStats.trip_name,
                start_time: tripWithStats.start_time,
                end_time: tripWithStats.end_time,
                status: tripWithStats.status,
                notes: tripWithStats.notes,
                created_at: tripWithStats.created_at.toISOString(),
                updated_at: tripWithStats.updated_at?.toISOString() || null,
                total_consumption_m3: tripWithStats.total_consumption_m3 || 0,
                total_consumption_tons: tripWithStats.total_consumption_tons || 0,
                duration_hours: tripWithStats.duration_hours || 0
            };
        } catch (error) {
            logger.error(this.node, `[TRIP-API] Get active trip failed: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Get trip by ID
     * GET /api/v2/marine/trip/:id
     */
    @Get('/:id')
    @HttpCode(200)
    @Authorized()
    async getTrip(@Param('id') tripId: string): Promise<TripWithStatsResponseDto> {
        try {
            const tripWithStats = await this.tripManagementService.getTripWithStats(tripId);

            if (!tripWithStats) {
                throw new Error('Trip not found');
            }

            return {
                id: tripWithStats.id,
                device_id: tripWithStats.device_id,
                trip_name: tripWithStats.trip_name,
                start_time: tripWithStats.start_time,
                end_time: tripWithStats.end_time,
                status: tripWithStats.status,
                notes: tripWithStats.notes,
                created_at: tripWithStats.created_at.toISOString(),
                updated_at: tripWithStats.updated_at?.toISOString() || null,
                total_consumption_m3: tripWithStats.total_consumption_m3 || 0,
                total_consumption_tons: tripWithStats.total_consumption_tons || 0,
                duration_hours: tripWithStats.duration_hours || 0
            };
        } catch (error) {
            logger.error(this.node, `[TRIP-API] Get trip failed: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Get trip history for a device
     * GET /api/v2/marine/trip/history/:device_id
     */
    @Get('/history/:device_id')
    @HttpCode(200)
    @Authorized()
    async getTripHistory(
        @Param('device_id') deviceId: string,
        @QueryParams() query: TripHistoryQueryDto
    ): Promise<TripResponseDto[]> {
        try {
            const limit = query.limit || 50;
            const trips = await this.tripManagementService.getTripHistory(
                deviceId,
                limit,
                query.status
            );

            return trips.map(trip => ({
                id: trip.id,
                device_id: trip.device_id,
                trip_name: trip.trip_name,
                start_time: trip.start_time,
                end_time: trip.end_time,
                status: trip.status,
                notes: trip.notes,
                created_at: trip.created_at.toISOString(),
                updated_at: trip.updated_at?.toISOString() || null
            }));
        } catch (error) {
            logger.error(this.node, `[TRIP-API] Get trip history failed: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Get trip accumulation data
     * GET /api/v2/marine/trip/:id/accumulation
     */
    @Get('/:id/accumulation')
    @HttpCode(200)
    @Authorized()
    async getTripAccumulation(@Param('id') tripId: string): Promise<TripAccumulationResponseDto> {
        try {
            const trip = await this.tripManagementService.getTrip(tripId);
            if (!trip) {
                throw new Error('Trip not found');
            }

            const accumulations = await this.tripAccumulationService.getTripAccumulation(tripId);
            const totalConsumption = await this.tripAccumulationService.getTotalConsumption(tripId);

            return {
                trip_id: tripId,
                device_id: trip.device_id,
                sensors: accumulations.map(acc => ({
                    sensor_key: acc.sensor_key,
                    total_volume_m3: Number(acc.total_volume_m3),
                    total_volume_tons: Number(acc.total_volume_tons),
                    oil_profile_id: acc.oil_profile_id,
                    current_density: acc.current_density ? Number(acc.current_density) : null,
                    last_update_time: acc.last_update_time,
                    sample_count: acc.sample_count
                })),
                total_consumption: totalConsumption
            };
        } catch (error) {
            logger.error(this.node, `[TRIP-API] Get trip accumulation failed: ${(error as Error).message}`);
            throw error;
        }
    }
}
