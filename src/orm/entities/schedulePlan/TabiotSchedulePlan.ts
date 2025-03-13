import { Entity, PrimaryColumn, Column } from 'typeorm';
import { CustomBaseEntity } from '../base/Base';

@Entity('tabiot_schedule_plan')
export class TabiotSchedulePlan extends CustomBaseEntity {
    @PrimaryColumn({ type: 'varchar', length: 255 })
    name!: string;

    @Column({ type: 'varchar', length: 255, nullable: false })
    label!: string;

    @Column({ type: 'int', default: 0 })
    schedule_count!: number;

    @Column({
        type: 'enum',
        enum: ['active', 'inactive'],
        default: 'inactive'
    })
    status!: 'active' | 'inactive';

    // Các trường creation, modified và is_deleted sẽ được kế thừa từ CustomBaseEntity

    @Column({ type: 'tinyint', nullable: true })
    enable?: number;

    @Column({ type: 'tinyint', default: 0 })
    is_synced!: number;

    @Column({ type: 'int', default: 1 })
    is_from_local!: number;

    @Column({ type: 'varchar', length: 255, nullable: true })
    device_id?: string;

    @Column({ type: 'date', nullable: true })
    start_date?: string;

    @Column({ type: 'date', nullable: true })
    end_date?: string;

    @Column({ type: 'tinyint', default: 0 })
    is_deleted: number;
}
