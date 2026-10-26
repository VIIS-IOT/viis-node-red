import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * Last state the gateway sent for one state alarm (`board_offline:board1`, `schedule_off_failed:<schedule>`).
 * `raise` only enqueues when the row is not already `Pending`, `clear` only when it is, so a condition that
 * repeats every poll sends one Pending and one Clear. The `Pending` rows are the snapshot the outbox sends
 * after a backend outage. One `Meta` row (`__outbox_meta:snapshot_pending`) records that a snapshot is owed. Created at runtime by `EVENT_OUTBOX_DDL`; instants are naive UTC (ADR-016).
 */
@Entity('tabiot_gateway_alarm_state')
export class TabiotGatewayAlarmState {
    @PrimaryColumn({ type: 'varchar', length: 140 })
    alarm_key: string;

    @Column({ type: 'varchar', length: 16 })
    /** `Meta`: bookkeeping row (the snapshot-pending marker), never an alarm. */
    status: 'Pending' | 'Clear' | 'Meta';

    @Column({ type: 'varchar', length: 16 })
    severity: string;

    @Column({ type: 'json', nullable: true })
    payload: Record<string, unknown> | null;

    @Column({ type: 'datetime', precision: 3 })
    updated_at: Date;
}
