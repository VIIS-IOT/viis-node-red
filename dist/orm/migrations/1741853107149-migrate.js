"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migrate1741853107149 = void 0;
class Migrate1741853107149 {
    constructor() {
        this.name = 'Migrate1741853107149';
    }
    up(queryRunner) {
        return __awaiter(this, void 0, void 0, function* () {
            yield queryRunner.query(`CREATE TABLE \`tabiot_schedule_plan\` (\`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6), \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`_user_tags\` text NULL, \`_comments\` text NULL, \`_assign\` text NULL, \`_liked_by\` text NULL, \`modified_by\` varchar(140) NULL, \`owner\` varchar(140) NULL, \`docstatus\` smallint NOT NULL DEFAULT '0', \`idx\` bigint NOT NULL DEFAULT '0', \`deleted\` datetime(6) NULL, \`name\` varchar(255) NOT NULL, \`label\` varchar(255) NOT NULL, \`schedule_count\` int NOT NULL DEFAULT '0', \`status\` enum ('active', 'inactive') NOT NULL DEFAULT 'inactive', \`enable\` tinyint NULL, \`is_synced\` tinyint NOT NULL DEFAULT '0', \`is_from_local\` int NOT NULL DEFAULT '1', \`device_id\` varchar(255) NULL, \`start_date\` date NULL, \`end_date\` date NULL, PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
            yield queryRunner.query(`CREATE TABLE \`tabiot_schedule\` (\`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6), \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`_user_tags\` text NULL, \`_comments\` text NULL, \`_assign\` text NULL, \`_liked_by\` text NULL, \`modified_by\` varchar(140) NULL, \`owner\` varchar(140) NULL, \`docstatus\` smallint NOT NULL DEFAULT '0', \`idx\` bigint NOT NULL DEFAULT '0', \`deleted\` datetime(6) NULL, \`name\` varchar(255) NOT NULL, \`device_id\` varchar(255) NULL, \`action\` mediumtext NULL, \`enable\` tinyint NOT NULL DEFAULT '1', \`label\` varchar(255) NULL, \`set_time\` time NULL, \`start_date\` date NULL, \`end_date\` date NULL, \`type\` enum ('', 'circulate', 'period', 'fixed', 'interval') NOT NULL DEFAULT '', \`interval\` varchar(255) NULL, \`start_time\` time NULL, \`end_time\` time NULL, \`is_from_local\` tinyint NULL, \`is_synced\` smallint NULL, \`is_deleted\` tinyint NOT NULL DEFAULT '0', \`status\` enum ('running', 'stopped', 'finished', '') NOT NULL DEFAULT '', \`schedule_plan_id\` varchar(255) NULL, PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`_user_tags\` text NULL`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`_comments\` text NULL`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`_assign\` text NULL`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`_liked_by\` text NULL`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`modified_by\` varchar(140) NULL`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`owner\` varchar(140) NULL`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`docstatus\` smallint NOT NULL DEFAULT '0'`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`idx\` bigint NOT NULL DEFAULT '0'`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD \`deleted\` datetime(6) NULL`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` DROP COLUMN \`creation\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` ADD \`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` DROP COLUMN \`modified\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` ADD \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`creation\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`modified\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device\` DROP COLUMN \`creation\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device\` ADD \`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device\` DROP COLUMN \`modified\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device\` ADD \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` CHANGE \`creation\` \`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` CHANGE \`modified\` \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`CREATE UNIQUE INDEX \`IDX_10ebf866c92988aca3a3e94129\` ON \`tabiot_device_telemetry\` (\`device_id\`, \`timestamp\`, \`key_name\`)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule\` ADD CONSTRAINT \`FK_4f3fa51bdcb252c4869ac67c8ae\` FOREIGN KEY (\`schedule_plan_id\`) REFERENCES \`tabiot_schedule_plan\`(\`name\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD CONSTRAINT \`FK_9fc556cd6d9ccfdd305e9f77f25\` FOREIGN KEY (\`device_profile_id\`) REFERENCES \`tabiot_device_profile\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device\` ADD CONSTRAINT \`FK_803f66858054f399391d92e5f98\` FOREIGN KEY (\`device_profile_id\`) REFERENCES \`tabiot_device_profile\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry\` ADD CONSTRAINT \`FK_26704df8a691ecb44c435e87ef9\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry_latest\` ADD CONSTRAINT \`FK_47ac20dfac901a971b28b5d4ea3\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` ADD CONSTRAINT \`FK_d8226ed2510b2417ad5d78edb00\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        });
    }
    down(queryRunner) {
        return __awaiter(this, void 0, void 0, function* () {
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP FOREIGN KEY \`FK_d8226ed2510b2417ad5d78edb00\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry_latest\` DROP FOREIGN KEY \`FK_47ac20dfac901a971b28b5d4ea3\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry\` DROP FOREIGN KEY \`FK_26704df8a691ecb44c435e87ef9\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device\` DROP FOREIGN KEY \`FK_803f66858054f399391d92e5f98\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP FOREIGN KEY \`FK_9fc556cd6d9ccfdd305e9f77f25\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule\` DROP FOREIGN KEY \`FK_4f3fa51bdcb252c4869ac67c8ae\``);
            yield queryRunner.query(`DROP INDEX \`IDX_10ebf866c92988aca3a3e94129\` ON \`tabiot_device_telemetry\``);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` CHANGE \`modified\` \`modified\` datetime(0) NULL DEFAULT CURRENT_TIMESTAMP`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` CHANGE \`creation\` \`creation\` datetime(0) NULL DEFAULT CURRENT_TIMESTAMP`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device\` DROP COLUMN \`modified\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device\` ADD \`modified\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device\` DROP COLUMN \`creation\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device\` ADD \`creation\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`modified\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`modified\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`creation\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`creation\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` DROP COLUMN \`modified\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` ADD \`modified\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` DROP COLUMN \`creation\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_device_profile\` ADD \`creation\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`deleted\``);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`idx\``);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`docstatus\``);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`owner\``);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`modified_by\``);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`_liked_by\``);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`_assign\``);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`_comments\``);
            yield queryRunner.query(`ALTER TABLE \`device_offline_automation_intents\` DROP COLUMN \`_user_tags\``);
            yield queryRunner.query(`DROP TABLE \`tabiot_schedule\``);
            yield queryRunner.query(`DROP TABLE \`tabiot_schedule_plan\``);
        });
    }
}
exports.Migrate1741853107149 = Migrate1741853107149;
