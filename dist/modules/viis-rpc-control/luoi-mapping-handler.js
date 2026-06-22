"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LuoiMappingHandler = void 0;
const logger_1 = require("./utils/logger");
class LuoiMappingHandler {
    constructor(node, modbusService, validationService, mqttService) {
        // Mapping constants
        this.luoiMapping = {
            "luoi_1": { thu: "luoi_1_thu", dai: "luoi_1_dai" },
            "luoi_2": { thu: "luoi_2_thu", dai: "luoi_2_dai" },
            "luoi_3": { thu: "luoi_3_thu", dai: "luoi_3_dai" }
        };
        this.coilPairs = [
            { key1: "luoi_1_thu", key2: "luoi_1_dai" },
            { key1: "luoi_2_thu", key2: "luoi_2_dai" },
            { key1: "luoi_3_thu", key2: "luoi_3_dai" }
        ];
        this.keysToMulByTen = ["set_ph"];
        this.keysToMulBy1000 = ["set_ec"];
        this.node = node;
        this.flowContext = node.context().flow;
        this.globalContext = node.context().global;
        this.modbusService = modbusService;
        this.validationService = validationService;
        this.mqttService = mqttService;
        this.logger = new logger_1.Logger(node, "LUOI-HANDLER");
    }
    /**
     * Process RPC body and handle ONLY luoi mapping logic with actual Modbus write operations
     * Returns true if any luoi parameters were processed
     */
    async processRpcBody(rpcBody) {
        this.logger.debug("Processing RPC body for luoi mapping only");
        this.flowContext.set("rpcBody", rpcBody);
        let hasLuoiMapping = false;
        // Only process luoi_1, luoi_2, luoi_3 parameters
        for (let key in rpcBody) {
            if (!rpcBody.hasOwnProperty(key))
                continue;
            // Only handle luoi mapping - let standard processing handle everything else
            if (this.luoiMapping[key]) {
                let rawValue = rpcBody[key];
                await this.handleLuoiMappingWithModbusWrite(key, rawValue);
                hasLuoiMapping = true;
            }
        }
        return hasLuoiMapping;
    }
    /**
     * Handle luoi mapping with actual Modbus write operations
     */
    async handleLuoiMappingWithModbusWrite(key, rawValue) {
        const mapping = this.luoiMapping[key];
        const thuKey = mapping.thu;
        const daiKey = mapping.dai;
        let thuValue, daiValue;
        switch (rawValue) {
            case 0:
                thuValue = 1;
                daiValue = 0;
                break;
            case 1:
                thuValue = 0;
                daiValue = 1;
                break;
            case 2:
                // N/A — không tác động coil
                return;
            default:
                this.logger.warn(`Giá trị không hợp lệ cho ${key}: ${rawValue}`);
                return;
        }
        try {
            const thuMapping = this.modbusService.findModbusMapping(thuKey);
            const daiMapping = this.modbusService.findModbusMapping(daiKey);
            if (!thuMapping || thuMapping.address === undefined) {
                throw new Error(`Missing Modbus mapping for ${thuKey}`);
            }
            if (!daiMapping || daiMapping.address === undefined) {
                throw new Error(`Missing Modbus mapping for ${daiKey}`);
            }
            // Write thu coil
            await this.writeToModbusAndPublish(thuKey, thuMapping, thuValue);
            // Write dai coil
            await this.writeToModbusAndPublish(daiKey, daiMapping, daiValue);
            this.logger.log(`Successfully processed luoi mapping: ${key}=${rawValue} -> ${thuKey}=${thuValue}, ${daiKey}=${daiValue}`);
        }
        catch (error) {
            this.logger.error(`Failed to process luoi mapping ${key}: ${error.message}`);
            throw error;
        }
    }
    /**
     * Write to Modbus and publish result
     */
    async writeToModbusAndPublish(key, mapping, value) {
        try {
            const writeMapping = Object.assign(Object.assign({}, mapping), { fc: 5, value: value });
            // Validate and convert value
            const validatedValue = this.validationService.validateAndConvertValue(key, value);
            // Write to Modbus
            this.logger.debug(`Writing to Modbus: key=${key}, address=${writeMapping.address}, value=${validatedValue}, fc=${writeMapping.fc}`);
            await this.modbusService.writeToModbus(key, writeMapping, validatedValue);
            // Read back the value to confirm
            const readValue = await this.modbusService.readFromModbus(key, writeMapping);
            // Publish the result
            this.mqttService.publishResult(key, readValue);
            this.logger.debug(`Successfully processed parameter: ${key}=${readValue}`);
        }
        catch (error) {
            this.logger.error(`Failed to write and publish ${key}: ${error.message}`);
            throw error;
        }
    }
    /**
     * Apply scaling to values
     */
    applyScaling(key, rawValue) {
        if (this.keysToMulByTen.includes(key) && typeof rawValue === 'number') {
            return rawValue * 10;
        }
        if (this.keysToMulBy1000.includes(key) && typeof rawValue === 'number') {
            return rawValue * 1000;
        }
        return rawValue;
    }
    /**
     * Handle coil mapping with validation
     */
    handleCoilMapping(key, rawValue, modbusCoils, coilRegisterData) {
        // Validate coil pairs
        for (let pair of this.coilPairs) {
            if (key === pair.key1 || key === pair.key2) {
                const otherKey = (key === pair.key1) ? pair.key2 : pair.key1;
                const currentOtherValue = coilRegisterData[otherKey] || false;
                if (rawValue && currentOtherValue) {
                    this.node.warn(`Không thể bật ${key} khi ${otherKey} đang bật`);
                    return null;
                }
            }
        }
        return {
            address: modbusCoils[key],
            value: rawValue ? 1 : 0,
            fc: 5
        };
    }
}
exports.LuoiMappingHandler = LuoiMappingHandler;
