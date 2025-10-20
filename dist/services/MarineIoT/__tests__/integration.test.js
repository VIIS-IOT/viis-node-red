"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const typeorm_1 = require("typeorm");
const OilProfileService_1 = require("../OilProfileService");
const FlowAccumulationService_1 = require("../FlowAccumulationService");
const TabiotOilProfile_1 = require("../../../orm/entities/oil-profile/TabiotOilProfile");
const TabiotFlowAccumulation_1 = require("../../../orm/entities/flow-accumulation/TabiotFlowAccumulation");
const TabiotDeviceTelemetry_1 = require("../../../orm/entities/device-telemetry/TabiotDeviceTelemetry");
const TabiotDevice_1 = require("../../../orm/entities/device/TabiotDevice");
describe('Marine IoT Integration Tests', () => {
    let dataSource;
    let profileService;
    let accumulationService;
    let testDeviceId;
    beforeAll(async () => {
        dataSource = new typeorm_1.DataSource({
            type: 'mysql',
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '3306'),
            username: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'viis_local_test',
            entities: [
                TabiotOilProfile_1.TabiotOilProfile,
                TabiotFlowAccumulation_1.TabiotFlowAccumulation,
                TabiotDeviceTelemetry_1.TabiotDeviceTelemetry,
                TabiotDevice_1.TabiotDevice,
            ],
            synchronize: true,
            dropSchema: true,
        });
        await dataSource.initialize();
        profileService = new OilProfileService_1.OilProfileService(dataSource);
        accumulationService = new FlowAccumulationService_1.FlowAccumulationService(dataSource);
    });
    afterAll(async () => {
        await dataSource.destroy();
    });
    beforeEach(async () => {
        testDeviceId = `test_device_${Date.now()}`;
        const deviceRepo = dataSource.getRepository(TabiotDevice_1.TabiotDevice);
        await deviceRepo.save(deviceRepo.create({
            name: testDeviceId,
            id: testDeviceId,
            label: 'Test Device',
            creation: new Date(),
            modified: new Date(),
        }));
    });
    afterEach(async () => {
        await dataSource.getRepository(TabiotFlowAccumulation_1.TabiotFlowAccumulation).clear();
        await dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry).clear();
        await dataSource.getRepository(TabiotOilProfile_1.TabiotOilProfile).clear();
        await dataSource.getRepository(TabiotDevice_1.TabiotDevice).clear();
    });
    describe('End-to-End Flow', () => {
        it('should complete full workflow: profile → telemetry → accumulation', async () => {
            // Step 1: Create oil profile
            const profile = await profileService.createProfile({
                name: 'e2e_profile_bo',
                device_id: testDeviceId,
                oil_type: 'BO',
                operating_temperature: 85,
                density: 950,
                label: 'E2E BO Profile',
                is_active: true,
            });
            expect(profile.is_active).toBe(true);
            // Step 2: Simulate telemetry collection
            const hourStart = new Date('2025-01-01T00:00:00Z');
            const startTs = hourStart.getTime();
            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry);
            // Create 1 hour of telemetry data
            const sensorData = [
                { key: 'fs01', flow: 25.5 },
                { key: 'fs02', flow: 30.2 },
                { key: 'fs03', flow: 18.7 },
            ];
            for (const sensor of sensorData) {
                for (let i = 0; i < 120; i++) {
                    await telemetryRepo.save(telemetryRepo.create({
                        device_id: testDeviceId,
                        timestamp: startTs + (i * 30000),
                        key_name: sensor.key,
                        value_type: 'float',
                        float_value: sensor.flow,
                        oil_profile_id: profile.name,
                        density_snapshot: profile.density,
                    }));
                }
            }
            // Step 3: Calculate accumulation
            const accumulations = await accumulationService.calculateHourlyAccumulation(testDeviceId, hourStart);
            // Verify results
            expect(accumulations).toHaveLength(3);
            const fs01 = accumulations.find(a => a.sensor_key === 'fs01');
            const fs02 = accumulations.find(a => a.sensor_key === 'fs02');
            const fs03 = accumulations.find(a => a.sensor_key === 'fs03');
            // Verify fs01
            expect(fs01 === null || fs01 === void 0 ? void 0 : fs01.avg_flow_m3h).toBe(25.5);
            expect(fs01 === null || fs01 === void 0 ? void 0 : fs01.accumulated_m3).toBe(25.5);
            expect(fs01 === null || fs01 === void 0 ? void 0 : fs01.accumulated_tons).toBe(24.225); // 25.5 * 0.95
            expect(fs01 === null || fs01 === void 0 ? void 0 : fs01.oil_profile_id).toBe(profile.name);
            expect(fs01 === null || fs01 === void 0 ? void 0 : fs01.density_used).toBe(950);
            // Verify fs02
            expect(fs02 === null || fs02 === void 0 ? void 0 : fs02.avg_flow_m3h).toBe(30.2);
            expect(fs02 === null || fs02 === void 0 ? void 0 : fs02.accumulated_tons).toBeCloseTo(28.69, 2); // 30.2 * 0.95
            // Verify fs03
            expect(fs03 === null || fs03 === void 0 ? void 0 : fs03.avg_flow_m3h).toBe(18.7);
            expect(fs03 === null || fs03 === void 0 ? void 0 : fs03.accumulated_tons).toBeCloseTo(17.765, 2); // 18.7 * 0.95
        });
        it('should handle profile switching correctly', async () => {
            // Create BO profile
            const boProfile = await profileService.createProfile({
                name: 'profile_bo',
                device_id: testDeviceId,
                oil_type: 'BO',
                operating_temperature: 85,
                density: 950,
                is_active: true,
            });
            // Create DO profile (inactive)
            const doProfile = await profileService.createProfile({
                name: 'profile_do',
                device_id: testDeviceId,
                oil_type: 'DO',
                operating_temperature: 40,
                density: 850,
                is_active: false,
            });
            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry);
            // Hour 1: Using BO profile
            const hour1Start = new Date('2025-01-01T00:00:00Z');
            for (let i = 0; i < 60; i++) {
                await telemetryRepo.save(telemetryRepo.create({
                    device_id: testDeviceId,
                    timestamp: hour1Start.getTime() + (i * 60000),
                    key_name: 'fs01',
                    value_type: 'float',
                    float_value: 25.0,
                    oil_profile_id: boProfile.name,
                    density_snapshot: boProfile.density,
                }));
            }
            // Switch to DO profile
            await profileService.setActiveProfile('profile_do');
            // Hour 2: Using DO profile
            const hour2Start = new Date('2025-01-01T01:00:00Z');
            for (let i = 0; i < 60; i++) {
                await telemetryRepo.save(telemetryRepo.create({
                    device_id: testDeviceId,
                    timestamp: hour2Start.getTime() + (i * 60000),
                    key_name: 'fs01',
                    value_type: 'float',
                    float_value: 25.0,
                    oil_profile_id: doProfile.name,
                    density_snapshot: doProfile.density,
                }));
            }
            // Calculate both hours
            const hour1Results = await accumulationService.calculateHourlyAccumulation(testDeviceId, hour1Start);
            const hour2Results = await accumulationService.calculateHourlyAccumulation(testDeviceId, hour2Start);
            // Verify different densities were used
            expect(hour1Results[0].density_used).toBe(950); // BO
            expect(hour1Results[0].accumulated_tons).toBe(23.75); // 25 * 0.95
            expect(hour2Results[0].density_used).toBe(850); // DO
            expect(hour2Results[0].accumulated_tons).toBe(21.25); // 25 * 0.85
            // Verify same flow rate but different tons due to density
            expect(hour1Results[0].avg_flow_m3h).toBe(25.0);
            expect(hour2Results[0].avg_flow_m3h).toBe(25.0);
            expect(hour1Results[0].accumulated_tons).toBeGreaterThan(hour2Results[0].accumulated_tons);
        });
        it('should preserve density snapshot even after profile update', async () => {
            // Create profile
            const profile = await profileService.createProfile({
                name: 'test_profile',
                device_id: testDeviceId,
                oil_type: 'BO',
                operating_temperature: 85,
                density: 950,
                is_active: true,
            });
            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry);
            const hourStart = new Date('2025-01-01T00:00:00Z');
            // Save telemetry with density 0.95
            for (let i = 0; i < 60; i++) {
                await telemetryRepo.save(telemetryRepo.create({
                    device_id: testDeviceId,
                    timestamp: hourStart.getTime() + (i * 60000),
                    key_name: 'fs01',
                    value_type: 'float',
                    float_value: 25.0,
                    oil_profile_id: profile.name,
                    density_snapshot: 950,
                }));
            }
            // Update profile density
            await profileService.updateProfile('test_profile', {
                density: 900, // Changed from 0.95
            });
            // Calculate accumulation
            const results = await accumulationService.calculateHourlyAccumulation(testDeviceId, hourStart);
            // Should use snapshot density (0.95), not updated density (0.90)
            expect(results[0].density_used).toBe(950);
            expect(results[0].accumulated_tons).toBe(23.75); // 25 * 0.95, not 25 * 0.90
        });
        it('should handle daily accumulation query', async () => {
            const profile = await profileService.createProfile({
                name: 'daily_test_profile',
                device_id: testDeviceId,
                oil_type: 'BO',
                operating_temperature: 85,
                density: 950,
                is_active: true,
            });
            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry);
            // Create 24 hours of data
            for (let h = 0; h < 24; h++) {
                const hourStart = new Date(`2025-01-01T${h.toString().padStart(2, '0')}:00:00Z`);
                for (let i = 0; i < 60; i++) {
                    await telemetryRepo.save(telemetryRepo.create({
                        device_id: testDeviceId,
                        timestamp: hourStart.getTime() + (i * 60000),
                        key_name: 'fs01',
                        value_type: 'float',
                        float_value: 25.0,
                        oil_profile_id: profile.name,
                        density_snapshot: profile.density,
                    }));
                }
                // Calculate each hour
                await accumulationService.calculateHourlyAccumulation(testDeviceId, hourStart);
            }
            // Query daily total
            const total = await accumulationService.getTotalAccumulation(testDeviceId, 'fs01', new Date('2025-01-01T00:00:00Z'), new Date('2025-01-02T00:00:00Z'));
            expect(total.total_m3).toBe(600); // 25 * 24
            expect(total.total_tons).toBe(570); // 23.75 * 24
        });
        it('should handle multiple devices independently', async () => {
            // Create second device
            const device2Id = `test_device_2_${Date.now()}`;
            const deviceRepo = dataSource.getRepository(TabiotDevice_1.TabiotDevice);
            await deviceRepo.save(deviceRepo.create({
                name: device2Id,
                id: device2Id,
                label: 'Test Device 2',
                creation: new Date(),
                modified: new Date(),
            }));
            // Create profiles for both devices
            const profile1 = await profileService.createProfile({
                name: 'profile_device1',
                device_id: testDeviceId,
                oil_type: 'BO',
                operating_temperature: 85,
                density: 950,
                is_active: true,
            });
            const profile2 = await profileService.createProfile({
                name: 'profile_device2',
                device_id: device2Id,
                oil_type: 'DO',
                operating_temperature: 40,
                density: 850,
                is_active: true,
            });
            const telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry);
            const hourStart = new Date('2025-01-01T00:00:00Z');
            // Create telemetry for both devices
            for (let i = 0; i < 60; i++) {
                const timestamp = hourStart.getTime() + (i * 60000);
                // Device 1
                await telemetryRepo.save(telemetryRepo.create({
                    device_id: testDeviceId,
                    timestamp,
                    key_name: 'fs01',
                    value_type: 'float',
                    float_value: 25.0,
                    oil_profile_id: profile1.name,
                    density_snapshot: profile1.density,
                }));
                // Device 2
                await telemetryRepo.save(telemetryRepo.create({
                    device_id: device2Id,
                    timestamp,
                    key_name: 'fs01',
                    value_type: 'float',
                    float_value: 25.0,
                    oil_profile_id: profile2.name,
                    density_snapshot: profile2.density,
                }));
            }
            // Calculate for both devices
            const results1 = await accumulationService.calculateHourlyAccumulation(testDeviceId, hourStart);
            const results2 = await accumulationService.calculateHourlyAccumulation(device2Id, hourStart);
            // Same flow but different density
            expect(results1[0].avg_flow_m3h).toBe(25.0);
            expect(results2[0].avg_flow_m3h).toBe(25.0);
            expect(results1[0].accumulated_tons).toBe(23.75); // 25 * 0.95
            expect(results2[0].accumulated_tons).toBe(21.25); // 25 * 0.85
        });
    });
});
