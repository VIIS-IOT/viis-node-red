import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1761105500988 implements MigrationInterface {
    name = 'Migrate1761105500988'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` ADD \`deleted_at\` datetime NULL COMMENT 'Soft delete timestamp - profile is hidden but data preserved'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` DROP COLUMN \`deleted_at\``);
    }

}
