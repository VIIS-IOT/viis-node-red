import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1743047609326 implements MigrationInterface {
    name = 'Migrate1743047609326'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_plan\` CHANGE \`status\` \`status\` enum ('active', 'inactive') NOT NULL DEFAULT 'active'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_plan\` CHANGE \`status\` \`status\` enum ('active', 'inactive') NOT NULL DEFAULT 'inactive'`);
    }

}
