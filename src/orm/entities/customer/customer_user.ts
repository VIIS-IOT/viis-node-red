import { Entity, Column, PrimaryColumn, Index, OneToMany, JoinColumn, ManyToOne, OneToOne, Unique } from 'typeorm';
import { CustomBaseEntity } from '../base/Base';

import { UserRoleTypeEnum } from '../../../constants/user_role';
import { IotDynamicRole } from '../dynamicRole/dynamicRole';
import { TabiotCustomer } from './customer';
import { CustomerLoginSessions } from './customer_login_sessions';
import { IotCustomerUserCredentials } from './customer_user_credentials';
import { TabiotNotification } from '../notification/TabiotNotification';

@Entity('tabiot_customer_user')
export class IotCustomerUser extends CustomBaseEntity {
    @PrimaryColumn({ type: 'varchar', length: 140 })
    name: string;

    @Index('unique_user_id', { unique: true })
    @Column({ type: 'varchar', length: 140, nullable: true })
    user_id?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    user_name?: string;

    @Column({ type: 'date', nullable: true })
    created_time?: Date;

    @Column({ type: 'varchar', length: 140, nullable: true })
    user_avatar?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    email?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    full_name?: string;

    // @Index('unique_phone_number', { unique: true })
    @Column({ type: 'varchar', length: 140, nullable: true })
    phone_number?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    address?: string;

    @Column({ type: 'date', nullable: true })
    date_join?: Date;

    @Column({ type: 'date', nullable: true })
    date_active?: Date;

    @Column({ type: 'varchar', length: 140, nullable: true })
    date_warranty?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    first_name?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    last_name?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    district?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    ward?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    province?: string;

    @Column({ type: 'smallint', default: 0 })
    is_admin: number;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    employee_id?: string;

    @Column({
        type: 'enum',
        default: UserRoleTypeEnum.CUSTOMER_USER,
        enum: UserRoleTypeEnum,
    })
    user_type: UserRoleTypeEnum;

    @Column({ type: 'varchar', length: 140, nullable: true })
    role_label?: string;

    @Column({ type: 'smallint', nullable: true })
    is_deactivated?: number;

    @OneToMany(() => CustomerLoginSessions, session => session.user)
    sessions: CustomerLoginSessions[];

    @Column({ type: 'varchar', length: 140, nullable: true })
    customer_id?: string;

    @ManyToOne(() => TabiotCustomer, customer => customer.users)
    @JoinColumn({ name: 'customer_id', referencedColumnName: 'name' })
    iot_customer?: TabiotCustomer;


    @Column({ type: 'varchar', length: 140, nullable: true })
    iot_dynamic_role?: string;

    @ManyToOne(() => IotDynamicRole, dynamicRole => dynamicRole.users, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'iot_dynamic_role', referencedColumnName: 'name' })
    dynamicRole?: IotDynamicRole;

    @OneToOne(() => IotCustomerUserCredentials, credential => credential.user)
    // @JoinColumn({ name: 'name', referencedColumnName: 'user_id' })
    credential?: IotCustomerUserCredentials;

    @OneToMany(() => TabiotNotification, notification => notification.customerUser)
    notifications: TabiotNotification[];
}