"use strict";
/**
 * Unit tests for telemetry value normalization functions
 * Tests normalizeValue and normalizeTelemetryData
 */
Object.defineProperty(exports, "__esModule", { value: true });
const viis_telemetry_utils_1 = require("../viis-telemetry-utils");
describe('normalizeValue', () => {
    describe('null and undefined handling', () => {
        it('should return null for null input', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('any_key', null)).toBeNull();
        });
        it('should return null for undefined input', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('any_key', undefined)).toBeNull();
        });
    });
    describe('string keys preservation', () => {
        it('should keep oil_profile as string', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('fs01_oil_profile', 'HFO_Generator')).toBe('HFO_Generator');
        });
        it('should keep trip_id as string', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('trip_id', '12345')).toBe('12345');
        });
        it('should keep hour_start as string', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('hour_start', '2025-01-20T14:00:00Z')).toBe('2025-01-20T14:00:00Z');
        });
        it('should keep gps_time as string', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('gps_time', '123456 010125')).toBe('123456 010125');
        });
        it('should convert number to string for string keys', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('trip_id', 12345)).toBe('12345');
        });
    });
    describe('numeric value normalization', () => {
        it('should keep number as number', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('fs01_flow', 25.5)).toBe(25.5);
        });
        it('should convert string number to number', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('fs01_flow', '25.5')).toBe(25.5);
        });
        it('should handle integer strings', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('sample_count', '100')).toBe(100);
        });
        it('should handle negative numbers', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('temperature', '-10.5')).toBe(-10.5);
        });
        it('should handle scientific notation', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('small_value', '1.5e-3')).toBe(0.0015);
        });
        it('should return null for NaN', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('bad_value', NaN)).toBeNull();
        });
        it('should return null for Infinity', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('bad_value', Infinity)).toBeNull();
        });
        it('should return null for negative Infinity', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('bad_value', -Infinity)).toBeNull();
        });
        it('should return null for empty string', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('empty', '')).toBeNull();
        });
        it('should return null for whitespace-only string', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('empty', '   ')).toBeNull();
        });
    });
    describe('boolean handling', () => {
        it('should keep true as true', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('is_active', true)).toBe(true);
        });
        it('should keep false as false', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('is_active', false)).toBe(false);
        });
    });
    describe('non-numeric string handling', () => {
        it('should keep non-numeric strings as strings', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('status', 'running')).toBe('running');
        });
        it('should trim whitespace', () => {
            expect((0, viis_telemetry_utils_1.normalizeValue)('status', '  active  ')).toBe('active');
        });
    });
});
describe('normalizeTelemetryData', () => {
    it('should normalize all values in an object', () => {
        const input = {
            ts: 1737453600000,
            fs01_flow: '25.5',
            fs01_oil_profile: 'HFO_Generator',
            sample_count: 60,
            temperature: '-10.5',
            is_active: true,
        };
        const result = (0, viis_telemetry_utils_1.normalizeTelemetryData)(input);
        expect(result).toEqual({
            ts: 1737453600000,
            fs01_flow: 25.5,
            fs01_oil_profile: 'HFO_Generator',
            sample_count: 60,
            temperature: -10.5,
            is_active: true,
        });
    });
    it('should handle ThingsBoard telemetry format', () => {
        const input = {
            ts: 1737453600000,
            hour_start: '2025-01-20T14:00:00Z',
            hour_end: '2025-01-20T15:00:00Z',
            fs01_avg_flow_m3h: '25.5',
            fs01_accumulated_m3: '25.5',
            fs01_accumulated_tons: '24.225',
            fs01_oil_profile: 'BO_Generator',
            fs01_density: '950',
            fs01_samples: '60',
        };
        const result = (0, viis_telemetry_utils_1.normalizeTelemetryData)(input);
        expect(result).toEqual({
            ts: 1737453600000,
            hour_start: '2025-01-20T14:00:00Z',
            hour_end: '2025-01-20T15:00:00Z',
            fs01_avg_flow_m3h: 25.5,
            fs01_accumulated_m3: 25.5,
            fs01_accumulated_tons: 24.225,
            fs01_oil_profile: 'BO_Generator',
            fs01_density: 950,
            fs01_samples: 60,
        });
    });
    it('should remove null values', () => {
        const input = {
            ts: 1737453600000,
            valid_value: 100,
            null_value: null,
            undefined_value: undefined,
            empty_string: '',
        };
        const result = (0, viis_telemetry_utils_1.normalizeTelemetryData)(input);
        expect(result).toEqual({
            ts: 1737453600000,
            valid_value: 100,
        });
        expect(result).not.toHaveProperty('null_value');
        expect(result).not.toHaveProperty('undefined_value');
        expect(result).not.toHaveProperty('empty_string');
    });
    it('should handle trip telemetry payload', () => {
        const input = {
            ts: 1737453600000,
            trip_id: 'trip-abc-123',
            trip_start: '1737400000000',
            trip_status: 'active',
            trip_duration_hours: '12.5',
            fs01_trip_total_m3: '150.25',
            fs01_trip_total_tons: '142.7375',
            machine1_consumption_m3: '50.5',
            machine1_flow_in: 'fs02',
            machine1_flow_return: 'fs03',
        };
        const result = (0, viis_telemetry_utils_1.normalizeTelemetryData)(input);
        expect(result.trip_id).toBe('trip-abc-123');
        expect(result.trip_status).toBe('active');
        expect(result.trip_start).toBe(1737400000000);
        expect(result.trip_duration_hours).toBe(12.5);
        expect(result.fs01_trip_total_m3).toBe(150.25);
        expect(result.machine1_consumption_m3).toBe(50.5);
        expect(result.machine1_flow_in).toBe('fs02');
        expect(result.machine1_flow_return).toBe('fs03');
    });
    it('should use Date.now() for invalid ts', () => {
        const before = Date.now();
        const input = {
            ts: 'invalid',
            value: 100,
        };
        const result = (0, viis_telemetry_utils_1.normalizeTelemetryData)(input);
        const after = Date.now();
        expect(result.ts).toBeGreaterThanOrEqual(before);
        expect(result.ts).toBeLessThanOrEqual(after);
    });
    it('should handle AIS telemetry with string dates', () => {
        const input = {
            lat: '10.12345',
            lon: '106.54321',
            sog: '12.5',
            cog: '180.5',
            zda_time: '2025-01-20T14:00:00Z',
            zda_day: '20',
            zda_month: '01',
            zda_year: '2025',
        };
        const result = (0, viis_telemetry_utils_1.normalizeTelemetryData)(input);
        expect(result.lat).toBe(10.12345);
        expect(result.lon).toBe(106.54321);
        expect(result.sog).toBe(12.5);
        expect(result.cog).toBe(180.5);
        expect(result.zda_time).toBe('2025-01-20T14:00:00Z');
        expect(result.zda_day).toBe('20');
        expect(result.zda_month).toBe('01');
        expect(result.zda_year).toBe('2025');
    });
});
