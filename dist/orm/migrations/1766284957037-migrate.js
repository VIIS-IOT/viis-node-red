"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migrate1766284957037 = void 0;
class Migrate1766284957037 {
    constructor() {
        this.name = 'Migrate1766284957037';
    }
    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` CHANGE \`status\` \`status\` enum ('pending', 'retrying', 'failed', 'permanently_failed', 'success') NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`CREATE INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\` (\`status\`, \`retry_count\`, \`last_retry_at\`)`);
    }
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` CHANGE \`status\` \`status\` enum ('pending', 'retrying', 'failed', 'success') NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`CREATE INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\` (\`status\`, \`retry_count\`, \`last_retry_at\`)`);
    }
}
exports.Migrate1766284957037 = Migrate1766284957037;
