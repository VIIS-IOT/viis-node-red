import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1766284957037 implements MigrationInterface {
    name = 'Migrate1766284957037'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` CHANGE \`status\` \`status\` enum ('pending', 'retrying', 'failed', 'permanently_failed', 'success') NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`CREATE INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\` (\`status\`, \`retry_count\`, \`last_retry_at\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` CHANGE \`status\` \`status\` enum ('pending', 'retrying', 'failed', 'success') NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`CREATE INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\` (\`status\`, \`retry_count\`, \`last_retry_at\`)`);
    }

}
