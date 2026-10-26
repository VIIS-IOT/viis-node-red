import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * One live actuator claim of the arbiter (`viis-actuator-arbiter`), persisted so claims survive a
 * Node-RED restart. The arbiter rewrites the whole table on every change (`ClaimStore.save`).
 * Times are epoch milliseconds, so no timezone applies. Created at runtime by `ACTUATOR_CLAIM_DDL`
 * (gateway MySQL has no migrations): keep both in step.
 */
@Entity('tabiot_actuator_claim')
export class TabiotActuatorClaim {
    @PrimaryColumn({ type: 'varchar', length: 140 })
    owner_id: string;

    @PrimaryColumn({ type: 'varchar', length: 140 })
    claim_key: string;

    @Column({ type: 'boolean' })
    value: boolean;

    @Column({ type: 'varchar', length: 20 })
    source: string;

    /** BIGINT: the mysql driver hands it back as a string. NULL = never expires (safety). */
    @Column({ type: 'bigint', nullable: true })
    expires_at: string | null;

    @Column({ type: 'bigint' })
    created_at: string;
}
