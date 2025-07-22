/**
 * Test script to verify K4 logic with user's actual configuration
 * User config: K4=25°C, current temp=25.4°C
 */

const { getRecommendedGroupSize } = require('../../../dist/modules/viis-auto-microclimate-control/utils/groupUtils');

// User's actual configuration from log
const userConfig = {
    set_k1_fan: 22,
    set_k2_fan: 23,
    set_k3_fan: 24,
    set_k4_fan: 25  // User's K4 threshold
};

console.log('=== User Configuration K4 Logic Test ===');
console.log('User config:', JSON.stringify(userConfig));
console.log('Current temperature from log: 25.4°C');
console.log('');

// Test scenarios based on user's thresholds
const scenarios = [
    { temp: 21, expected: "No fans" },
    { temp: 22.5, expected: "1 fan rotation (K1)" },
    { temp: 23.5, expected: "2 fans rotation (K2)" },
    { temp: 24.5, expected: "3 fans rotation (K3)" },
    { temp: 25.4, expected: "Water wall + quat_tren_1 only (K4)" },  // User's actual case
    { temp: 26, expected: "Water wall + quat_tren_1 only (K4)" }
];

scenarios.forEach(scenario => {
    const groupSize = getRecommendedGroupSize(
        scenario.temp,
        70, // humidity
        {
            k1: userConfig.set_k1_fan,
            k2: userConfig.set_k2_fan,
            k3: userConfig.set_k3_fan,
            k4: userConfig.set_k4_fan
        }
    );
    
    console.log(`Temperature: ${scenario.temp}°C`);
    console.log(`  Expected: ${scenario.expected}`);
    console.log(`  Actual group size: ${groupSize}`);
    
    if (scenario.temp === 25.4) {
        console.log('  🔍 THIS IS THE USER\'S ACTUAL CASE!');
        if (groupSize === 5) {
            console.log('  ✅ K4 correctly returns 5 (should trigger water wall + quat_tren_1 logic)');
            console.log('  ✅ K4 should NOT activate quat_1 to quat_5 (targetGroup = [])');
            console.log('  ❗ BUT USER REPORTS: quat_1 to quat_5 are being activated!');
            console.log('  🐛 POTENTIAL BUG: Logic may not be reaching K4 special handling');
        } else {
            console.log(`  ❌ K4 should return 5 but got ${groupSize}`);
        }
    } else if (scenario.temp >= userConfig.set_k4_fan) {
        if (groupSize === 5) {
            console.log('  ✅ K4 correctly returns 5');
        } else {
            console.log(`  ❌ K4 should return 5 but got ${groupSize}`);
        }
    } else if (scenario.temp >= userConfig.set_k3_fan) {
        if (groupSize === 3) {
            console.log('  ✅ K3 correctly returns 3');
        } else {
            console.log(`  ❌ K3 should return 3 but got ${groupSize}`);
        }
    } else if (scenario.temp >= userConfig.set_k2_fan) {
        if (groupSize === 2) {
            console.log('  ✅ K2 correctly returns 2');
        } else {
            console.log(`  ❌ K2 should return 2 but got ${groupSize}`);
        }
    } else if (scenario.temp >= userConfig.set_k1_fan) {
        if (groupSize === 1) {
            console.log('  ✅ K1 correctly returns 1');
        } else {
            console.log(`  ❌ K1 should return 1 but got ${groupSize}`);
        }
    } else {
        if (groupSize === 0) {
            console.log('  ✅ Below K1 correctly returns 0');
        } else {
            console.log(`  ❌ Below K1 should return 0 but got ${groupSize}`);
        }
    }
    
    console.log('');
});

console.log('=== Analysis ===');
console.log('🔍 User\'s issue: temp=25.4°C with K4=25°C should trigger K4 logic');
console.log('✅ getRecommendedGroupSize() correctly returns 5 for K4');
console.log('❗ BUT: User reports quat_1 to quat_5 are being activated');
console.log('🐛 SUSPECTED ISSUE: The K4 special handling in fanControlService.ts may not be working');
console.log('💡 NEXT STEP: Check if requiredGroupSize === 5 condition is being reached');