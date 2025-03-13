import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { TabiotDeviceProfile } from '../device-profile/TabiotDeviceProfile';
import { CustomBaseEntity } from '../base/Base';

@Entity('tabiot_production_function')
export class TabiotProductionFunction extends CustomBaseEntity {

    @PrimaryColumn({ type: 'varchar', length: 255 })
    name!: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    type?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    label?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    identifier?: string;

    @Column({
        type: 'enum',
        enum: ['Bool', 'Value', 'Enum', 'Raw', 'String', 'Group Break', 'Tab Break', 'IP', 'Checkbox-bit', 'User data type'],
        nullable: true,
    })
    data_type?: 'Bool' | 'Value' | 'Enum' | 'Raw' | 'String' | 'Group Break' | 'Tab Break' | 'IP' | 'Checkbox-bit' | 'User data type';

    @Column({ type: 'varchar', length: 255, nullable: true })
    icon_url?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    data_on_text?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    data_off_text?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    enum_value?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    unit?: string;

    @Column({
        type: 'enum',
        enum: ['r', 'rw', 'w'],
        nullable: true,
    })
    data_permission?: 'r' | 'rw' | 'w';

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    device_group_function_id?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    data_measure_max?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    data_measure_min?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    data_eligible_max?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    data_eligible_min?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    checkbox_bit_label1?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    checkbox_bit_label2?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    checkbox_bit_label3?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    checkbox_bit_label4?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    checkbox_bit_label5?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    checkbox_bit_label6?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    checkbox_bit_label7?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    checkbox_bit_label8?: string;

    @Column({
        type: 'enum',
        enum: ['', 'Line', 'Text', 'Text_Line', 'Gauge', 'Card'],
        nullable: true,
    })
    chart_type?: '' | 'Line' | 'Text' | 'Text_Line' | 'Gauge' | 'Card';

    @Column({
        type: 'enum',
        enum: ['', 'Raw', 'Round', 'Float_1', 'Float_2', 'Float_3', 'Float_6'],
        nullable: true,
    })
    round_type?: '' | 'Raw' | 'Round' | 'Float_1' | 'Float_2' | 'Float_3' | 'Float_6';

    @Column({ type: 'int', nullable: true })
    md_size?: number;

    @Column({ type: 'tinyint', nullable: true })
    show_chart?: boolean;

    @Column({ type: 'int', nullable: true })
    index_sort?: number;

    @ManyToOne(() => TabiotDeviceProfile)
    @JoinColumn({ name: 'device_profile_id' })
    device_profile?: TabiotDeviceProfile;
}
