/**
 * TFS Parsing Tests
 * Tests for TFS (Total Flow Sensor) value parsing from Modbus registers
 * 
 * Format: TFS uses 2 consecutive 16-bit registers
 * - Register[n]: Integer part
 * - Register[n+1]: Decimal part (only last 3 digits used)
 * - Formula: tfs_value = integer + ((decimal % 1000) / 1000)
 * 
 * Example:
 * - Register 10 = 91, Register 11 = 4589
 * - Result: 91 + ((4589%1000)/1000) = 91 + (589/1000) = 91.589 m³
 */

import { ViisMarinetTelemetryProcessor } from '../viis-marine-telemetry-processor';
import { DataSource } from 'typeorm';
import { MarineIoTConfig } from '../viis-marine-telemetry-config';

jest.mock('../../../services/MarineIoT/OilProfileService');
jest.mock('../../../services/MarineIoT/FlowCheckpointService');
jest.mock('../../../services/MarineIoT/TripAccumulationService');
jest.mock('../../../services/MarineIoT/TripManagementService');

describe('TFS Parsing Logic', () => {
    let processor: ViisMarinetTelemetryProcessor;
    let mockNode: any;
    let mockNodeContext: any;
    let mockDataSource: jest.Mocked<DataSource>;

    const marineConfig: MarineIoTConfig = {
        enabled: true,
        flowSensorKeys: ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'],
        profileCacheDuration: 300000
    };

    beforeEach(() => {
        mockNode = {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        mockNodeContext = {
            get: jest.fn(),
            set: jest.fn()
        };

        mockDataSource = {
            getRepository: jest.fn().mockReturnValue({
                save: jest.fn(),
                findOne: jest.fn(),
                find: jest.fn()
            })
        } as any;

        processor = new ViisMarinetTelemetryProcessor(
            mockNode,
            mockNodeContext,
            mockDataSource,
            marineConfig,
            'device_001'
        );
    });

    describe('parseTfsValues - Basic Parsing', () => {
        it('should parse TFS01 correctly (example from user)', () => {
            // User's example: Register 10 = 91, Register 11 = 4589
            // Formula: 91 + ((4589 % 1000) / 1000) = 91 + (589/1000) = 91.589 m³
            const holdingRegisters: number[] = new Array(10);
            holdingRegisters[10] = 91;    // tfs01 integer part
            holdingRegisters[11] = 4589;  // tfs01 decimal part (only last 3 digits: 589)
            holdingRegisters.length = 30; // Leave tfs02-06 undefined

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(1);
            expect(result[0].key_name).toBe('tfs01');
            expect(result[0].tfs_value).toBe(91.589); // 91 + (589/1000)
            expect(result[0].device_id).toBe('device_001');
            expect(result[0].timestamp).toBeGreaterThan(0);

            // Log message verification
            expect(mockNode.log).toHaveBeenCalledWith(
                expect.stringContaining('tfs01: 91 + (4589%1000)/1000 = 91.5890 m³')
            );
        });

        it('should parse all 6 TFS sensors from holding registers', () => {
            const holdingRegisters = new Array(30).fill(0);
            
            // tfs01: address 10-11 → 100.250 m³
            holdingRegisters[10] = 100;
            holdingRegisters[11] = 250;
            
            // tfs02: address 12-13 → 200.500 m³
            holdingRegisters[12] = 200;
            holdingRegisters[13] = 500;
            
            // tfs03: address 14-15 → 300.750 m³
            holdingRegisters[14] = 300;
            holdingRegisters[15] = 750;
            
            // tfs04: address 16-17 → 400.125 m³
            holdingRegisters[16] = 400;
            holdingRegisters[17] = 125;
            
            // tfs05: address 18-19 → 500.999 m³
            holdingRegisters[18] = 500;
            holdingRegisters[19] = 999;
            
            // tfs06: address 20-21 → 600.001 m³
            holdingRegisters[20] = 600;
            holdingRegisters[21] = 1;

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(6);
            
            expect(result[0].key_name).toBe('tfs01');
            expect(result[0].tfs_value).toBe(100.250);
            
            expect(result[1].key_name).toBe('tfs02');
            expect(result[1].tfs_value).toBe(200.500);
            
            expect(result[2].key_name).toBe('tfs03');
            expect(result[2].tfs_value).toBe(300.750);
            
            expect(result[3].key_name).toBe('tfs04');
            expect(result[3].tfs_value).toBe(400.125);
            
            expect(result[4].key_name).toBe('tfs05');
            expect(result[4].tfs_value).toBe(500.999);
            
            expect(result[5].key_name).toBe('tfs06');
            expect(result[5].tfs_value).toBe(600.001);
        });

        it('should handle zero values correctly', () => {
            // Only set tfs01 registers, leave others as undefined to skip them
            const holdingRegisters: number[] = new Array(10);
            holdingRegisters[10] = 0;
            holdingRegisters[11] = 0;
            // Extend array but leave 12-21 undefined
            holdingRegisters.length = 30;

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(1);
            expect(result[0].tfs_value).toBe(0);
        });

        it('should handle large integer values', () => {
            const holdingRegisters: number[] = new Array(10);
            holdingRegisters[10] = 65535; // Max 16-bit unsigned
            holdingRegisters[11] = 999;   // Last 3 digits: 999
            holdingRegisters.length = 30; // Leave others undefined

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(1);
            expect(result[0].tfs_value).toBe(65535.999); // 65535 + (999/1000)
        });

        it('should handle decimal-only values (integer = 0)', () => {
            const holdingRegisters: number[] = new Array(10);
            holdingRegisters[10] = 0;
            holdingRegisters[11] = 456; // 0.456 m³
            holdingRegisters.length = 30; // Leave others undefined

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(1);
            expect(result[0].tfs_value).toBe(0.456);
        });

        it('should use modulo 1000 for decimal values > 1000', () => {
            const holdingRegisters: number[] = new Array(10);
            holdingRegisters[10] = 91;
            holdingRegisters[11] = 8979; // 8979 % 1000 = 979 → 0.979
            holdingRegisters.length = 30;

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(1);
            expect(result[0].tfs_value).toBe(91.979); // 91 + (979/1000)
            expect(result[0].key_name).toBe('tfs01');
        });

        it('should use modulo 1000 for various large decimal values', () => {
            const holdingRegisters: number[] = new Array(30);
            
            // tfs01: 1234 % 1000 = 234 → 100.234
            holdingRegisters[10] = 100;
            holdingRegisters[11] = 1234;
            
            // tfs02: 5678 % 1000 = 678 → 200.678
            holdingRegisters[12] = 200;
            holdingRegisters[13] = 5678;
            
            // tfs03: 9999 % 1000 = 999 → 300.999
            holdingRegisters[14] = 300;
            holdingRegisters[15] = 9999;

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(3);
            expect(result[0].tfs_value).toBe(100.234);
            expect(result[1].tfs_value).toBe(200.678);
            expect(result[2].tfs_value).toBe(300.999);
        });
    });

    describe('parseTfsValues - Edge Cases', () => {
        it('should skip sensors with null/undefined values', () => {
            const holdingRegisters: number[] = new Array(30);
            // Fill all with valid zeros first
            for (let i = 0; i < 30; i++) holdingRegisters[i] = 0;
            // Then set tfs01 with null decimal part
            holdingRegisters[10] = 100;
            holdingRegisters[11] = null as any; // Invalid decimal part

            const result = processor.parseTfsValues(holdingRegisters);

            // tfs01 skipped due to null, but tfs02-06 parsed (all zeros)
            expect(result).toHaveLength(5);
        });

        it('should skip sensors when registers are out of bounds', () => {
            const holdingRegisters = new Array(14).fill(0); // Length 14 = indices 0-13
            holdingRegisters[10] = 100;
            holdingRegisters[11] = 250;

            const result = processor.parseTfsValues(holdingRegisters);

            // tfs01 (10-11) ✓, tfs02 (12-13) ✓, tfs03 (14-15) ✗ out of bounds
            expect(result).toHaveLength(2); // Only tfs01 and tfs02
            expect(result[0].key_name).toBe('tfs01');
            expect(result[1].key_name).toBe('tfs02');
        });

        it('should handle empty register array', () => {
            const holdingRegisters: number[] = [];

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(0);
        });

        it('should handle register array shorter than TFS addresses', () => {
            const holdingRegisters = new Array(10).fill(0); // Only 10 registers

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(0); // No TFS data
        });
    });

    describe('parseTfsValues - Delta Calculation Scenarios', () => {
        it('should parse TFS for delta calculation - increasing values', () => {
            // Simulation: First reading
            const holdingRegisters1: number[] = new Array(30);
            holdingRegisters1[10] = 91;
            holdingRegisters1[11] = 458;  // 458 % 1000 = 458

            const result1 = processor.parseTfsValues(holdingRegisters1);
            expect(result1[0].tfs_value).toBe(91.458);

            // Second reading (3 seconds later)
            const holdingRegisters2: number[] = new Array(30);
            holdingRegisters2[10] = 91;
            holdingRegisters2[11] = 698;  // 698 % 1000 = 698

            const result2 = processor.parseTfsValues(holdingRegisters2);
            expect(result2[0].tfs_value).toBe(91.698);

            // Expected delta: 91.698 - 91.458 = 0.240 m³
            const delta = result2[0].tfs_value - result1[0].tfs_value;
            expect(delta).toBeCloseTo(0.240, 3);
        });

        it('should detect counter rollover (integer part changes)', () => {
            // First reading
            const holdingRegisters1: number[] = new Array(30);
            holdingRegisters1[10] = 91;
            holdingRegisters1[11] = 900;  // 900 % 1000 = 900

            const result1 = processor.parseTfsValues(holdingRegisters1);
            expect(result1[0].tfs_value).toBe(91.900);

            // Second reading (crossed to next integer)
            const holdingRegisters2: number[] = new Array(30);
            holdingRegisters2[10] = 92;
            holdingRegisters2[11] = 150;  // 150 % 1000 = 150

            const result2 = processor.parseTfsValues(holdingRegisters2);
            expect(result2[0].tfs_value).toBe(92.150);

            // Expected delta: 92.150 - 91.900 = 0.250 m³
            const delta = result2[0].tfs_value - result1[0].tfs_value;
            expect(delta).toBeCloseTo(0.250, 3);
        });

        it('should detect PLC counter reset (negative delta)', () => {
            // First reading - high value
            const holdingRegisters1 = new Array(30).fill(0);
            holdingRegisters1[10] = 1000;
            holdingRegisters1[11] = 500;

            const result1 = processor.parseTfsValues(holdingRegisters1);
            expect(result1[0].tfs_value).toBe(1000.500);

            // Second reading - reset to low value
            const holdingRegisters2 = new Array(30).fill(0);
            holdingRegisters2[10] = 5;
            holdingRegisters2[11] = 250;

            const result2 = processor.parseTfsValues(holdingRegisters2);
            expect(result2[0].tfs_value).toBe(5.250);

            // Negative delta indicates reset
            const delta = result2[0].tfs_value - result1[0].tfs_value;
            expect(delta).toBeLessThan(0);
            expect(delta).toBeCloseTo(-995.250, 3);
        });

        it('should handle very small deltas (precision test)', () => {
            const holdingRegisters1 = new Array(30).fill(0);
            holdingRegisters1[10] = 100;
            holdingRegisters1[11] = 100;

            const result1 = processor.parseTfsValues(holdingRegisters1);
            
            const holdingRegisters2 = new Array(30).fill(0);
            holdingRegisters2[10] = 100;
            holdingRegisters2[11] = 101;

            const result2 = processor.parseTfsValues(holdingRegisters2);

            // Delta should be 0.001 m³
            const delta = result2[0].tfs_value - result1[0].tfs_value;
            expect(delta).toBeCloseTo(0.001, 3);
        });
    });

    describe('TFS Parsing - Real-world Scenarios', () => {
        it('should parse typical hourly accumulation scenario', () => {
            // Scenario: Vessel running for 1 hour
            // Start: 7:00 PM - TFS = 91.458 m³
            // End: 8:00 PM - TFS = 116.958 m³
            // Expected accumulation: 25.5 m³ in 1 hour

            const startReading = new Array(30).fill(0);
            startReading[10] = 91;
            startReading[11] = 458;

            const endReading = new Array(30).fill(0);
            endReading[10] = 116;
            endReading[11] = 958;

            const start = processor.parseTfsValues(startReading);
            const end = processor.parseTfsValues(endReading);

            const accumulated = end[0].tfs_value - start[0].tfs_value;
            expect(accumulated).toBeCloseTo(25.5, 3);
        });

        it('should parse multi-sensor trip scenario', () => {
            // Trip with 3 active sensors
            const holdingRegisters: number[] = new Array(30);
            
            // Main Engine Flow In (fs01/tfs01): 150.250 m³
            holdingRegisters[10] = 150;
            holdingRegisters[11] = 250;
            
            // Main Engine Flow Return (fs02/tfs02): 120.125 m³
            holdingRegisters[12] = 120;
            holdingRegisters[13] = 125;
            
            // Generator Flow In (fs03/tfs03): 80.500 m³
            holdingRegisters[14] = 80;
            holdingRegisters[15] = 500;
            // Leave tfs04-06 undefined

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(3);
            
            // Main Engine consumption: 150.250 - 120.125 = 30.125 m³
            const mainEngineConsumption = result[0].tfs_value - result[1].tfs_value;
            expect(mainEngineConsumption).toBeCloseTo(30.125, 3);
        });

        it('should handle 24-hour continuous operation', () => {
            // Start of day: 00:00
            const startOfDay = new Array(30).fill(0);
            startOfDay[10] = 0;
            startOfDay[11] = 0;

            // End of day: 24:00 (assuming 25.5 m³/h avg flow)
            const endOfDay = new Array(30).fill(0);
            endOfDay[10] = 612;  // 24 * 25.5 = 612 m³
            endOfDay[11] = 0;

            const start = processor.parseTfsValues(startOfDay);
            const end = processor.parseTfsValues(endOfDay);

            const dailyTotal = end[0].tfs_value - start[0].tfs_value;
            expect(dailyTotal).toBe(612.0);
        });
    });

    describe('TFS Parsing - Precision and Accuracy', () => {
        it('should maintain 3 decimal precision', () => {
            const holdingRegisters = new Array(30).fill(0);
            holdingRegisters[10] = 123;
            holdingRegisters[11] = 456;

            const result = processor.parseTfsValues(holdingRegisters);

            // 123 + (456/1000) = 123.456
            expect(result[0].tfs_value).toBe(123.456);
            expect(result[0].tfs_value.toString()).toBe('123.456');
        });

        it('should handle rounding edge cases', () => {
            const holdingRegisters = new Array(30).fill(0);
            holdingRegisters[10] = 99;
            holdingRegisters[11] = 999;

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result[0].tfs_value).toBe(99.999);
        });

        it('should parse multiple sensors with different precisions', () => {
            const holdingRegisters = new Array(30).fill(0);
            
            holdingRegisters[10] = 1;
            holdingRegisters[11] = 1;    // 1.001
            
            holdingRegisters[12] = 10;
            holdingRegisters[13] = 10;   // 10.010
            
            holdingRegisters[14] = 100;
            holdingRegisters[15] = 100;  // 100.100

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result[0].tfs_value).toBe(1.001);
            expect(result[1].tfs_value).toBe(10.010);
            expect(result[2].tfs_value).toBe(100.100);
        });
    });

    describe('TFS Parsing - Performance', () => {
        it('should parse all sensors efficiently', () => {
            const holdingRegisters = new Array(30).fill(0);
            
            for (let i = 0; i < 6; i++) {
                const baseAddr = 10 + (i * 2);
                holdingRegisters[baseAddr] = i * 100;
                holdingRegisters[baseAddr + 1] = i * 100;
            }

            const startTime = Date.now();
            const result = processor.parseTfsValues(holdingRegisters);
            const endTime = Date.now();

            expect(result).toHaveLength(6);
            expect(endTime - startTime).toBeLessThan(10); // Should be very fast
        });

        it('should handle rapid consecutive parsing calls', () => {
            const holdingRegisters = new Array(30).fill(0);
            holdingRegisters[10] = 100;
            holdingRegisters[11] = 500;

            const results = [];
            for (let i = 0; i < 100; i++) {
                results.push(processor.parseTfsValues(holdingRegisters));
            }

            expect(results).toHaveLength(100);
            results.forEach(result => {
                expect(result[0].tfs_value).toBe(100.500);
            });
        });
    });
});
