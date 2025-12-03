"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migrate1764644792104 = void 0;
class Migrate1764644792104 {
    constructor() {
        this.name = 'Migrate1764644792104';
    }
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` ADD UNIQUE INDEX \`IDX_e56bde5fbda227d8a7f30182f9\` (\`idempotency_key\`)`);
        await queryRunner.query(`CREATE INDEX \`idx_idempotency_key\` ON \`tabiot_thingsboard_telemetry_queue\` (\`idempotency_key\`)`);
    }
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX \`idx_idempotency_key\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` DROP INDEX \`IDX_e56bde5fbda227d8a7f30182f9\``);
    }
}
exports.Migrate1764644792104 = Migrate1764644792104;
