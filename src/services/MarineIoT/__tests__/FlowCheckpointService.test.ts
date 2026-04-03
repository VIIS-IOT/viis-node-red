/**
 * Unit tests for FlowCheckpointService
 */

import { DataSource } from 'typeorm';
import { FlowCheckpointService } from '../FlowCheckpointService';
import { TabiotFlowCheckpoint } from '../../../orm/entities/flow-checkpoint/TabiotFlowCheckpoint';

describe('FlowCheckpointService', () => {
    let service: FlowCheckpointService;
    let mockDataSource: jest.Mocked<DataSource>;
    let mockRepo: any;

    beforeEach(() => {
        mockRepo = {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            create: jest.fn((data: any) => data)
        };

        mockDataSource = {
            getRepository: jest.fn().mockReturnValue(mockRepo)
        } as any;

        service = new FlowCheckpointService(mockDataSource);
    });

    describe('updateCheckpoint', () => {
        it('should calculate positive delta when checkpoint exists', async () => {
            const existingCheckpoint = {
                id: 1,
                device_id: 'device_001',
                sensor_key: 'tfs01',
                checkpoint_type: 'trip',
                last_tfs_value: 100.0,
                last_update_time: Date.now()
            };

            mockRepo.findOne.mockResolvedValue(existingCheckpoint);
            mockRepo.save.mockResolvedValue({
                ...existingCheckpoint,
                last_tfs_value: 110.5
            });

            const result = await service.updateCheckpoint({
                deviceId: 'device_001',
                sensorKey: 'tfs01',
                tfsValue: 110.5,
                checkpointType: 'trip'
            });

            expect(result.delta).toBe(10.5);
            expect(result.wasReset).toBe(false);
            expect(mockRepo.save).toHaveBeenCalled();
        });

        it('should detect reset when delta is negative', async () => {
            const existingCheckpoint = {
                id: 1,
                device_id: 'device_001',
                sensor_key: 'tfs01',
                checkpoint_type: 'trip',
                last_tfs_value: 100.0,
                last_update_time: Date.now()
            };

            mockRepo.findOne.mockResolvedValue(existingCheckpoint);
            mockRepo.save.mockResolvedValue({
                ...existingCheckpoint,
                last_tfs_value: 5.0
            });

            const result = await service.updateCheckpoint({
                deviceId: 'device_001',
                sensorKey: 'tfs01',
                tfsValue: 5.0, // Reset to lower value
                checkpointType: 'trip'
            });

            expect(result.delta).toBeNull();
            expect(result.wasReset).toBe(true);
            expect(mockRepo.save).toHaveBeenCalled();
        });

        it('should create new checkpoint when none exists', async () => {
            mockRepo.findOne.mockResolvedValue(null);
            mockRepo.save.mockResolvedValue({
                id: 1,
                device_id: 'device_001',
                sensor_key: 'tfs01',
                checkpoint_type: 'trip',
                last_tfs_value: 50.0,
                last_update_time: Date.now()
            });

            const result = await service.updateCheckpoint({
                deviceId: 'device_001',
                sensorKey: 'tfs01',
                tfsValue: 50.0,
                checkpointType: 'trip'
            });

            expect(result.delta).toBeNull();
            expect(result.wasReset).toBe(false);
            expect(mockRepo.create).toHaveBeenCalled();
            expect(mockRepo.save).toHaveBeenCalled();
        });
    });

    describe('getCheckpoint', () => {
        it('should retrieve checkpoint by device, sensor, and type', async () => {
            const checkpoint = {
                id: 1,
                device_id: 'device_001',
                sensor_key: 'tfs01',
                checkpoint_type: 'trip',
                last_tfs_value: 100.0
            };

            mockRepo.findOne.mockResolvedValue(checkpoint);

            const result = await service.getCheckpoint('device_001', 'tfs01', 'trip');

            expect(result).toEqual(checkpoint);
            expect(mockRepo.findOne).toHaveBeenCalledWith({
                where: {
                    device_id: 'device_001',
                    sensor_key: 'tfs01',
                    checkpoint_type: 'trip'
                }
            });
        });
    });

    describe('resetCheckpoint', () => {
        it('should reset existing checkpoint to new value', async () => {
            const existingCheckpoint = {
                id: 1,
                device_id: 'device_001',
                sensor_key: 'tfs01',
                checkpoint_type: 'trip',
                last_tfs_value: 100.0,
                last_update_time: Date.now()
            };

            mockRepo.findOne.mockResolvedValue(existingCheckpoint);
            mockRepo.save.mockImplementation((data) => Promise.resolve(data));

            await service.resetCheckpoint('device_001', 'tfs01', 'trip', 0);

            expect(mockRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    last_tfs_value: 0
                })
            );
        });
    });

    describe('calculateDelta', () => {
        it('should calculate delta without updating checkpoint', async () => {
            mockRepo.findOne.mockResolvedValue({
                last_tfs_value: 100.0
            });

            const delta = await service.calculateDelta('device_001', 'tfs01', 'trip', 115.5);

            expect(delta).toBe(15.5);
            expect(mockRepo.save).not.toHaveBeenCalled();
        });

        it('should return null for negative delta', async () => {
            mockRepo.findOne.mockResolvedValue({
                last_tfs_value: 100.0
            });

            const delta = await service.calculateDelta('device_001', 'tfs01', 'trip', 50.0);

            expect(delta).toBeNull();
        });
    });
});
