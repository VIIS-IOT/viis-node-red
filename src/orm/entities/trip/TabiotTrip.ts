/**
 * @fileoverview TabiotTrip Entity
 * 
 * Represents a voyage/trip for tracking cumulative fuel consumption
 * Separate from hourly accumulation - this tracks journey-level totals
 */

import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Trip/Voyage entity for Marine IoT
 */
@Entity('tabiot_trip')
@Index(['device_id', 'status'])
export class TabiotTrip {
    @PrimaryColumn({ type: 'varchar', length: 36 })
    id: string;

    @Column({ type: 'varchar', length: 36 })
    device_id: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    trip_name: string | null;

    @Column({ type: 'bigint', comment: 'Unix timestamp in milliseconds' })
    start_time: number;

    @Column({ type: 'bigint', nullable: true, comment: 'Unix timestamp in milliseconds' })
    end_time: number | null;

    @Column({ 
        type: 'enum', 
        enum: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
        default: 'ACTIVE'
    })
    status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn({ type: 'timestamp' })
    created_at: Date;

    @Column({ type: 'timestamp', nullable: true })
    updated_at: Date | null;
}
