import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { TabiotDevice } from '../device/TabiotDevice';

@Entity('tabiot_device_telemetry')
@Unique(['device_id', 'timestamp', 'key_name'])
export class TabiotDeviceTelemetry {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ type: 'varchar', length: 255, nullable: true })
    device_id?: string;

    @Column({ type: 'bigint' })
    timestamp!: number;

    @Column({ type: 'varchar', length: 255 })
    key_name!: string;

    @Column({
        type: 'enum',
        enum: ['int', 'float', 'string', 'boolean', 'json'],
    })
    value_type!: 'int' | 'float' | 'string' | 'boolean' | 'json';

    @Column({ type: 'int', nullable: true })
    int_value?: number;

    @Column({ type: 'float', nullable: true })
    float_value?: number;

    @Column({ type: 'varchar', length: 255, nullable: true })
    string_value?: string;

    @Column({ type: 'tinyint', nullable: true })
    boolean_value?: boolean;

    @Column({ type: 'json', nullable: true })
    json_value?: object;

    @ManyToOne(() => TabiotDevice)
    @JoinColumn({ name: 'device_id' })
    device?: TabiotDevice;
}
