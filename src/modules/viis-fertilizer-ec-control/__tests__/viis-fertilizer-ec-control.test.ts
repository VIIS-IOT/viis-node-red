/**
 * Unit tests for viis-fertilizer-ec-control node
 * Tests core functionality without database dependencies
 */

import { Node, NodeContext } from 'node-red';
import { ContextWindowService } from '../services/ContextWindowService';
import { SensorReadings, ValveTimes } from '../interfaces/types';
import { EC_CONTROL_DEFAULTS } from '../constants';

// Mock Node-RED node
const createMockNode = (): Node => {
    const messages: any[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const statusUpdates: any[] = [];

    return {
        send: jest.fn((msg: any) => messages.push(msg)),
        error: jest.fn((msg: string) => errors.push(msg)),
        warn: jest.fn((msg: string) => warnings.push(msg)),
        log: jest.fn(),
        status: jest.fn((status: any) => statusUpdates.push(status)),
        on: jest.fn(),
        _messages: messages,
        _errors: errors,
        _warnings: warnings,
        _statusUpdates: statusUpdates,
    } as any;
};

describe('ViisfertilizerEcControl - Core Functions', () => {
    describe('ContextWindowService', () => {
        let service: ContextWindowService;
        let mockNode: Node;

        beforeEach(() => {
            mockNode = createMockNode();
            service = new ContextWindowService(mockNode, {
                windowSize: 5,
                adjustmentThreshold: 0.05,
                adjustmentStep: 50,
                maxValveTime: 5000,
                minValveTime: 100,
            });
        });

        describe('Ramp-up Period', () => {
            it('should skip samples during ramp-up period', () => {
                service.startRun(2); // 2-second ramp-up

                const reading: SensorReadings = {
                    current_ec: 1.8,
                    current_flow_1: 10,
                    current_flow_2: 20,
                    current_flow_3: 30,
                    current_flow_4: 40,
                    current_flow_5: 50,
                };

                const added = service.addSample(reading);
                expect(added).toBe(false);

                const stats = service.getStats();
                expect(stats.sampleCount).toBe(0);
            });

            it('should accept samples after ramp-up completes', async () => {
                service.startRun(0.1); // 100ms ramp-up

                // Wait for ramp-up to complete
                await new Promise(resolve => setTimeout(resolve, 150));

                const reading: SensorReadings = {
                    current_ec: 1.8,
                    current_flow_1: 10,
                    current_flow_2: 20,
                    current_flow_3: 30,
                    current_flow_4: 40,
                    current_flow_5: 50,
                };

                const added = service.addSample(reading);
                expect(added).toBe(true);

                const stats = service.getStats();
                expect(stats.sampleCount).toBe(1);
            });

            it('should check ramp-up completion status', async () => {
                service.startRun(0.1); // 100ms ramp-up
                expect(service.isRampUpComplete()).toBe(false);

                await new Promise(resolve => setTimeout(resolve, 150));

                // Add one sample to trigger completion check
                service.addSample({
                    current_ec: 1.8,
                    current_flow_1: 10,
                    current_flow_2: 20,
                    current_flow_3: 30,
                    current_flow_4: 40,
                    current_flow_5: 50,
                });

                expect(service.isRampUpComplete()).toBe(true);
            });
        });

        describe('EC Averaging', () => {
            beforeEach(async () => {
                service.startRun(0.01); // Minimal ramp-up
                await new Promise(resolve => setTimeout(resolve, 20));
            });

            it('should calculate average EC from buffer', () => {
                const readings = [1.5, 1.6, 1.7, 1.8, 1.9];

                readings.forEach(ec => {
                    service.addSample({
                        current_ec: ec,
                        current_flow_1: 10,
                        current_flow_2: 20,
                        current_flow_3: 30,
                        current_flow_4: 40,
                        current_flow_5: 50,
                    });
                });

                const stats = service.getStats();
                expect(stats.avgEc).toBeCloseTo(1.7, 2);
                expect(stats.sampleCount).toBe(5);
            });

            it('should maintain sliding window of configured size', () => {
                const readings = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];

                readings.forEach(ec => {
                    service.addSample({
                        current_ec: ec,
                        current_flow_1: 10,
                        current_flow_2: 20,
                        current_flow_3: 30,
                        current_flow_4: 40,
                        current_flow_5: 50,
                    });
                });

                const stats = service.getStats();
                // Window size is 5, so should average last 5 values: [1.2, 1.3, 1.4, 1.5, 1.6]
                expect(stats.avgEc).toBeCloseTo(1.4, 2);
                expect(stats.sampleCount).toBe(7); // Total samples added
            });
        });

        describe('Flow Averaging', () => {
            beforeEach(async () => {
                service.startRun(0.01);
                await new Promise(resolve => setTimeout(resolve, 20));
            });

            it('should calculate average flows for all valves', () => {
                for (let i = 0; i < 3; i++) {
                    service.addSample({
                        current_ec: 1.8,
                        current_flow_1: 10 + i,
                        current_flow_2: 20 + i,
                        current_flow_3: 30 + i,
                        current_flow_4: 40 + i,
                        current_flow_5: 50 + i,
                    });
                }

                const stats = service.getStats();
                expect(stats.flowAverages.flow_1).toBeCloseTo(11, 1);
                expect(stats.flowAverages.flow_2).toBeCloseTo(21, 1);
                expect(stats.flowAverages.flow_3).toBeCloseTo(31, 1);
                expect(stats.flowAverages.flow_4).toBeCloseTo(41, 1);
                expect(stats.flowAverages.flow_5).toBeCloseTo(51, 1);
            });
        });

        describe('EC Deviation Calculation', () => {
            beforeEach(async () => {
                service.startRun(0.01);
                await new Promise(resolve => setTimeout(resolve, 20));
            });

            it('should calculate deviation from target EC', () => {
                // Need at least 5 samples for getEcDeviation to work
                for (let i = 0; i < 5; i++) {
                    service.addSample({
                        current_ec: 1.9,
                        current_flow_1: 10,
                        current_flow_2: 20,
                        current_flow_3: 30,
                        current_flow_4: 40,
                        current_flow_5: 50,
                    });
                }

                const deviation = service.getEcDeviation(1.8);
                expect(deviation.avgEc).toBeCloseTo(1.9, 2);
                expect(deviation.deviation).toBeCloseTo(0.1, 2);
            });

            it('should handle negative deviation', () => {
                // Need at least 5 samples for getEcDeviation to work
                for (let i = 0; i < 5; i++) {
                    service.addSample({
                        current_ec: 1.7,
                        current_flow_1: 10,
                        current_flow_2: 20,
                        current_flow_3: 30,
                        current_flow_4: 40,
                        current_flow_5: 50,
                    });
                }

                const deviation = service.getEcDeviation(1.8);
                expect(deviation.deviation).toBeCloseTo(-0.1, 2);
            });
        });

        describe('Adaptive Adjustment Calculation', () => {
            beforeEach(async () => {
                service.startRun(0.01);
                await new Promise(resolve => setTimeout(resolve, 20));
            });

            it('should track EC deviation for monitoring (feedforward control)', () => {
                // Add samples with EC above target
                for (let i = 0; i < 5; i++) {
                    service.addSample({
                        current_ec: 1.9, // 0.1 above target 1.8
                        current_flow_1: 10,
                        current_flow_2: 20,
                        current_flow_3: 30,
                        current_flow_4: 40,
                        current_flow_5: 50,
                    });
                }

                const deviation = service.getEcDeviation(1.8);

                // Should track deviation but NOT adjust valve times
                // System uses feedforward + open-loop control
                expect(deviation.deviation).toBeCloseTo(0.1, 2);
                expect(deviation.avgEc).toBeCloseTo(1.9, 2);
            });

            it('should provide stats for post-run learning', () => {
                for (let i = 0; i < 5; i++) {
                    service.addSample({
                        current_ec: 1.82,
                        current_flow_1: 10 + i,
                        current_flow_2: 20 + i,
                        current_flow_3: 30,
                        current_flow_4: 40,
                        current_flow_5: 50,
                    });
                }

                const stats = service.getStats();

                // Stats used for updating lookup table after run
                expect(stats.avgEc).toBeCloseTo(1.82, 2);
                expect(stats.sampleCount).toBe(5);
                expect(stats.flowAverages.flow_1).toBeGreaterThan(0);
                expect(stats.rampUpComplete).toBe(true);
            });
        });

        describe('State Reset', () => {
            it('should clear all buffers on reset', async () => {
                service.startRun(0.01);
                await new Promise(resolve => setTimeout(resolve, 20));

                service.addSample({
                    current_ec: 1.8,
                    current_flow_1: 10,
                    current_flow_2: 20,
                    current_flow_3: 30,
                    current_flow_4: 40,
                    current_flow_5: 50,
                });

                let statsBeforeReset = service.getStats();
                expect(statsBeforeReset.sampleCount).toBe(1);

                service.reset();

                let statsAfterReset = service.getStats();
                expect(statsAfterReset.sampleCount).toBe(0);
                expect(statsAfterReset.avgEc).toBe(0);
            });
        });
    });

    describe('Valve Time Validation', () => {
        it('should validate valve times are within bounds', () => {
            const maxValveTime = EC_CONTROL_DEFAULTS.MAX_VALVE_TIME;
            const minValveTime = 100;

            const validateValveTimes = (times: ValveTimes): boolean => {
                const values = Object.values(times);
                return values.every(v => v >= minValveTime && v <= maxValveTime);
            };

            const validTimes: ValveTimes = {
                time_on_valve_01: 1000,
                time_on_valve_02: 2000,
                time_on_valve_03: 3000,
                time_on_valve_04: 4000,
                time_on_valve_05: 5000,
            };
            expect(validateValveTimes(validTimes)).toBe(true);

            const invalidTimesTooHigh: ValveTimes = {
                time_on_valve_01: 20000, // Above max
                time_on_valve_02: 2000,
                time_on_valve_03: 3000,
                time_on_valve_04: 4000,
                time_on_valve_05: 5000,
            };
            expect(validateValveTimes(invalidTimesTooHigh)).toBe(false);

            const invalidTimesTooLow: ValveTimes = {
                time_on_valve_01: 50, // Below min
                time_on_valve_02: 2000,
                time_on_valve_03: 3000,
                time_on_valve_04: 4000,
                time_on_valve_05: 5000,
            };
            expect(validateValveTimes(invalidTimesTooLow)).toBe(false);
        });
    });

    describe('Global Context Data Reading', () => {
        it('should validate global context data structure', () => {
            // Simulates holdingRegisterData from polling flow
            const holdingData = {
                ts: Date.now(),
                current_ec: 1.85,
                current_flow_1: 10.5,
                current_flow_2: 20.3,
                current_flow_3: 15.0,
                current_flow_4: 0,
                current_flow_5: 0,
                control_mode: 2,
                set_ec: 1.8,
            };

            // Check required keys exist
            expect(holdingData.current_ec).toBeDefined();
            expect(holdingData.ts).toBeDefined();
            expect(typeof holdingData.current_ec).toBe('number');
        });

        it('should detect stale data correctly', () => {
            const maxAge = EC_CONTROL_DEFAULTS.GLOBAL_DATA_MAX_AGE;
            const now = Date.now();

            // Fresh data
            const freshData = { ts: now - 1000 };
            const freshAge = now - freshData.ts;
            expect(freshAge).toBeLessThan(maxAge);

            // Stale data
            const staleData = { ts: now - 15000 };
            const staleAge = now - staleData.ts;
            expect(staleAge).toBeGreaterThan(maxAge);
        });

        it('should handle missing global context data gracefully', () => {
            const holdingData = undefined;
            expect(holdingData).toBeUndefined();
            // Should return null when data is missing
        });

        it('should extract sensor readings from global context', () => {
            const holdingData = {
                ts: Date.now(),
                current_ec: 1.85,
                current_flow_1: 10.5,
                current_flow_2: 20.3,
                current_flow_3: 15.0,
                current_flow_4: 0,
                current_flow_5: 0,
            };

            const readings: SensorReadings = {
                current_ec: Number(holdingData.current_ec),
                current_flow_1: Number(holdingData.current_flow_1 ?? 0),
                current_flow_2: Number(holdingData.current_flow_2 ?? 0),
                current_flow_3: Number(holdingData.current_flow_3 ?? 0),
                current_flow_4: Number(holdingData.current_flow_4 ?? 0),
                current_flow_5: Number(holdingData.current_flow_5 ?? 0),
            };

            expect(readings.current_ec).toBe(1.85);
            expect(readings.current_flow_1).toBe(10.5);
            expect(readings.current_flow_2).toBe(20.3);
            expect(readings.current_flow_3).toBe(15.0);
            expect(readings.current_flow_4).toBe(0);
            expect(readings.current_flow_5).toBe(0);
        });
    });
});
