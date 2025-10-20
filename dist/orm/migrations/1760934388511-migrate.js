"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migrate1760934388511 = void 0;
class Migrate1760934388511 {
    constructor() {
        this.name = 'Migrate1760934388511';
    }
    async up(queryRunner) {
        // Get the actual foreign key constraint name
        const foreignKeys = await queryRunner.query(`SELECT CONSTRAINT_NAME 
             FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
             WHERE TABLE_SCHEMA = DATABASE() 
             AND TABLE_NAME = 'tabiot_oil_profile' 
             AND COLUMN_NAME = 'device_id' 
             AND REFERENCED_TABLE_NAME = 'tabiot_device'`);
        // Drop the foreign key constraint first if it exists
        if (foreignKeys && foreignKeys.length > 0) {
            const fkName = foreignKeys[0].CONSTRAINT_NAME;
            await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` DROP FOREIGN KEY \`${fkName}\``);
        }
        // Now drop the index
        await queryRunner.query(`DROP INDEX \`IDX_dfd0a500bcd8aa0e5c262ca5bf\` ON \`tabiot_oil_profile\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` ADD \`machine_type\` enum ('GENERATOR', 'MAIN_ENGINE', 'BOILER') NOT NULL COMMENT 'Machine type: GENERATOR (fs01-02), MAIN_ENGINE (fs03-04), BOILER (fs05-06)'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` CHANGE \`oil_type\` \`oil_type\` enum ('BO', 'DO', 'HFO') NOT NULL COMMENT 'Oil type: BO (Bunker Oil), DO (Diesel Oil), HFO (Heavy Fuel Oil)'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` CHANGE \`density\` \`density\` float NOT NULL COMMENT 'Density in kg/m³ (SI unit)'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_flow_accumulation\` CHANGE \`density_used\` \`density_used\` float NOT NULL COMMENT 'Density value in kg/m³ used for tons calculation (snapshot from profile)'`);
        await queryRunner.query(`CREATE INDEX \`IDX_ab43fa0de70aaf7dfa27274abb\` ON \`tabiot_oil_profile\` (\`device_id\`, \`machine_type\`, \`is_active\`)`);
        // Recreate the foreign key constraint
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` ADD CONSTRAINT \`FK_tabiot_oil_profile_device_id\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE CASCADE`);
    }
    async down(queryRunner) {
        // Get the actual foreign key constraint name
        const foreignKeys = await queryRunner.query(`SELECT CONSTRAINT_NAME 
             FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
             WHERE TABLE_SCHEMA = DATABASE() 
             AND TABLE_NAME = 'tabiot_oil_profile' 
             AND COLUMN_NAME = 'device_id' 
             AND REFERENCED_TABLE_NAME = 'tabiot_device'`);
        // Drop the foreign key constraint first if it exists
        if (foreignKeys && foreignKeys.length > 0) {
            const fkName = foreignKeys[0].CONSTRAINT_NAME;
            await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` DROP FOREIGN KEY \`${fkName}\``);
        }
        await queryRunner.query(`DROP INDEX \`IDX_ab43fa0de70aaf7dfa27274abb\` ON \`tabiot_oil_profile\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_flow_accumulation\` CHANGE \`density_used\` \`density_used\` float NOT NULL COMMENT 'Density value used for tons calculation (snapshot from profile)'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` CHANGE \`density\` \`density\` float NOT NULL COMMENT 'Density in tons/m3 (or kg/L)'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` CHANGE \`oil_type\` \`oil_type\` enum ('BO', 'DO') NOT NULL COMMENT 'Oil type: BO (Bunker Oil) or DO (Diesel Oil)'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` DROP COLUMN \`machine_type\``);
        await queryRunner.query(`CREATE INDEX \`IDX_dfd0a500bcd8aa0e5c262ca5bf\` ON \`tabiot_oil_profile\` (\`device_id\`, \`is_active\`)`);
        // Recreate the foreign key constraint with the original name
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` ADD CONSTRAINT \`FK_dfd0a500bcd8aa0e5c262ca5bf\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE CASCADE`);
    }
}
exports.Migrate1760934388511 = Migrate1760934388511;
