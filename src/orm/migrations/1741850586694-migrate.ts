import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1741850586694 implements MigrationInterface {
    name = 'Migrate1741850586694'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP FOREIGN KEY \`fk_plan_id\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP FOREIGN KEY \`tabiot_schedule_ibfk_1\``);
        await queryRunner.query(`DROP INDEX \`device_id\` ON \`tabiot_schedule\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`_user_tags\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`_comments\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`_assign\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`_liked_by\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`modified_by\` varchar(140) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`owner\` varchar(140) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`docstatus\` smallint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`idx\` bigint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`deleted\` datetime(6) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`creation\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`creation\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`modified\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`modified\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` CHANGE \`enable\` \`enable\` tinyint NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` CHANGE \`type\` \`type\` enum ('', 'circulate', 'period', 'fixed', 'interval') NOT NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` CHANGE \`is_deleted\` \`is_deleted\` tinyint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` CHANGE \`status\` \`status\` enum ('running', 'stopped', 'finished', '') NOT NULL DEFAULT ''`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` CHANGE \`status\` \`status\` enum ('running', 'stopped', 'finished', '') NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` CHANGE \`is_deleted\` \`is_deleted\` tinyint NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` CHANGE \`type\` \`type\` enum ('', 'circulate', 'period', 'fixed', 'interval') NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` CHANGE \`enable\` \`enable\` tinyint NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`modified\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`modified\` datetime(0) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`creation\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD \`creation\` datetime(0) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`deleted\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`idx\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`docstatus\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`owner\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`modified_by\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`_liked_by\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`_assign\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`_comments\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP COLUMN \`_user_tags\``);
        await queryRunner.query(`CREATE INDEX \`device_id\` ON \`tabiot_schedule\` (\`device_id\`)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD CONSTRAINT \`tabiot_schedule_ibfk_1\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD CONSTRAINT \`fk_plan_id\` FOREIGN KEY (\`schedule_plan_id\`) REFERENCES \`tabiot_schedule_plan\`(\`name\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

}
