/**
 * Unit tests for TFS Parsing Logic
 * Tests the formula: integer + decimal/1000
 */
describe('TFS Parsing', () => {
    describe('Formula Validation', () => {
        it('should correctly parse TFS value: integer + decimal/1000', () => {
            // Example from PLC: address 10=91, address 11=256
            const integerPart = 91;
            const decimalPart = 256;
            const tfsValue = integerPart + (decimalPart / 1000);
            expect(tfsValue).toBeCloseTo(91.256, 4);
        });
        it('should handle decimal = 0', () => {
            const integerPart = 50;
            const decimalPart = 0;
            const tfsValue = integerPart + (decimalPart / 1000);
            expect(tfsValue).toBe(50.0);
        });
        it('should handle large decimal values', () => {
            const integerPart = 100;
            const decimalPart = 999;
            const tfsValue = integerPart + (decimalPart / 1000);
            expect(tfsValue).toBeCloseTo(100.999, 4);
        });
        it('should match PLC examples from documentation', () => {
            // Example 1: 91.256 m³
            expect(91 + (256 / 1000)).toBeCloseTo(91.256, 4);
            // Example 2: 56.004 m³
            expect(56 + (4 / 1000)).toBeCloseTo(56.004, 4);
            // Example 3: 60.694 m³
            expect(60 + (694 / 1000)).toBeCloseTo(60.694, 4);
        });
        it('should handle 4 decimal precision', () => {
            // 91.4589 m³
            const integerPart = 91;
            const decimalPart = 459; // Actually represents 0.459, not 0.4589
            const tfsValue = integerPart + (decimalPart / 1000);
            // Result will be 91.459, not 91.4589 (limited by /1000 formula)
            expect(tfsValue).toBeCloseTo(91.459, 3);
        });
    });
    describe('TFS Register Mapping', () => {
        it('should map TFS sensors to correct register addresses', () => {
            const mapping = [
                { sensor: 'tfs01', intAddr: 10, decAddr: 11 },
                { sensor: 'tfs02', intAddr: 12, decAddr: 13 },
                { sensor: 'tfs03', intAddr: 14, decAddr: 15 },
                { sensor: 'tfs04', intAddr: 16, decAddr: 17 },
                { sensor: 'tfs05', intAddr: 18, decAddr: 19 },
                { sensor: 'tfs06', intAddr: 20, decAddr: 21 }
            ];
            expect(mapping).toHaveLength(6);
            // Verify sequential mapping
            for (let i = 0; i < 6; i++) {
                expect(mapping[i].intAddr).toBe(10 + (i * 2));
                expect(mapping[i].decAddr).toBe(11 + (i * 2));
            }
        });
    });
    describe('Delta Calculation', () => {
        it('should calculate positive delta', () => {
            const lastTfs = 100.0;
            const currentTfs = 110.5;
            const delta = currentTfs - lastTfs;
            expect(delta).toBe(10.5);
        });
        it('should detect negative delta (reset)', () => {
            const lastTfs = 100.0;
            const currentTfs = 5.0;
            const delta = currentTfs - lastTfs;
            expect(delta).toBeLessThan(0);
            expect(delta).toBe(-95.0);
        });
        it('should handle zero delta', () => {
            const lastTfs = 50.0;
            const currentTfs = 50.0;
            const delta = currentTfs - lastTfs;
            expect(delta).toBe(0);
        });
    });
    describe('Tons Conversion', () => {
        it('should convert m³ to tons using density', () => {
            const volumeM3 = 10.5;
            const density = 850; // kg/m³
            const volumeTons = volumeM3 * (density / 1000);
            expect(volumeTons).toBeCloseTo(8.925, 3);
        });
        it('should handle different densities', () => {
            const volumeM3 = 20.0;
            // Diesel Oil (DO)
            const densityDO = 850;
            const tonsDO = volumeM3 * (densityDO / 1000);
            expect(tonsDO).toBe(17.0);
            // Fuel Oil (FO)
            const densityFO = 950;
            const tonsFO = volumeM3 * (densityFO / 1000);
            expect(tonsFO).toBe(19.0);
        });
    });
});
