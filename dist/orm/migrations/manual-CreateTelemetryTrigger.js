"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateTelemetryTrigger1681705523000 = void 0;
class CreateTelemetryTrigger1681705523000 {
    up(queryRunner) {
        return __awaiter(this, void 0, void 0, function* () {
            yield queryRunner.query(`
            CREATE TRIGGER IF NOT EXISTS after_telemetry_insert
            AFTER INSERT ON tabiot_device_telemetry
            FOR EACH ROW
            BEGIN
                INSERT INTO tabiot_device_telemetry_latest (
                    device_id, 
                    key_name, 
                    timestamp, 
                    boolean_value, 
                    int_value, 
                    float_value, 
                    string_value
                )
                VALUES (
                    NEW.device_id, 
                    NEW.key_name, 
                    NEW.timestamp, 
                    NEW.boolean_value, 
                    NEW.int_value, 
                    NEW.float_value, 
                    NEW.string_value
                )
                ON DUPLICATE KEY UPDATE
                    timestamp = NEW.timestamp,
                    boolean_value = NEW.boolean_value,
                    int_value = NEW.int_value,
                    float_value = NEW.float_value,
                    string_value = NEW.string_value;
            END;
        `);
        });
    }
    down(queryRunner) {
        return __awaiter(this, void 0, void 0, function* () {
            yield queryRunner.query(`DROP TRIGGER IF EXISTS after_telemetry_insert`);
        });
    }
}
exports.CreateTelemetryTrigger1681705523000 = CreateTelemetryTrigger1681705523000;
