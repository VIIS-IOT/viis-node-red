"use strict";
/**
 * Type definitions for VIIS Auto Microclimate Control Node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransitionPhase = exports.FanControlMode = exports.FanControlState = void 0;
exports.isValidSensorData = isValidSensorData;
exports.isValidDeviceStatus = isValidDeviceStatus;
exports.isValidConfig = isValidConfig;
// Fan control state machine states
var FanControlState;
(function (FanControlState) {
    FanControlState["IDLE"] = "idle";
    FanControlState["ROTATION_ACTIVE"] = "rotation_active";
    FanControlState["THRESHOLD_ACTIVE"] = "threshold_active";
    FanControlState["TRANSITIONING"] = "transitioning";
    FanControlState["ERROR"] = "error";
    FanControlState["EMERGENCY_STOP"] = "emergency_stop";
})(FanControlState || (exports.FanControlState = FanControlState = {}));
// Fan control mode types
var FanControlMode;
(function (FanControlMode) {
    FanControlMode["ROTATION"] = "rotation";
    FanControlMode["THRESHOLD"] = "threshold";
    FanControlMode["DISABLED"] = "disabled";
})(FanControlMode || (exports.FanControlMode = FanControlMode = {}));
// Transition phase types
var TransitionPhase;
(function (TransitionPhase) {
    TransitionPhase["OFF"] = "off";
    TransitionPhase["DELAY"] = "delay";
    TransitionPhase["ON"] = "on";
    TransitionPhase["COMPLETE"] = "complete";
})(TransitionPhase || (exports.TransitionPhase = TransitionPhase = {}));
function isValidSensorData(data) {
    return data && typeof data === 'object' && typeof data.ts === 'number';
}
function isValidDeviceStatus(data) {
    return data && typeof data === 'object' && typeof data.ts === 'number';
}
function isValidConfig(config) {
    return config && typeof config === 'object';
}
