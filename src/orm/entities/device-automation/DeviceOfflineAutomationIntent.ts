import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { TabiotDevice } from '../device/TabiotDevice';
import { CustomBaseEntity } from '../base/Base';

@Entity('device_offline_automation_intents')
export class DeviceOfflineAutomationIntent extends CustomBaseEntity {

    @PrimaryColumn({ type: 'varchar', length: 36 })
    id!: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    label?: string;

    @Column({ type: 'tinyint', default: 1 })
    enable!: boolean;

    @Column({ type: 'json', nullable: true })
    intent_json?: object;

    @Column({ type: 'varchar', length: 255, nullable: true })
    device_id?: string;

    @ManyToOne(() => TabiotDevice)
    @JoinColumn({ name: 'device_id' })
    device?: TabiotDevice;
}
