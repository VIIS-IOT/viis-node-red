import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1760928859802 implements MigrationInterface {
    name = 'Migrate1760928859802'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`tabiot_oil_profile\` (\`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6), \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`_user_tags\` text NULL, \`_comments\` text NULL, \`_assign\` text NULL, \`_liked_by\` text NULL, \`modified_by\` varchar(140) NULL, \`owner\` varchar(140) NULL, \`docstatus\` smallint NOT NULL DEFAULT '0', \`idx\` bigint NOT NULL DEFAULT '0', \`deleted\` datetime(6) NULL, \`name\` varchar(255) NOT NULL, \`device_id\` varchar(255) NOT NULL, \`oil_type\` enum ('BO', 'DO') NOT NULL COMMENT 'Oil type: BO (Bunker Oil) or DO (Diesel Oil)', \`operating_temperature\` float NOT NULL COMMENT 'Operating temperature in Celsius', \`density\` float NOT NULL COMMENT 'Density in tons/m3 (or kg/L)', \`label\` varchar(255) NULL, \`is_active\` tinyint NOT NULL COMMENT '1 if this is the active profile for the device' DEFAULT '0', \`description\` text NULL, INDEX \`IDX_dfd0a500bcd8aa0e5c262ca5bf\` (\`device_id\`, \`is_active\`), PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`tabiot_flow_accumulation\` (\`id\` int NOT NULL AUTO_INCREMENT, \`device_id\` varchar(255) NOT NULL, \`sensor_key\` varchar(255) NOT NULL COMMENT 'Sensor key: fs01, fs02, fs03, fs04, fs05, fs06', \`hour_start\` datetime NOT NULL COMMENT 'Hour start timestamp (e.g., 2025-01-01 00:00:00)', \`hour_end\` datetime NOT NULL COMMENT 'Hour end timestamp (e.g., 2025-01-01 01:00:00)', \`avg_flow_m3h\` float NOT NULL COMMENT 'Average flow rate in m3/h during this hour', \`accumulated_m3\` float NOT NULL COMMENT 'Accumulated volume in m3 for this hour', \`accumulated_tons\` float NOT NULL COMMENT 'Accumulated volume in tons for this hour (m3 * density)', \`oil_profile_id\` varchar(255) NOT NULL COMMENT 'Oil profile ID used for this calculation', \`density_used\` float NOT NULL COMMENT 'Density value used for tons calculation (snapshot from profile)', \`sample_count\` int NOT NULL COMMENT 'Number of telemetry samples used in this hour calculation', \`first_sample_ts\` bigint NOT NULL COMMENT 'Timestamp of first sample in this hour (ms)', \`last_sample_ts\` bigint NOT NULL COMMENT 'Timestamp of last sample in this hour (ms)', \`created_at\` datetime NOT NULL COMMENT 'When this record was created' DEFAULT CURRENT_TIMESTAMP, INDEX \`IDX_22d0d5be04c56c7f4cc531ebdf\` (\`sensor_key\`, \`hour_start\`), INDEX \`IDX_a95896aa88bf37112d3a4698f1\` (\`device_id\`, \`hour_start\`), UNIQUE INDEX \`IDX_6d5c6872ca42a941cc0ff5fbfa\` (\`device_id\`, \`sensor_key\`, \`hour_start\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry_latest\` ADD \`oil_profile_id\` varchar(255) NULL COMMENT 'Oil profile ID at time of last reading'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry_latest\` ADD \`density_snapshot\` float NULL COMMENT 'Density snapshot at time of last reading'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry\` ADD \`oil_profile_id\` varchar(255) NULL COMMENT 'Oil profile ID at time of reading (for Marine IoT)'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry\` ADD \`density_snapshot\` float NULL COMMENT 'Density snapshot at time of reading (for flow conversion)'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` ADD CONSTRAINT \`FK_5b648bbfb5cd7dd8cbba3e5d706\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_flow_accumulation\` ADD CONSTRAINT \`FK_b3036faad250c068295e44f6d06\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_flow_accumulation\` ADD CONSTRAINT \`FK_66ff2c3e68d0ebde3adbd24f38e\` FOREIGN KEY (\`oil_profile_id\`) REFERENCES \`tabiot_oil_profile\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_flow_accumulation\` DROP FOREIGN KEY \`FK_66ff2c3e68d0ebde3adbd24f38e\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_flow_accumulation\` DROP FOREIGN KEY \`FK_b3036faad250c068295e44f6d06\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` DROP FOREIGN KEY \`FK_5b648bbfb5cd7dd8cbba3e5d706\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry\` DROP COLUMN \`density_snapshot\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry\` DROP COLUMN \`oil_profile_id\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry_latest\` DROP COLUMN \`density_snapshot\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry_latest\` DROP COLUMN \`oil_profile_id\``);
        await queryRunner.query(`DROP INDEX \`IDX_6d5c6872ca42a941cc0ff5fbfa\` ON \`tabiot_flow_accumulation\``);
        await queryRunner.query(`DROP INDEX \`IDX_a95896aa88bf37112d3a4698f1\` ON \`tabiot_flow_accumulation\``);
        await queryRunner.query(`DROP INDEX \`IDX_22d0d5be04c56c7f4cc531ebdf\` ON \`tabiot_flow_accumulation\``);
        await queryRunner.query(`DROP TABLE \`tabiot_flow_accumulation\``);
        await queryRunner.query(`DROP INDEX \`IDX_dfd0a500bcd8aa0e5c262ca5bf\` ON \`tabiot_oil_profile\``);
        await queryRunner.query(`DROP TABLE \`tabiot_oil_profile\``);
    }

}
