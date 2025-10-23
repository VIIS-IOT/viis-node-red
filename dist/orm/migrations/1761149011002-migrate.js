"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migrate1761149011002 = void 0;
class Migrate1761149011002 {
    constructor() {
        this.name = 'Migrate1761149011002';
    }
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE \`tabiot_oil_profile\` (\`creation\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6), \`modified\` datetime(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`_user_tags\` text NULL, \`_comments\` text NULL, \`_assign\` text NULL, \`_liked_by\` text NULL, \`modified_by\` varchar(140) NULL, \`owner\` varchar(140) NULL, \`docstatus\` smallint NOT NULL DEFAULT '0', \`idx\` bigint NOT NULL DEFAULT '0', \`deleted\` datetime(6) NULL, \`name\` varchar(255) NOT NULL, \`device_id\` varchar(255) NOT NULL, \`machine_type\` enum ('GENERATOR', 'MAIN_ENGINE', 'BOILER') NOT NULL COMMENT 'Machine type: GENERATOR (fs01-02), MAIN_ENGINE (fs03-04), BOILER (fs05-06)', \`oil_type\` enum ('DO', 'FO') NOT NULL COMMENT 'Oil type: DO (Diesel Oil), FO (Fuel Oil)', \`operating_temperature\` float NOT NULL COMMENT 'Operating temperature in Celsius', \`density\` float NOT NULL COMMENT 'Density in kg/m³ (SI unit)', \`label\` varchar(255) NULL, \`is_active\` tinyint NOT NULL COMMENT '1 if this is the active profile for the device' DEFAULT '0', \`description\` text NULL, \`deleted_at\` datetime NULL COMMENT 'Soft delete timestamp - profile is hidden but data preserved', INDEX \`IDX_ab43fa0de70aaf7dfa27274abb\` (\`device_id\`, \`machine_type\`, \`is_active\`), PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`tabiot_trip_accumulation\` (\`id\` int NOT NULL AUTO_INCREMENT, \`trip_id\` varchar(36) NOT NULL, \`device_id\` varchar(36) NOT NULL, \`sensor_key\` varchar(20) NOT NULL COMMENT 'fs01, fs02, fs03, fs04, fs05, fs06', \`total_volume_m3\` decimal(12,2) NOT NULL COMMENT 'Total accumulated volume in m³' DEFAULT '0.00', \`total_volume_tons\` decimal(12,2) NOT NULL COMMENT 'Total accumulated volume in tons' DEFAULT '0.00', \`oil_profile_id\` varchar(50) NULL, \`current_density\` decimal(8,2) NULL COMMENT 'Current density in kg/m³', \`last_update_time\` bigint NULL COMMENT 'Last update timestamp in milliseconds', \`sample_count\` int NOT NULL COMMENT 'Number of samples accumulated' DEFAULT '0', \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX \`IDX_f873f3618a91e280ed900364f8\` (\`device_id\`), INDEX \`IDX_b02dde4c4b596147fa13ea4ad1\` (\`trip_id\`), UNIQUE INDEX \`unique_trip_sensor\` (\`trip_id\`, \`sensor_key\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`tabiot_trip\` (\`id\` varchar(36) NOT NULL, \`device_id\` varchar(36) NOT NULL, \`trip_name\` varchar(100) NULL, \`start_time\` bigint NOT NULL COMMENT 'Unix timestamp in milliseconds', \`end_time\` bigint NULL COMMENT 'Unix timestamp in milliseconds', \`status\` enum ('ACTIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE', \`notes\` text NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp NULL, INDEX \`IDX_66e186e7803aa3ba951416a15d\` (\`device_id\`, \`status\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`tabiot_flow_accumulation\` (\`id\` int NOT NULL AUTO_INCREMENT, \`device_id\` varchar(255) NOT NULL, \`sensor_key\` varchar(255) NOT NULL COMMENT 'Sensor key: fs01, fs02, fs03, fs04, fs05, fs06', \`hour_start\` datetime NOT NULL COMMENT 'Hour start timestamp (e.g., 2025-01-01 00:00:00)', \`hour_end\` datetime NOT NULL COMMENT 'Hour end timestamp (e.g., 2025-01-01 01:00:00)', \`avg_flow_m3h\` float NOT NULL COMMENT 'Average flow rate in m3/h during this hour', \`accumulated_m3\` float NOT NULL COMMENT 'Accumulated volume in m3 for this hour', \`accumulated_tons\` float NOT NULL COMMENT 'Accumulated volume in tons for this hour (m3 * density)', \`oil_profile_id\` varchar(255) NOT NULL COMMENT 'Oil profile ID used for this calculation', \`density_used\` float NOT NULL COMMENT 'Density value in kg/m³ used for tons calculation (snapshot from profile)', \`sample_count\` int NOT NULL COMMENT 'Number of telemetry samples used in this hour calculation', \`first_sample_ts\` bigint NOT NULL COMMENT 'Timestamp of first sample in this hour (ms)', \`last_sample_ts\` bigint NOT NULL COMMENT 'Timestamp of last sample in this hour (ms)', \`created_at\` datetime NOT NULL COMMENT 'When this record was created' DEFAULT CURRENT_TIMESTAMP, INDEX \`IDX_22d0d5be04c56c7f4cc531ebdf\` (\`sensor_key\`, \`hour_start\`), INDEX \`IDX_a95896aa88bf37112d3a4698f1\` (\`device_id\`, \`hour_start\`), UNIQUE INDEX \`IDX_6d5c6872ca42a941cc0ff5fbfa\` (\`device_id\`, \`sensor_key\`, \`hour_start\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`tabiot_thingsboard_telemetry_queue\` (\`id\` int NOT NULL AUTO_INCREMENT, \`device_id\` varchar(255) NOT NULL, \`device_token\` varchar(255) NOT NULL, \`payload\` json NOT NULL, \`timestamp\` bigint NOT NULL, \`retry_count\` int NOT NULL DEFAULT '0', \`max_retries\` int NOT NULL DEFAULT '3', \`status\` enum ('pending', 'retrying', 'failed', 'success') NOT NULL DEFAULT 'pending', \`last_error\` text NULL, \`last_retry_at\` bigint NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_device_id\` (\`device_id\`), INDEX \`idx_status\` (\`status\`), INDEX \`idx_retry\` (\`status\`, \`retry_count\`, \`last_retry_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`data_permission2\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` DROP COLUMN \`rw_permission\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry_latest\` ADD \`oil_profile_id\` varchar(255) NULL COMMENT 'Oil profile ID at time of last reading'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry_latest\` ADD \`density_snapshot\` float NULL COMMENT 'Density snapshot at time of last reading'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry\` ADD \`oil_profile_id\` varchar(255) NULL COMMENT 'Oil profile ID at time of reading (for Marine IoT)'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry\` ADD \`density_snapshot\` float NULL COMMENT 'Density snapshot at time of reading (for flow conversion)'`);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` ADD CONSTRAINT \`FK_5b648bbfb5cd7dd8cbba3e5d706\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_flow_accumulation\` ADD CONSTRAINT \`FK_b3036faad250c068295e44f6d06\` FOREIGN KEY (\`device_id\`) REFERENCES \`tabiot_device\`(\`name\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tabiot_flow_accumulation\` ADD CONSTRAINT \`FK_66ff2c3e68d0ebde3adbd24f38e\` FOREIGN KEY (\`oil_profile_id\`) REFERENCES \`tabiot_oil_profile\`(\`name\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE \`tabiot_flow_accumulation\` DROP FOREIGN KEY \`FK_66ff2c3e68d0ebde3adbd24f38e\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_flow_accumulation\` DROP FOREIGN KEY \`FK_b3036faad250c068295e44f6d06\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_oil_profile\` DROP FOREIGN KEY \`FK_5b648bbfb5cd7dd8cbba3e5d706\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry\` DROP COLUMN \`density_snapshot\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry\` DROP COLUMN \`oil_profile_id\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry_latest\` DROP COLUMN \`density_snapshot\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_device_telemetry_latest\` DROP COLUMN \`oil_profile_id\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`rw_permission\` varchar(50) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_production_function\` ADD \`data_permission2\` varchar(50) NULL`);
        await queryRunner.query(`DROP INDEX \`idx_retry\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`DROP INDEX \`idx_status\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`DROP INDEX \`idx_device_id\` ON \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`DROP TABLE \`tabiot_thingsboard_telemetry_queue\``);
        await queryRunner.query(`DROP INDEX \`IDX_6d5c6872ca42a941cc0ff5fbfa\` ON \`tabiot_flow_accumulation\``);
        await queryRunner.query(`DROP INDEX \`IDX_a95896aa88bf37112d3a4698f1\` ON \`tabiot_flow_accumulation\``);
        await queryRunner.query(`DROP INDEX \`IDX_22d0d5be04c56c7f4cc531ebdf\` ON \`tabiot_flow_accumulation\``);
        await queryRunner.query(`DROP TABLE \`tabiot_flow_accumulation\``);
        await queryRunner.query(`DROP INDEX \`IDX_66e186e7803aa3ba951416a15d\` ON \`tabiot_trip\``);
        await queryRunner.query(`DROP TABLE \`tabiot_trip\``);
        await queryRunner.query(`DROP INDEX \`unique_trip_sensor\` ON \`tabiot_trip_accumulation\``);
        await queryRunner.query(`DROP INDEX \`IDX_b02dde4c4b596147fa13ea4ad1\` ON \`tabiot_trip_accumulation\``);
        await queryRunner.query(`DROP INDEX \`IDX_f873f3618a91e280ed900364f8\` ON \`tabiot_trip_accumulation\``);
        await queryRunner.query(`DROP TABLE \`tabiot_trip_accumulation\``);
        await queryRunner.query(`DROP INDEX \`IDX_ab43fa0de70aaf7dfa27274abb\` ON \`tabiot_oil_profile\``);
        await queryRunner.query(`DROP TABLE \`tabiot_oil_profile\``);
    }
}
exports.Migrate1761149011002 = Migrate1761149011002;
