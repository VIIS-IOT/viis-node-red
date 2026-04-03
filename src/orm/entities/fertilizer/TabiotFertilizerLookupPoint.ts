import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    Unique,
    Index
} from 'typeorm';
import { TabiotDevice } from '../device/TabiotDevice';

/**
 * Fertilizer Lookup Point Entity
 *
 * Stores EC setpoint → valve time mappings for intelligent fertilizer control.
 * Each row represents either:
 * - An "Actual" point learned from real irrigation runs
 * - An "Interpolated" point calculated from surrounding actual points
 *
 * The lookup table is synchronized with the backend server and ThingsBoard.
 *
 * Modbus Register Mapping:
 * - time_on_valve_01-05 → Modbus holding registers 23-27
 * - actual_flow_01-05 ← Modbus holding registers 30-34
 * - EC values are stored as actual (e.g., 1.8), Modbus uses ×10 (e.g., 18)
 */
@Entity('tabiot_fertilizer_lookup_point')
@Unique(['device_id', 'ec_setpoint'])
@Index(['device_id'])
@Index(['ec_setpoint'])
export class TabiotFertilizerLookupPoint {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ type: 'varchar', length: 255 })
    device_id!: string;

    @Column({
        type: 'decimal',
        precision: 4,
        scale: 2,
        comment: 'Target EC setpoint (e.g., 1.80 mS/cm)'
    })
    ec_setpoint!: number;

    // ========================================
    // Valve ON times per cycle (milliseconds)
    // Maps to Modbus holding registers 23-27
    // ========================================

    @Column({
        type: 'int',
        default: 0,
        comment: 'Valve 1 ON time per cycle (ms) - Modbus reg 23'
    })
    time_on_valve_01!: number;

    @Column({
        type: 'int',
        default: 0,
        comment: 'Valve 2 ON time per cycle (ms) - Modbus reg 24'
    })
    time_on_valve_02!: number;

    @Column({
        type: 'int',
        default: 0,
        comment: 'Valve 3 ON time per cycle (ms) - Modbus reg 25'
    })
    time_on_valve_03!: number;

    @Column({
        type: 'int',
        default: 0,
        comment: 'Valve 4 ON time per cycle (ms) - Modbus reg 26'
    })
    time_on_valve_04!: number;

    @Column({
        type: 'int',
        default: 0,
        comment: 'Valve 5 ON time per cycle (ms) - Modbus reg 27'
    })
    time_on_valve_05!: number;

    // ========================================
    // Achieved values (from actual runs)
    // ========================================

    @Column({
        type: 'decimal',
        precision: 4,
        scale: 2,
        nullable: true,
        comment: 'Average EC achieved during runs (mS/cm)'
    })
    actual_ec_avg?: number;

    @Column({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 1 - from Modbus reg 30'
    })
    actual_flow_01?: number;

    @Column({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 2 - from Modbus reg 31'
    })
    actual_flow_02?: number;

    @Column({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 3 - from Modbus reg 32'
    })
    actual_flow_03?: number;

    @Column({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 4 - from Modbus reg 33'
    })
    actual_flow_04?: number;

    @Column({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 5 - from Modbus reg 34'
    })
    actual_flow_05?: number;

    // ========================================
    // Metadata
    // ========================================

    @Column({
        type: 'int',
        default: 0,
        comment: 'Number of irrigation runs contributing to this point'
    })
    sample_count!: number;

    @Column({
        type: 'enum',
        enum: ['Actual', 'Interpolated'],
        default: 'Interpolated',
        comment: 'Actual = learned from runs, Interpolated = calculated'
    })
    data_type!: 'Actual' | 'Interpolated';

    @Column({
        type: 'datetime',
        nullable: true,
        comment: 'Last sync with backend server'
    })
    last_server_sync?: Date;

    @Column({
        type: 'datetime',
        default: () => 'CURRENT_TIMESTAMP',
        comment: 'Last update timestamp'
    })
    last_updated!: Date;

    // ========================================
    // Relationships
    // ========================================

    @ManyToOne(() => TabiotDevice, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'device_id', referencedColumnName: 'name' })
    device?: TabiotDevice;
}
