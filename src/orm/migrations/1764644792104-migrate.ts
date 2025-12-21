import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1764644792104 implements MigrationInterface {
    name = 'Migrate1764644792104'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` ADD UNIQUE INDEX \`IDX_e56bde5fbda227d8a7f30182f9\` (\`idempotency_key\`)`);
        await queryRunner.query(`CREATE INDEX \`idx_idempotency_key\` ON \`tabiot_thingsboard_telemetry_queue\` (\`idempotency_key\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`idx_idempotency_key\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_thingsboard_telemetry_queue\` DROP INDEX \`IDX_e56bde5fbda227d8a7f30182f9\``);
    }

}
