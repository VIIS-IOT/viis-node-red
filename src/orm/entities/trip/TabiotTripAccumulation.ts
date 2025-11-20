/**
 * @fileoverview TabiotTripAccumulation Entity
 * 
 * Stores running totals for each sensor during a trip
 * Updated every 2 seconds based on real-time flow rates
 * IMPORTANT: This is separate from hourly accumulation (tabiot_flow_accumulation)
 */

import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * Trip accumulation data for flow sensors
 * Running totals accumulated during an active trip
 */
@Entity('tabiot_trip_accumulation')
@Index('unique_trip_sensor', ['trip_id', 'sensor_key'], { unique: true })
@Index(['trip_id'])
@Index(['device_id'])
export class TabiotTripAccumulation {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 36 })
    trip_id: string;

    @Column({ type: 'varchar', length: 36 })
    device_id: string;

    @Column({ type: 'varchar', length: 20, comment: 'fs01, fs02, fs03, fs04, fs05, fs06' })
    sensor_key: string;

    // Running totals (accumulated volume)
    @Column({ 
        type: 'decimal', 
        precision: 12, 
        scale: 6, 
        default: 0,
        comment: 'Total accumulated volume in m³'
    })
    total_volume_m3: number;

    @Column({ 
        type: 'decimal', 
        precision: 12, 
        scale: 6, 
        default: 0,
        comment: 'Total accumulated volume in tons'
    })
    total_volume_tons: number;

    // Current metadata
    @Column({ type: 'varchar', length: 50, nullable: true })
    oil_profile_id: string | null;

    @Column({ 
        type: 'decimal', 
        precision: 8, 
        scale: 2, 
        nullable: true,
        comment: 'Current density in kg/m³'
    })
    current_density: number | null;

    @Column({ 
        type: 'bigint', 
        nullable: true,
        comment: 'Last update timestamp in milliseconds'
    })
    last_update_time: number | null;

    @Column({ 
        type: 'int', 
        default: 0,
        comment: 'Number of samples accumulated'
    })
    sample_count: number;

    @Column({ 
        type: 'timestamp', 
        default: () => 'CURRENT_TIMESTAMP',
        onUpdate: 'CURRENT_TIMESTAMP'
    })
    updated_at: Date;
}
