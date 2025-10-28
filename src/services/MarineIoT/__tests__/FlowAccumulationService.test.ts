import { DataSource } from 'typeorm';
import { FlowAccumulationService } from '../FlowAccumulationService';
import { TabiotFlowAccumulation } from '../../../orm/entities/flow-accumulation/TabiotFlowAccumulation';
import { TabiotDeviceTelemetry } from '../../../orm/entities/device-telemetry/TabiotDeviceTelemetry';
import { TabiotOilProfile } from '../../../orm/entities/oil-profile/TabiotOilProfile';
import { TabiotDevice } from '../../../orm/entities/device/TabiotDevice';
import { TabiotCustomer } from '../../../orm/entities/customer/customer';

describe('FlowAccumulationService', () => {
    let dataSource: DataSource;
    let service: FlowAccumulationService;
    let testDeviceId: string;
    let testProfileId: string;

    beforeAll(async () => {
        dataSource = new DataSource({
            type: 'mysql',
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '3306'),
            username: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'viis_local_test',
            entities: ['src/orm/entities/**/*.ts'],
            synchronize: true,
            dropSchema: true,
        });

        await dataSource.initialize();
        service = new FlowAccumulationService(dataSource);
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    beforeEach(async () => {
        // Create test device
        const deviceRepo = dataSource.getRepository(TabiotDevice);
        testDeviceId = `test_device_${Date.now()}`;
        
        const device = deviceRepo.create({
            name: testDeviceId,
            id: testDeviceId,
            label: 'Test Device',
            creation: new Date(),
            modified: new Date(),
        });
        
        await deviceRepo.save(device);

        // Create test oil profile
        const profileRepo = dataSource.getRepository(TabiotOilProfile);
        testProfileId = `test_profile_${Date.now()}`;
        
        const profile = profileRepo.create({
            name: testProfileId,
            device_id: testDeviceId,
            oil_type: 'FO',
            operating_temperature: 85,
            density: 950,
            is_active: true,
            creation: new Date(),
            modified: new Date(),
        });
        
        await profileRepo.save(profile);
    });

    afterEach(async () => {
        // Delete in order to respect foreign key constraints
        await dataSource.getRepository(TabiotFlowAccumulation).delete({});
        await dataSource.getRepository(TabiotDeviceTelemetry).delete({});
        await dataSource.getRepository(TabiotOilProfile).delete({});
        await dataSource.getRepository(TabiotDevice).delete({});
    });

    describe('calculateHourlyAccumulation', () => {
        it('should calculate accumulation with valid telemetry data', async () => {
            const hourStart = new Date('2025-01-01T00:00:00Z');
            const startTs = hourStart.getTime();
            const endTs = startTs + 3600000; // +1 hour

            // Create TFS telemetry data (accumulated values increasing)
            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
            const samples = [];
            
            const startTfs = 100.0; // Starting accumulated value
            const endTfs = 125.5;   // Ending accumulated value
            const deltaPerSample = (endTfs - startTfs) / 119; // Distribute across samples
            
            for (let i = 0; i < 120; i++) {
                const timestamp = startTs + (i * 30000); // Every 30 seconds
                const tfsValue = startTfs + (i * deltaPerSample);
                
                samples.push(
                    telemetryRepo.create({
                        device_id: testDeviceId,
                        timestamp,
                        key_name: 'tfs01', // TFS sensor (accumulated)
                        value_type: 'float',
                        float_value: tfsValue,
                        oil_profile_id: testProfileId,
                        density_snapshot: 950,
                    })
                );
            }
            
            await telemetryRepo.save(samples);

            // Calculate accumulation
            const results = await service.calculateHourlyAccumulation(
                testDeviceId,
                hourStart
            );

            expect(results).toHaveLength(1); // Only fs01 has data
            expect(results[0].sensor_key).toBe('fs01');
            expect(results[0].accumulated_m3).toBeCloseTo(25.5, 1); // endTfs - startTfs
            expect(results[0].accumulated_tons).toBeCloseTo(24.225, 2); // 25.5 * (950/1000)
            expect(results[0].sample_count).toBe(120);
            expect(results[0].oil_profile_id).toBe(testProfileId);
            expect(results[0].density_used).toBe(950);
        });

        it('should calculate for multiple sensors', async () => {
            const hourStart = new Date('2025-01-01T00:00:00Z');
            const startTs = hourStart.getTime();

            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
            
            // TFS sensors with different accumulations
            const sensorConfig = [
                { fs: 'fs01', tfs: 'tfs01', start: 100.0, end: 125.5 },  // 25.5 m³
                { fs: 'fs02', tfs: 'tfs02', start: 200.0, end: 230.2 },  // 30.2 m³
                { fs: 'fs03', tfs: 'tfs03', start: 300.0, end: 318.7 },  // 18.7 m³
            ];
            
            for (const config of sensorConfig) {
                const deltaPerSample = (config.end - config.start) / 119;
                
                for (let i = 0; i < 120; i++) {
                    const timestamp = startTs + (i * 30000);
                    const tfsValue = config.start + (i * deltaPerSample);
                    
                    await telemetryRepo.save(
                        telemetryRepo.create({
                            device_id: testDeviceId,
                            timestamp,
                            key_name: config.tfs,
                            value_type: 'float',
                            float_value: tfsValue,
                            oil_profile_id: testProfileId,
                            density_snapshot: 950,
                        })
                    );
                }
            }

            const results = await service.calculateHourlyAccumulation(
                testDeviceId,
                hourStart
            );

            expect(results).toHaveLength(3);
            
            const fs01 = results.find(r => r.sensor_key === 'fs01');
            const fs02 = results.find(r => r.sensor_key === 'fs02');
            const fs03 = results.find(r => r.sensor_key === 'fs03');

            expect(fs01?.accumulated_m3).toBeCloseTo(25.5, 1);
            expect(fs02?.accumulated_m3).toBeCloseTo(30.2, 1);
            expect(fs03?.accumulated_m3).toBeCloseTo(18.7, 1);
        });

        it('should verify math: accumulated_tons = accumulated_m3 * density', async () => {
            const hourStart = new Date('2025-01-01T00:00:00Z');
            const startTs = hourStart.getTime();
            const density = 850; // 850 kg/m³

            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
            
            // TFS accumulated from 100 to 120 = 20 m³
            for (let i = 0; i < 60; i++) {
                const tfsValue = 100 + (i * 20 / 59);
                await telemetryRepo.save(
                    telemetryRepo.create({
                        device_id: testDeviceId,
                        timestamp: startTs + (i * 60000),
                        key_name: 'tfs01',
                        value_type: 'float',
                        float_value: tfsValue,
                        oil_profile_id: testProfileId,
                        density_snapshot: density,
                    })
                );
            }

            const results = await service.calculateHourlyAccumulation(
                testDeviceId,
                hourStart
            );

            const result = results[0];
            // 20 m³ * (850/1000) = 17 tons
            expect(result.accumulated_m3).toBeCloseTo(20, 1);
            expect(result.accumulated_tons).toBeCloseTo(17, 1);
            expect(result.density_used).toBe(density);
        });

        it('should include profile information', async () => {
            const hourStart = new Date('2025-01-01T00:00:00Z');
            const startTs = hourStart.getTime();

            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
            
            // TFS data with profile info
            for (let i = 0; i < 60; i++) {
                const tfsValue = 100 + (i * 0.5);
                await telemetryRepo.save(
                    telemetryRepo.create({
                        device_id: testDeviceId,
                        timestamp: startTs + (i * 60000),
                        key_name: 'tfs01',
                        value_type: 'float',
                        float_value: tfsValue,
                        oil_profile_id: testProfileId,
                        density_snapshot: 950,
                    })
                );
            }

            const results = await service.calculateHourlyAccumulation(
                testDeviceId,
                hourStart
            );

            expect(results[0].oil_profile_id).toBe(testProfileId);
            expect(results[0].density_used).toBe(950);
        });

        it('should handle missing telemetry gracefully', async () => {
            const hourStart = new Date('2025-01-01T00:00:00Z');

            // No telemetry data created
            const results = await service.calculateHourlyAccumulation(
                testDeviceId,
                hourStart
            );

            expect(results).toEqual([]);
        });

        it('should use default density when no snapshot available', async () => {
            const hourStart = new Date('2025-01-01T00:00:00Z');
            const startTs = hourStart.getTime();

            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
            
            // Create TFS telemetry without density snapshot
            for (let i = 0; i < 60; i++) {
                const tfsValue = 100 + (i * 0.5);
                await telemetryRepo.save(
                    telemetryRepo.create({
                        device_id: testDeviceId,
                        timestamp: startTs + (i * 60000),
                        key_name: 'tfs01',
                        value_type: 'float',
                        float_value: tfsValue,
                        // No oil_profile_id or density_snapshot
                    })
                );
            }

            const results = await service.calculateHourlyAccumulation(
                testDeviceId,
                hourStart
            );

            // Should use density from active profile (950) or default 1000
            expect(results).toHaveLength(1);
            expect(results[0].density_used).toBeGreaterThan(0);
        });

        it('should be idempotent (recalculate same hour)', async () => {
            const hourStart = new Date('2025-01-01T00:00:00Z');
            const startTs = hourStart.getTime();

            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
            
            // TFS data
            for (let i = 0; i < 60; i++) {
                const tfsValue = 100 + (i * 0.5);
                await telemetryRepo.save(
                    telemetryRepo.create({
                        device_id: testDeviceId,
                        timestamp: startTs + (i * 60000),
                        key_name: 'tfs01',
                        value_type: 'float',
                        float_value: tfsValue,
                        oil_profile_id: testProfileId,
                        density_snapshot: 950,
                    })
                );
            }

            // Calculate first time
            const results1 = await service.calculateHourlyAccumulation(
                testDeviceId,
                hourStart
            );

            // Calculate again
            const results2 = await service.calculateHourlyAccumulation(
                testDeviceId,
                hourStart
            );

            expect(results1[0].accumulated_tons).toBe(results2[0].accumulated_tons);
            
            // Should only have 1 record (not duplicate)
            const accumulationRepo = dataSource.getRepository(TabiotFlowAccumulation);
            const count = await accumulationRepo.count({
                where: {
                    device_id: testDeviceId,
                    sensor_key: 'fs01',
                    hour_start: hourStart,
                }
            });
            
            expect(count).toBe(1);
        });
    });

    describe('getAccumulationByDateRange', () => {
        it('should retrieve accumulation data for date range', async () => {
            const accumulationRepo = dataSource.getRepository(TabiotFlowAccumulation);
            
            // Create sample accumulation data
            const dates = [
                new Date('2025-01-01T00:00:00Z'),
                new Date('2025-01-01T01:00:00Z'),
                new Date('2025-01-01T02:00:00Z'),
            ];

            for (const hourStart of dates) {
                await accumulationRepo.save(
                    accumulationRepo.create({
                        device_id: testDeviceId,
                        sensor_key: 'fs01',
                        hour_start: hourStart,
                        hour_end: new Date(hourStart.getTime() + 3600000),
                        avg_flow_m3h: 25.5,
                        accumulated_m3: 25.5,
                        accumulated_tons: 24.225,
                        oil_profile_id: testProfileId,
                        density_used: 0.95,
                        sample_count: 120,
                        first_sample_ts: hourStart.getTime(),
                        last_sample_ts: hourStart.getTime() + 3600000,
                    })
                );
            }

            const results = await service.getAccumulationByDateRange(
                testDeviceId,
                'fs01',
                new Date('2025-01-01T00:00:00Z'),
                new Date('2025-01-01T03:00:00Z')
            );

            expect(results).toHaveLength(3);
        });
    });

    describe('getTotalAccumulation', () => {
        it('should calculate total accumulation for period', async () => {
            const accumulationRepo = dataSource.getRepository(TabiotFlowAccumulation);
            
            // Create 24 hours of data
            for (let h = 0; h < 24; h++) {
                const hourStart = new Date(`2025-01-01T${h.toString().padStart(2, '0')}:00:00Z`);
                await accumulationRepo.save(
                    accumulationRepo.create({
                        device_id: testDeviceId,
                        sensor_key: 'fs01',
                        hour_start: hourStart,
                        hour_end: new Date(hourStart.getTime() + 3600000),
                        avg_flow_m3h: 25.0,
                        accumulated_m3: 25.0,
                        accumulated_tons: 23.75, // 25 * 0.95
                        oil_profile_id: testProfileId,
                        density_used: 0.95,
                        sample_count: 120,
                        first_sample_ts: hourStart.getTime(),
                        last_sample_ts: hourStart.getTime() + 3600000,
                    })
                );
            }

            const total = await service.getTotalAccumulation(
                testDeviceId,
                'fs01',
                new Date('2025-01-01T00:00:00Z'),
                new Date('2025-01-02T00:00:00Z')
            );

            expect(total.total_m3).toBe(600); // 25 * 24
            expect(total.total_tons).toBe(570); // 23.75 * 24
        });
    });

    describe('calculatePreviousHour', () => {
        it('should calculate for previous hour', async () => {
            // Set up TFS data for previous hour
            const now = new Date();
            const previousHour = new Date(now);
            previousHour.setHours(now.getHours() - 1, 0, 0, 0);
            
            const startTs = previousHour.getTime();

            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
            
            // TFS accumulated from 100 to 120 = 20 m³
            for (let i = 0; i < 60; i++) {
                const tfsValue = 100 + (i * 20 / 59);
                await telemetryRepo.save(
                    telemetryRepo.create({
                        device_id: testDeviceId,
                        timestamp: startTs + (i * 60000),
                        key_name: 'tfs01',
                        value_type: 'float',
                        float_value: tfsValue,
                        oil_profile_id: testProfileId,
                        density_snapshot: 950,
                    })
                );
            }

            const results = await service.calculatePreviousHour(testDeviceId);

            expect(results).toHaveLength(1);
            expect(results[0].sensor_key).toBe('fs01');
            expect(results[0].accumulated_m3).toBeCloseTo(20, 1);
        });
    });

    describe('backfillAccumulation', () => {
        it('should backfill multiple hours of data', async () => {
            const startDate = new Date('2025-01-01T00:00:00Z');
            const endDate = new Date('2025-01-01T03:00:00Z'); // 3 hours

            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
            
            // Create TFS telemetry for 3 hours
            for (let h = 0; h < 3; h++) {
                const hourTs = startDate.getTime() + (h * 3600000);
                const baseValue = 100 + (h * 25); // Start each hour at different value
                
                for (let i = 0; i < 60; i++) {
                    const tfsValue = baseValue + (i * 25 / 59); // Accumulate 25 m³ per hour
                    await telemetryRepo.save(
                        telemetryRepo.create({
                            device_id: testDeviceId,
                            timestamp: hourTs + (i * 60000),
                            key_name: 'tfs01',
                            value_type: 'float',
                            float_value: tfsValue,
                            oil_profile_id: testProfileId,
                            density_snapshot: 950,
                        })
                    );
                }
            }

            const processedHours = await service.backfillAccumulation(
                testDeviceId,
                startDate,
                endDate
            );

            expect(processedHours).toBe(3);

            // Verify data was created
            const accumulationRepo = dataSource.getRepository(TabiotFlowAccumulation);
            const count = await accumulationRepo.count({
                where: {
                    device_id: testDeviceId,
                    sensor_key: 'fs01',
                }
            });

            expect(count).toBe(3);
        });
    });
});
