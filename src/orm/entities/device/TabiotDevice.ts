import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { TabiotDeviceProfile } from '../device-profile/TabiotDeviceProfile';
import { CustomBaseEntity } from '../base/Base';

@Entity('tabiot_device')
@Unique(['id'])
export class TabiotDevice extends CustomBaseEntity {

    @PrimaryColumn({ type: 'varchar', length: 255 })
    name!: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    id?: string;

    @Column({ type: 'tinyint', default: 1 })
    is_gateway!: number;

    @Column({ type: 'varchar', length: 255, nullable: true })
    serial_number?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    device_id_thingsboard?: string;

    @Column({ type: 'text', nullable: true })
    access_token_thingsboard?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    description?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    device_profile?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    zone_id?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    zone_name?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    type?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    label?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    firmware_id?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    software_id?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    customer_name?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    image?: string;

    @ManyToOne(() => TabiotDeviceProfile)
    @JoinColumn({ name: 'device_profile_id' })
    deviceProfile?: TabiotDeviceProfile;
}
