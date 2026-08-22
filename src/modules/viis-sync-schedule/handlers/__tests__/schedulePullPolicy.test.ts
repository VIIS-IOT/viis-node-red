import {
    localInstantFromServer,
    shouldSkipIncomingUpdate,
    shouldSoftDeleteLocalOnPull,
} from '../schedulePullPolicy';

describe('schedulePullPolicy', () => {
    it('does not soft-delete an unsynced local create', () => {
        expect(shouldSoftDeleteLocalOnPull({ is_from_local: 1, is_synced: 0 })).toBe(false);
        expect(shouldSoftDeleteLocalOnPull({ is_from_local: 0, is_synced: 1 })).toBe(true);
        expect(shouldSoftDeleteLocalOnPull({ is_from_local: 1, is_synced: 1 })).toBe(true);
    });

    it('skips update when unsynced local is newer or server clock is missing', () => {
        expect(shouldSkipIncomingUpdate(
            { is_from_local: 1, is_synced: 0, modified: '2026-08-22 04:00:00' },
            undefined,
        )).toBe(true);
        expect(shouldSkipIncomingUpdate(
            { is_from_local: 1, is_synced: 0, modified: '2026-08-22 05:00:00' },
            '2026-08-22T04:00:00.000Z',
        )).toBe(true);
        expect(shouldSkipIncomingUpdate(
            { is_from_local: 0, is_synced: 1, modified: '2026-08-22 04:00:00' },
            '2026-08-22T05:00:00.000Z',
        )).toBe(false);
    });

    it('does not invent now when the server omitted modified', () => {
        expect(localInstantFromServer(undefined)).toBeNull();
        expect(localInstantFromServer('2026-08-21T04:54:13.000Z')?.toISOString())
            .toBe('2026-08-21T04:54:13.000Z');
    });
});
