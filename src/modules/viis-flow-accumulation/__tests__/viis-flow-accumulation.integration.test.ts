/**
 * Test suite for viis-flow-accumulation node
 */

import { DataSource } from 'typeorm';
import { FlowAccumulationService } from '../../../services/MarineIoT/FlowAccumulationService';
import { TabiotFlowAccumulation } from '../../../orm/entities/flow-accumulation/TabiotFlowAccumulation';
import { TabiotDeviceTelemetry } from '../../../orm/entities/device-telemetry/TabiotDeviceTelemetry';

describe('ViisFlowAccumulationNode', () => {
    let dataSource: DataSource;
    let accumulationService: FlowAccumulationService;
    let testDeviceId: string;

    beforeAll(async () => {
        testDeviceId = `test-device-${Date.now()}`;

        dataSource = new DataSource({
            type: 'mysql',
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '3308'),
            username: process.env.DB_USERNAME || 'root',
            password: process.env.DB_PASSWORD || 'admin@123',
            database: process.env.DB_DATABASE || 'viis_local',
            entities: [TabiotFlowAccumulation, TabiotDeviceTelemetry],
            synchronize: true,
            dropSchema: true,
            logging: false,
        });

        await dataSource.initialize();
        accumulationService = new FlowAccumulationService(dataSource);
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    beforeEach(async () => {
        await dataSource.getRepository(TabiotFlowAccumulation).clear();
        await dataSource.getRepository(TabiotDeviceTelemetry).clear();
    });

    describe('Scheduled Calculation', () => {
        it('should calculate accumulation for previous hour', async () => {
            // Setup: Create telemetry data for previous hour
            const now = new Date();
            const previousHourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - 1, 0, 0, 0);
            const startTs = previousHourStart.getTime();

            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
            
            // Add 60 samples for fs01 (1 per minute)
            for (let i = 0; i < 60; i++) {
                await telemetryRepo.save(
                    telemetryRepo.create({
                        device_id: testDeviceId,
                        timestamp: startTs + (i * 60000),
                        key_name: 'fs01',
                        value_type: 'float',
                        float_value: 25.0,
                        oil_profile_id: 'BO_Generator',
                        density_snapshot: 950,
                    })
                );
            }

            // Execute: Calculate previous hour
            const results = await accumulationService.calculatePreviousHour(testDeviceId);

            // Assert
            expect(results).toHaveLength(1);
            expect(results[0].sensor_key).toBe('fs01');
            expect(results[0].avg_flow_m3h).toBe(25.0);
            expect(results[0].accumulated_m3).toBe(25.0);
            expect(results[0].accumulated_tons).toBe(23.75); // 25 * 0.95
            expect(results[0].sample_count).toBe(60);
        });

        it('should handle multiple sensors', async () => {
            const now = new Date();
            const previousHourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - 1, 0, 0, 0);
            const startTs = previousHourStart.getTime();

            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
            const sensors = ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];
            
            // Add data for all sensors
            for (const sensor of sensors) {
                for (let i = 0; i < 60; i++) {
                    await telemetryRepo.save(
                        telemetryRepo.create({
                            device_id: testDeviceId,
                            timestamp: startTs + (i * 60000),
                            key_name: sensor,
                            value_type: 'float',
                            float_value: 20.0 + sensors.indexOf(sensor),
                            oil_profile_id: 'BO_Generator',
                            density_snapshot: 950,
                        })
                    );
                }
            }

            const results = await accumulationService.calculatePreviousHour(testDeviceId);

            expect(results).toHaveLength(6);
            expect(results.map(r => r.sensor_key).sort()).toEqual(['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06']);
        });

        it('should handle no data gracefully', async () => {
            const results = await accumulationService.calculatePreviousHour(testDeviceId);
            expect(results).toEqual([]);
        });
    });

    describe('Manual Calculation', () => {
        it('should calculate specific hour on demand', async () => {
            const hourStart = new Date('2025-01-20T14:00:00Z');
            const startTs = hourStart.getTime();

            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
            
            for (let i = 0; i < 60; i++) {
                await telemetryRepo.save(
                    telemetryRepo.create({
                        device_id: testDeviceId,
                        timestamp: startTs + (i * 60000),
                        key_name: 'fs01',
                        value_type: 'float',
                        float_value: 30.5,
                        oil_profile_id: 'DO_MainEngine',
                        density_snapshot: 850,
                    })
                );
            }

            const results = await accumulationService.calculateHourlyAccumulation(
                testDeviceId,
                hourStart
            );

            expect(results).toHaveLength(1);
            expect(results[0].hour_start).toEqual(hourStart);
            expect(results[0].avg_flow_m3h).toBe(30.5);
        });

        it('should be idempotent (can recalculate same hour)', async () => {
            const hourStart = new Date('2025-01-20T10:00:00Z');
            const startTs = hourStart.getTime();

            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
            
            for (let i = 0; i < 60; i++) {
                await telemetryRepo.save(
                    telemetryRepo.create({
                        device_id: testDeviceId,
                        timestamp: startTs + (i * 60000),
                        key_name: 'fs01',
                        value_type: 'float',
                        float_value: 25.0,
                        oil_profile_id: 'BO_Generator',
                        density_snapshot: 950,
                    })
                );
            }

            // Calculate first time
            const results1 = await accumulationService.calculateHourlyAccumulation(
                testDeviceId,
                hourStart
            );

            // Calculate again (should update, not duplicate)
            const results2 = await accumulationService.calculateHourlyAccumulation(
                testDeviceId,
                hourStart
            );

            expect(results1[0].accumulated_tons).toBe(results2[0].accumulated_tons);

            // Verify only one record exists
            const accRepo = dataSource.getRepository(TabiotFlowAccumulation);
            const count = await accRepo.count({
                where: {
                    device_id: testDeviceId,
                    sensor_key: 'fs01',
                    hour_start: hourStart,
                },
            });

            expect(count).toBe(1);
        });
    });

    describe('Backfill', () => {
        it('should backfill multiple hours of data', async () => {
            const startDate = new Date('2025-01-20T10:00:00Z');
            const endDate = new Date('2025-01-20T13:00:00Z'); // 3 hours

            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);

            // Create data for 3 hours
            for (let h = 0; h < 3; h++) {
                const hourStart = new Date(startDate.getTime() + h * 3600000);
                for (let i = 0; i < 60; i++) {
                    await telemetryRepo.save(
                        telemetryRepo.create({
                            device_id: testDeviceId,
                            timestamp: hourStart.getTime() + (i * 60000),
                            key_name: 'fs01',
                            value_type: 'float',
                            float_value: 20.0 + h, // Different flow each hour
                            oil_profile_id: 'BO_Generator',
                            density_snapshot: 950,
                        })
                    );
                }
            }

            const processedHours = await accumulationService.backfillAccumulation(
                testDeviceId,
                startDate,
                endDate
            );

            expect(processedHours).toBe(3);

            // Verify all records created
            const accRepo = dataSource.getRepository(TabiotFlowAccumulation);
            const records = await accRepo.find({
                where: { device_id: testDeviceId, sensor_key: 'fs01' },
                order: { hour_start: 'ASC' },
            });

            expect(records).toHaveLength(3);
            expect(records[0].avg_flow_m3h).toBe(20.0);
            expect(records[1].avg_flow_m3h).toBe(21.0);
            expect(records[2].avg_flow_m3h).toBe(22.0);
        });
    });

    describe('MQTT Payload Formatting', () => {
        it('should format accumulation results for ThingsBoard MQTT', async () => {
            const hourStart = new Date('2025-01-20T14:00:00Z');
            const hourEnd = new Date('2025-01-20T15:00:00Z');

            // Create mock accumulation results
            const mockResults: TabiotFlowAccumulation[] = [
                {
                    id: 1,
                    device_id: testDeviceId,
                    sensor_key: 'fs01',
                    hour_start: hourStart,
                    hour_end: hourEnd,
                    avg_flow_m3h: 25.5,
                    accumulated_m3: 25.5,
                    accumulated_tons: 24.225,
                    oil_profile_id: 'BO_Generator',
                    density_used: 950,
                    sample_count: 60,
                    first_sample_ts: hourStart.getTime(),
                    last_sample_ts: hourEnd.getTime() - 1000,
                    created_at: new Date(),
                },
                {
                    id: 2,
                    device_id: testDeviceId,
                    sensor_key: 'fs02',
                    hour_start: hourStart,
                    hour_end: hourEnd,
                    avg_flow_m3h: 30.2,
                    accumulated_m3: 30.2,
                    accumulated_tons: 28.69,
                    oil_profile_id: 'BO_Generator',
                    density_used: 950,
                    sample_count: 60,
                    first_sample_ts: hourStart.getTime(),
                    last_sample_ts: hourEnd.getTime() - 1000,
                    created_at: new Date(),
                },
            ];

            // Format payload in ThingsBoard flat structure
            const payload: any = {
                ts: Date.now(),
                hour_start: hourStart.toISOString(),
                hour_end: hourEnd.toISOString(),
            };

            mockResults.forEach((result) => {
                const prefix = result.sensor_key;
                payload[`${prefix}_avg_flow_m3h`] = result.avg_flow_m3h;
                payload[`${prefix}_accumulated_m3`] = result.accumulated_m3;
                payload[`${prefix}_accumulated_tons`] = result.accumulated_tons;
                payload[`${prefix}_oil_profile`] = result.oil_profile_id;
                payload[`${prefix}_density`] = result.density_used;
                payload[`${prefix}_samples`] = result.sample_count;
            });

            // Verify flat payload structure (ThingsBoard format)
            expect(payload.ts).toBeDefined();
            expect(payload.hour_start).toBe(hourStart.toISOString());
            expect(payload.hour_end).toBe(hourEnd.toISOString());
            expect(payload.fs01_accumulated_tons).toBe(24.225);
            expect(payload.fs01_avg_flow_m3h).toBe(25.5);
            expect(payload.fs02_accumulated_m3).toBe(30.2);
            expect(payload.fs02_oil_profile).toBe('BO_Generator');
            expect(payload.fs01_density).toBe(950);
            expect(payload.fs02_samples).toBe(60);
        });
    });

    describe('Error Handling', () => {
        it('should handle database connection errors', async () => {
            const brokenDataSource = new DataSource({
                type: 'mysql',
                host: 'invalid-host',
                port: 9999,
                username: 'invalid',
                password: 'invalid',
                database: 'invalid',
                entities: [TabiotFlowAccumulation],
            });

            const brokenService = new FlowAccumulationService(brokenDataSource);

            await expect(
                brokenService.calculatePreviousHour('test-device')
            ).rejects.toThrow();
        });

        it('should handle invalid date ranges', async () => {
            const startDate = new Date('2025-01-20T10:00:00Z');
            const endDate = new Date('2025-01-19T10:00:00Z'); // End before start

            const processedHours = await accumulationService.backfillAccumulation(
                testDeviceId,
                startDate,
                endDate
            );

            expect(processedHours).toBe(0); // No hours processed
        });
    });
});
