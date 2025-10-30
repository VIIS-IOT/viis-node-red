/**
 * Test TFS Reset Handling in Flow Accumulation
 * Verify that TFS counter resets do NOT cause data loss
 */

import { DataSource } from 'typeorm';
import { FlowAccumulationService } from '../FlowAccumulationService';
import { TabiotDeviceTelemetry } from '../../../orm/entities/device-telemetry/TabiotDeviceTelemetry';
import { TabiotOilProfile } from '../../../orm/entities/oil-profile/TabiotOilProfile';

describe('FlowAccumulationService - TFS Reset Handling', () => {
    let service: FlowAccumulationService;
    let mockDataSource: any;
    let mockTelemetryRepo: any;
    let mockOilProfileRepo: any;
    let mockAccumulationRepo: any;

    beforeEach(() => {
        // Mock repositories
        mockTelemetryRepo = {
            createQueryBuilder: jest.fn(),
            findOne: jest.fn()
        };

        mockOilProfileRepo = {
            findOne: jest.fn()
        };

        mockAccumulationRepo = {
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn((data) => data)
        };

        // Mock DataSource
        mockDataSource = {
            getRepository: jest.fn((entity) => {
                if (entity === TabiotDeviceTelemetry) return mockTelemetryRepo;
                if (entity === TabiotOilProfile) return mockOilProfileRepo;
                return mockAccumulationRepo;
            })
        } as unknown as DataSource;

        service = new FlowAccumulationService(mockDataSource);
    });

    describe('calculateWithResets', () => {
        it('should handle TFS reset within hour - basic case', async () => {
            const deviceId = 'device_001';
            const sensorKey = 'fs01';
            const hourStart = new Date('2025-10-30T14:00:00Z');
            const hourEnd = new Date('2025-10-30T15:00:00Z');

            // Mock boundary values - negative delta indicates reset
            const mockQueryBuilder: any = {
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                setParameter: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                getOne: jest.fn(),
                getMany: jest.fn()
            };

            mockTelemetryRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

            // First call: get TFS at start (14:00)
            mockQueryBuilder.getOne
                .mockResolvedValueOnce({
                    timestamp: hourStart.getTime(),
                    float_value: 60000.5, // Near overflow
                    density_snapshot: 950,
                    oil_profile_id: 'BO_Generator'
                })
                // Second call: get TFS at end (15:00) - AFTER RESET
                .mockResolvedValueOnce({
                    timestamp: hourEnd.getTime(),
                    float_value: 10.2, // Reset happened!
                    density_snapshot: 950,
                    oil_profile_id: 'BO_Generator'
                });

            // Third call: get all TFS data for segment-based calculation
            mockQueryBuilder.getMany.mockResolvedValueOnce([
                { timestamp: hourStart.getTime(), float_value: 60000.5 },
                { timestamp: hourStart.getTime() + 1800000, float_value: 60500.3 }, // +500 m³
                { timestamp: hourStart.getTime() + 2400000, float_value: 10.2 },    // RESET! was ~65000
                { timestamp: hourEnd.getTime(), float_value: 10.2 }
            ]);

            mockAccumulationRepo.findOne.mockResolvedValue(null);
            mockAccumulationRepo.save.mockImplementation((data) => Promise.resolve(data));

            const result = await service.calculateHourlyAccumulation(deviceId, hourStart);

            expect(result).toHaveLength(1);
            expect(result[0].sensor_key).toBe(sensorKey);
            
            // Should calculate: (60500.3 - 60000.5) + 10.2 = 499.8 + 10.2 = 510 m³
            // (accumulated before reset + accumulated after reset)
            expect(result[0].accumulated_m3).toBeCloseTo(510, 1);
        });

        it('should handle multiple TFS resets in same hour', async () => {
            const deviceId = 'device_001';
            const hourStart = new Date('2025-10-30T14:00:00Z');
            const hourEnd = new Date('2025-10-30T15:00:00Z');

            const mockQueryBuilder: any = {
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                setParameter: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                getOne: jest.fn(),
                getMany: jest.fn()
            };

            mockTelemetryRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

            // Boundary values
            mockQueryBuilder.getOne
                .mockResolvedValueOnce({
                    timestamp: hourStart.getTime(),
                    float_value: 50000.0,
                    density_snapshot: 950,
                    oil_profile_id: 'BO_Generator'
                })
                .mockResolvedValueOnce({
                    timestamp: hourEnd.getTime(),
                    float_value: 15.5, // After 2nd reset
                    density_snapshot: 950,
                    oil_profile_id: 'BO_Generator'
                });

            // All TFS data with 2 resets
            mockQueryBuilder.getMany.mockResolvedValueOnce([
                { timestamp: hourStart.getTime(), float_value: 50000.0 },
                { timestamp: hourStart.getTime() + 1200000, float_value: 55000.0 }, // +5000
                { timestamp: hourStart.getTime() + 1800000, float_value: 5.5 },     // RESET 1
                { timestamp: hourStart.getTime() + 2400000, float_value: 10.5 },    // +5
                { timestamp: hourStart.getTime() + 3000000, float_value: 5.0 },     // RESET 2
                { timestamp: hourEnd.getTime(), float_value: 15.5 }                 // +10.5
            ]);

            mockAccumulationRepo.findOne.mockResolvedValue(null);
            mockAccumulationRepo.save.mockImplementation((data) => Promise.resolve(data));

            const result = await service.calculateHourlyAccumulation(deviceId, hourStart);

            // Should calculate: 5000 + 5.5 + 5 + 5.0 + 10.5 = 5026 m³
            expect(result[0].accumulated_m3).toBeCloseTo(5026, 1);
        });

        it('should handle normal case without reset', async () => {
            const deviceId = 'device_001';
            const hourStart = new Date('2025-10-30T14:00:00Z');
            const hourEnd = new Date('2025-10-30T15:00:00Z');

            const mockQueryBuilder: any = {
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                setParameter: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                getOne: jest.fn(),
                getMany: jest.fn()
            };

            mockTelemetryRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

            // Normal case: positive delta
            mockQueryBuilder.getOne
                .mockResolvedValueOnce({
                    timestamp: hourStart.getTime(),
                    float_value: 1000.5,
                    density_snapshot: 950,
                    oil_profile_id: 'BO_Generator'
                })
                .mockResolvedValueOnce({
                    timestamp: hourEnd.getTime(),
                    float_value: 1025.3,
                    density_snapshot: 950,
                    oil_profile_id: 'BO_Generator'
                });

            mockAccumulationRepo.findOne.mockResolvedValue(null);
            mockAccumulationRepo.save.mockImplementation((data) => Promise.resolve(data));

            const result = await service.calculateHourlyAccumulation(deviceId, hourStart);

            // Should use simple boundary delta: 1025.3 - 1000.5 = 24.8 m³
            expect(result[0].accumulated_m3).toBeCloseTo(24.8, 1);
            
            // getMany should NOT be called (no reset detected)
            expect(mockQueryBuilder.getMany).not.toHaveBeenCalled();
        });
    });
});
