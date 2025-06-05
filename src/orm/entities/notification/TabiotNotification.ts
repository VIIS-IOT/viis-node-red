import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { CustomBaseEntity } from '../base/Base';
import { TabiotCustomer } from '../customer/customer';
import { IotCustomerUser } from '../customer/customer_user';

@Entity('tabiot_notification', { schema: 'public' })
export class TabiotNotification extends CustomBaseEntity {
    @PrimaryColumn({ type: 'varchar', length: 140 })
    name!: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    customer_user?: string;

    @Column({ type: 'text', nullable: true })
    message?: string;

    @Column({ type: 'timestamp', nullable: true })
    created_at?: Date;

    @Column({ type: 'varchar', length: 140, nullable: true })
    entity?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    type?: string;

    @Column({ type: 'smallint', default: 0 })
    is_read?: number = 0;

    @Column({ type: 'smallint', default: 0 })
    is_sent?: number = 0;

    @Column({ type: 'varchar', length: 140, nullable: true })
    customer_id?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    err_code?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    entity_label?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    severity?: string;

    // Relationship with TabiotCustomer
    @ManyToOne(() => TabiotCustomer, customer => customer.notifications, {
        nullable: true,
        onDelete: 'CASCADE'
    })
    @JoinColumn({ name: 'customer_id', referencedColumnName: 'name' })
    customer?: TabiotCustomer;

    // with TabiotCustomerUser
    @ManyToOne(() => IotCustomerUser, customerUser => customerUser.notifications, {
        nullable: true,
        onDelete: 'CASCADE'
    })
    @JoinColumn({ name: 'customer_user', referencedColumnName: 'name' })
    customerUser?: IotCustomerUser;
}
