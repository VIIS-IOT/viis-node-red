import { Entity, PrimaryColumn, Column } from 'typeorm';
import { CustomBaseEntity } from '../base/Base';

@Entity('tabiot_device_profile')
export class TabiotDeviceProfile extends CustomBaseEntity {

    @PrimaryColumn({ type: 'varchar', length: 255 })
    name!: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    tb_device_profile_id?: string;

    // creation và modified sẽ kế thừa từ CustomBaseEntity

    @Column({ type: 'varchar', length: 255, nullable: true })
    label?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    type?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    image?: string;

    @Column({
        type: 'enum',
        enum: ['DEFAULT', 'MQTT', 'CoAP', 'LWM2M', 'SNMP'],
        nullable: true,
    })
    transport_type?: 'DEFAULT' | 'MQTT' | 'CoAP' | 'LWM2M' | 'SNMP';

    @Column({
        type: 'enum',
        enum: ['DISABLED', 'ALLOW_CREATE_NEW_DEVICES'],
        nullable: true,
    })
    provision_type?: 'DISABLED' | 'ALLOW_CREATE_NEW_DEVICES';

    @Column({ type: 'json', nullable: true })
    profile_data?: object;

    @Column({ type: 'varchar', length: 255, nullable: true })
    description?: string;

    @Column({ type: 'tinyint', nullable: true })
    is_default?: boolean;

    @Column({ type: 'varchar', length: 255, nullable: true })
    firmware_id?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    software_id?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    default_rule_chain_id?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    default_dashboard_id?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    default_queue?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    provision_device_key?: string;
}
