"use strict";
/**
 * @fileoverview Marine IoT Telemetry Service
 *
 * Handles querying and aggregating telemetry data for Marine IoT systems
 * with support for multi-machine (Generator, Main Engine, Boiler) data
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarineTelemetryService = void 0;
const typedi_1 = require("typedi");
const typeorm_1 = require("typeorm");
const TabiotDeviceTelemetryLatest_1 = require("../../../orm/entities/device-telemetry/TabiotDeviceTelemetryLatest");
const TabiotDeviceTelemetry_1 = require("../../../orm/entities/device-telemetry/TabiotDeviceTelemetry");
const TabiotOilProfile_1 = require("../../../orm/entities/oil-profile/TabiotOilProfile");
const OilProfileService_1 = require("../../../services/MarineIoT/OilProfileService");
const TripManagementService_1 = require("../../../services/MarineIoT/TripManagementService");
const TripAccumulationService_1 = require("../../../services/MarineIoT/TripAccumulationService");
const marine_telemetry_dto_1 = require("../dto/marine-telemetry.dto");
/**
 * Sensor mapping for each machine type
 */
const MACHINE_SENSORS = {
    'GENERATOR': { flow_in: 'fs01', flow_return: 'fs02' },
    'MAIN_ENGINE': { flow_in: 'fs03', flow_return: 'fs04' },
    'BOILER': { flow_in: 'fs05', flow_return: 'fs06' }
};
let MarineTelemetryService = class MarineTelemetryService {
    constructor(dataSource) {
        this.dataSource = dataSource;
        this.telemetryLatestRepo = dataSource.getRepository(TabiotDeviceTelemetryLatest_1.TabiotDeviceTelemetryLatest);
        this.telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry);
        this.oilProfileRepo = dataSource.getRepository(TabiotOilProfile_1.TabiotOilProfile);
        this.oilProfileService = new OilProfileService_1.OilProfileService(dataSource);
        this.tripManagementService = new TripManagementService_1.TripManagementService(dataSource);
        this.tripAccumulationService = new TripAccumulationService_1.TripAccumulationService(dataSource);
    }
    /**
     * Get latest telemetry data with machine aggregation
     */
    async getLatestTelemetry(deviceId, keys) {
        // Default to all flow sensors if not specified
        const sensorKeys = keys || ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];
        // Query latest telemetry for requested sensors
        const queryBuilder = this.telemetryLatestRepo
            .createQueryBuilder('t')
            .where('t.device_id = :deviceId', { deviceId })
            .andWhere('t.key_name IN (:...keys)', { keys: sensorKeys });
        const telemetryData = await queryBuilder.getMany();
        if (telemetryData.length === 0) {
            throw new Error(`No telemetry data found for device ${deviceId}`);
        }
        // Get current timestamp from latest data
        const timestamp = Math.max(...telemetryData.map(t => Number(t.timestamp)));
        // Transform to data points
        const dataPoints = telemetryData.map(t => {
            const machineType = OilProfileService_1.OilProfileService.getMachineTypeBySensor(t.key_name);
            const value = t.float_value || 0;
            const density = t.density_snapshot || 1000;
            return {
                key_name: t.key_name,
                value: value,
                value_tons: this.calculateTons(value, density),
                oil_profile_id: t.oil_profile_id || null,
                density_snapshot: density,
                machine_type: machineType
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
    async getLatestTelemetryWithTrip(deviceId, keys) {
        // Get base real-time telemetry
        const baseData = await this.getLatestTelemetry(deviceId, keys);
        // Check if there's an active trip
        const activeTrip = await this.tripManagementService.getActiveTrip(deviceId);
        if (!activeTrip) {
            // No active trip, return base data without trip accumulation
            return Object.assign(Object.assign({}, baseData), { machines: baseData.machines, current_trip: undefined });
        }
        // Get trip accumulation data
        const tripAccumulation = await this.tripAccumulationService.getTripAccumulation(activeTrip.id);
        // Merge trip data with real-time data
        const enhancedMachines = this.mergeWithTripData(baseData.machines, tripAccumulation, activeTrip);
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
    mergeWithTripData(machines, tripAccumulation, trip) {
        const enhanced = {};
        const machineTypes = ['GENERATOR', 'MAIN_ENGINE', 'BOILER'];
        for (const machineType of machineTypes) {
            const machineData = machines[machineType];
            if (!machineData)
                continue;
            const sensors = MACHINE_SENSORS[machineType];
            // Find accumulation data for this machine's sensors
            const flowInAcc = tripAccumulation.find(a => a.sensor_key === sensors.flow_in);
            const flowReturnAcc = tripAccumulation.find(a => a.sensor_key === sensors.flow_return);
            enhanced[machineType] = Object.assign(Object.assign({}, machineData), { trip_accumulation: {
                    total_volume_in: {
                        m3: Number((flowInAcc === null || flowInAcc === void 0 ? void 0 : flowInAcc.total_volume_m3) || 0),
                        tons: Number((flowInAcc === null || flowInAcc === void 0 ? void 0 : flowInAcc.total_volume_tons) || 0)
                    },
                    total_volume_return: {
                        m3: Number((flowReturnAcc === null || flowReturnAcc === void 0 ? void 0 : flowReturnAcc.total_volume_m3) || 0),
                        tons: Number((flowReturnAcc === null || flowReturnAcc === void 0 ? void 0 : flowReturnAcc.total_volume_tons) || 0)
                    },
                    total_consumption: {
                        m3: Number((Number((flowInAcc === null || flowInAcc === void 0 ? void 0 : flowInAcc.total_volume_m3) || 0) - Number((flowReturnAcc === null || flowReturnAcc === void 0 ? void 0 : flowReturnAcc.total_volume_m3) || 0)).toFixed(2)),
                        tons: Number((Number((flowInAcc === null || flowInAcc === void 0 ? void 0 : flowInAcc.total_volume_tons) || 0) - Number((flowReturnAcc === null || flowReturnAcc === void 0 ? void 0 : flowReturnAcc.total_volume_tons) || 0)).toFixed(2))
                    }
                } });
        }
        return enhanced;
    }
    /**
     * Get historical telemetry data
     */
    async getTelemetryHistory(deviceId, startTime, endTime, keys, interval, machineType) {
        const sensorKeys = keys || ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];
        // Filter by machine type if specified
        let filteredKeys = sensorKeys;
        if (machineType) {
            const machineSensors = MACHINE_SENSORS[machineType];
            filteredKeys = sensorKeys.filter(k => k === machineSensors.flow_in || k === machineSensors.flow_return);
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
    async getMachineSummary(deviceId) {
        const machines = [];
        const machineTypes = ['GENERATOR', 'MAIN_ENGINE', 'BOILER'];
        for (const machineType of machineTypes) {
            const sensors = MACHINE_SENSORS[machineType];
            // Get current profile
            const profile = await this.oilProfileService.getActiveProfileForMachine(deviceId, machineType);
            // Get latest telemetry for this machine's sensors
            const latestData = await this.telemetryLatestRepo
                .createQueryBuilder('t')
                .where('t.device_id = :deviceId', { deviceId })
                .andWhere('t.key_name IN (:...keys)', {
                keys: [sensors.flow_in, sensors.flow_return]
            })
                .getMany();
            // Determine status
            let status = marine_telemetry_dto_1.MachineStatus.NO_DATA;
            let lastUpdate = 0;
            if (latestData.length > 0) {
                lastUpdate = Math.max(...latestData.map(t => Number(t.timestamp)));
                const dataAge = Date.now() - lastUpdate;
                if (dataAge < 5 * 60 * 1000) { // Less than 5 minutes
                    status = marine_telemetry_dto_1.MachineStatus.OPERATIONAL;
                    // Check for warnings (high consumption, etc.)
                    // This can be enhanced based on business rules
                }
                else {
                    status = marine_telemetry_dto_1.MachineStatus.NO_DATA;
                }
            }
            machines.push({
                type: machineType,
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
    calculateTons(m3h, density) {
        return Number(((m3h * density) / 1000).toFixed(2));
    }
    /**
     * Aggregate telemetry data by machine type
     */
    aggregateByMachine(dataPoints) {
        const machines = {};
        // Group by machine type
        const machineTypes = ['GENERATOR', 'MAIN_ENGINE', 'BOILER'];
        for (const machineType of machineTypes) {
            const sensors = MACHINE_SENSORS[machineType];
            const flowInData = dataPoints.find(d => d.key_name === sensors.flow_in);
            const flowReturnData = dataPoints.find(d => d.key_name === sensors.flow_return);
            if (flowInData && flowReturnData) {
                const flowIn = {
                    key: flowInData.key_name,
                    m3h: flowInData.value,
                    th: flowInData.value_tons
                };
                const flowReturn = {
                    key: flowReturnData.key_name,
                    m3h: flowReturnData.value,
                    th: flowReturnData.value_tons
                };
                const consumption = {
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
    groupByInterval(rawData, intervalMs) {
        const grouped = new Map();
        for (const record of rawData) {
            const timestamp = Number(record.timestamp);
            const intervalStart = Math.floor(timestamp / intervalMs) * intervalMs;
            if (!grouped.has(intervalStart)) {
                grouped.set(intervalStart, {
                    timestamp: intervalStart,
                    profiles: {}
                });
            }
            const point = grouped.get(intervalStart);
            const value = record.float_value || 0;
            // Set sensor value
            point[record.key_name] = value;
            // Track profile info
            if (record.oil_profile_id && record.density_snapshot) {
                const machineType = OilProfileService_1.OilProfileService.getMachineTypeBySensor(record.key_name);
                if (machineType && point.profiles) {
                    point.profiles[machineType] = {
                        id: record.oil_profile_id,
                        density: record.density_snapshot
                    };
                }
            }
        }
        return Array.from(grouped.values()).sort((a, b) => a.timestamp - b.timestamp);
    }
};
exports.MarineTelemetryService = MarineTelemetryService;
exports.MarineTelemetryService = MarineTelemetryService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], MarineTelemetryService);
