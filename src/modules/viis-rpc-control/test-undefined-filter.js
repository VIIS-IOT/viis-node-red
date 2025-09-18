/**
 * Test script để kiểm tra logic filter undefined parameters
 * Chạy script này để test xem các tham số có giá trị "undefined" có bị loại bỏ không
 */

// Simulate the filterUndefinedParams function
function filterUndefinedParams(params) {
    const filteredParams = {};
    const filteredKeys = [];
    
    for (const [key, value] of Object.entries(params)) {
        // Filter out "undefined" string values and actual undefined values
        if (value === "undefined" || value === undefined) {
            filteredKeys.push(key);
            continue;
        }
        filteredParams[key] = value;
    }
    
    if (filteredKeys.length > 0) {
        console.log(`Filtered out parameters with undefined values: ${filteredKeys.join(", ")}`);
    }
    
    return filteredParams;
}

// Test case 1: RPC message với một số tham số undefined
const testCase1 = {
    "method": "set_state",
    "params": {
        "env_enum": "MT06",
        "COIL_AUTO_TRON": true,
        "HOLDING_SETML_BOM_1": 400,
        "HOLDING_SETML_BOM_2": 1000,
        "HOLDING_SETML_BOM_3": 100,
        "HOLDING_SETML_BOM_4": 0,
        "HOLDING_SETML_BOM_5": 40,
        "HOLDING_SETML_BOM_6": 40,
        "HOLDING_SETML_BOM_7": 40,
        "HOLDING_SETML_BOM_8": 40,
        "HOLDING_SETML_BOM_9": 6,
        "HOLDING_SETML_BOM_10": 4,
        "HOLDING_SETML_BOM_11": 2,
        "HOLDING_SETML_BOM_12": "undefined",
        "HOLDING_SETML_BOM_13": "undefined",
        "HOLDING_SETML_BOM_14": "undefined",
        "HOLDING_SETML_BOM_15": "undefined",
        "HOLDING_SETML_BOM_16": "undefined",
        "HOLDING_THOI_GIAN_TRON_TOI_DA": 1500,
        "HOLDING_LUU_LUONG_DOSING_TOI_DA": 20,
        "HOLDING_THOI_GIAN_BAT_VAN_NUOC_VAO_TOI_DA": 500,
        "schedule_id": "21c6d14bfbc35218"
    },
    "timeout": 10000
};

// Test case 2: Tất cả tham số đều undefined
const testCase2 = {
    "method": "set_state",
    "params": {
        "HOLDING_SETML_BOM_12": "undefined",
        "HOLDING_SETML_BOM_13": "undefined",
        "HOLDING_SETML_BOM_14": undefined,
        "HOLDING_SETML_BOM_15": "undefined"
    },
    "timeout": 10000
};

// Test case 3: Không có tham số undefined
const testCase3 = {
    "method": "set_state",
    "params": {
        "COIL_AUTO_TRON": true,
        "HOLDING_SETML_BOM_1": 400,
        "HOLDING_SETML_BOM_2": 1000,
        "schedule_id": "21c6d14bfbc35218"
    },
    "timeout": 10000
};

console.log("=== TEST CASE 1: Mixed valid and undefined parameters ===");
console.log("Original params:", Object.keys(testCase1.params));
const filtered1 = filterUndefinedParams(testCase1.params);
console.log("Filtered params:", Object.keys(filtered1));
console.log("Filtered result:", filtered1);
console.log("");

console.log("=== TEST CASE 2: All parameters undefined ===");
console.log("Original params:", Object.keys(testCase2.params));
const filtered2 = filterUndefinedParams(testCase2.params);
console.log("Filtered params:", Object.keys(filtered2));
console.log("Should be empty object:", Object.keys(filtered2).length === 0);
console.log("");

console.log("=== TEST CASE 3: No undefined parameters ===");
console.log("Original params:", Object.keys(testCase3.params));
const filtered3 = filterUndefinedParams(testCase3.params);
console.log("Filtered params:", Object.keys(filtered3));
console.log("Should be same as original:", Object.keys(filtered3).length === Object.keys(testCase3.params).length);
console.log("");

console.log("=== SUMMARY ===");
console.log(`Test 1 - Original: ${Object.keys(testCase1.params).length} params, Filtered: ${Object.keys(filtered1).length} params`);
console.log(`Test 2 - Original: ${Object.keys(testCase2.params).length} params, Filtered: ${Object.keys(filtered2).length} params`);
console.log(`Test 3 - Original: ${Object.keys(testCase3.params).length} params, Filtered: ${Object.keys(filtered3).length} params`);