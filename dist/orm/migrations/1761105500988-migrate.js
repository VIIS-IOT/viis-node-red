"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migrate1761105500988 = void 0;
class Migrate1761105500988 {
    constructor() {
        this.name = 'Migrate1761105500988';
    }
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` ADD \`deleted_at\` datetime NULL COMMENT 'Soft delete timestamp - profile is hidden but data preserved'`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` DROP COLUMN \`deleted_at\``);
    }
}
exports.Migrate1761105500988 = Migrate1761105500988;
