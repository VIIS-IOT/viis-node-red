import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1760979610474 implements MigrationInterface {
    name = 'Migrate1760979610474'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` DROP FOREIGN KEY \`FK_tabiot_oil_profile_device_id\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` CHANGE \`oil_type\` \`oil_type\` enum ('DO', 'FO') NOT NULL COMMENT 'Oil type: DO (Diesel Oil), FO (Fuel Oil)'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` ADD CONSTRAINT \`FK_5b648bbfb5cd7dd8cbba3e5d706\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` DROP FOREIGN KEY \`FK_5b648bbfb5cd7dd8cbba3e5d706\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` CHANGE \`oil_type\` \`oil_type\` enum ('BO', 'DO', 'HFO') NOT NULL COMMENT 'Oil type: BO (Bunker Oil), DO (Diesel Oil), HFO (Heavy Fuel Oil)'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` ADD CONSTRAINT \`FK_tabiot_oil_profile_device_id\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
