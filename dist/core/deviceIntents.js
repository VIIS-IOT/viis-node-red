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
exports.DeviceIntentService = void 0;
class DeviceIntentService {
    constructor(intents, devicesData) {
        this.intents = intents;
        this.devicesData = devicesData;
    }
    getLatestDeviceKeyValueData(device_id, identifier) {
        const deviceData = this.devicesData.find((d) => d.device_id === device_id);
        if (!deviceData)
            return null;
        const keyData = deviceData.latest_data.find((d) => d.key === identifier);
        return keyData;
    }
    getIntentPredicateResult(node, interval_windown_secs) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const latestDeviceData = this.getLatestDeviceKeyValueData(node.device_id, node.identifier);
                if (!latestDeviceData)
                    return false;
                //Ignore ts check
                // if (
                //   dayjs().valueOf() - latestDeviceData?.ts >
                //   interval_windown_secs * 1000
                // )
                //   return false;
                const fnc = node.function;
                if (!fnc)
                    return false;
                const value = latestDeviceData.value;
                switch (node.operation) {
                    case "!=":
                        if (fnc.data_type === "Bool") {
                            return Boolean(value) !== Boolean(node.bool_v);
                        }
                        else if (["Value", "Accumulate", "Raw", "Enum"].includes(fnc.data_type || "")) {
                            return Number(value) !== Number(node.dbl_v);
                        }
                        else {
                            return String(value) !== String(node.str_v);
                        }
                    case "<":
                        if (fnc.data_type === "Bool") {
                            return Boolean(value) < Boolean(node.bool_v);
                        }
                        else if (["Value", "Accumulate", "Raw", "Enum"].includes(fnc.data_type || "")) {
                            return Number(value) < Number(node.dbl_v);
                        }
                        else {
                            return String(value) < String(node.str_v);
                        }
                    case "=":
                        if (fnc.data_type === "Bool") {
                            return Boolean(value) == Boolean(node.bool_v);
                        }
                        else if (["Value", "Accumulate", "Raw", "Enum"].includes(fnc.data_type || "")) {
                            return Number(value) == Number(node.dbl_v);
                        }
                        else {
                            return String(value) == String(node.str_v);
                        }
                    case "<=":
                        if (fnc.data_type === "Bool") {
                            return Boolean(value) <= Boolean(node.bool_v);
                        }
                        else if (["Value", "Accumulate", "Raw", "Enum"].includes(fnc.data_type || "")) {
                            return Number(value) <= Number(node.dbl_v);
                        }
                        else {
                            return String(value) <= String(node.str_v);
                        }
                    case ">":
                        if (fnc.data_type === "Bool") {
                            return Boolean(value) > Boolean(node.bool_v);
                        }
                        else if (["Value", "Accumulate", "Raw", "Enum"].includes(fnc.data_type || "")) {
                            return Number(value) > Number(node.dbl_v);
                        }
                        else {
                            return String(value) > String(node.str_v);
                        }
                    case ">=":
                        if (fnc.data_type === "Bool") {
                            return Boolean(value) >= Boolean(node.bool_v);
                        }
                        else if (["Value", "Accumulate", "Raw", "Enum"].includes(fnc.data_type || "")) {
                            return Number(value) >= Number(node.dbl_v);
                        }
                        else {
                            return String(value) >= String(node.str_v);
                        }
                    default:
                        break;
                }
                return false;
            }
            catch (error) {
                throw error;
            }
        });
    }
    traverseConditions(conds, interval, results) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log("conds", conds);
            for (const cond of conds) {
                if (cond.predicate) {
                    const result = yield this.getIntentPredicateResult(cond.predicate, interval);
                    results.push({
                        id: cond.id,
                        predicateResult: result,
                    });
                }
                if (cond.conditions && cond.conditions.length > 0) {
                    this.traverseConditions(cond.conditions, interval, results);
                }
            }
        });
    }
    processConditions(conditions, interval) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = [];
            for (const condition of conditions) {
                const processedCondition = {
                    id: condition.id,
                    type: condition.type,
                    connecter: condition.connecter,
                };
                if (condition.type === "SINGLE" && condition.predicate) {
                    const predicateResult = yield this.getIntentPredicateResult(condition.predicate, interval);
                    processedCondition.predicate = predicateResult;
                }
                if (condition.conditions && condition.conditions.length > 0) {
                    processedCondition.conditions = yield this.processConditions(condition.conditions, interval);
                    // Tính toán predicate của node cha dựa trên connecter và giá trị con
                    if (condition.connecter === "OR") {
                        processedCondition.predicate = processedCondition.conditions.some((child) => child.predicate);
                    }
                    else if (condition.connecter === "AND") {
                        processedCondition.predicate = processedCondition.conditions.every((child) => child.predicate);
                    }
                }
                result.push(processedCondition);
            }
            return result;
        });
    }
    stringifyAllValues(obj) {
        return JSON.parse(JSON.stringify(obj, (key, value) => typeof value === "object" && value !== null ? value : String(value)));
    }
    processDeviceIntent(intent) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const resultsCondion = yield this.processConditions(intent.conditions, intent.interval_windown);
                let predicate = false;
                if (intent.connecter === "OR") {
                    predicate = resultsCondion.some((child) => child.predicate);
                }
                else if (intent.connecter === "AND") {
                    predicate = resultsCondion.every((child) => child.predicate);
                }
                return predicate;
            }
            catch (error) {
                console.log(error);
                throw error;
            }
        });
    }
    processDeviceIntents() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const results = [];
                const activeIntents = this.intents.filter((d) => d.enable && d.type === "OFFLINE");
                for (const intent of activeIntents) {
                    const result = yield this.processDeviceIntent(intent);
                    if (result) {
                        results.push({
                            id: intent.id,
                            schedule_plan_actions: intent.schedule_plan_actions,
                            device_actions: intent.device_actions
                                .map((d) => {
                                let value = undefined;
                                if (d.function.data_type === "Bool") {
                                    value = Boolean(d.bool_v);
                                }
                                else if (["Value", "Accumulate", "Raw", "Enum"].includes(d.function.data_type || "")) {
                                    value = Number(d.dbl_v);
                                }
                                else {
                                    value = String(d.str_v);
                                }
                                return {
                                    device_id: d.device_id,
                                    key: d.function.identifier,
                                    value: value,
                                };
                            })
                                .filter((d) => {
                                const curValue = this.getLatestDeviceKeyValueData(d.device_id, d.key);
                                return curValue ? (curValue === null || curValue === void 0 ? void 0 : curValue.value) !== d.value : true;
                            }),
                        });
                    }
                }
                return results;
            }
            catch (error) {
                return error;
            }
        });
    }
}
exports.DeviceIntentService = DeviceIntentService;
