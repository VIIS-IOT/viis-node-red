import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    Index
} from 'typeorm';
import { TabiotDevice } from '../device/TabiotDevice';
import { TabiotSchedule } from '../schedule/TabiotSchedule';

/**
 * Fertilizer Irrigation Run Entity
 *
 * Stores history of all irrigation runs with EC control.
 * Used for:
 * - Learning: Calculate lookup table updates after each run
 * - Audit: Track all irrigation activities
 * - Sync: Queue runs to sync with backend when online
 *
 * Data Collection:
 * - EC and flow values are averaged after skipping 20s ramp-up period
 * - Valve times are the values that were written to Modbus at start of run
 */
@Entity('tabiot_fertilizer_irrigation_run')
@Index(['device_id', 'start_time'])
@Index(['is_synced_to_server', 'status'])
@Index(['schedule_name'])
export class TabiotFertilizerIrrigationRun {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ type: 'varchar', length: 255 })
    device_id!: string;

    @Column({
        type: 'varchar',
        length: 255,
        nullable: true,
        comment: 'Schedule that triggered this run (if any)'
    })
    schedule_name?: string;

    // ========================================
    // EC Setpoint and Achieved
    // ========================================

    @Column({
        type: 'decimal',
        precision: 4,
        scale: 2,
        comment: 'Target EC setpoint (e.g., 1.80 mS/cm)'
    })
    ec_setpoint!: number;

    @Column({
        type: 'decimal',
        precision: 4,
        scale: 2,
        nullable: true,
        comment: 'Average EC achieved (after 20s ramp-up)'
    })
    ec_achieved_avg?: number;

    // ========================================
    // Achieved Flow Rates (averages after ramp-up)
    // From Modbus holding registers 30-34
    // ========================================

    @Column({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 1'
    })
    flow_achieved_01_avg?: number;

    @Column({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 2'
    })
    flow_achieved_02_avg?: number;

    @Column({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 3'
    })
    flow_achieved_03_avg?: number;

    @Column({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 4'
    })
    flow_achieved_04_avg?: number;

    @Column({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 5'
    })
    flow_achieved_05_avg?: number;

    // ========================================
    // Valve Times Used (ms per cycle)
    // Written to Modbus holding registers 23-27
    // ========================================

    @Column({
        type: 'int',
        default: 0,
        comment: 'Valve 1 ON time per cycle (ms)'
    })
    time_on_valve_01!: number;

    @Column({
        type: 'int',
        default: 0,
        comment: 'Valve 2 ON time per cycle (ms)'
    })
    time_on_valve_02!: number;

    @Column({
        type: 'int',
        default: 0,
        comment: 'Valve 3 ON time per cycle (ms)'
    })
    time_on_valve_03!: number;

    @Column({
        type: 'int',
        default: 0,
        comment: 'Valve 4 ON time per cycle (ms)'
    })
    time_on_valve_04!: number;

    @Column({
        type: 'int',
        default: 0,
        comment: 'Valve 5 ON time per cycle (ms)'
    })
    time_on_valve_05!: number;

    // ========================================
    // Timing
    // ========================================

    @Column({
        type: 'datetime',
        comment: 'When irrigation started'
    })
    start_time!: Date;

    @Column({
        type: 'datetime',
        nullable: true,
        comment: 'When irrigation ended'
    })
    end_time?: Date;

    @Column({
        type: 'int',
        nullable: true,
        comment: 'Total duration in seconds'
    })
    duration_seconds?: number;

    // ========================================
    // Status and Error Tracking
    // ========================================

    @Column({
        type: 'enum',
        enum: ['Running', 'Completed', 'Failed', 'Interrupted'],
        default: 'Running',
        comment: 'Current status of the run'
    })
    status!: 'Running' | 'Completed' | 'Failed' | 'Interrupted';

    @Column({
        type: 'varchar',
        length: 255,
        nullable: true,
        comment: 'Error code if status is Failed'
    })
    error_code?: string;

    @Column({
        type: 'text',
        nullable: true,
        comment: 'Additional error details or notes'
    })
    error_message?: string;

    // ========================================
    // Sync Status (for offline operation)
    // ========================================

    @Column({
        type: 'tinyint',
        default: 0,
        comment: '1 = synced to backend, 0 = pending sync'
    })
    is_synced_to_server!: number;

    @Column({
        type: 'datetime',
        nullable: true,
        comment: 'When successfully synced to server'
    })
    synced_at?: Date;

    @Column({
        type: 'int',
        default: 0,
        comment: 'Number of sync attempts'
    })
    sync_attempts!: number;

    @Column({
        type: 'text',
        nullable: true,
        comment: 'Last sync error message'
    })
    sync_error?: string;

    // ========================================
    // Timestamps
    // ========================================

    @Column({
        type: 'datetime',
        default: () => 'CURRENT_TIMESTAMP',
        comment: 'Record creation time'
    })
    created_at!: Date;

    // ========================================
    // Relationships
    // ========================================

    @ManyToOne(() => TabiotDevice, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'device_id', referencedColumnName: 'name' })
    device?: TabiotDevice;

    @ManyToOne(() => TabiotSchedule, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'schedule_name', referencedColumnName: 'name' })
    schedule?: TabiotSchedule;
}
