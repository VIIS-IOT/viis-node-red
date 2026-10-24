/**
 * Persistence of the arbiter's claims in gateway MySQL (`tabiot_actuator_claim`), so a manual or safety
 * claim survives a Node-RED restart. The claim set is small (one row per owner and key), so `save`
 * replaces the whole table in one transaction instead of tracking changes.
 *
 * Gateway MySQL runs with `synchronize: false` and no runtime migrations: the table is created on first
 * use by `ACTUATOR_CLAIM_DDL`, which must match `TabiotActuatorClaim` column for column.
 */
import { DataSource } from 'typeorm';
import { TabiotActuatorClaim } from '../../orm/entities/actuator/TabiotActuatorClaim';
import { ActuatorClaim, ClaimSource } from './arbiter-core';

export const ACTUATOR_CLAIM_DDL = `CREATE TABLE IF NOT EXISTS \`tabiot_actuator_claim\` (
  \`owner_id\` VARCHAR(140) NOT NULL,
  \`claim_key\` VARCHAR(140) NOT NULL,
  \`value\` TINYINT(1) NOT NULL,
  \`source\` VARCHAR(20) NOT NULL,
  \`expires_at\` BIGINT NULL,
  \`created_at\` BIGINT NOT NULL,
  PRIMARY KEY (\`owner_id\`, \`claim_key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

/** DELETE, not TRUNCATE: TRUNCATE commits implicitly and would break the replace-all transaction. */
const DELETE_ALL = 'DELETE FROM `tabiot_actuator_claim`';

export class ClaimStore {
    private tableReady: Promise<void> | null = null;

    constructor(private readonly ds: DataSource) {}

    /** Runs the DDL once per instance; a failed attempt is retried on the next call. */
    ensureTable(): Promise<void> {
        if (!this.tableReady) {
            this.tableReady = this.ds
                .query(ACTUATOR_CLAIM_DDL)
                .then(() => undefined)
                .catch(error => {
                    this.tableReady = null;
                    throw error;
                });
        }
        return this.tableReady;
    }

    async load(): Promise<ActuatorClaim[]> {
        const rows = await this.ds.getRepository(TabiotActuatorClaim).find();
        return rows.map(row => ({
            key: row.claim_key,
            value: Boolean(Number(row.value)),
            source: row.source as ClaimSource,
            ownerId: row.owner_id,
            expiresAt: row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at),
            createdAt: Number(row.created_at),
        }));
    }

    /** False once the shared DataSource was destroyed (another node closing first); no save can succeed then. */
    isAvailable(): boolean {
        return this.ds.isInitialized;
    }

    /** Replaces every stored claim with `claims` in one transaction. */
    async save(claims: ActuatorClaim[]): Promise<void> {
        await this.ds.transaction(async manager => {
            await manager.query(DELETE_ALL);
            if (claims.length === 0) return;
            await manager.getRepository(TabiotActuatorClaim).insert(
                claims.map(c => ({
                    owner_id: c.ownerId,
                    claim_key: c.key,
                    value: c.value,
                    source: c.source,
                    expires_at: c.expiresAt === null ? null : String(c.expiresAt),
                    created_at: String(c.createdAt),
                }))
            );
        });
    }
}
