import { parseUrl } from '../urlParser';

describe('parseUrl v2/v3 schedule aliases', () => {
    it('rewrites schedulePlan before the schedule prefix', () => {
        expect(parseUrl('/api/v2/schedulePlan')).toBe('/api/v3/schedulePlan');
        expect(parseUrl('/api/v2/schedulePlan/ver2?x=1')).toBe('/api/v3/schedulePlan/ver2');
    });

    it('rewrites schedule CRUD paths', () => {
        expect(parseUrl('/api/v2/schedule')).toBe('/api/v3/schedule');
        expect(parseUrl('/api/v2/schedule/ver2')).toBe('/api/v3/schedule/ver2');
    });

    it('leaves v3 and unrelated paths alone', () => {
        expect(parseUrl('/api/v3/schedulePlan')).toBe('/api/v3/schedulePlan');
        expect(parseUrl('/api/v2/file/upload')).toBe('/api/v2/file/upload');
    });
});
