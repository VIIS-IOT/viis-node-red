/**
 * @fileoverview TabiotFlowCheckpoint Entity
 * 
 * Stores checkpoint values for TFS (Total Flow Sensor) to calculate delta-based accumulation
 * Used by both TripAccumulationWorker and FlowAccumulationService
 */

import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Flow checkpoint for tracking last TFS value
 * Enables delta calculation: current_tfs - last_tfs = accumulated volume
 */
@Entity('tabiot_flow_checkpoint')
@Index('idx_checkpoint_lookup', ['device_id', 'sensor_key', 'checkpoint_type'], { unique: true })
@Index(['device_id'])
@Index(['sensor_key'])
export class TabiotFlowCheckpoint {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 255, comment: 'Device ID' })
    device_id: string;

    @Column({ 
        type: 'varchar', 
        length: 20, 
        comment: 'TFS sensor key: tfs01, tfs02, tfs03, tfs04, tfs05, tfs06' 
    })
    sensor_key: string;

    @Column({ 
        type: 'varchar', 
        length: 20, 
        comment: 'Checkpoint type: trip or hourly' 
    })
    checkpoint_type: string;

    @Column({ 
        type: 'decimal', 
        precision: 12, 
        scale: 4,
        default: 0,
        comment: 'Last TFS value read from PLC (m³)' 
    })
    last_tfs_value: number;

    @Column({ 
        type: 'bigint',
        comment: 'Timestamp when checkpoint was last updated (ms)'
    })
    last_update_time: number;

    @Column({
        type: 'text',
        nullable: true,
        comment: 'Additional metadata (JSON)'
    })
    metadata: string | null;

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updated_at: Date;
}
