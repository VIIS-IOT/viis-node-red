"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaimStore = exports.ACTUATOR_CLAIM_DDL = void 0;
const TabiotActuatorClaim_1 = require("../../orm/entities/actuator/TabiotActuatorClaim");
exports.ACTUATOR_CLAIM_DDL = `CREATE TABLE IF NOT EXISTS \`tabiot_actuator_claim\` (
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
class ClaimStore {
    constructor(ds) {
        this.ds = ds;
        this.tableReady = null;
    }
    /** Runs the DDL once per instance; a failed attempt is retried on the next call. */
    ensureTable() {
        if (!this.tableReady) {
            this.tableReady = this.ds
                .query(exports.ACTUATOR_CLAIM_DDL)
                .then(() => undefined)
                .catch(error => {
                this.tableReady = null;
                throw error;
            });
        }
        return this.tableReady;
    }
    async load() {
        const rows = await this.ds.getRepository(TabiotActuatorClaim_1.TabiotActuatorClaim).find();
        return rows.map(row => ({
            key: row.claim_key,
            value: Boolean(Number(row.value)),
            source: row.source,
            ownerId: row.owner_id,
            expiresAt: row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at),
            createdAt: Number(row.created_at),
        }));
    }
    /** Replaces every stored claim with `claims` in one transaction. */
    async save(claims) {
        await this.ds.transaction(async (manager) => {
            await manager.query(DELETE_ALL);
            if (claims.length === 0)
                return;
            await manager.getRepository(TabiotActuatorClaim_1.TabiotActuatorClaim).insert(claims.map(c => ({
                owner_id: c.ownerId,
                claim_key: c.key,
                value: c.value,
                source: c.source,
                expires_at: c.expiresAt === null ? null : String(c.expiresAt),
                created_at: String(c.createdAt),
            })));
        });
    }
}
exports.ClaimStore = ClaimStore;
