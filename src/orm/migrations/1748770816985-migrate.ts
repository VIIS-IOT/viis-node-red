import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1748770816985 implements MigrationInterface {
    name = 'Migrate1748770816985'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP FOREIGN KEY \`FK_82dbff0216b4f3ef0f543d2c07b\``);
        await queryRunner.query(`CREATE TABLE \`customer_login_sessions\` (\`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6), \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`_user_tags\` text NULL, \`_comments\` text NULL, \`_assign\` text NULL, \`_liked_by\` text NULL, \`modified_by\` varchar(140) NULL, \`owner\` varchar(140) NULL, \`docstatus\` smallint NOT NULL DEFAULT '0', \`idx\` bigint NOT NULL DEFAULT '0', \`deleted\` datetime(6) NULL, \`name\` varchar(140) NOT NULL, \`user_id\` varchar(140) NULL, \`device\` varchar(255) NULL, \`ip_address\` varchar(45) NULL, \`login_time\` timestamp NOT NULL, \`logout_time\` timestamp NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`tabiot_customer_user_credentials\` (\`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6), \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`_user_tags\` text NULL, \`_comments\` text NULL, \`_assign\` text NULL, \`_liked_by\` text NULL, \`modified_by\` varchar(140) NULL, \`owner\` varchar(140) NULL, \`docstatus\` smallint NOT NULL DEFAULT '0', \`idx\` bigint NOT NULL DEFAULT '0', \`deleted\` datetime(6) NULL, \`name\` varchar(140) NOT NULL, \`id\` varchar(140) NULL, \`enable\` smallint NOT NULL DEFAULT '0', \`password\` varchar(140) NULL, \`user_id\` varchar(140) NULL, \`last_reset_password_key_generated_on\` timestamp NULL, \`reset_password_key\` varchar(140) NULL, \`total_retry_send_email\` bigint NOT NULL DEFAULT '0', UNIQUE INDEX \`REL_e88c7a238c02307fa55aa10e6a\` (\`user_id\`), PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`tabiot_customer_user\` (\`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6), \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`_user_tags\` text NULL, \`_comments\` text NULL, \`_assign\` text NULL, \`_liked_by\` text NULL, \`modified_by\` varchar(140) NULL, \`owner\` varchar(140) NULL, \`docstatus\` smallint NOT NULL DEFAULT '0', \`idx\` bigint NOT NULL DEFAULT '0', \`deleted\` datetime(6) NULL, \`name\` varchar(140) NOT NULL, \`user_id\` varchar(140) NULL, \`user_name\` varchar(140) NULL, \`created_time\` date NULL, \`user_avatar\` varchar(140) NULL, \`email\` varchar(140) NULL, \`full_name\` varchar(140) NULL, \`phone_number\` varchar(140) NULL, \`address\` varchar(140) NULL, \`date_join\` date NULL, \`date_active\` date NULL, \`date_warranty\` varchar(140) NULL, \`first_name\` varchar(140) NULL, \`last_name\` varchar(140) NULL, \`district\` varchar(140) NULL, \`ward\` varchar(140) NULL, \`province\` varchar(140) NULL, \`is_admin\` smallint NOT NULL DEFAULT '0', \`description\` text NULL, \`employee_id\` varchar(140) NULL, \`user_type\` enum ('VIIS_ROOT_USER', 'System User', 'TENANT_SUPER_ADMIN', 'TENANT_ADMIN', 'TENANT_USER', 'TENANT_CUSTOM_ROLE', 'Viis IoT User') NOT NULL DEFAULT 'Viis IoT User', \`role_label\` varchar(140) NULL, \`is_deactivated\` smallint NULL, \`customer_id\` varchar(140) NULL, \`iot_dynamic_role\` varchar(140) NULL, UNIQUE INDEX \`unique_user_id\` (\`user_id\`), PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`tabiot_customer\` (\`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6), \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`_user_tags\` text NULL, \`_comments\` text NULL, \`_assign\` text NULL, \`_liked_by\` text NULL, \`modified_by\` varchar(140) NULL, \`owner\` varchar(140) NULL, \`docstatus\` smallint NOT NULL DEFAULT '0', \`idx\` bigint NOT NULL DEFAULT '0', \`deleted\` datetime(6) NULL, \`name\` varchar(140) NOT NULL, \`modifiedBy\` varchar(140) NULL, \`id\` varchar(140) NULL, \`customerName\` varchar(140) NULL, \`createdTime\` date NULL, \`email\` varchar(140) NULL, \`phone\` varchar(140) NULL, \`description\` varchar(140) NULL, \`address\` varchar(140) NULL, \`city\` varchar(140) NULL, \`country\` varchar(140) NULL, \`province\` varchar(140) NULL, \`zipPostalCode\` varchar(140) NULL, \`zipCode\` varchar(140) NULL, \`logo\` text NULL, \`district\` varchar(140) NULL, \`ward\` varchar(140) NULL, \`packageId\` varchar(140) NULL, \`type\` varchar(140) NULL, \`developerMode\` smallint NOT NULL DEFAULT '0', \`developerWebhookId\` varchar(140) NULL, \`developerRuleId\` varchar(140) NULL, \`test\` decimal(21,9) NOT NULL DEFAULT '0.000000000', \`isReceiveConnectionNoti\` smallint NOT NULL DEFAULT '0', \`isReceiveNotificationNoti\` smallint NOT NULL DEFAULT '0', UNIQUE INDEX \`IDX_34e197ebfce40659e171f68c58\` (\`id\`), PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`tabiot_dynamic_role\` (\`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6), \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`_user_tags\` text NULL, \`_comments\` text NULL, \`_assign\` text NULL, \`_liked_by\` text NULL, \`modified_by\` varchar(140) NULL, \`owner\` varchar(140) NULL, \`docstatus\` smallint NOT NULL DEFAULT '0', \`idx\` bigint NOT NULL DEFAULT '0', \`deleted\` datetime(6) NULL, \`name\` varchar(140) NOT NULL, \`label\` varchar(140) NULL, \`role\` varchar(140) NULL, \`iot_customer\` varchar(140) NULL, \`sections\` text NULL, PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`yes"?>\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` ADD \`customer_id\` varchar(140) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`start_time\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`start_time\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`end_time\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`end_time\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD CONSTRAINT \`FK_82dbff0216b4f3ef0f543d2c07b\` FOREIGN KEY (\`schedule_id\`) REFERENCES \`tabiot_schedule\`(\`name\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`customer_login_sessions\` ADD CONSTRAINT \`FK_6796fe0549c819adab8f5154e46\` FOREIGN KEY (\`user_id\`) REFERENCES \`tabiot_customer_user\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_customer_user_credentials\` ADD CONSTRAINT \`FK_e88c7a238c02307fa55aa10e6ab\` FOREIGN KEY (\`user_id\`) REFERENCES \`tabiot_customer_user\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_customer_user\` ADD CONSTRAINT \`FK_f09e5990e0e92e85ebca9cdc7aa\` FOREIGN KEY (\`customer_id\`) REFERENCES \`tabiot_customer\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_customer_user\` ADD CONSTRAINT \`FK_780eb2884bf379e3f5744bdc0f1\` FOREIGN KEY (\`iot_dynamic_role\`) REFERENCES \`tabiot_dynamic_role\`(\`name\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` ADD CONSTRAINT \`FK_ca6a1941a27bc05174bddadc72a\` FOREIGN KEY (\`customer_id\`) REFERENCES \`tabiot_customer\`(\`name\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_dynamic_role\` ADD CONSTRAINT \`FK_2dc9693c049f8f5d16128500584\` FOREIGN KEY (\`iot_customer\`) REFERENCES \`tabiot_customer\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_dynamic_role\` DROP FOREIGN KEY \`FK_2dc9693c049f8f5d16128500584\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` DROP FOREIGN KEY \`FK_ca6a1941a27bc05174bddadc72a\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_customer_user\` DROP FOREIGN KEY \`FK_780eb2884bf379e3f5744bdc0f1\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_customer_user\` DROP FOREIGN KEY \`FK_f09e5990e0e92e85ebca9cdc7aa\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_customer_user_credentials\` DROP FOREIGN KEY \`FK_e88c7a238c02307fa55aa10e6ab\``);
        await queryRunner.query(`ALTER TABLE \`customer_login_sessions\` DROP FOREIGN KEY \`FK_6796fe0549c819adab8f5154e46\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP FOREIGN KEY \`FK_82dbff0216b4f3ef0f543d2c07b\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`end_time\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`end_time\` time NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`start_time\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`start_time\` time NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device\` DROP COLUMN \`customer_id\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`yes"?>\` varchar(512) NULL`);
        await queryRunner.query(`DROP TABLE \`tabiot_dynamic_role\``);
        await queryRunner.query(`DROP INDEX \`IDX_34e197ebfce40659e171f68c58\` ON \`tabiot_customer\``);
        await queryRunner.query(`DROP TABLE \`tabiot_customer\``);
        await queryRunner.query(`DROP INDEX \`unique_user_id\` ON \`tabiot_customer_user\``);
        await queryRunner.query(`DROP TABLE \`tabiot_customer_user\``);
        await queryRunner.query(`DROP INDEX \`REL_e88c7a238c02307fa55aa10e6a\` ON \`tabiot_customer_user_credentials\``);
        await queryRunner.query(`DROP TABLE \`tabiot_customer_user_credentials\``);
        await queryRunner.query(`DROP TABLE \`customer_login_sessions\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD CONSTRAINT \`FK_82dbff0216b4f3ef0f543d2c07b\` FOREIGN KEY (\`schedule_id\`) REFERENCES \`tabiot_schedule\`(\`name\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

}
