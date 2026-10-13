"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceIntentService = void 0;
const intentValue_1 = require("./intentValue");
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
    async getIntentPredicateResult(node, interval_windown_secs) {
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
            // The populated predicate column decides how the value is read
            // (see ./intentValue.ts); data_type only breaks a multi-column tie.
            return (0, intentValue_1.compareIntentPredicate)(latestDeviceData.value, node, fnc.data_type);
        }
        catch (error) {
            throw error;
        }
    }
    async traverseConditions(conds, interval, results) {
        console.log("conds", conds);
        for (const cond of conds) {
            if (cond.predicate) {
                const result = await this.getIntentPredicateResult(cond.predicate, interval);
                results.push({
                    id: cond.id,
                    predicateResult: result,
                });
            }
            if (cond.conditions && cond.conditions.length > 0) {
                await this.traverseConditions(cond.conditions, interval, results);
            }
        }
    }
    async processConditions(conditions, interval) {
        const result = [];
        for (const condition of conditions) {
            const processedCondition = {
                id: condition.id,
                type: condition.type,
                connecter: condition.connecter,
            };
            if (condition.type === "SINGLE" && condition.predicate) {
                const predicateResult = await this.getIntentPredicateResult(condition.predicate, interval);
                processedCondition.predicate = predicateResult;
            }
            if (condition.conditions && condition.conditions.length > 0) {
                processedCondition.conditions = await this.processConditions(condition.conditions, interval);
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
    }
    async processDeviceIntent(intent) {
        try {
            const resultsCondion = await this.processConditions(intent.conditions, intent.interval_windown);
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
    }
    /**
     * The set-state commands a fired intent sends. The value comes from the populated action
     * column (see ./intentValue.ts). An action without a usable value is dropped, and so is one
     * the device already reports.
     */
    getDeviceActionsToSend(intent) {
        var _a;
        const actions = [];
        for (const action of intent.device_actions) {
            const dataType = (_a = action.function) === null || _a === void 0 ? void 0 : _a.data_type;
            const value = (0, intentValue_1.resolveIntentActionValue)(action, dataType);
            if (value === undefined)
                continue;
            const key = action.function.identifier;
            const current = this.getLatestDeviceKeyValueData(action.device_id, key);
            if (current && (0, intentValue_1.intentActionAlreadyApplied)(current.value, action, dataType)) {
                continue;
            }
            actions.push({ device_id: action.device_id, key, value });
        }
        return actions;
    }
    async processDeviceIntents() {
        try {
            const results = [];
            const activeIntents = this.intents.filter((d) => d.enable && d.type === "OFFLINE");
            for (const intent of activeIntents) {
                const result = await this.processDeviceIntent(intent);
                if (result) {
                    results.push({
                        id: intent.id,
                        schedule_plan_actions: intent.schedule_plan_actions,
                        device_actions: this.getDeviceActionsToSend(intent),
                    });
                }
            }
            return results;
        }
        catch (error) {
            throw error;
        }
    }
}
exports.DeviceIntentService = DeviceIntentService;
