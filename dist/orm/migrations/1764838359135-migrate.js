"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migrate1764838359135 = void 0;
class Migrate1764838359135 {
    constructor() {
        this.name = 'Migrate1764838359135';
    }
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` ADD \`idempotency_key\` varchar(36) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` ADD UNIQUE INDEX \`IDX_e56bde5fbda227d8a7f30182f9\` (\`idempotency_key\`)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_trip_accumulation\` CHANGE \`total_volume_m3\` \`total_volume_m3\` decimal(12,6) NOT NULL COMMENT 'Total accumulated volume in m³' DEFAULT '0.000000'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_trip_accumulation\` CHANGE \`total_volume_tons\` \`total_volume_tons\` decimal(12,6) NOT NULL COMMENT 'Total accumulated volume in tons' DEFAULT '0.000000'`);
        await queryRunner.query(`DROP INDEX \`IDX_ab43fa0de70aaf7dfa27274abb\` ON \`tabiot_oil_profile\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` CHANGE \`machine_type\` \`machine_type\` enum ('BOILER', 'MAIN_ENGINE', 'GENERATOR_HFO', 'GENERATOR_DO') NOT NULL COMMENT 'Machine type: BOILER (fs01), MAIN_ENGINE (fs02-fs03), GENERATOR_HFO (fs03-fs04), GENERATOR_DO (fs05-fs06)'`);
        await queryRunner.query(`DROP INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` CHANGE \`status\` \`status\` enum ('pending', 'retrying', 'failed', 'permanently_failed', 'success') NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`CREATE INDEX \`IDX_ab43fa0de70aaf7dfa27274abb\` ON \`tabiot_oil_profile\` (\`device_id\`, \`machine_type\`, \`is_active\`)`);
        await queryRunner.query(`CREATE INDEX \`idx_idempotency_key\` ON \`tabiot_thingsboard_telemetry_queue\` (\`idempotency_key\`)`);
        await queryRunner.query(`CREATE INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\` (\`status\`, \`retry_count\`, \`last_retry_at\`)`);
    }
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`DROP INDEX \`idx_idempotency_key\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`DROP INDEX \`IDX_ab43fa0de70aaf7dfa27274abb\` ON \`tabiot_oil_profile\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` CHANGE \`status\` \`status\` enum ('pending', 'retrying', 'failed', 'success') NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`CREATE INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\` (\`status\`, \`retry_count\`, \`last_retry_at\`)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` CHANGE \`machine_type\` \`machine_type\` enum ('GENERATOR', 'MAIN_ENGINE', 'BOILER') NOT NULL COMMENT 'Machine type: MAIN_ENGINE (fs01-02), GENERATOR (fs03-04), BOILER (fs05-06)'`);
        await queryRunner.query(`CREATE INDEX \`IDX_ab43fa0de70aaf7dfa27274abb\` ON \`tabiot_oil_profile\` (\`device_id\`, \`machine_type\`, \`is_active\`)`);
        await queryRunner.query(`ALTER TABLE \`tabiot_trip_accumulation\` CHANGE \`total_volume_tons\` \`total_volume_tons\` decimal(12,2) NOT NULL COMMENT 'Total accumulated volume in tons' DEFAULT '0.00'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_trip_accumulation\` CHANGE \`total_volume_m3\` \`total_volume_m3\` decimal(12,2) NOT NULL COMMENT 'Total accumulated volume in m³' DEFAULT '0.00'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` DROP INDEX \`IDX_e56bde5fbda227d8a7f30182f9\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` DROP COLUMN \`idempotency_key\``);
    }
}
exports.Migrate1764838359135 = Migrate1764838359135;
