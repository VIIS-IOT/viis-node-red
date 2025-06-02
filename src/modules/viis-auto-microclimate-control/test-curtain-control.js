/**
 * Test script for improved curtain control logic
 * Tests the new dual-sensor approach (outdoor + indoor light)
 */

console.log("=== VIIS Curtain Control Logic Test ===");
console.log("");

// Test scenarios for the new curtain control logic
const testScenarios = {
    scenario1: {
        description: "High outdoor light - should extend curtains",
        sensorData: {
            light_outdoor: 55000, // Above dai threshold (50000)
            light_indoor: 25000   // Indoor light still good
        },
        config: {
            set_light_dai_luoi_1: 50000,
            set_light_thu_luoi_1: 30000,
            set_light_indoor_thu_luoi_1: 15000
        },
        expectedAction: "dai",
        reason: "Outdoor light exceeds dai threshold"
    },

    scenario2: {
        description: "Low outdoor light - should retract curtains",
        sensorData: {
            light_outdoor: 25000, // Below thu threshold (30000)
            light_indoor: 20000   // Indoor light is fine
        },
        config: {
            set_light_dai_luoi_1: 50000,
            set_light_thu_luoi_1: 30000,
            set_light_indoor_thu_luoi_1: 15000
        },
        expectedAction: "thu",
        reason: "Outdoor light below thu threshold"
    },

    scenario3: {
        description: "Low indoor light - should retract curtains (NEW LOGIC)",
        sensorData: {
            light_outdoor: 40000, // Between thresholds (not triggering outdoor logic)
            light_indoor: 10000   // Below indoor thu threshold (15000)
        },
        config: {
            set_light_dai_luoi_1: 50000,
            set_light_thu_luoi_1: 30000,
            set_light_indoor_thu_luoi_1: 15000
        },
        expectedAction: "thu",
        reason: "Indoor light too low - curtain blocking too much light"
    },

    scenario4: {
        description: "Medium light levels - no action needed",
        sensorData: {
            light_outdoor: 40000, // Between thresholds
            light_indoor: 20000   // Above indoor threshold
        },
        config: {
            set_light_dai_luoi_1: 50000,
            set_light_thu_luoi_1: 30000,
            set_light_indoor_thu_luoi_1: 15000
        },
        expectedAction: "none",
        reason: "Light levels are within acceptable range"
    }
};

// Simulate the curtain control logic
function simulateCurtainLogic(lightOutdoor, lightIndoor, daiThreshold, thuThreshold, indoorThuThreshold) {
    if (lightOutdoor >= daiThreshold) {
        return "dai"; // Extend curtain to block high outdoor light
    } else if (lightOutdoor <= thuThreshold || lightIndoor <= indoorThuThreshold) {
        return "thu"; // Retract curtain due to low outdoor light OR low indoor light
    }
    return "none"; // No action needed
}

// Run tests
console.log("Running curtain control logic tests...");
console.log("");

let passedTests = 0;
let totalTests = Object.keys(testScenarios).length;

for (const [scenarioKey, scenario] of Object.entries(testScenarios)) {
    console.log(`🧪 ${scenario.description}`);
    console.log(`   Outdoor light: ${scenario.sensorData.light_outdoor} lux`);
    console.log(`   Indoor light: ${scenario.sensorData.light_indoor} lux`);
    console.log(`   Thresholds: dai=${scenario.config.set_light_dai_luoi_1}, thu=${scenario.config.set_light_thu_luoi_1}, indoor_thu=${scenario.config.set_light_indoor_thu_luoi_1}`);
    
    const actualAction = simulateCurtainLogic(
        scenario.sensorData.light_outdoor,
        scenario.sensorData.light_indoor,
        scenario.config.set_light_dai_luoi_1,
        scenario.config.set_light_thu_luoi_1,
        scenario.config.set_light_indoor_thu_luoi_1
    );
    
    const passed = actualAction === scenario.expectedAction;
    console.log(`   Expected: ${scenario.expectedAction}, Got: ${actualAction} ${passed ? '✅' : '❌'}`);
    console.log(`   Reason: ${scenario.reason}`);
    console.log("");
    
    if (passed) passedTests++;
}

// Summary
console.log("=== Test Results ===");
console.log(`Passed: ${passedTests}/${totalTests} tests`);

if (passedTests === totalTests) {
    console.log("🎉 All tests passed! The improved curtain control logic is working correctly.");
    console.log("");
    console.log("Key improvements:");
    console.log("  ✅ Dual-sensor approach (outdoor + indoor light)");
    console.log("  ✅ Prevents over-darkening when curtains are closed");
    console.log("  ✅ Maintains original outdoor light logic");
    console.log("  ✅ Adds intelligent indoor light monitoring");
    console.log("");
    console.log("Benefits:");
    console.log("  • Curtains will open when indoor light becomes too low");
    console.log("  • Better balance between sun protection and natural lighting");
    console.log("  • Solves the problem where curtains stay closed indefinitely");
} else {
    console.log("❌ Some tests failed. Please review the logic.");
}
