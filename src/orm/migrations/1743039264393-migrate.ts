import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1743039264393 implements MigrationInterface {
    name = 'Migrate1743039264393'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`set_time\``);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`set_time\` time NULL`);
    }

}
