import { toMysqlDate } from '../mysqlDate';

describe('toMysqlDate', () => {
    it('keeps a date-only string', () => {
        expect(toMysqlDate('2025-06-18')).toBe('2025-06-18');
    });

    it('maps a Vietnam midnight ISO instant back to the ICT calendar day', () => {
        expect(toMysqlDate('2025-06-18T17:00:00.000Z')).toBe('2025-06-19');
        expect(toMysqlDate('2027-06-29T17:00:00.000Z')).toBe('2027-06-30');
    });

    it('returns undefined for empty values', () => {
        expect(toMysqlDate(undefined)).toBeUndefined();
        expect(toMysqlDate(null)).toBeUndefined();
        expect(toMysqlDate('')).toBeUndefined();
    });
});
