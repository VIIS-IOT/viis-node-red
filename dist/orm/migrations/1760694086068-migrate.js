"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migrate1760694086068 = void 0;
class Migrate1760694086068 {
    constructor() {
        this.name = 'Migrate1760694086068';
    }
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE \`tabiot_notification\` CHANGE \`metadata\` \`metadata\` text NULL`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE \`tabiot_notification\` CHANGE \`metadata\` \`metadata\` text NULL COMMENT 'JSON metadata for error tracking (occurrence_count, etc.)'`);
    }
}
exports.Migrate1760694086068 = Migrate1760694086068;
