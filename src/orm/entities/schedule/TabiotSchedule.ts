import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { CustomBaseEntity } from '../base/Base';
import { TabiotSchedulePlan } from '../schedulePlan/TabiotSchedulePlan';

@Entity('tabiot_schedule')
export class TabiotSchedule extends CustomBaseEntity {

    @PrimaryColumn({ type: 'varchar', length: 255 })
    name: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    device_id?: string;

    device_label?: string;

    @Column({ type: 'mediumtext', nullable: true })
    action?: string;

    @Column({ type: 'tinyint', default: 1 })
    enable: number;

    @Column({ type: 'varchar', length: 255, nullable: true })
    label?: string;

    @Column({ type: 'time', nullable: true })
    set_time?: string;

    @Column({ type: 'date', nullable: true })
    start_date?: string;

    @Column({ type: 'date', nullable: true })
    end_date?: string;

    @Column({
        type: 'enum',
        enum: ['', 'circulate', 'period', 'fixed', 'interval'],
        default: '',
    })
    type: '' | 'circulate' | 'period' | 'fixed' | 'interval';

    @Column({ type: 'varchar', length: 255, nullable: true })
    interval?: string;

    @Column({ type: 'time', nullable: true })
    start_time?: string;

    @Column({ type: 'time', nullable: true })
    end_time?: string;

    @Column({ type: 'tinyint', nullable: true })
    is_from_local?: number;

    @Column({ type: 'smallint', nullable: true })
    is_synced?: number;

    @Column({ type: 'tinyint', default: 0 })
    is_deleted: number;

    @Column({
        type: 'enum',
        enum: ['running', 'stopped', 'finished', ''],
        default: '',
    })
    status: 'running' | 'stopped' | 'finished' | '';

    @Column({ type: 'varchar', length: 255, nullable: true })
    schedule_plan_id?: string;

    @ManyToOne(() => TabiotSchedulePlan, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'schedule_plan_id' })
    schedulePlan?: TabiotSchedulePlan;
}
