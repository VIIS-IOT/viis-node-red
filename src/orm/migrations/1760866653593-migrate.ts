import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1760866653593 implements MigrationInterface {
    name = 'Migrate1760866653593'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`tabiot_thingsboard_telemetry_queue\` (\`id\` int NOT NULL AUTO_INCREMENT, \`device_id\` varchar(255) NOT NULL, \`device_token\` varchar(255) NOT NULL, \`payload\` json NOT NULL, \`timestamp\` bigint NOT NULL, \`retry_count\` int NOT NULL DEFAULT '0', \`max_retries\` int NOT NULL DEFAULT '3', \`status\` enum ('pending', 'retrying', 'failed', 'success') NOT NULL DEFAULT 'pending', \`last_error\` text NULL, \`last_retry_at\` bigint NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_device_id\` (\`device_id\`), INDEX \`idx_status\` (\`status\`), INDEX \`idx_retry\` (\`status\`, \`retry_count\`, \`last_retry_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`id\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`data_permission2\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`rw_permission\``);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`rw_permission\` varchar(50) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`data_permission2\` varchar(50) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`id\` int NULL`);
        await queryRunner.query(`DROP INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`DROP INDEX \`idx_status\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`DROP INDEX \`idx_device_id\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`DROP TABLE \`tabiot_thingsboard_telemetry_queue\``);
    }

}
