import { Node } from "node-red";
import {
    IModbusService,
    IValidationService,
    IMqttService,
    ModbusMappingResult
} from "./interfaces/types";
import { Logger } from "./utils/logger";



export class LuoiMappingHandler {
    private node: Node;
    private flowContext: any;
    private globalContext: any;
    private modbusService: IModbusService;
    private validationService: IValidationService;
    private mqttService: IMqttService;
    private logger: Logger;

    // Mapping constants
    private readonly luoiMapping = {
        "luoi_1": { thu: "luoi_1_thu", dai: "luoi_1_dai" },
        "luoi_2": { thu: "luoi_2_thu", dai: "luoi_2_dai" },
        "luoi_3": { thu: "luoi_3_thu", dai: "luoi_3_dai" }
    };

    private readonly coilPairs = [
        { key1: "luoi_1_thu", key2: "luoi_1_dai" },
        { key1: "luoi_2_thu", key2: "luoi_2_dai" },
        { key1: "luoi_3_thu", key2: "luoi_3_dai" }
    ];

    private readonly keysToMulByTen = ["set_ph"];
    private readonly keysToMulBy1000 = ["set_ec"];

    constructor(
        node: Node,
        modbusService: IModbusService,
        validationService: IValidationService,
        mqttService: IMqttService
    ) {
        this.node = node;
        this.flowContext = node.context().flow;
        this.globalContext = node.context().global;
        this.modbusService = modbusService;
        this.validationService = validationService;
        this.mqttService = mqttService;
        this.logger = new Logger(node, "LUOI-HANDLER");
    }

    /**
     * Process RPC body and handle ONLY luoi mapping logic with actual Modbus write operations
     * Returns true if any luoi parameters were processed
     */
    public async processRpcBody(rpcBody: Record<string, any>): Promise<boolean> {
        this.logger.debug("Processing RPC body for luoi mapping only");
        this.flowContext.set("rpcBody", rpcBody);
        let hasLuoiMapping = false;

        // Only process luoi_1, luoi_2, luoi_3 parameters
        for (let key in rpcBody) {
            if (!rpcBody.hasOwnProperty(key)) continue;

            // Only handle luoi mapping - let standard processing handle everything else
            if (this.luoiMapping[key as keyof typeof this.luoiMapping]) {
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
    private async handleLuoiMappingWithModbusWrite(key: string, rawValue: any): Promise<void> {
        const mapping = this.luoiMapping[key as keyof typeof this.luoiMapping];
        const thuKey = mapping.thu;
        const daiKey = mapping.dai;
        let thuValue: number, daiValue: number;

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
        } catch (error) {
            this.logger.error(`Failed to process luoi mapping ${key}: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Write to Modbus and publish result
     */
    private async writeToModbusAndPublish(key: string, mapping: ModbusMappingResult, value: number | boolean): Promise<void> {
        try {
            const writeMapping: ModbusMappingResult = {
                ...mapping,
                fc: 5,
                value: value,
            };

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
        } catch (error) {
            this.logger.error(`Failed to write and publish ${key}: ${(error as Error).message}`);
            throw error;
        }
    }



    /**
     * Apply scaling to values
     */
    private applyScaling(key: string, rawValue: any): any {
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
    private handleCoilMapping(
        key: string,
        rawValue: any,
        modbusCoils: Record<string, number>,
        coilRegisterData: Record<string, boolean>
    ): { address: number; value: number; fc: number } | null {
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
