import { Entity, Column, PrimaryColumn, Index, ManyToOne, OneToOne, JoinColumn } from 'typeorm';
import { CustomBaseEntity } from '../base/Base';
import { IotCustomerUser } from './customer_user';

@Entity('tabiot_customer_user_credentials')
export class IotCustomerUserCredentials extends CustomBaseEntity {
    @PrimaryColumn({ type: 'varchar', length: 140 })
    name: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    id?: string;

    @Column({ type: 'smallint', default: 0 })
    enable: number;

    @Column({ type: 'varchar', length: 140, nullable: true })
    password?: string;

    // @Index('tabiot_customer_user_credentials_user_id_key', { unique: true })
    @Column({ type: 'varchar', length: 140, nullable: true })
    user_id?: string;

    @OneToOne(() => IotCustomerUser, user => user.credential)
    @JoinColumn({ name: 'user_id', referencedColumnName: 'name' })
    user?: IotCustomerUser;

    @Column({ type: 'timestamp', nullable: true })
    last_reset_password_key_generated_on?: Date;

    @Column({ type: 'varchar', length: 140, nullable: true })
    reset_password_key?: string;

    @Column({ type: 'bigint', default: 0 })
    total_retry_send_email: number;
}