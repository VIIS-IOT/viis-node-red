import { Exclude } from 'class-transformer';
import { Column, CreateDateColumn, DeleteDateColumn, UpdateDateColumn } from 'typeorm';

export class CustomBaseEntity {
    @CreateDateColumn({
        type: 'datetime',
        precision: 6,
        default: () => 'CURRENT_TIMESTAMP(6)',
        nullable: true
    })
    creation?: Date;

    @UpdateDateColumn({
        type: 'datetime',
        precision: 6,
        default: () => 'CURRENT_TIMESTAMP(6)',
        onUpdate: 'CURRENT_TIMESTAMP(6)',
        nullable: true
    })
    modified?: Date;

    @Exclude()
    @Column({ type: 'text', nullable: true })
    _user_tags?: string;

    @Exclude()
    @Column({ type: 'text', nullable: true })
    _comments?: string;

    @Exclude()
    @Column({ type: 'text', nullable: true })
    _assign?: string;

    @Exclude()
    @Column({ type: 'text', nullable: true })
    _liked_by?: string;

    @Exclude()
    @Column({ type: 'varchar', length: 140, nullable: true })
    modified_by?: string;

    @Exclude()
    @Column({ type: 'varchar', length: 140, nullable: true })
    owner?: string;

    @Exclude()
    @Column({ type: 'smallint', default: 0 })
    docstatus?: number = 0;

    @Exclude()
    @Column({ type: 'bigint', default: 0 })
    idx?: number = 0;

    @DeleteDateColumn({ nullable: true, type: 'datetime' })
    deleted: Date = null;
}
