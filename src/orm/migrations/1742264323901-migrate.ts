import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1742264323901 implements MigrationInterface {
    name = 'Migrate1742264323901'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`fk_schedule_id\` ON \`tabiot_schedule_log\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`_user_tags\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`_comments\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`_assign\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`_liked_by\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`modified_by\` varchar(140) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`owner\` varchar(140) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`docstatus\` smallint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`idx\` bigint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`deleted\` datetime(6) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`creation\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`modified\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`start_time\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`start_time\` time NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`end_time\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`end_time\` time NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD CONSTRAINT \`FK_82dbff0216b4f3ef0f543d2c07b\` FOREIGN KEY (\`schedule_id\`) REFERENCES \`tabiot_schedule\`(\`name\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP FOREIGN KEY \`FK_82dbff0216b4f3ef0f543d2c07b\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`end_time\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`end_time\` timestamp NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`start_time\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`start_time\` timestamp NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`modified\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`modified\` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`creation\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`creation\` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`deleted\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`idx\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`docstatus\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`owner\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`modified_by\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`_liked_by\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`_assign\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`_comments\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`_user_tags\``);
        await queryRunner.query(`CREATE INDEX \`fk_schedule_id\` ON \`tabiot_schedule_log\` (\`schedule_id\`)`);
    }

}
