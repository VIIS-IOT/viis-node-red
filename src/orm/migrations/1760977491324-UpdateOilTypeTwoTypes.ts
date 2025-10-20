import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Update oil_type enum from 3 types (BO, DO, HFO) to 2 types (DO, FO)
 * 
 * Changes:
 * - Remove BO (Bunker Oil) and HFO (Heavy Fuel Oil)
 * - Add FO (Fuel Oil) to replace both BO and HFO
 * - Keep DO (Diesel Oil)
 */
export class UpdateOilTypeTwoTypes1760977491324 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Step 1: Add 'FO' to existing enum (temporarily allow all 4 values)
        await queryRunner.query(`
            ALTER TABLE \`tabiot_oil_profile\` 
            MODIFY COLUMN \`oil_type\` enum ('BO', 'DO', 'HFO', 'FO') NOT NULL
        `);

        // Step 2: Convert existing BO and HFO records to FO
        await queryRunner.query(`
            UPDATE tabiot_oil_profile 
            SET oil_type = 'FO' 
            WHERE oil_type IN ('BO', 'HFO')
        `);

        // Step 3: Remove BO and HFO from enum (only keep DO and FO)
        await queryRunner.query(`
            ALTER TABLE \`tabiot_oil_profile\` 
            MODIFY COLUMN \`oil_type\` enum ('DO', 'FO') NOT NULL 
            COMMENT 'Oil type: DO (Diesel Oil), FO (Fuel Oil)'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revert back to 3 oil types (BO, DO, HFO)
        await queryRunner.query(`
            ALTER TABLE \`tabiot_oil_profile\` 
            MODIFY COLUMN \`oil_type\` enum ('BO', 'DO', 'HFO') NOT NULL 
            COMMENT 'Oil type: BO (Bunker Oil), DO (Diesel Oil), HFO (Heavy Fuel Oil)'
        `);
        
        // Note: Cannot accurately revert FO back to BO or HFO
        // All FO records will remain as FO
    }
}
