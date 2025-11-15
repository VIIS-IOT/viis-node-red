import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TabiotDevice } from '../device/TabiotDevice';
import { CustomBaseEntity } from '../base/Base';

/**
 * Oil Profile Entity for Marine IoT System
 * Stores oil type configurations for different machines
 * Supports 4 machines:
 * - BOILER: Nồi hơi (fs01 - direct consumption)
 * - MAIN_ENGINE: Máy chính (fs02 in - fs03 return)
 * - GENERATOR_HFO: Máy phát HFO (fs03 in - fs04 return)
 * - GENERATOR_DO: Máy phát DO (fs05 in - fs06 return)
 * Each machine can have different oil types (DO/FO) with specific density and temperature
 */
@Entity('tabiot_oil_profile')
@Index(['device_id', 'machine_type', 'is_active'])
export class TabiotOilProfile extends CustomBaseEntity {

    @PrimaryColumn({ type: 'varchar', length: 255 })
    name!: string;

    @Column({ type: 'varchar', length: 255 })
    device_id!: string;

    @Column({
        type: 'enum',
        enum: ['BOILER', 'MAIN_ENGINE', 'GENERATOR_HFO', 'GENERATOR_DO'],
        comment: 'Machine type: BOILER (fs01), MAIN_ENGINE (fs02-fs03), GENERATOR_HFO (fs03-fs04), GENERATOR_DO (fs05-fs06)'
    })
    machine_type!: 'BOILER' | 'MAIN_ENGINE' | 'GENERATOR_HFO' | 'GENERATOR_DO';

    @Column({
        type: 'enum',
        enum: ['DO', 'FO'],
        comment: 'Oil type: DO (Diesel Oil), FO (Fuel Oil)'
    })
    oil_type!: 'DO' | 'FO';

    @Column({ 
        type: 'float', 
        comment: 'Operating temperature in Celsius' 
    })
    operating_temperature!: number;

    @Column({ 
        type: 'float', 
        comment: 'Density in kg/m³ (SI unit)' 
    })
    density!: number;

    @Column({ type: 'varchar', length: 255, nullable: true })
    label?: string;

    @Column({ 
        type: 'tinyint', 
        default: 0,
        comment: '1 if this is the active profile for the device'
    })
    is_active!: boolean;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column({ 
        type: 'datetime', 
        nullable: true,
        comment: 'Soft delete timestamp - profile is hidden but data preserved'
    })
    deleted_at?: Date;

    @ManyToOne(() => TabiotDevice, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'device_id', referencedColumnName: 'name' })
    device?: TabiotDevice;
}
