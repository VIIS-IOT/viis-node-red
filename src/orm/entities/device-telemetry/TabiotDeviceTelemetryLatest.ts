import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { TabiotDevice } from '../device/TabiotDevice';

@Entity('tabiot_device_telemetry_latest')
export class TabiotDeviceTelemetryLatest {

    @PrimaryColumn({ type: 'varchar', length: 255 })
    device_id!: string;

    @PrimaryColumn({ type: 'varchar', length: 255 })
    key_name!: string;

    @Column({ type: 'bigint' })
    timestamp!: number;

    @Column({ type: 'tinyint', nullable: true })
    boolean_value?: boolean;

    @Column({ type: 'int', nullable: true })
    int_value?: number;

    @Column({ type: 'float', nullable: true })
    float_value?: number;

    @Column({ type: 'text', nullable: true })
    string_value?: string;

    @ManyToOne(() => TabiotDevice)
    @JoinColumn({ name: 'device_id' })
    device?: TabiotDevice;
}
