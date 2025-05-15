// import { MigrationInterface, QueryRunner } from "typeorm";

// export class CreateTelemetryTrigger1681705523000 implements MigrationInterface {
//     public async up(queryRunner: QueryRunner): Promise<void> {
//         await queryRunner.query(`
//             CREATE TRIGGER IF NOT EXISTS after_telemetry_insert
//             AFTER INSERT ON tabiot_device_telemetry
//             FOR EACH ROW
//             BEGIN
//                 INSERT INTO tabiot_device_telemetry_latest (
//                     device_id, 
//                     key_name, 
//                     timestamp, 
//                     boolean_value, 
//                     int_value, 
//                     float_value, 
//                     string_value
//                 )
//                 VALUES (
//                     NEW.device_id, 
//                     NEW.key_name, 
//                     NEW.timestamp, 
//                     NEW.boolean_value, 
//                     NEW.int_value, 
//                     NEW.float_value, 
//                     NEW.string_value
//                 )
//                 ON DUPLICATE KEY UPDATE
//                     timestamp = NEW.timestamp,
//                     boolean_value = NEW.boolean_value,
//                     int_value = NEW.int_value,
//                     float_value = NEW.float_value,
//                     string_value = NEW.string_value;
//             END;
//         `);
//     }

//     public async down(queryRunner: QueryRunner): Promise<void> {
//         await queryRunner.query(`DROP TRIGGER IF EXISTS after_telemetry_insert`);
//     }
// }
