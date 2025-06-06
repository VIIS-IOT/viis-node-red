"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migrate1749196519625 = void 0;
class Migrate1749196519625 {
    constructor() {
        this.name = 'Migrate1749196519625';
    }
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`customer_user\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD CONSTRAINT \`FK_615b2e7ef1d8e04d0a8f30be73a\` FOREIGN KEY (\`customer_user\`) REFERENCES \`tabiot_customer_user\`(\`name\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP FOREIGN KEY \`FK_615b2e7ef1d8e04d0a8f30be73a\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`customer_user\``);
    }
}
exports.Migrate1749196519625 = Migrate1749196519625;
