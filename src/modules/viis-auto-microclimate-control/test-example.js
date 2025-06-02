/**
 * Test example for VIIS Auto Microclimate Control Node
 * This file demonstrates how to set up test data and verify node functionality
 */

// Example configuration data for global variable configKeyValues
const exampleConfig = {
    // Fan control
    "set_mode_fan": 1,
    "set_auto_mode_fan": 0, // 0 = threshold mode, 1 = rotation mode
    "set_k1_fan": 25,
    "set_k2_fan": 30,
    "set_k3_fan": 35,
    "set_k4_fan": 40,
    "set_gr_alternate_fan": 2,
    "set_time_alternate_fan": 15,

    // Fan dao control
    "set_mode_fan_dao": 1,
    "set_time_alternate_fan_dao": 5,

    // Water pump control
    "set_mode_tuong_nuoc": 1,
    "set_threshold_low_water_bump": 60,
    "set_threshold_high_water_bump": 80,

    // Curtain control
    "set_mode_luoi": 1,
    "set_light_dai_luoi_1": 50000,
    "set_light_thu_luoi_1": 30000,
    "set_tolerance_light_luoi_1": 5,
    "set_light_dai_luoi_2": 50000,
    "set_light_thu_luoi_2": 30000,
    "set_tolerance_light_luoi_2": 5
};

// Example sensor data for global variable holdingRegisterData
const exampleSensorData = {
    "ts": Date.now(),
    "temp_outdoor": 28.5,
    "temp_indoor": 32.0,  // Above K2 threshold (30°C)
    "humi_indoor": 70,    // Between water pump thresholds
    "humi_outdoor": 85,
    "light_indoor": 45000, // Indoor light (not used for curtain control)
    "light_outdoor": 60000 // Outdoor light (used for curtain control - above DAI threshold)
};

// Example device status for global variable coilRegisterData
const exampleDeviceStatus = {
    "ts": Date.now(),
    "quat_1": false,
    "quat_2": false,
    "quat_3": false,
    "quat_4": false,
    "quat_5": false,
    "quat_6": false,
    "quat_dao_1": false,
    "quat_dao_2": false,
    "quat_dao_3": false,
    "bom_nuoc_1": false,
    "lamp_1": false,
    "lamp_2": false,
    "luoi_2_thu": false,
    "luoi_2_dai": false,
    "luoi_1_thu": false,
    "luoi_1_dai": false
};

// Example Modbus coil mapping for global variable modbusCoils
const exampleModbusCoils = {
    "quat_1": 0,
    "quat_2": 1,
    "quat_3": 2,
    "quat_4": 3,
    "quat_5": 4,
    "quat_6": 5,
    "quat_dao_1": 6,
    "quat_dao_2": 7,
    "quat_dao_3": 8,
    "bom_nuoc_1": 9,
    "luoi_2_thu": 12,
    "luoi_2_dai": 13,
    "luoi_1_thu": 16,
    "luoi_1_dai": 17
};

// Test scenarios
const testScenarios = {
    // Scenario 1: Normal operation with K2 threshold
    scenario1: {
        description: "K2 threshold triggered - should activate 4 fans",
        config: { ...exampleConfig },
        sensorData: {
            ...exampleSensorData,
            temp_indoor: 32.0, // Above K2 (30°C)
            humi_indoor: 70
        },
        expectedActions: [
            "Turn off all fans first",
            "Turn on 4 fans in rotation group"
        ]
    },

    // Scenario 2: K4 emergency threshold
    scenario2: {
        description: "K4 emergency threshold - should activate all fans + water pump",
        config: { ...exampleConfig },
        sensorData: {
            ...exampleSensorData,
            temp_indoor: 42.0, // Above K4 (40°C)
            humi_indoor: 70
        },
        expectedActions: [
            "Turn on all 6 fans",
            "Turn on water pump (K4 override)"
        ]
    },

    // Scenario 3: Low humidity - water pump activation
    scenario3: {
        description: "Low humidity - should activate water pump",
        config: { ...exampleConfig },
        sensorData: {
            ...exampleSensorData,
            temp_indoor: 24.0, // Below K1
            humi_indoor: 55    // Below low threshold (60%)
        },
        expectedActions: [
            "Turn on water pump due to low humidity"
        ]
    },

    // Scenario 4: High light - curtain extension
    scenario4: {
        description: "High light - should extend curtains after tolerance",
        config: { ...exampleConfig },
        sensorData: {
            ...exampleSensorData,
            temp_indoor: 24.0,
            light_indoor: 55000 // Above dai threshold (50000 lux)
        },
        expectedActions: [
            "Start tolerance timer for curtain extension",
            "After 5 minutes: extend curtains (dai)"
        ]
    },

    // Scenario 5: Rotation mode
    scenario5: {
        description: "Fan rotation mode - should rotate fan groups",
        config: {
            ...exampleConfig,
            set_auto_mode_fan: 1, // Rotation mode
            set_gr_alternate_fan: 2,
            set_time_alternate_fan: 15
        },
        sensorData: { ...exampleSensorData },
        expectedActions: [
            "Activate first group of 2 fans",
            "After 15 minutes: switch to next group"
        ]
    }
};

// Function to set up test environment
function setupTestEnvironment(scenario) {
    console.log(`\n=== Setting up ${scenario.description} ===`);

    // In a real Node-RED environment, you would set these global variables:
    // global.set("configKeyValues", scenario.config);
    // global.set("holdingRegisterData", scenario.sensorData);
    // global.set("coilRegisterData", exampleDeviceStatus);
    // global.set("modbusCoils", exampleModbusCoils);

    console.log("Configuration:", JSON.stringify(scenario.config, null, 2));
    console.log("Sensor Data:", JSON.stringify(scenario.sensorData, null, 2));
    console.log("Expected Actions:", scenario.expectedActions);
}

// Function to simulate control commands
function simulateControlCommands() {
    const commands = [
        {
            description: "Start control loop",
            payload: { command: "start" }
        },
        {
            description: "Execute manual control cycle",
            payload: { command: "execute" }
        },
        {
            description: "Get status",
            payload: { command: "status" }
        },
        {
            description: "Update polling interval to 5 seconds",
            payload: {
                command: "updateInterval",
                params: { interval: 5000 }
            }
        },
        {
            description: "Stop control loop",
            payload: { command: "stop" }
        }
    ];

    console.log("\n=== Control Commands ===");
    commands.forEach(cmd => {
        console.log(`${cmd.description}:`, JSON.stringify(cmd.payload));
    });
}

// Function to validate expected output
function validateOutput(output) {
    console.log("\n=== Output Validation ===");

    const requiredFields = [
        'timestamp', 'success', 'actionsExecuted', 'errors',
        'sensorData', 'controlStatus', 'actions'
    ];

    requiredFields.forEach(field => {
        if (output.payload && output.payload[field] !== undefined) {
            console.log(`✓ ${field}: ${JSON.stringify(output.payload[field])}`);
        } else {
            console.log(`✗ Missing field: ${field}`);
        }
    });
}

// Main test execution
function runTests() {
    console.log("VIIS Auto Microclimate Control Node - Test Examples");
    console.log("==================================================");

    // Run each test scenario
    Object.entries(testScenarios).forEach(([key, scenario]) => {
        setupTestEnvironment(scenario);
    });

    // Show control commands
    simulateControlCommands();

    // Example output validation
    const exampleOutput = {
        payload: {
            timestamp: Date.now(),
            success: true,
            actionsExecuted: 4,
            errors: 0,
            sensorData: {
                temp_indoor: 32.0,
                humi_indoor: 70,
                light_indoor: 45000
            },
            controlStatus: {
                fanControlEnabled: true,
                waterPumpEnabled: true,
                curtainControlEnabled: true
            },
            actions: [
                { device: "quat_1", value: false, reason: "Turn off for group control" },
                { device: "quat_2", value: false, reason: "Turn off for group control" },
                { device: "quat_1", value: true, reason: "K2 threshold: temp=32°C (≥30)" },
                { device: "quat_2", value: true, reason: "K2 threshold: temp=32°C (≥30)" }
            ]
        }
    };

    validateOutput(exampleOutput);
}

// Export for use in Node-RED or testing frameworks
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        exampleConfig,
        exampleSensorData,
        exampleDeviceStatus,
        exampleModbusCoils,
        testScenarios,
        setupTestEnvironment,
        simulateControlCommands,
        validateOutput,
        runTests
    };
}

// Run tests if executed directly
if (typeof require !== 'undefined' && require.main === module) {
    runTests();
}
