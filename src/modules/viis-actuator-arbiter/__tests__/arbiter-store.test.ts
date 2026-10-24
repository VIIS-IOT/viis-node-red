import { ACTUATOR_CLAIM_DDL, ClaimStore } from '../arbiter-store';
import { ActuatorClaim } from '../arbiter-core';
import { TabiotActuatorClaim } from '../../../orm/entities/actuator/TabiotActuatorClaim';

/**
 * In-memory stand-in for the slice of the TypeORM DataSource the store uses (the repo has no sqlite
 * driver): DDL and `DELETE FROM` through `query`, `find`/`insert` on the repository, and a transaction
 * that restores the rows when the work throws. BIGINT columns come back as strings, like the mysql driver.
 */
class FakeClaimDataSource {
    readonly ddl: string[] = [];
    rows: Record<string, any>[] = [];

    async query(sql: string): Promise<void> {
        if (/^DELETE FROM `tabiot_actuator_claim`$/.test(sql.trim())) this.rows = [];
        else this.ddl.push(sql);
    }

    getRepository(entity: { name: string }) {
        if (entity.name !== TabiotActuatorClaim.name) throw new Error(`unexpected entity ${entity.name}`);
        return {
            find: async () => this.rows.map(r => ({ ...r })),
            insert: async (input: Record<string, any> | Record<string, any>[]) => {
                for (const row of Array.isArray(input) ? input : [input]) {
                    if (this.rows.some(r => r.owner_id === row.owner_id && r.claim_key === row.claim_key)) {
                        throw new Error('ER_DUP_ENTRY');
                    }
                    this.rows.push({
                        ...row,
                        value: row.value ? 1 : 0,
                        expires_at: row.expires_at === null ? null : String(row.expires_at),
                        created_at: String(row.created_at),
                    });
                }
            },
        };
    }

    async transaction<T>(work: (manager: any) => Promise<T>): Promise<T> {
        const before = this.rows.map(r => ({ ...r }));
        try {
            return await work({ query: (sql: string) => this.query(sql), getRepository: (e: any) => this.getRepository(e) });
        } catch (error) {
            this.rows = before;
            throw error;
        }
    }
}

const claims: ActuatorClaim[] = [
    { key: 'valve_1', value: true, source: 'manual', ownerId: 'manual:cmd-1', expiresAt: 1_800_000_060_000, createdAt: 1_800_000_000_000 },
    { key: 'valve_2', value: false, source: 'safety', ownerId: 'safety:estop', expiresAt: null, createdAt: 1_800_000_000_500 },
];

describe('ClaimStore', () => {
    test('save then load round-trips', async () => {
        const ds = new FakeClaimDataSource();
        const store = new ClaimStore(ds as any);

        await store.save(claims);
        expect(await store.load()).toEqual(claims);

        await store.save([claims[1]]);
        expect(await store.load()).toEqual([claims[1]]);
    });

    test('save([]) empties', async () => {
        const ds = new FakeClaimDataSource();
        const store = new ClaimStore(ds as any);

        await store.save(claims);
        await store.save([]);
        expect(await store.load()).toEqual([]);
    });

    test('ensureTable twice', async () => {
        const ds = new FakeClaimDataSource();
        const store = new ClaimStore(ds as any);

        await store.ensureTable();
        await store.ensureTable();
        expect(ds.ddl).toEqual([ACTUATOR_CLAIM_DDL]);
        expect(ACTUATOR_CLAIM_DDL).toMatch(/^CREATE TABLE IF NOT EXISTS `tabiot_actuator_claim`/);
        expect(ACTUATOR_CLAIM_DDL).toMatch(/PRIMARY KEY \(`owner_id`, `claim_key`\)/);
    });
});
