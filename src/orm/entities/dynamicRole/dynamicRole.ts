import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { CustomBaseEntity } from '../base/Base';
import { TabiotCustomer } from '../customer/customer';
import { IotCustomerUser } from '../customer/customer_user';

@Entity('tabiot_dynamic_role')
export class IotDynamicRole extends CustomBaseEntity {
    @PrimaryColumn({ type: 'varchar', length: 140 })
    name: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    label?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    role?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    @ManyToOne(() => TabiotCustomer, customer => customer.dynamicRole)
    @JoinColumn({ name: 'iot_customer', referencedColumnName: 'name' })
    iot_customer?: TabiotCustomer;

    @OneToMany(() => IotCustomerUser, user => user.dynamicRole)
    users: IotCustomerUser[];

    @Column({ type: 'text', nullable: true })
    sections?: string;
}