"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migrate1774439085418 = void 0;
class Migrate1774439085418 {
    constructor() {
        this.name = 'Migrate1774439085418';
    }
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`label_multilingual\` json NULL`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`label_multilingual\``);
    }
}
exports.Migrate1774439085418 = Migrate1774439085418;
