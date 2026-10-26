"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALARM_KEY_MAX_LENGTH = void 0;
exports.capAlarmKey = capAlarmKey;
const crypto_1 = require("crypto");
/**
 * Longest `alarm_key` the backend accepts (`AlarmValidator`: 1-120 chars; a longer key is a 400, which marks the
 * outbox row dead). The state-alarm builders (`actuator_write_failed:`, `manual_runtime_exceeded:`,
 * `board_offline:`, `schedule_off_failed:`) build keys from coil, board and schedule names, so they go
 * through here.
 */
exports.ALARM_KEY_MAX_LENGTH = 120;
/**
 * `key` unchanged when it fits; otherwise cut to {@link ALARM_KEY_MAX_LENGTH} with a short hash of the full key
 * as the tail, so two long keys that share their first 111 characters stay two alarms (the backend keeps one
 * active alarm per key).
 */
function capAlarmKey(key) {
    if (key.length <= exports.ALARM_KEY_MAX_LENGTH)
        return key;
    const tail = (0, crypto_1.createHash)("sha1").update(key).digest("hex").slice(0, 8);
    return `${key.slice(0, exports.ALARM_KEY_MAX_LENGTH - tail.length - 1)}~${tail}`;
}
