import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { CustomBaseEntity } from '../base/Base';
import { TabiotSchedule } from './TabiotSchedule';

@Entity('tabiot_schedule_log')
export class TabiotScheduleLog extends CustomBaseEntity {
    @PrimaryColumn({ type: 'varchar', length: 255 })
    name!: string;

    @Column({ type: 'datetime', nullable: true })
    start_time?: string;

    @Column({ type: 'datetime', nullable: true })
    end_time?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    schedule_id?: string;

    @ManyToOne(() => TabiotSchedule, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'schedule_id' })
    schedule?: TabiotSchedule;
}
