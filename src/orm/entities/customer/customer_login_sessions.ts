import { Entity, PrimaryColumn, ManyToOne, Column, BeforeInsert, JoinColumn } from 'typeorm';
import { CustomBaseEntity } from '../base/Base';
import { IotCustomerUser } from './customer_user';
import { v4 as uuidv4 } from 'uuid';

@Entity('customer_login_sessions')
export class CustomerLoginSessions extends CustomBaseEntity {
    @PrimaryColumn({ type: 'varchar', length: 140 })
    name: string;

    @Column({ type: 'varchar', length: 140, nullable: true })
    user_id: string | null;

    @ManyToOne(() => IotCustomerUser, user => user.sessions)
    @JoinColumn({ name: 'user_id', referencedColumnName: 'name' })
    user: IotCustomerUser;

    @Column({ type: 'varchar', length: 255, nullable: true })
    device?: string;

    @Column({ type: 'varchar', length: 45, nullable: true })
    ip_address?: string | null;

    @Column({ type: 'timestamp', name: 'login_time' })
    login_time: Date;

    @Column({ type: 'timestamp', name: 'logout_time', nullable: true })
    logout_time: Date | null;

    @Column({ type: 'boolean', default: true })
    is_active: boolean;

    @BeforeInsert()
    generateName() {
        // Format: SES-{UUID}
        this.name = `SES-${uuidv4()}`;
        this.login_time = new Date();
    }
}