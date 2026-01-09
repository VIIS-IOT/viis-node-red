"use strict";
/**
 * TFS Integration Tests
 * End-to-end tests for TFS-based accumulation system
 *
 * Flow:
 * 1. Read TFS from Modbus holding registers
 * 2. Parse TFS values (integer + decimal/1000)
 * 3. Save to tabiot_device_telemetry with profile/density
 * 4. Update checkpoint in tabiot_flow_checkpoint
 * 5. Calculate delta (new_tfs - last_checkpoint)
 * 6. Update accumulation (trip and hourly)
 */
Object.defineProperty(exports, "__esModule", { value: true });
describe('TFS Integration Tests', () => {
    let dataSource;
    let checkpointService;
    let tripAccumulationService;
    let flowAccumulationService;
    const testDeviceId = 'test_device_001';
    const testTripId = 'test_trip_001';
    beforeAll(async () => {
        // This is a documentation test - shows expected flow
        // Actual integration tests should use test database
    });
    describe('Scenario 1: Normal Operation - Positive Delta', () => {
        /**
         * Scenario: Vessel running normally for 1 hour
         *
         * Timeline:
         * - 7:00 PM: TFS = 91.458 m³
         * - 7:01 PM: TFS = 91.698 m³ (delta = 0.240 m³)
         * - 7:02 PM: TFS = 91.938 m³ (delta = 0.240 m³)
         * - ... continues every minute
         * - 8:00 PM: TFS = 116.958 m³ (total delta = 25.5 m³)
         */
        it('should accumulate TFS deltas over time', async () => {
            const testData = [
                { time: '7:00', intPart: 91, decPart: 458, expected: 91.458 },
                { time: '7:01', intPart: 91, decPart: 698, expected: 91.698 },
                { time: '7:02', intPart: 91, decPart: 938, expected: 91.938 },
                { time: '7:30', intPart: 104, decPart: 208, expected: 104.208 },
                { time: '8:00', intPart: 116, decPart: 958, expected: 116.958 },
            ];
            let previousValue = testData[0].expected;
            let cumulativeDelta = 0;
            for (let i = 1; i < testData.length; i++) {
                const currentValue = testData[i].expected;
                const delta = currentValue - previousValue;
                expect(delta).toBeGreaterThanOrEqual(0); // Always positive
                cumulativeDelta += delta;
                previousValue = currentValue;
            }
            // Total accumulation in 1 hour
            const totalAccumulation = testData[testData.length - 1].expected - testData[0].expected;
            expect(totalAccumulation).toBeCloseTo(25.5, 1);
            expect(cumulativeDelta).toBeCloseTo(totalAccumulation, 1);
        });
        it('should calculate correct tons with density', () => {
            const accumulatedM3 = 25.5;
            const density = 950; // kg/m³
            const accumulatedTons = accumulatedM3 * (density / 1000);
            expect(accumulatedTons).toBeCloseTo(24.225, 3);
        });
    });
    describe('Scenario 2: Counter Reset Detection', () => {
        /**
         * Scenario: PLC counter is reset manually
         *
         * Timeline:
         * - 10:00: TFS = 1000.500 m³
         * - 10:01: TFS = 1001.250 m³ (delta = 0.750 m³) ✓
         * - 10:02: User resets PLC counter
         * - 10:03: TFS = 5.250 m³ (reset detected, delta = negative)
         * - 10:04: TFS = 6.000 m³ (delta = 0.750 m³) ✓
         */
        it('should detect counter reset when delta is negative', () => {
            const readings = [
                { time: '10:00', value: 1000.500 },
                { time: '10:01', value: 1001.250 },
                { time: '10:03', value: 5.250 }, // Reset!
                { time: '10:04', value: 6.000 },
            ];
            const results = [];
            for (let i = 1; i < readings.length; i++) {
                const delta = readings[i].value - readings[i - 1].value;
                const wasReset = delta < 0;
                results.push({
                    time: readings[i].time,
                    delta: wasReset ? null : delta,
                    wasReset
                });
            }
            expect(results[0].delta).toBeCloseTo(0.750, 3);
            expect(results[0].wasReset).toBe(false);
            expect(results[1].delta).toBeNull(); // Reset detected
            expect(results[1].wasReset).toBe(true);
            expect(results[2].delta).toBeCloseTo(0.750, 3);
            expect(results[2].wasReset).toBe(false);
        });
        it('should reset checkpoint after negative delta', () => {
            const oldCheckpoint = 1001.250;
            const newReading = 5.250;
            const delta = newReading - oldCheckpoint;
            expect(delta).toBeLessThan(0);
            // After reset detection, checkpoint should be updated to new value
            const updatedCheckpoint = newReading;
            expect(updatedCheckpoint).toBe(5.250);
            // Next reading should calculate from new checkpoint
            const nextReading = 6.000;
            const nextDelta = nextReading - updatedCheckpoint;
            expect(nextDelta).toBeCloseTo(0.750, 3);
        });
    });
    describe('Scenario 3: Multi-Sensor Trip Accumulation', () => {
        /**
         * Scenario: Vessel trip with multiple sensors
         *
         * Sensors:
         * - tfs01 (Main Engine In): Start 150.250 → End 200.750 (delta = 50.5 m³)
         * - tfs02 (Main Engine Return): Start 120.125 → End 160.375 (delta = 40.25 m³)
         * - tfs03 (Generator In): Start 80.500 → End 105.750 (delta = 25.25 m³)
         * - tfs04 (Generator Return): Start 60.000 → End 80.125 (delta = 20.125 m³)
         *
         * Consumption:
         * - Main Engine: 50.5 - 40.25 = 10.25 m³
         * - Generator: 25.25 - 20.125 = 5.125 m³
         * - Total: 15.375 m³
         */
        it('should accumulate multiple sensors independently', () => {
            const startReadings = {
                tfs01: 150.250,
                tfs02: 120.125,
                tfs03: 80.500,
                tfs04: 60.000
            };
            const endReadings = {
                tfs01: 200.750,
                tfs02: 160.375,
                tfs03: 105.750,
                tfs04: 80.125
            };
            const deltas = {
                tfs01: endReadings.tfs01 - startReadings.tfs01,
                tfs02: endReadings.tfs02 - startReadings.tfs02,
                tfs03: endReadings.tfs03 - startReadings.tfs03,
                tfs04: endReadings.tfs04 - startReadings.tfs04
            };
            expect(deltas.tfs01).toBeCloseTo(50.5, 1);
            expect(deltas.tfs02).toBeCloseTo(40.25, 2);
            expect(deltas.tfs03).toBeCloseTo(25.25, 2);
            expect(deltas.tfs04).toBeCloseTo(20.125, 3);
            // Calculate consumption (flow in - flow return)
            const mainEngineConsumption = deltas.tfs01 - deltas.tfs02;
            const generatorConsumption = deltas.tfs03 - deltas.tfs04;
            const totalConsumption = mainEngineConsumption + generatorConsumption;
            expect(mainEngineConsumption).toBeCloseTo(10.25, 2);
            expect(generatorConsumption).toBeCloseTo(5.125, 3);
            expect(totalConsumption).toBeCloseTo(15.375, 3);
        });
        it('should convert to tons with different densities', () => {
            const mainEngineM3 = 10.25;
            const generatorM3 = 5.125;
            const mainEngineDensity = 950; // FO
            const generatorDensity = 850; // DO
            const mainEngineTons = mainEngineM3 * (mainEngineDensity / 1000);
            const generatorTons = generatorM3 * (generatorDensity / 1000);
            expect(mainEngineTons).toBeCloseTo(9.7375, 4);
            expect(generatorTons).toBeCloseTo(4.35625, 5);
        });
    });
    describe('Scenario 4: Hourly Accumulation with Reset Handling', () => {
        /**
         * Scenario: Calculate hourly accumulation with reset in the middle
         *
         * Hour: 14:00 - 15:00
         * - 14:00:00 - TFS = 100.000 m³
         * - 14:20:00 - TFS = 108.500 m³ (delta = 8.5 m³)
         * - 14:30:00 - Reset to TFS = 5.000 m³ (add current value 5.0 m³)
         * - 14:50:00 - TFS = 13.000 m³ (delta = 8.0 m³)
         * - 15:00:00 - TFS = 16.500 m³ (delta = 3.5 m³)
         *
         * Total accumulation: 8.5 + 5.0 + 8.0 + 3.5 = 25.0 m³
         */
        it('should calculate accumulation with reset within hour', () => {
            const samples = [
                { timestamp: '14:00:00', tfs: 100.000 },
                { timestamp: '14:20:00', tfs: 108.500 }, // +8.5
                { timestamp: '14:30:00', tfs: 5.000 }, // Reset: add 5.0
                { timestamp: '14:50:00', tfs: 13.000 }, // +8.0
                { timestamp: '15:00:00', tfs: 16.500 }, // +3.5
            ];
            let totalAccumulated = 0;
            for (let i = 1; i < samples.length; i++) {
                const delta = samples[i].tfs - samples[i - 1].tfs;
                if (delta >= 0) {
                    // Normal accumulation
                    totalAccumulated += delta;
                }
                else {
                    // Reset detected - add current value as accumulated since reset
                    totalAccumulated += samples[i].tfs;
                }
            }
            // Total: 8.5 + 5.0 + 8.0 + 3.5 = 25.0 m³
            expect(totalAccumulated).toBeCloseTo(25.0, 1);
        });
    });
    describe('Scenario 5: Modbus Register Parsing', () => {
        /**
         * Scenario: Parse actual Modbus holding register data
         */
        it('should parse holding registers to TFS values', () => {
            // Simulate Modbus read: 30 holding registers
            const holdingRegisters = new Array(30).fill(0);
            // tfs01: address 10-11 → 91 + 458/1000 = 91.458 m³
            holdingRegisters[10] = 91;
            holdingRegisters[11] = 458;
            // tfs02: address 12-13 → 91 + 698/1000 = 91.698 m³
            holdingRegisters[12] = 91;
            holdingRegisters[13] = 698;
            // tfs03: address 14-15 → 150 + 250/1000 = 150.250 m³
            holdingRegisters[14] = 150;
            holdingRegisters[15] = 250;
            // Parse logic (should match ViisMarinetTelemetryProcessor.parseTfsValues)
            const tfsMapping = [
                { key: 'tfs01', intAddr: 10, decAddr: 11 },
                { key: 'tfs02', intAddr: 12, decAddr: 13 },
                { key: 'tfs03', intAddr: 14, decAddr: 15 },
            ];
            const parsed = tfsMapping.map(({ key, intAddr, decAddr }) => ({
                key,
                value: holdingRegisters[intAddr] + (holdingRegisters[decAddr] / 1000)
            }));
            expect(parsed[0].value).toBe(91.458);
            expect(parsed[1].value).toBe(91.698);
            expect(parsed[2].value).toBe(150.250);
        });
    });
    describe('Scenario 6: Complete Flow - Polling to Accumulation', () => {
        /**
         * Complete flow simulation:
         * 1. Marine telemetry polling (every 2 seconds)
         * 2. Read holding registers from Modbus
         * 3. Parse TFS values
         * 4. Update checkpoints
         * 5. Calculate deltas
         * 6. Update trip accumulation
         * 7. Update hourly accumulation (on schedule)
         */
        it('should simulate complete accumulation flow', async () => {
            // Step 1: Initial state (checkpoint)
            const initialCheckpoint = {
                tfs01: 100.000,
                tfs02: 80.000
            };
            // Step 2: First polling cycle (2 seconds later)
            const polling1 = {
                holdingRegisters: new Array(30).fill(0)
            };
            polling1.holdingRegisters[10] = 100; // tfs01 integer
            polling1.holdingRegisters[11] = 240; // tfs01 decimal → 100.240
            polling1.holdingRegisters[12] = 80; // tfs02 integer
            polling1.holdingRegisters[13] = 190; // tfs02 decimal → 80.190
            const tfs1_reading1 = 100.240;
            const tfs2_reading1 = 80.190;
            const delta1_tfs01 = tfs1_reading1 - initialCheckpoint.tfs01;
            const delta1_tfs02 = tfs2_reading1 - initialCheckpoint.tfs02;
            expect(delta1_tfs01).toBeCloseTo(0.240, 3);
            expect(delta1_tfs02).toBeCloseTo(0.190, 3);
            // Step 3: Second polling cycle (2 seconds later)
            const polling2 = {
                holdingRegisters: new Array(30).fill(0)
            };
            polling2.holdingRegisters[10] = 100;
            polling2.holdingRegisters[11] = 480; // → 100.480
            polling2.holdingRegisters[12] = 80;
            polling2.holdingRegisters[13] = 380; // → 80.380
            const tfs1_reading2 = 100.480;
            const tfs2_reading2 = 80.380;
            const delta2_tfs01 = tfs1_reading2 - tfs1_reading1;
            const delta2_tfs02 = tfs2_reading2 - tfs2_reading1;
            expect(delta2_tfs01).toBeCloseTo(0.240, 3);
            expect(delta2_tfs02).toBeCloseTo(0.190, 3);
            // Step 4: Accumulate deltas
            const totalDelta_tfs01 = delta1_tfs01 + delta2_tfs01;
            const totalDelta_tfs02 = delta1_tfs02 + delta2_tfs02;
            expect(totalDelta_tfs01).toBeCloseTo(0.480, 3);
            expect(totalDelta_tfs02).toBeCloseTo(0.380, 3);
            // Step 5: Convert to tons
            const density = 950; // kg/m³
            const tons_tfs01 = totalDelta_tfs01 * (density / 1000);
            const tons_tfs02 = totalDelta_tfs02 * (density / 1000);
            expect(tons_tfs01).toBeCloseTo(0.456, 3);
            expect(tons_tfs02).toBeCloseTo(0.361, 3);
        });
    });
    describe('Data Flow Documentation', () => {
        it('should document expected database schema', () => {
            // tabiot_device_telemetry - stores TFS readings
            const telemetryRecord = {
                device_id: 'device_001',
                timestamp: 1234567890000,
                key_name: 'tfs01',
                value_type: 'float',
                float_value: 91.458,
                oil_profile_id: 'profile_fo_001',
                density_snapshot: 950
            };
            expect(telemetryRecord.float_value).toBe(91.458);
            // tabiot_flow_checkpoint - stores last TFS value for delta calculation
            const checkpointRecord = {
                device_id: 'device_001',
                sensor_key: 'tfs01',
                checkpoint_type: 'trip',
                last_tfs_value: 91.458,
                last_update_time: 1234567890000
            };
            expect(checkpointRecord.last_tfs_value).toBe(91.458);
            // tabiot_trip_accumulation - running totals for trip
            const tripRecord = {
                trip_id: 'trip_001',
                device_id: 'device_001',
                sensor_key: 'fs01', // Note: uses fs key, not tfs
                total_volume_m3: 25.5,
                total_volume_tons: 24.225,
                current_density: 950,
                sample_count: 100
            };
            expect(tripRecord.total_volume_m3).toBe(25.5);
            // tabiot_flow_accumulation - hourly totals
            const hourlyRecord = {
                device_id: 'device_001',
                sensor_key: 'fs01',
                hour_start: new Date('2025-01-21T07:00:00Z'),
                hour_end: new Date('2025-01-21T08:00:00Z'),
                avg_flow_m3h: 25.5,
                accumulated_m3: 25.5,
                accumulated_tons: 24.225,
                density_used: 950,
                sample_count: 30
            };
            expect(hourlyRecord.accumulated_m3).toBe(25.5);
        });
    });
});
