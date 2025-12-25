import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { CustomBaseEntity } from '../base/Base';

/**
 * Entity for coil tracking sessions
 * Stores coil state tracking with duration and related telemetry snapshots
 */
@Entity('tabiot_coil_tracking_session')
@Index(['tracking_key'])
@Index(['coil_key'])
@Index(['device_id', 'status'])
@Index(['start_time'])
@Index(['board_id'])
export class TabiotCoilTrackingSession extends CustomBaseEntity {

    @PrimaryColumn({ type: 'varchar', length: 140 })
    name: string;

    @Column({ type: 'varchar', length: 100 })
    tracking_key: string;

    @Column({ type: 'varchar', length: 100 })
    coil_key: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    board_id?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    device_id?: string;

    @Column({ type: 'datetime' })
    start_time: Date;

    @Column({ type: 'datetime', nullable: true })
    end_time?: Date;

    @Column({ type: 'int', nullable: true })
    duration_seconds?: number;

    @Column({
        type: 'enum',
        enum: ['active', 'completed'],
        default: 'active'
    })
    status: 'active' | 'completed';

    @Column({ type: 'json', nullable: true })
    start_snapshot?: Record<string, any>;

    @Column({ type: 'json', nullable: true })
    end_snapshot?: Record<string, any>;
}
