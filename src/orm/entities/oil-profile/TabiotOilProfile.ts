import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TabiotDevice } from '../device/TabiotDevice';
import { CustomBaseEntity } from '../base/Base';

/**
 * Oil Profile Entity for Marine IoT System
 * Stores oil type configurations for different machines (Generator, Main Engine, Boiler)
 * Each machine can have different oil types (BO/DO/HFO) with specific density and temperature
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
        enum: ['GENERATOR', 'MAIN_ENGINE', 'BOILER'],
        comment: 'Machine type: GENERATOR (fs01-02), MAIN_ENGINE (fs03-04), BOILER (fs05-06)'
    })
    machine_type!: 'GENERATOR' | 'MAIN_ENGINE' | 'BOILER';

    @Column({
        type: 'enum',
        enum: ['BO', 'DO', 'HFO'],
        comment: 'Oil type: BO (Bunker Oil), DO (Diesel Oil), HFO (Heavy Fuel Oil)'
    })
    oil_type!: 'BO' | 'DO' | 'HFO';

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

    @ManyToOne(() => TabiotDevice, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'device_id', referencedColumnName: 'name' })
    device?: TabiotDevice;
}
