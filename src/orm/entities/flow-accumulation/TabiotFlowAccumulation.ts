import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { TabiotDevice } from '../device/TabiotDevice';
import { TabiotOilProfile } from '../oil-profile/TabiotOilProfile';

/**
 * Flow Accumulation Entity for Marine IoT System
 * Stores hourly accumulated flow data from flow sensors (fs01-fs06)
 */
@Entity('tabiot_flow_accumulation')
@Unique(['device_id', 'sensor_key', 'hour_start'])
@Index(['device_id', 'hour_start'])
@Index(['sensor_key', 'hour_start'])
export class TabiotFlowAccumulation {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ type: 'varchar', length: 255 })
    device_id!: string;

    @Column({ 
        type: 'varchar', 
        length: 255, 
        comment: 'Sensor key: fs01, fs02, fs03, fs04, fs05, fs06' 
    })
    sensor_key!: string;

    @Column({ 
        type: 'datetime', 
        comment: 'Hour start timestamp (e.g., 2025-01-01 00:00:00)' 
    })
    hour_start!: Date;

    @Column({ 
        type: 'datetime', 
        comment: 'Hour end timestamp (e.g., 2025-01-01 01:00:00)' 
    })
    hour_end!: Date;

    @Column({ 
        type: 'float', 
        comment: 'Average flow rate in m3/h during this hour' 
    })
    avg_flow_m3h!: number;

    @Column({ 
        type: 'float', 
        comment: 'Accumulated volume in m3 for this hour' 
    })
    accumulated_m3!: number;

    @Column({ 
        type: 'float', 
        comment: 'Accumulated volume in tons for this hour (m3 * density)' 
    })
    accumulated_tons!: number;

    @Column({ 
        type: 'varchar', 
        length: 255, 
        comment: 'Oil profile ID used for this calculation' 
    })
    oil_profile_id!: string;

    @Column({ 
        type: 'float', 
        comment: 'Density value in kg/m³ used for tons calculation (snapshot from profile)' 
    })
    density_used!: number;

    @Column({ 
        type: 'int', 
        comment: 'Number of telemetry samples used in this hour calculation' 
    })
    sample_count!: number;

    @Column({ 
        type: 'bigint', 
        comment: 'Timestamp of first sample in this hour (ms)' 
    })
    first_sample_ts!: number;

    @Column({ 
        type: 'bigint', 
        comment: 'Timestamp of last sample in this hour (ms)' 
    })
    last_sample_ts!: number;

    @Column({ 
        type: 'datetime',
        default: () => 'CURRENT_TIMESTAMP',
        comment: 'When this record was created'
    })
    created_at!: Date;

    @ManyToOne(() => TabiotDevice, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'device_id', referencedColumnName: 'name' })
    device?: TabiotDevice;

    @ManyToOne(() => TabiotOilProfile)
    @JoinColumn({ name: 'oil_profile_id', referencedColumnName: 'name' })
    oil_profile?: TabiotOilProfile;
}
