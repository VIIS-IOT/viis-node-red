import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1741853107149 implements MigrationInterface {
    name = 'Migrate1741853107149'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`tabiot_schedule_plan\` (\`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6), \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`_user_tags\` text NULL, \`_comments\` text NULL, \`_assign\` text NULL, \`_liked_by\` text NULL, \`modified_by\` varchar(140) NULL, \`owner\` varchar(140) NULL, \`docstatus\` smallint NOT NULL DEFAULT '0', \`idx\` bigint NOT NULL DEFAULT '0', \`deleted\` datetime(6) NULL, \`name\` varchar(255) NOT NULL, \`label\` varchar(255) NOT NULL, \`schedule_count\` int NOT NULL DEFAULT '0', \`status\` enum ('active', 'inactive') NOT NULL DEFAULT 'inactive', \`enable\` tinyint NULL, \`is_synced\` tinyint NOT NULL DEFAULT '0', \`is_from_local\` int NOT NULL DEFAULT '1', \`device_id\` varchar(255) NULL, \`start_date\` date NULL, \`end_date\` date NULL, PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`tabiot_schedule\` (\`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6), \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`_user_tags\` text NULL, \`_comments\` text NULL, \`_assign\` text NULL, \`_liked_by\` text NULL, \`modified_by\` varchar(140) NULL, \`owner\` varchar(140) NULL, \`docstatus\` smallint NOT NULL DEFAULT '0', \`idx\` bigint NOT NULL DEFAULT '0', \`deleted\` datetime(6) NULL, \`name\` varchar(255) NOT NULL, \`device_id\` varchar(255) NULL, \`action\` mediumtext NULL, \`enable\` tinyint NOT NULL DEFAULT '1', \`label\` varchar(255) NULL, \`set_time\` time NULL, \`start_date\` date NULL, \`end_date\` date NULL, \`type\` enum ('', 'circulate', 'period', 'fixed', 'interval') NOT NULL DEFAULT '', \`interval\` varchar(255) NULL, \`start_time\` time NULL, \`end_time\` time NULL, \`is_from_local\` tinyint NULL, \`is_synced\` smallint NULL, \`is_deleted\` tinyint NOT NULL DEFAULT '0', \`status\` enum ('running', 'stopped', 'finished', '') NOT NULL DEFAULT '', \`schedule_plan_id\` varchar(255) NULL, PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`_user_tags\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`_comments\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`_assign\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`_liked_by\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`modified_by\` varchar(140) NULL`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`owner\` varchar(140) NULL`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`docstatus\` smallint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`idx\` bigint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`deleted\` datetime(6) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` DROP COLUMN \`creation\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` ADD \`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` DROP COLUMN \`modified\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` ADD \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`creation\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`modified\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` DROP COLUMN \`creation\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` ADD \`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` DROP COLUMN \`modified\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` ADD \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` CHANGE \`creation\` \`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` CHANGE \`modified\` \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_10ebf866c92988aca3a3e94129\` ON \`tabiot_device_telemetry\` (\`device_id\`, \`timestamp\`, \`key_name\`)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD CONSTRAINT \`FK_4f3fa51bdcb252c4869ac67c8ae\` FOREIGN KEY (\`schedule_plan_id\`) REFERENCES \`tabiot_schedule_plan\`(\`name\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD CONSTRAINT \`FK_9fc556cd6d9ccfdd305e9f77f25\` FOREIGN KEY (\`device_profile_id\`) REFERENCES \`tabiot_device_profile\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` ADD CONSTRAINT \`FK_803f66858054f399391d92e5f98\` FOREIGN KEY (\`device_profile_id\`) REFERENCES \`tabiot_device_profile\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry\` ADD CONSTRAINT \`FK_26704df8a691ecb44c435e87ef9\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry_latest\` ADD CONSTRAINT \`FK_47ac20dfac901a971b28b5d4ea3\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD CONSTRAINT \`FK_d8226ed2510b2417ad5d78edb00\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP FOREIGN KEY \`FK_d8226ed2510b2417ad5d78edb00\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry_latest\` DROP FOREIGN KEY \`FK_47ac20dfac901a971b28b5d4ea3\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry\` DROP FOREIGN KEY \`FK_26704df8a691ecb44c435e87ef9\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` DROP FOREIGN KEY \`FK_803f66858054f399391d92e5f98\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP FOREIGN KEY \`FK_9fc556cd6d9ccfdd305e9f77f25\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP FOREIGN KEY \`FK_4f3fa51bdcb252c4869ac67c8ae\``);
        await queryRunner.query(`DROP INDEX \`IDX_10ebf866c92988aca3a3e94129\` ON \`tabiot_device_telemetry\``);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` CHANGE \`modified\` \`modified\` datetime(0) NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` CHANGE \`creation\` \`creation\` datetime(0) NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` DROP COLUMN \`modified\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` ADD \`modified\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` DROP COLUMN \`creation\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` ADD \`creation\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`modified\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`modified\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`creation\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`creation\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` DROP COLUMN \`modified\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` ADD \`modified\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` DROP COLUMN \`creation\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` ADD \`creation\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`deleted\``);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`idx\``);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`docstatus\``);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`owner\``);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`modified_by\``);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`_liked_by\``);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`_assign\``);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`_comments\``);
        await queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`_user_tags\``);
        await queryRunner.query(`DROP TABLE \`tabiot_schedule\``);
        await queryRunner.query(`DROP TABLE \`tabiot_schedule_plan\``);
    }

}
