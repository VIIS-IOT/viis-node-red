/**
 * Unit tests for ViisMarinetTelemetryProcessor
 */

import { ViisMarinetTelemetryProcessor } from '../viis-marine-telemetry-processor';
import { DataSource, Repository } from 'typeorm';
import { TabiotDeviceTelemetry } from '../../../orm/entities/device-telemetry/TabiotDeviceTelemetry';
import { OilProfileService } from '../../../services/MarineIoT/OilProfileService';
import { MarineIoTConfig, OilProfile } from '../viis-marine-telemetry-config';

// Mock dependencies
jest.mock('../../../services/MarineIoT/OilProfileService');
jest.mock('typeorm', () => {
    const actual = jest.requireActual('typeorm');
    return {
        ...actual,
        DataSource: jest.fn(),
        Repository: jest.fn()
    };
});

describe('ViisMarinetTelemetryProcessor', () => {
    let processor: ViisMarinetTelemetryProcessor;
    let mockNode: any;
    let mockNodeContext: any;
    let mockDataSource: jest.Mocked<DataSource>;
    let mockOilProfileService: jest.Mocked<OilProfileService>;
    let mockTelemetryRepo: jest.Mocked<Repository<TabiotDeviceTelemetry>>;
    
    const marineConfig: MarineIoTConfig = {
        enabled: true,
        flowSensorKeys: ['fs01', 'fs02', 'fs03'],
        profileCacheDuration: 300000 // 5 minutes
    };

    const mockProfile: OilProfile = {
        name: 'profile_bo_001',
        device_id: 'device_001',
        oil_type: 'BO',
        operating_temperature: 85,
        density: 950,
        label: 'Bunker Oil Standard',
        is_active: true
    };

    beforeEach(() => {
        // Mock Node
        mockNode = {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        // Mock NodeContext
        mockNodeContext = {
            get: jest.fn(),
            set: jest.fn()
        };

        // Mock DataSource
        mockDataSource = {
            getRepository: jest.fn()
        } as any;

        // Mock Telemetry Repository
        mockTelemetryRepo = {
            save: jest.fn()
        } as any;

        mockDataSource.getRepository.mockReturnValue(mockTelemetryRepo);

        // Create processor instance
        processor = new ViisMarinetTelemetryProcessor(
            mockNode,
            mockNodeContext,
            mockDataSource,
            marineConfig,
            'device_001'
        );

        // Get mocked OilProfileService instance
        mockOilProfileService = (processor as any).oilProfileService;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('getActiveProfile', () => {
        it('should fetch profile from service on first call', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(mockProfile as any);

            const result = await processor.getActiveProfile();

            expect(result).toEqual(mockProfile);
            expect(mockOilProfileService.getActiveProfile).toHaveBeenCalledWith('device_001');
            expect(mockNode.log).toHaveBeenCalledWith(
                expect.stringContaining('Loaded active profile: profile_bo_001')
            );
        });

        it('should use cached profile if cache is still valid', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(mockProfile as any);

            // First call - fetches from service
            await processor.getActiveProfile();
            expect(mockOilProfileService.getActiveProfile).toHaveBeenCalledTimes(1);

            // Second call - should use cache
            const result = await processor.getActiveProfile();
            
            expect(result).toEqual(mockProfile);
            expect(mockOilProfileService.getActiveProfile).toHaveBeenCalledTimes(1); // Not called again
            expect(mockNode.log).toHaveBeenCalledWith(
                expect.stringContaining('Using cached profile')
            );
        });

        it('should refresh profile when cache expires', async () => {
            const shortCacheConfig: MarineIoTConfig = {
                ...marineConfig,
                profileCacheDuration: 100 // 100ms for testing
            };

            const processorShortCache = new ViisMarinetTelemetryProcessor(
                mockNode,
                mockNodeContext,
                mockDataSource,
                shortCacheConfig,
                'device_001'
            );
            (processorShortCache as any).oilProfileService = mockOilProfileService;

            mockOilProfileService.getActiveProfile.mockResolvedValue(mockProfile as any);

            // First call
            await processorShortCache.getActiveProfile();
            expect(mockOilProfileService.getActiveProfile).toHaveBeenCalledTimes(1);

            // Wait for cache to expire
            await new Promise(resolve => setTimeout(resolve, 150));

            // Second call - should fetch again
            await processorShortCache.getActiveProfile();
            expect(mockOilProfileService.getActiveProfile).toHaveBeenCalledTimes(2);
        });

        it('should handle no active profile gracefully', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(null);

            const result = await processor.getActiveProfile();

            expect(result).toBeNull();
            expect(mockNode.warn).toHaveBeenCalledWith(
                '[Marine] No active oil profile found'
            );
        });

        it('should handle errors and return null', async () => {
            const error = new Error('Database connection failed');
            mockOilProfileService.getActiveProfile.mockRejectedValue(error);

            const result = await processor.getActiveProfile();

            expect(result).toBeNull();
            expect(mockNode.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to get active profile')
            );
        });
    });

    describe('processFlowSensorData', () => {
        it('should process flow sensor data with active profile', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(mockProfile as any);

            const telemetryData = {
                fs01: 25.5,
                fs02: 30.2,
                fs03: 15.8,
                temperature: 85, // Non-flow sensor, should be ignored
                pressure: 120 // Non-flow sensor, should be ignored
            };

            const result = await processor.processFlowSensorData(telemetryData);

            expect(result).toHaveLength(3);
            expect(result[0]).toMatchObject({
                device_id: 'device_001',
                key_name: 'fs01',
                float_value: 25.5,
                oil_profile_id: 'profile_bo_001',
                density_snapshot: 950
            });
            expect(result[1]).toMatchObject({
                key_name: 'fs02',
                float_value: 30.2
            });
            expect(result[2]).toMatchObject({
                key_name: 'fs03',
                float_value: 15.8
            });
        });

        it('should handle missing flow sensor data', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(mockProfile as any);

            const telemetryData = {
                fs01: 25.5,
                // fs02 missing
                fs03: null, // null value
                temperature: 85
            };

            const result = await processor.processFlowSensorData(telemetryData);

            expect(result).toHaveLength(1); // Only fs01
            expect(result[0].key_name).toBe('fs01');
        });

        it('should process with null profile when no active profile exists', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(null);

            const telemetryData = {
                fs01: 25.5,
                fs02: 30.2
            };

            const result = await processor.processFlowSensorData(telemetryData);

            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({
                key_name: 'fs01',
                float_value: 25.5,
                oil_profile_id: null,
                density_snapshot: null
            });
        });

        it('should return empty array when Marine IoT is disabled', async () => {
            const disabledConfig: MarineIoTConfig = {
                ...marineConfig,
                enabled: false
            };

            const processorDisabled = new ViisMarinetTelemetryProcessor(
                mockNode,
                mockNodeContext,
                mockDataSource,
                disabledConfig,
                'device_001'
            );

            const telemetryData = {
                fs01: 25.5,
                fs02: 30.2
            };

            const result = await processorDisabled.processFlowSensorData(telemetryData);

            expect(result).toEqual([]);
        });

        it('should filter out invalid numeric values', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(mockProfile as any);

            const telemetryData = {
                fs01: 25.5,
                fs02: 'invalid', // Invalid string
                fs03: NaN // NaN
            };

            const result = await processor.processFlowSensorData(telemetryData);

            expect(result).toHaveLength(1);
            expect(result[0].key_name).toBe('fs01');
        });
    });

    describe('saveFlowSensorData', () => {
        it('should save flow sensor data to database', async () => {
            const flowSensorData = [
                {
                    device_id: 'device_001',
                    timestamp: Date.now(),
                    key_name: 'fs01',
                    float_value: 25.5,
                    oil_profile_id: 'profile_bo_001',
                    density_snapshot: 950
                },
                {
                    device_id: 'device_001',
                    timestamp: Date.now(),
                    key_name: 'fs02',
                    float_value: 30.2,
                    oil_profile_id: 'profile_bo_001',
                    density_snapshot: 950
                }
            ];

            mockTelemetryRepo.save.mockResolvedValue([] as any);

            await processor.saveFlowSensorData(flowSensorData);

            expect(mockDataSource.getRepository).toHaveBeenCalledWith(TabiotDeviceTelemetry);
            expect(mockTelemetryRepo.save).toHaveBeenCalled();
            
            const savedEntities = mockTelemetryRepo.save.mock.calls[0][0];
            expect(savedEntities).toHaveLength(2);
            expect(savedEntities[0].key_name).toBe('fs01');
            expect(savedEntities[0].oil_profile_id).toBe('profile_bo_001');
            expect(mockNode.log).toHaveBeenCalledWith(
                expect.stringContaining('Saved 2 flow sensor records')
            );
        });

        it('should not save if no data provided', async () => {
            await processor.saveFlowSensorData([]);

            expect(mockTelemetryRepo.save).not.toHaveBeenCalled();
        });

        it('should handle database errors', async () => {
            const flowSensorData = [
                {
                    device_id: 'device_001',
                    timestamp: Date.now(),
                    key_name: 'fs01',
                    float_value: 25.5,
                    oil_profile_id: 'profile_bo_001',
                    density_snapshot: 950
                }
            ];

            const dbError = new Error('Database save failed');
            mockTelemetryRepo.save.mockRejectedValue(dbError);

            await expect(processor.saveFlowSensorData(flowSensorData)).rejects.toThrow(
                'Database save failed'
            );
            
            expect(mockNode.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to save flow sensor data')
            );
        });
    });

    describe('clearCache', () => {
        it('should clear the profile cache', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(mockProfile as any);

            // Load cache
            await processor.getActiveProfile();
            
            // Clear cache
            processor.clearCache();
            expect(mockNode.log).toHaveBeenCalledWith('[Marine] Profile cache cleared');

            // Next call should fetch from service again
            await processor.getActiveProfile();
            expect(mockOilProfileService.getActiveProfile).toHaveBeenCalledTimes(2);
        });
    });

    describe('getCacheStatus', () => {
        it('should return cache status with no cache initially', () => {
            const status = processor.getCacheStatus();

            expect(status.hasCache).toBe(false);
            expect(status.profile).toBeNull();
        });

        it('should return cache status with cached profile', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(mockProfile as any);

            await processor.getActiveProfile();
            
            const status = processor.getCacheStatus();

            expect(status.hasCache).toBe(true);
            expect(status.profile).toEqual(mockProfile);
            expect(status.age).toBeGreaterThanOrEqual(0);
        });

        it('should return correct cache age', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(mockProfile as any);

            await processor.getActiveProfile();
            
            // Wait a bit
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const status = processor.getCacheStatus();

            expect(status.age).toBeGreaterThanOrEqual(100);
        });
    });

    describe('Integration: Full workflow', () => {
        it('should process telemetry end-to-end', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(mockProfile as any);
            mockTelemetryRepo.save.mockResolvedValue([] as any);

            const telemetryData = {
                fs01: 25.5,
                fs02: 30.2,
                fs03: 15.8,
                temperature: 85,
                pressure: 120
            };

            // Process data
            const flowSensorData = await processor.processFlowSensorData(telemetryData);
            expect(flowSensorData).toHaveLength(3);

            // Save data
            await processor.saveFlowSensorData(flowSensorData);
            
            expect(mockTelemetryRepo.save).toHaveBeenCalled();
            const savedEntities = mockTelemetryRepo.save.mock.calls[0][0] as any[];
            expect(savedEntities).toHaveLength(3);
            expect(savedEntities.every((e: any) => e.oil_profile_id === 'profile_bo_001')).toBe(true);
            expect(savedEntities.every((e: any) => e.density_snapshot === 950)).toBe(true);
        });
    });
});
