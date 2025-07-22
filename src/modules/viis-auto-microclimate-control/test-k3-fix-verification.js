/**
 * Test to verify K3 threshold fix
 * Ensures K3 uses 3 fans with rotation instead of all 5 fans
 */

const { getRecommendedGroupSize, getFanGroups } = require('../../../dist/modules/viis-auto-microclimate-control/utils/groupUtils');

// Test configuration
const thresholds = {
    k1: 25,
    k2: 30, 
    k3: 35,
    k4: 40
};

console.log('=== K3 Threshold Fix Verification ===\n');

// Test K3 temperature (36°C)
const k3Temperature = 36;
const humidity = 60;

const requiredGroupSize = getRecommendedGroupSize(k3Temperature, humidity, thresholds);
console.log(`Temperature: ${k3Temperature}°C (K3 threshold: ${thresholds.k3}°C)`);
console.log(`Required group size: ${requiredGroupSize}`);

if (requiredGroupSize === 3) {
    console.log('✅ PASS: K3 correctly returns 3 fans (not 5)');
    
    // Test fan groups for 3-fan rotation
    const fanGroups = getFanGroups(3);
    console.log(`\nAvailable 3-fan groups for rotation:`);
    fanGroups.forEach((group, index) => {
        console.log(`  Group ${index + 1}: [${group.join(', ')}]`);
    });
    
    console.log(`\n✅ K3 will use 3-fan rotation with ${fanGroups.length} groups`);
} else {
    console.log(`❌ FAIL: K3 returns ${requiredGroupSize} fans instead of 3`);
}

// Test other thresholds for comparison
console.log('\n=== Other Thresholds Verification ===');

const testCases = [
    { name: 'K1', temp: 26, expected: 1 },
    { name: 'K2', temp: 31, expected: 2 },
    { name: 'K4', temp: 41, expected: 5 }
];

testCases.forEach(testCase => {
    const result = getRecommendedGroupSize(testCase.temp, humidity, thresholds);
    const status = result === testCase.expected ? '✅ PASS' : '❌ FAIL';
    console.log(`${status}: ${testCase.name} (${testCase.temp}°C) → ${result} fans (expected: ${testCase.expected})`);
});

console.log('\n=== Test Complete ===');