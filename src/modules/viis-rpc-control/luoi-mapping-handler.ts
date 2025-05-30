import { Node } from "node-red";

interface ModbusMessage {
    payload: {
        value: number;
        fc: number;
        unitid: number;
        address: number;
        quantity: number;
    };
}

interface ModbusRequest {
    address: number;
    quantity: number;
    unitid: number;
    fc: number;
    value: number;
}

interface LuoiMappingResult {
    messages: ModbusMessage[];
    modbusRequest?: ModbusRequest;
    shouldContinue: boolean;
}

interface StandardMappingResult {
    payload: {
        value: number;
        fc: number;
        unitid: number;
        address: number;
        quantity: number;
    };
    modbusRequest: ModbusRequest;
}

export class LuoiMappingHandler {
    private node: Node;
    private flowContext: any;
    private globalContext: any;

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

    constructor(node: Node) {
        this.node = node;
        this.flowContext = node.context().flow;
        this.globalContext = node.context().global;
    }

    /**
     * Process RPC body and handle luoi mapping logic
     */
    public processRpcBody(rpcBody: Record<string, any>): LuoiMappingResult | StandardMappingResult | null {
        this.flowContext.set("rpcBody", rpcBody);

        const modbusHoldingRegisters = this.globalContext.get("modbusHoldingRegisters") || {};
        const modbusInputRegisters = this.globalContext.get("modbusInputRegisters") || {};
        const modbusCoils = this.globalContext.get("modbusCoils") || {};
        const coilRegisterData = this.globalContext.get("coilRegisterData") || {};

        let messages: ModbusMessage[] = [];
        let address: number | undefined;
        let value: number | undefined;
        let fc: number | undefined;

        for (let key in rpcBody) {
            if (!rpcBody.hasOwnProperty(key)) continue;

            let rawValue = rpcBody[key];

            // Xử lý đặc biệt cho luoi_1, luoi_2, luoi_3
            if (this.luoiMapping[key as keyof typeof this.luoiMapping]) {
                const luoiResult = this.handleLuoiMapping(key, rawValue, modbusCoils);
                if (luoiResult === null) return null;
                
                messages.push(...luoiResult);
                continue; // Bỏ qua xử lý tiếp theo cho key này
            }

            // Xử lý scaling
            rawValue = this.applyScaling(key, rawValue);

            // Xử lý coils với validation
            if (modbusCoils.hasOwnProperty(key)) {
                const coilResult = this.handleCoilMapping(key, rawValue, modbusCoils, coilRegisterData);
                if (coilResult === null) return null;
                
                address = coilResult.address;
                value = coilResult.value;
                fc = coilResult.fc;
                break;
            }
            // Xử lý holding registers
            else if (modbusHoldingRegisters.hasOwnProperty(key)) {
                address = modbusHoldingRegisters[key];
                value = rawValue;
                fc = 6;
                break;
            }
            // Xử lý input registers
            else if (modbusInputRegisters.hasOwnProperty(key)) {
                address = modbusInputRegisters[key];
                value = rawValue;
                fc = 4;
                break;
            }
        }

        // Xử lý output cho trường hợp luoi
        if (messages.length > 0) {
            return this.handleLuoiOutput(messages);
        }

        // Xử lý output cho trường hợp standard
        if (address === undefined || value === undefined || fc === undefined) {
            return null;
        }

        return this.handleStandardOutput(address, value, fc);
    }

    /**
     * Handle luoi mapping logic
     */
    private handleLuoiMapping(key: string, rawValue: any, modbusCoils: Record<string, number>): ModbusMessage[] | null {
        const mapping = this.luoiMapping[key as keyof typeof this.luoiMapping];
        const thuKey = mapping.thu;
        const daiKey = mapping.dai;
        let thuValue: number, daiValue: number;

        switch(rawValue) {
            case 0:
                thuValue = 1;
                daiValue = 0;
                break;
            case 1:
                thuValue = 0;
                daiValue = 1;
                break;
            default:
                this.node.warn(`Giá trị không hợp lệ cho ${key}: ${rawValue}`);
                return null;
        }

        const messages: ModbusMessage[] = [];

        // Tạo message cho thu
        messages.push({
            payload: {
                'value': thuValue,
                'fc': 5,
                'unitid': 1,
                'address': modbusCoils[thuKey],
                'quantity': 1
            }
        });

        // Tạo message cho dai
        messages.push({
            payload: {
                'value': daiValue,
                'fc': 5,
                'unitid': 1,
                'address': modbusCoils[daiKey],
                'quantity': 1
            }
        });

        return messages;
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

    /**
     * Handle luoi output
     */
    private handleLuoiOutput(messages: ModbusMessage[]): LuoiMappingResult {
        messages.forEach(msg => {
            let readFc = 1; // Read Coils
            this.flowContext.set('modbusRequest', {
                'address': msg.payload.address,
                'quantity': 1,
                'unitid': 1,
                'fc': readFc,
                'value': msg.payload.value,
            });
        });

        return {
            messages,
            shouldContinue: false
        };
    }

    /**
     * Handle standard output
     */
    private handleStandardOutput(address: number, value: number, fc: number): StandardMappingResult {
        let readFc: number;
        if (fc === 6) {
            readFc = 3;
        } else if (fc === 5) {
            readFc = 1;
        } else if (fc === 4) {
            readFc = 4;
        } else {
            readFc = fc;
        }

        const modbusRequest: ModbusRequest = {
            'address': address,
            'quantity': 1,
            'unitid': 1,
            'fc': readFc,
            'value': value,
        };

        this.flowContext.set('modbusRequest', modbusRequest);

        return {
            payload: {
                'value': value,
                'fc': fc,
                'unitid': 1,
                'address': address,
                'quantity': 1
            },
            modbusRequest
        };
    }
}
