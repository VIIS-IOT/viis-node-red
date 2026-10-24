import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * One gateway event waiting for (or already past) delivery to the backend `notification-by-token`.
 * `seq` is the delivery order; `event_id` travels in the payload so the backend inbox drops a retried
 * duplicate. The device token is read at send time and never stored here.
 * Created at runtime by `EVENT_OUTBOX_DDL` (gateway MySQL has no migrations): keep both in step.
 * Instants are naive UTC (ADR-016).
 */
@Entity('tabiot_event_outbox')
@Index('idx_event_outbox_pending', ['sent_at', 'dead', 'next_attempt_at'])
export class TabiotEventOutbox {
    /** BIGINT: the mysql driver hands it back as a string. */
    @PrimaryGeneratedColumn({ type: 'bigint' })
    seq: string;

    @Column({ type: 'varchar', length: 64, unique: true })
    event_id: string;

    @Column({ type: 'json' })
    payload: Record<string, unknown>;

    @Column({ type: 'datetime', precision: 3 })
    created_at: Date;

    @Column({ type: 'datetime', precision: 3 })
    next_attempt_at: Date;

    @Column({ type: 'datetime', precision: 3, nullable: true })
    sent_at: Date | null;

    /** Rejected by the backend for good (4xx other than 408/409/429): never retried, does not block later rows. */
    @Column({ type: 'boolean', default: false })
    dead: boolean;

    @Column({ type: 'int', default: 0 })
    attempts: number;

    @Column({ type: 'varchar', length: 255, nullable: true })
    last_error: string | null;
}
