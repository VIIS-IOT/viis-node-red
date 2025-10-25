/**
 * @fileoverview Marine IoT Telemetry Service
 * 
 * Handles querying and aggregating telemetry data for Marine IoT systems
 * with support for multi-machine (Generator, Main Engine, Boiler) data
 */

import { Service } from 'typedi';
import { DataSource, Repository, Between } from 'typeorm';
import { TabiotDeviceTelemetryLatest } from '../../../orm/entities/device-telemetry/TabiotDeviceTelemetryLatest';
import { TabiotDeviceTelemetry } from '../../../orm/entities/device-telemetry/TabiotDeviceTelemetry';
import { TabiotOilProfile } from '../../../orm/entities/oil-profile/TabiotOilProfile';
import { OilProfileService, MachineType } from '../../../services/MarineIoT/OilProfileService';
import { TripManagementService } from '../../../services/MarineIoT/TripManagementService';
import { TripAccumulationService } from '../../../services/MarineIoT/TripAccumulationService';
import {
    LatestTelemetryResponseDto,
    EnhancedLatestTelemetryResponseDto,
    TelemetryHistoryResponseDto,
    MachinesSummaryResponseDto,
    MachineType as DtoMachineType,
    TelemetryDataPoint,
    MachineData,
    EnhancedMachineData,
    MachineFlowData,
    ConsumptionRate,
    HistoricalDataPoint,
    MachineSummary,
    MachineStatus,
    MachineProfile
} from '../dto/marine-telemetry.dto';

/**
 * Sensor mapping for each machine type
 * fs01-fs02: Máy chính (Main Engine), fs03-fs04: Máy phát (Generator), fs05-fs06: Nồi hơi (Boiler)
 */
const MACHINE_SENSORS: Record<MachineType, { flow_in: string; flow_return: string }> = {
    'MAIN_ENGINE': { flow_in: 'fs01', flow_return: 'fs02' },
    'GENERATOR': { flow_in: 'fs03', flow_return: 'fs04' },
    'BOILER': { flow_in: 'fs05', flow_return: 'fs06' }
};

@Service()
export class MarineTelemetryService {
    private telemetryLatestRepo: Repository<TabiotDeviceTelemetryLatest>;
    private telemetryRepo: Repository<TabiotDeviceTelemetry>;
    private oilProfileRepo: Repository<TabiotOilProfile>;
    private oilProfileService: OilProfileService;
    private tripManagementService: TripManagementService;
    private tripAccumulationService: TripAccumulationService;

    constructor(private dataSource: DataSource) {
        this.telemetryLatestRepo = dataSource.getRepository(TabiotDeviceTelemetryLatest);
        this.telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
        this.oilProfileRepo = dataSource.getRepository(TabiotOilProfile);
        this.oilProfileService = new OilProfileService(dataSource);
        this.tripManagementService = new TripManagementService(dataSource);
        this.tripAccumulationService = new TripAccumulationService(dataSource);
    }

    /**
     * Get latest telemetry data with machine aggregation
     */
    async getLatestTelemetry(
        deviceId: string,
        keys?: string[]
    ): Promise<LatestTelemetryResponseDto> {
        // Default to all flow sensors if not specified
        const sensorKeys = keys || ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];

        // Query latest telemetry for requested sensors
        const queryBuilder = this.telemetryLatestRepo
            .createQueryBuilder('t')
            .where('t.device_id = :deviceId', { deviceId })
            .andWhere('t.key_name IN (:...keys)', { keys: sensorKeys });

        const telemetryData = await queryBuilder.getMany();

        // If no data, return empty structure instead of error
        if (telemetryData.length === 0) {
            return {
                device_id: deviceId,
                timestamp: Date.now(),
                data: [],
                machines: {}
            };
        }

        // Get current timestamp from latest data
        const timestamp = Math.max(...telemetryData.map(t => Number(t.timestamp)));

        // Transform to data points
        const dataPoints: TelemetryDataPoint[] = telemetryData.map(t => {
            const machineType = OilProfileService.getMachineTypeBySensor(t.key_name);
            const value = t.float_value || 0;
            const density = t.density_snapshot || 1000;
            
            return {
                key_name: t.key_name,
                value: value,
                value_tons: this.calculateTons(value, density),
                oil_profile_id: t.oil_profile_id || null,
                density_snapshot: density,
                machine_type: machineType as DtoMachineType
            };
        });

        // Aggregate by machine
        const machines = this.aggregateByMachine(dataPoints);

        return {
            device_id: deviceId,
            timestamp: timestamp,
            data: dataPoints,
            machines: machines
        };
    }

    /**
     * Get latest telemetry data WITH trip accumulation
     * Returns enhanced data including trip totals
     */
    async getLatestTelemetryWithTrip(
        deviceId: string,
        keys?: string[]
    ): Promise<EnhancedLatestTelemetryResponseDto> {
        // Get base real-time telemetry
        const baseData = await this.getLatestTelemetry(deviceId, keys);

        // Check if there's an active trip
        const activeTrip = await this.tripManagementService.getActiveTrip(deviceId);

        if (!activeTrip) {
            // No active trip, return base data without trip accumulation
            return {
                ...baseData,
                machines: baseData.machines as any, // Cast to EnhancedMachineData
                current_trip: undefined
            };
        }

        // Get trip accumulation data
        const tripAccumulation = await this.tripAccumulationService.getTripAccumulation(activeTrip.id);

        // Merge trip data with real-time data
        const enhancedMachines = this.mergeWithTripData(
            baseData.machines,
            tripAccumulation,
            activeTrip
        );

        // Calculate trip duration
        const durationMs = Date.now() - activeTrip.start_time;
        const durationHours = Number((durationMs / (1000 * 60 * 60)).toFixed(2));

        return {
            device_id: deviceId,
            timestamp: baseData.timestamp,
            data: baseData.data,
            machines: enhancedMachines,
            current_trip: {
                id: activeTrip.id,
                name: activeTrip.trip_name || 'Unnamed Trip',
                start_time: activeTrip.start_time,
                duration_hours: durationHours
            }
        };
    }

    /**
     * Merge trip accumulation data with real-time machine data
     */
    private mergeWithTripData(
        machines: Record<string, MachineData>,
        tripAccumulation: any[],
        trip: any
    ): Record<string, EnhancedMachineData> {
        const enhanced: Record<string, EnhancedMachineData> = {};
        const machineTypes: MachineType[] = ['GENERATOR', 'MAIN_ENGINE', 'BOILER'];

        for (const machineType of machineTypes) {
            const machineData = machines[machineType];
            if (!machineData) continue;

            const sensors = MACHINE_SENSORS[machineType];

            // Find accumulation data for this machine's sensors
            const flowInAcc = tripAccumulation.find(a => a.sensor_key === sensors.flow_in);
            const flowReturnAcc = tripAccumulation.find(a => a.sensor_key === sensors.flow_return);

            enhanced[machineType] = {
                ...machineData,
                trip_accumulation: {
                    total_volume_in: {
                        m3: Number(flowInAcc?.total_volume_m3 || 0),
                        tons: Number(flowInAcc?.total_volume_tons || 0)
                    },
                    total_volume_return: {
                        m3: Number(flowReturnAcc?.total_volume_m3 || 0),
                        tons: Number(flowReturnAcc?.total_volume_tons || 0)
                    },
                    total_consumption: {
                        m3: Number((Number(flowInAcc?.total_volume_m3 || 0) - Number(flowReturnAcc?.total_volume_m3 || 0)).toFixed(2)),
                        tons: Number((Number(flowInAcc?.total_volume_tons || 0) - Number(flowReturnAcc?.total_volume_tons || 0)).toFixed(2))
                    }
                }
            };
        }

        return enhanced;
    }

    /**
     * Get historical telemetry data
     */
    async getTelemetryHistory(
        deviceId: string,
        startTime: number,
        endTime: number,
        keys?: string[],
        interval?: number,
        machineType?: MachineType
    ): Promise<TelemetryHistoryResponseDto> {
        const sensorKeys = keys || ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];

        // Filter by machine type if specified
        let filteredKeys = sensorKeys;
        if (machineType) {
            const machineSensors = MACHINE_SENSORS[machineType];
            filteredKeys = sensorKeys.filter(k => 
                k === machineSensors.flow_in || k === machineSensors.flow_return
            );
        }

        // Query historical data
        const queryBuilder = this.telemetryRepo
            .createQueryBuilder('t')
            .where('t.device_id = :deviceId', { deviceId })
            .andWhere('t.key_name IN (:...keys)', { keys: filteredKeys })
            .andWhere('t.timestamp >= :startTime', { startTime })
            .andWhere('t.timestamp <= :endTime', { endTime })
            .orderBy('t.timestamp', 'ASC');

        const rawData = await queryBuilder.getMany();

        // Group by timestamp intervals
        const intervalMs = interval || 60000; // Default 1 minute
        const groupedData = this.groupByInterval(rawData, intervalMs);

        return {
            device_id: deviceId,
            time_range: { start: startTime, end: endTime },
            interval: intervalMs,
            data: groupedData
        };
    }

    /**
     * Get machine summary information
     */
    async getMachineSummary(deviceId: string): Promise<MachinesSummaryResponseDto> {
        const machines: MachineSummary[] = [];
        const machineTypes: MachineType[] = ['GENERATOR', 'MAIN_ENGINE', 'BOILER'];

        for (const machineType of machineTypes) {
            const sensors = MACHINE_SENSORS[machineType];
            
            // Get current profile
            const profile = await this.oilProfileService.getActiveProfileForMachine(
                deviceId,
                machineType
            );

            // Get latest telemetry for this machine's sensors
            const latestData = await this.telemetryLatestRepo
                .createQueryBuilder('t')
                .where('t.device_id = :deviceId', { deviceId })
                .andWhere('t.key_name IN (:...keys)', { 
                    keys: [sensors.flow_in, sensors.flow_return] 
                })
                .getMany();

            // Determine status
            let status: MachineStatus = MachineStatus.NO_DATA;
            let lastUpdate = 0;

            if (latestData.length > 0) {
                lastUpdate = Math.max(...latestData.map(t => Number(t.timestamp)));
                const dataAge = Date.now() - lastUpdate;
                
                if (dataAge < 5 * 60 * 1000) { // Less than 5 minutes
                    status = MachineStatus.OPERATIONAL;
                    
                    // Check for warnings (high consumption, etc.)
                    // This can be enhanced based on business rules
                } else {
                    status = MachineStatus.NO_DATA;
                }
            }

            machines.push({
                type: machineType as DtoMachineType,
                sensors: sensors,
                current_profile: profile ? {
                    id: profile.name,
                    oil_type: profile.oil_type,
                    density: profile.density,
                    label: profile.label || profile.name
                } : null,
                status: status,
                last_update: lastUpdate
            });
        }

        return {
            device_id: deviceId,
            machines: machines
        };
    }

    /**
     * Calculate tons from m³/h and density
     * Formula: T/h = (m³/h × density) / 1000
     */
    private calculateTons(m3h: number, density: number): number {
        return Number(((m3h * density) / 1000).toFixed(2));
    }

    /**
     * Aggregate telemetry data by machine type
     */
    private aggregateByMachine(
        dataPoints: TelemetryDataPoint[]
    ): Record<string, MachineData> {
        const machines: Record<string, MachineData> = {};

        // Group by machine type
        const machineTypes: MachineType[] = ['GENERATOR', 'MAIN_ENGINE', 'BOILER'];

        for (const machineType of machineTypes) {
            const sensors = MACHINE_SENSORS[machineType];
            
            const flowInData = dataPoints.find(d => d.key_name === sensors.flow_in);
            const flowReturnData = dataPoints.find(d => d.key_name === sensors.flow_return);

            if (flowInData && flowReturnData) {
                const flowIn: MachineFlowData = {
                    key: flowInData.key_name,
                    m3h: flowInData.value,
                    th: flowInData.value_tons
                };

                const flowReturn: MachineFlowData = {
                    key: flowReturnData.key_name,
                    m3h: flowReturnData.value,
                    th: flowReturnData.value_tons
                };

                const consumption: ConsumptionRate = {
                    m3h: Number((flowIn.m3h - flowReturn.m3h).toFixed(2)),
                    th: Number((flowIn.th - flowReturn.th).toFixed(2))
                };

                machines[machineType] = {
                    flow_in: flowIn,
                    flow_return: flowReturn,
                    consumption_rate: consumption,
                    oil_profile: flowInData.oil_profile_id,
                    density: flowInData.density_snapshot || 0
                };
            }
        }

        return machines;
    }

    /**
     * Group historical data by time intervals
     */
    private groupByInterval(
        rawData: TabiotDeviceTelemetry[],
        intervalMs: number
    ): HistoricalDataPoint[] {
        const grouped: Map<number, HistoricalDataPoint> = new Map();

        for (const record of rawData) {
            const timestamp = Number(record.timestamp);
            const intervalStart = Math.floor(timestamp / intervalMs) * intervalMs;

            if (!grouped.has(intervalStart)) {
                grouped.set(intervalStart, {
                    timestamp: intervalStart,
                    profiles: {}
                });
            }

            const point = grouped.get(intervalStart)!;
            const value = record.float_value || 0;

            // Set sensor value
            (point as any)[record.key_name] = value;

            // Track profile info
            if (record.oil_profile_id && record.density_snapshot) {
                const machineType = OilProfileService.getMachineTypeBySensor(record.key_name);
                if (machineType && point.profiles) {
                    point.profiles[machineType as DtoMachineType] = {
                        id: record.oil_profile_id,
                        density: record.density_snapshot
                    };
                }
            }
        }

        return Array.from(grouped.values()).sort((a, b) => a.timestamp - b.timestamp);
    }
}
