import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1741854297628 implements MigrationInterface {
    name = 'Migrate1741854297628'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_plan\` ADD \`is_deleted\` tinyint NOT NULL DEFAULT '0'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_plan\` DROP COLUMN \`is_deleted\``);
    }

}
