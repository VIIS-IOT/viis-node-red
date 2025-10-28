/**
 * TFS Parsing Tests
 * Tests for TFS (Total Flow Sensor) value parsing from Modbus registers
 * 
 * Format: TFS uses 2 consecutive 16-bit registers
 * - Register[n]: Integer part
 * - Register[n+1]: Decimal part (entire value becomes decimal)
 * - Formula: tfs_value = parseFloat(`${integer}.${decimal}`)
 * 
 * Examples:
 * - Register 10 = 91, Register 11 = 4589
 *   Result: parseFloat("91.4589") = 91.4589 m³
 * - Register 10 = 91, Register 11 = 6987
 *   Result: parseFloat("91.6987") = 91.6987 m³
 * - Register 10 = 91, Register 11 = 698
 *   Result: parseFloat("91.698") = 91.698 m³
 * - Delta: 91.6987 - 91.4589 = 0.2398 ≈ 0.240 m³
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
            // Formula: parseFloat("91.4589") = 91.4589 m³
            const holdingRegisters: number[] = new Array(10);
            holdingRegisters[10] = 91;    // tfs01 integer part
            holdingRegisters[11] = 4589;  // tfs01 decimal part
            holdingRegisters.length = 30; // Leave tfs02-06 undefined

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(1);
            expect(result[0].key_name).toBe('tfs01');
            expect(result[0].tfs_value).toBe(91.4589); // parseFloat("91.4589")
            expect(result[0].device_id).toBe('device_001');
            expect(result[0].timestamp).toBeGreaterThan(0);

            // Log message verification
            expect(mockNode.log).toHaveBeenCalledWith(
                expect.stringContaining('tfs01: 91.4589')
            );
        });

        it('should parse all 6 TFS sensors from holding registers', () => {
            const holdingRegisters = new Array(30).fill(0);
            
            // tfs01: address 10-11 → parseFloat("100.250") = 100.25 m³
            holdingRegisters[10] = 100;
            holdingRegisters[11] = 250;
            
            // tfs02: address 12-13 → parseFloat("200.500") = 200.5 m³
            holdingRegisters[12] = 200;
            holdingRegisters[13] = 500;
            
            // tfs03: address 14-15 → parseFloat("300.7500") = 300.75 m³
            holdingRegisters[14] = 300;
            holdingRegisters[15] = 7500;
            
            // tfs04: address 16-17 → parseFloat("400.1250") = 400.125 m³
            holdingRegisters[16] = 400;
            holdingRegisters[17] = 1250;
            
            // tfs05: address 18-19 → parseFloat("500.9999") = 500.9999 m³
            holdingRegisters[18] = 500;
            holdingRegisters[19] = 9999;
            
            // tfs06: address 20-21 → parseFloat("600.1") = 600.1 m³
            holdingRegisters[20] = 600;
            holdingRegisters[21] = 1;

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(6);
            
            expect(result[0].key_name).toBe('tfs01');
            expect(result[0].tfs_value).toBe(100.25);
            
            expect(result[1].key_name).toBe('tfs02');
            expect(result[1].tfs_value).toBe(200.5);
            
            expect(result[2].key_name).toBe('tfs03');
            expect(result[2].tfs_value).toBe(300.75);
            
            expect(result[3].key_name).toBe('tfs04');
            expect(result[3].tfs_value).toBe(400.125);
            
            expect(result[4].key_name).toBe('tfs05');
            expect(result[4].tfs_value).toBe(500.9999);
            
            expect(result[5].key_name).toBe('tfs06');
            expect(result[5].tfs_value).toBe(600.1);
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
            holdingRegisters[11] = 9999;
            holdingRegisters.length = 30; // Leave others undefined

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(1);
            expect(result[0].tfs_value).toBe(65535.9999); // parseFloat("65535.9999")
        });

        it('should handle decimal-only values (integer = 0)', () => {
            const holdingRegisters: number[] = new Array(10);
            holdingRegisters[10] = 0;
            holdingRegisters[11] = 456; // parseFloat("0.456") = 0.456 m³
            holdingRegisters.length = 30; // Leave others undefined

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(1);
            expect(result[0].tfs_value).toBe(0.456);
        });

        it('should handle decimal values with variable digits', () => {
            const holdingRegisters: number[] = new Array(10);
            holdingRegisters[10] = 91;
            holdingRegisters[11] = 8979; // parseFloat("91.8979") = 91.8979
            holdingRegisters.length = 30;

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(1);
            expect(result[0].tfs_value).toBe(91.8979);
            expect(result[0].key_name).toBe('tfs01');
        });

        it('should parse various decimal values correctly', () => {
            const holdingRegisters: number[] = new Array(30);
            
            // tfs01: parseFloat("100.1234") = 100.1234
            holdingRegisters[10] = 100;
            holdingRegisters[11] = 1234;
            
            // tfs02: parseFloat("200.5678") = 200.5678
            holdingRegisters[12] = 200;
            holdingRegisters[13] = 5678;
            
            // tfs03: parseFloat("300.9999") = 300.9999
            holdingRegisters[14] = 300;
            holdingRegisters[15] = 9999;

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(3);
            expect(result[0].tfs_value).toBe(100.1234);
            expect(result[1].tfs_value).toBe(200.5678);
            expect(result[2].tfs_value).toBe(300.9999);
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
        it('should parse TFS for delta calculation - increasing values (user example)', () => {
            // User's example: First reading at 7:00 PM
            const holdingRegisters1: number[] = new Array(30);
            holdingRegisters1[10] = 91;
            holdingRegisters1[11] = 4589;  // 4589/10000 = 0.4589

            const result1 = processor.parseTfsValues(holdingRegisters1);
            expect(result1[0].tfs_value).toBe(91.4589);

            // Second reading at 7:00:03 (3 seconds later)
            const holdingRegisters2: number[] = new Array(30);
            holdingRegisters2[10] = 91;
            holdingRegisters2[11] = 6987;  // 6987/10000 = 0.6987

            const result2 = processor.parseTfsValues(holdingRegisters2);
            expect(result2[0].tfs_value).toBe(91.6987);

            // Expected delta: 91.6987 - 91.4589 = 0.2398 ≈ 0.240 m³
            const delta = result2[0].tfs_value - result1[0].tfs_value;
            expect(delta).toBeCloseTo(0.2398, 4);
        });

        it('should detect counter rollover (integer part changes)', () => {
            // First reading
            const holdingRegisters1: number[] = new Array(30);
            holdingRegisters1[10] = 91;
            holdingRegisters1[11] = 9000;  // parseFloat("91.9000") = 91.9

            const result1 = processor.parseTfsValues(holdingRegisters1);
            expect(result1[0].tfs_value).toBe(91.9);

            // Second reading (crossed to next integer)
            const holdingRegisters2: number[] = new Array(30);
            holdingRegisters2[10] = 92;
            holdingRegisters2[11] = 15;  // parseFloat("92.15") = 92.15

            const result2 = processor.parseTfsValues(holdingRegisters2);
            expect(result2[0].tfs_value).toBe(92.15);

            // Expected delta: 92.15 - 91.9 = 0.25 m³
            const delta = result2[0].tfs_value - result1[0].tfs_value;
            expect(delta).toBeCloseTo(0.25, 4);
        });

        it('should detect PLC counter reset (negative delta)', () => {
            // First reading - high value
            const holdingRegisters1 = new Array(30).fill(0);
            holdingRegisters1[10] = 1000;
            holdingRegisters1[11] = 5;  // parseFloat("1000.5") = 1000.5

            const result1 = processor.parseTfsValues(holdingRegisters1);
            expect(result1[0].tfs_value).toBe(1000.5);

            // Second reading - reset to low value
            const holdingRegisters2 = new Array(30).fill(0);
            holdingRegisters2[10] = 5;
            holdingRegisters2[11] = 25;  // parseFloat("5.25") = 5.25

            const result2 = processor.parseTfsValues(holdingRegisters2);
            expect(result2[0].tfs_value).toBe(5.25);

            // Negative delta indicates reset
            const delta = result2[0].tfs_value - result1[0].tfs_value;
            expect(delta).toBeLessThan(0);
            expect(delta).toBeCloseTo(-995.25, 2);
        });

        it('should handle very small deltas (precision test)', () => {
            const holdingRegisters1 = new Array(30).fill(0);
            holdingRegisters1[10] = 100;
            holdingRegisters1[11] = 1000;  // parseFloat("100.1000") = 100.1

            const result1 = processor.parseTfsValues(holdingRegisters1);
            expect(result1[0].tfs_value).toBe(100.1);
            
            const holdingRegisters2 = new Array(30).fill(0);
            holdingRegisters2[10] = 100;
            holdingRegisters2[11] = 1001;  // parseFloat("100.1001") = 100.1001

            const result2 = processor.parseTfsValues(holdingRegisters2);
            expect(result2[0].tfs_value).toBe(100.1001);

            // Delta: 100.1001 - 100.1 = 0.0001 m³
            const delta = result2[0].tfs_value - result1[0].tfs_value;
            expect(delta).toBeCloseTo(0.0001, 4);
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
            startReading[11] = 458;  // parseFloat("91.458") = 91.458

            const endReading = new Array(30).fill(0);
            endReading[10] = 116;
            endReading[11] = 958;  // parseFloat("116.958") = 116.958

            const start = processor.parseTfsValues(startReading);
            const end = processor.parseTfsValues(endReading);

            const accumulated = end[0].tfs_value - start[0].tfs_value;
            expect(accumulated).toBeCloseTo(25.5, 2);
        });

        it('should parse multi-sensor trip scenario', () => {
            // Trip with 3 active sensors
            const holdingRegisters: number[] = new Array(30);
            
            // Main Engine Flow In (fs01/tfs01): 150.25 m³
            holdingRegisters[10] = 150;
            holdingRegisters[11] = 25;  // parseFloat("150.25") = 150.25
            
            // Main Engine Flow Return (fs02/tfs02): 120.125 m³
            holdingRegisters[12] = 120;
            holdingRegisters[13] = 125;  // parseFloat("120.125") = 120.125
            
            // Generator Flow In (fs03/tfs03): 80.5 m³
            holdingRegisters[14] = 80;
            holdingRegisters[15] = 5;  // parseFloat("80.5") = 80.5
            // Leave tfs04-06 undefined

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result).toHaveLength(3);
            
            // Main Engine consumption: 150.25 - 120.125 = 30.125 m³
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
        it('should handle variable decimal precision', () => {
            const holdingRegisters = new Array(30).fill(0);
            holdingRegisters[10] = 123;
            holdingRegisters[11] = 456;  // parseFloat("123.456") = 123.456

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result[0].tfs_value).toBe(123.456);
            expect(result[0].tfs_value.toString()).toBe('123.456');
        });

        it('should handle rounding edge cases', () => {
            const holdingRegisters = new Array(30).fill(0);
            holdingRegisters[10] = 99;
            holdingRegisters[11] = 9999;  // 9999/10000 = 0.9999

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result[0].tfs_value).toBe(99.9999);
        });

        it('should parse multiple sensors with different decimal lengths', () => {
            const holdingRegisters = new Array(30).fill(0);
            
            holdingRegisters[10] = 1;
            holdingRegisters[11] = 1;     // parseFloat("1.1") = 1.1
            
            holdingRegisters[12] = 10;
            holdingRegisters[13] = 10;    // parseFloat("10.10") = 10.1
            
            holdingRegisters[14] = 100;
            holdingRegisters[15] = 100;   // parseFloat("100.100") = 100.1

            const result = processor.parseTfsValues(holdingRegisters);

            expect(result[0].tfs_value).toBe(1.1);
            expect(result[1].tfs_value).toBe(10.1);
            expect(result[2].tfs_value).toBe(100.1);
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
            holdingRegisters[11] = 5;  // parseFloat("100.5") = 100.5

            const results = [];
            for (let i = 0; i < 100; i++) {
                results.push(processor.parseTfsValues(holdingRegisters));
            }

            expect(results).toHaveLength(100);
            results.forEach(result => {
                expect(result[0].tfs_value).toBe(100.5);
            });
        });
    });
});
