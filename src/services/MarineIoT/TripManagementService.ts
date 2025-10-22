/**
 * @fileoverview Trip Management Service
 * 
 * Manages voyage/trip lifecycle for Marine IoT fuel consumption tracking
 * Handles start/end/cancel operations for trips
 * 
 * IMPORTANT: This is separate from FlowAccumulationService (hourly accumulation)
 */

import { Service } from 'typedi';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { TabiotTrip } from '../../orm/entities/trip/TabiotTrip';
import { TabiotTripAccumulation } from '../../orm/entities/trip/TabiotTripAccumulation';

export interface CreateTripOptions {
    deviceId: string;
    tripName?: string;
    notes?: string;
}

export interface TripWithStats extends TabiotTrip {
    total_consumption_m3?: number;
    total_consumption_tons?: number;
    duration_hours?: number;
}

@Service()
export class TripManagementService {
    private tripRepo: Repository<TabiotTrip>;
    private accumulationRepo: Repository<TabiotTripAccumulation>;

    constructor(private dataSource: DataSource) {
        this.tripRepo = dataSource.getRepository(TabiotTrip);
        this.accumulationRepo = dataSource.getRepository(TabiotTripAccumulation);
    }

    /**
     * Start a new trip
     * Auto-ends any active trips for the same device before starting
     */
    async startTrip(options: CreateTripOptions): Promise<TabiotTrip> {
        const { deviceId, tripName, notes } = options;

        // End any active trips for this device first
        await this.endActiveTrips(deviceId);

        // Create new trip
        const tripId = uuidv4();
        const trip = this.tripRepo.create({
            id: tripId,
            device_id: deviceId,
            trip_name: tripName || `Trip ${new Date().toISOString().split('T')[0]}`,
            start_time: Date.now(),
            status: 'ACTIVE',
            notes: notes || null,
        });

        await this.tripRepo.save(trip);

        // Initialize accumulation counters for all 6 sensors
        const sensors = ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];
        const accumulationRecords = sensors.map(sensor => 
            this.accumulationRepo.create({
                trip_id: tripId,
                device_id: deviceId,
                sensor_key: sensor,
                total_volume_m3: 0,
                total_volume_tons: 0,
                sample_count: 0,
                last_update_time: null,
            })
        );

        await this.accumulationRepo.save(accumulationRecords);

        return trip;
    }

    /**
     * End a specific trip
     */
    async endTrip(tripId: string): Promise<TabiotTrip | null> {
        const trip = await this.tripRepo.findOne({ where: { id: tripId } });
        
        if (!trip) {
            throw new Error(`Trip ${tripId} not found`);
        }

        if (trip.status !== 'ACTIVE') {
            throw new Error(`Trip ${tripId} is not active (status: ${trip.status})`);
        }

        trip.end_time = Date.now();
        trip.status = 'COMPLETED';
        trip.updated_at = new Date();

        return await this.tripRepo.save(trip);
    }

    /**
     * Cancel a trip
     */
    async cancelTrip(tripId: string, reason?: string): Promise<TabiotTrip | null> {
        const trip = await this.tripRepo.findOne({ where: { id: tripId } });
        
        if (!trip) {
            throw new Error(`Trip ${tripId} not found`);
        }

        trip.end_time = Date.now();
        trip.status = 'CANCELLED';
        trip.notes = reason ? `${trip.notes || ''}\nCancelled: ${reason}`.trim() : trip.notes;
        trip.updated_at = new Date();

        return await this.tripRepo.save(trip);
    }

    /**
     * Get active trip for a device
     */
    async getActiveTrip(deviceId: string): Promise<TabiotTrip | null> {
        return await this.tripRepo.findOne({
            where: { 
                device_id: deviceId, 
                status: 'ACTIVE' 
            }
        });
    }

    /**
     * Get trip by ID
     */
    async getTrip(tripId: string): Promise<TabiotTrip | null> {
        return await this.tripRepo.findOne({
            where: { id: tripId }
        });
    }

    /**
     * Get trip with consumption statistics
     */
    async getTripWithStats(tripId: string): Promise<TripWithStats | null> {
        const trip = await this.getTrip(tripId);
        if (!trip) return null;

        // Get accumulation data
        const accumulations = await this.accumulationRepo.find({
            where: { trip_id: tripId }
        });

        // Calculate total consumption (sum of all flow_in - flow_return)
        const flowInSensors = ['fs01', 'fs03', 'fs05'];
        const flowReturnSensors = ['fs02', 'fs04', 'fs06'];

        const totalInM3 = accumulations
            .filter(a => flowInSensors.includes(a.sensor_key))
            .reduce((sum, a) => sum + Number(a.total_volume_m3), 0);

        const totalReturnM3 = accumulations
            .filter(a => flowReturnSensors.includes(a.sensor_key))
            .reduce((sum, a) => sum + Number(a.total_volume_m3), 0);

        const totalInTons = accumulations
            .filter(a => flowInSensors.includes(a.sensor_key))
            .reduce((sum, a) => sum + Number(a.total_volume_tons), 0);

        const totalReturnTons = accumulations
            .filter(a => flowReturnSensors.includes(a.sensor_key))
            .reduce((sum, a) => sum + Number(a.total_volume_tons), 0);

        const durationMs = (trip.end_time || Date.now()) - trip.start_time;
        const durationHours = durationMs / (1000 * 60 * 60);

        return {
            ...trip,
            total_consumption_m3: Number((totalInM3 - totalReturnM3).toFixed(2)),
            total_consumption_tons: Number((totalInTons - totalReturnTons).toFixed(2)),
            duration_hours: Number(durationHours.toFixed(2))
        };
    }

    /**
     * Get trip history for a device
     */
    async getTripHistory(
        deviceId: string, 
        limit: number = 50,
        status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
    ): Promise<TabiotTrip[]> {
        const queryBuilder = this.tripRepo
            .createQueryBuilder('trip')
            .where('trip.device_id = :deviceId', { deviceId })
            .orderBy('trip.start_time', 'DESC')
            .limit(limit);

        if (status) {
            queryBuilder.andWhere('trip.status = :status', { status });
        }

        return await queryBuilder.getMany();
    }

    /**
     * End all active trips for a device
     * Used internally when starting a new trip
     */
    private async endActiveTrips(deviceId: string): Promise<void> {
        await this.tripRepo
            .createQueryBuilder()
            .update(TabiotTrip)
            .set({ 
                end_time: Date.now(),
                status: 'COMPLETED',
                updated_at: new Date()
            })
            .where('device_id = :deviceId', { deviceId })
            .andWhere('status = :status', { status: 'ACTIVE' })
            .execute();
    }

    /**
     * Delete old completed trips (data retention)
     */
    async deleteOldTrips(deviceId: string, olderThanDays: number = 90): Promise<number> {
        const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
        
        const result = await this.tripRepo
            .createQueryBuilder()
            .delete()
            .from(TabiotTrip)
            .where('device_id = :deviceId', { deviceId })
            .andWhere('status IN (:...statuses)', { statuses: ['COMPLETED', 'CANCELLED'] })
            .andWhere('end_time < :cutoffTime', { cutoffTime })
            .execute();

        return result.affected || 0;
    }
}
