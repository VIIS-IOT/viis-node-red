import { Entity, PrimaryColumn, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { CustomBaseEntity } from '../base/Base';
import { IotCustomerUser } from './customer_user';
import { TabiotDevice } from '../device/TabiotDevice';
import { IotDynamicRole } from '../dynamicRole/dynamicRole';

@Entity('tabiot_customer', { schema: 'public' })
export class TabiotCustomer extends CustomBaseEntity {
    @PrimaryColumn({ type: 'varchar', length: 140 })
    name: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    modifiedBy: string | null;

    @Column({ type: 'varchar', length: 140, unique: true, nullable: true })
    id: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    customerName: string | null;

    @Column({ type: 'date', nullable: true })
    createdTime: Date | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    email: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    phone: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    description: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    address: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    city: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    country: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    province: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    zipPostalCode: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    zipCode: string | null;

    @Column({ type: 'text', nullable: true })
    logo: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    district: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    ward: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    packageId: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    type: string | null;

    @Column({ type: 'smallint', default: 0, nullable: false })
    developerMode: number;

    @Column({ type: 'varchar', length: 140, nullable: true })
    developerWebhookId: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    developerRuleId: string | null;

    @Column({ type: 'numeric', precision: 21, scale: 9, default: 0, nullable: false })
    test: number;

    @Column({ type: 'smallint', default: 0, nullable: false })
    isReceiveConnectionNoti: number;

    @Column({ type: 'smallint', default: 0, nullable: false })
    isReceiveNotificationNoti: number;

    @OneToMany(() => TabiotDevice, device => device.customer)
    devices: TabiotDevice[];

    @OneToMany(() => IotDynamicRole, dynamicRole => dynamicRole.iot_customer)
    dynamicRole: IotDynamicRole[];

    @OneToMany(() => IotCustomerUser, user => user.iot_customer)
    users: IotCustomerUser[];
}