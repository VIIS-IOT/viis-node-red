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
exports.Migrate1742198990685 = void 0;
class Migrate1742198990685 {
    constructor() {
        this.name = 'Migrate1742198990685';
    }
    up(queryRunner) {
        return __awaiter(this, void 0, void 0, function* () {
            yield queryRunner.query(`DROP INDEX \`fk_schedule_id\` ON \`tabiot_schedule_log\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`_user_tags\` text NULL`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`_comments\` text NULL`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`_assign\` text NULL`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`_liked_by\` text NULL`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`modified_by\` varchar(140) NULL`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`owner\` varchar(140) NULL`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`docstatus\` smallint NOT NULL DEFAULT '0'`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`idx\` bigint NOT NULL DEFAULT '0'`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`deleted\` datetime(6) NULL`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`creation\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`modified\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`start_time\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`start_time\` time NULL`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`end_time\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`end_time\` time NULL`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD CONSTRAINT \`FK_82dbff0216b4f3ef0f543d2c07b\` FOREIGN KEY (\`schedule_id\`) REFERENCES \`tabiot_schedule\`(\`name\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        });
    }
    down(queryRunner) {
        return __awaiter(this, void 0, void 0, function* () {
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP FOREIGN KEY \`FK_82dbff0216b4f3ef0f543d2c07b\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`end_time\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`end_time\` timestamp NULL`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`start_time\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`start_time\` timestamp NULL`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`modified\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`modified\` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`creation\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`creation\` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP`);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`deleted\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`idx\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`docstatus\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`owner\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`modified_by\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`_liked_by\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`_assign\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`_comments\``);
            yield queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`_user_tags\``);
            yield queryRunner.query(`CREATE INDEX \`fk_schedule_id\` ON \`tabiot_schedule_log\` (\`schedule_id\`)`);
        });
    }
}
exports.Migrate1742198990685 = Migrate1742198990685;
