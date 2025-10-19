import { 
    Entity, 
    PrimaryGeneratedColumn, 
    Column, 
    CreateDateColumn, 
    UpdateDateColumn,
    Index
} from 'typeorm';

/**
 * Entity for storing failed ThingsBoard telemetry data for retry
 * Supports batch telemetry upload with retry mechanism
 */
@Entity('tabiot_thingsboard_telemetry_queue')
@Index('idx_retry', ['status', 'retry_count', 'last_retry_at'])
export class TabiotThingsboardTelemetryQueue {
    
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ type: 'varchar', length: 255 })
    @Index('idx_device_id')
    device_id!: string;

    @Column({ type: 'varchar', length: 255 })
    device_token!: string;

    /**
     * Batch telemetry data in ThingsBoard format
     * Format: [{"ts": 1234567890, "values": {"temp": 25, "humidity": 60}}]
     */
    @Column({ type: 'json' })
    payload!: Array<{
        ts: number;
        values: Record<string, any>;
    }>;

    @Column({ type: 'bigint' })
    timestamp!: number;

    @Column({ type: 'int', default: 0 })
    retry_count!: number;

    @Column({ type: 'int', default: 3 })
    max_retries!: number;

    @Column({
        type: 'enum',
        enum: ['pending', 'retrying', 'failed', 'success'],
        default: 'pending'
    })
    @Index('idx_status')
    status!: 'pending' | 'retrying' | 'failed' | 'success';

    @Column({ type: 'text', nullable: true })
    last_error?: string;

    @Column({ type: 'bigint', nullable: true })
    last_retry_at?: number;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}
