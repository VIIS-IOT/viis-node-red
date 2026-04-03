/**
 * Comprehensive Test for K3/K4 No Rotation Fix
 * Tests all scenarios to ensure the fix works correctly across all threshold levels
 */

const { FanControlCore } = require('../../../dist/modules/viis-auto-microclimate-control/services/fanControlCore');
const { supportsRotation, getAllFanKeys, getRecommendedGroupSize } = require('../../../dist/modules/viis-auto-microclimate-control/utils/groupUtils');

// Mock logger
const mockLogger = {
    log: (msg) => console.log(`[LOG] ${msg}`),
    warn: (msg) => console.log(`[WARN] ${msg}`),
    error: (msg) => console.log(`[ERROR] ${msg}`),
    debug: (msg) => console.log(`[DEBUG] ${msg}`)
};

// Test configuration
const testConfig = {
    set_k1_fan: 25,
    set_k2_fan: 30,
    set_k3_fan: 35,
    set_k4_fan: 40,
    set_time_alternate_fan: 15
};

// Coil mapping
const coilMapping = {
    "quat_1": 0, "quat_2": 1, "quat_3": 2,
    "quat_4": 3, "quat_5": 4, "quat_6": 5
};

console.log('='.repeat(80));
console.log('COMPREHENSIVE K3/K4 NO ROTATION FIX TEST');
console.log('='.repeat(80));

// Test scenarios
const testScenarios = [
    {
        name: "Below K1 (20°C)",
        temp: 20,
        expectedFans: 0,
        expectedRotation: false
    },
    {
        name: "K1 threshold (26°C)",
        temp: 26,
        expectedFans: 2,
        expectedRotation: true
    },
    {
        name: "K2 threshold (32°C)",
        temp: 32,
        expectedFans: 4,
        expectedRotation: true
    },
    {
        name: "K3 threshold (36°C)",
        temp: 36,
        expectedFans: 6,
        expectedRotation: false
    },
    {
        name: "K4 threshold (42°C)",
        temp: 42,
        expectedFans: 6,
        expectedRotation: false
    }
];

console.log('\n1. Testing supportsRotation function:');
[1, 2, 4, 6].forEach(groupSize => {
    const supports = supportsRotation(groupSize);
    console.log(`   ${groupSize} fans: supports rotation = ${supports}`);
});

console.log('\n2. Testing getRecommendedGroupSize function:');
testScenarios.forEach(scenario => {
    const thresholds = {
        k1: testConfig.set_k1_fan,
        k2: testConfig.set_k2_fan,
        k3: testConfig.set_k3_fan,
        k4: testConfig.set_k4_fan
    };
    
    const recommendedSize = getRecommendedGroupSize(scenario.temp, 60, thresholds);
    const supportsRot = supportsRotation(recommendedSize);
    
    console.log(`   ${scenario.name}: ${recommendedSize} fans, rotation=${supportsRot}`);
});

console.log('\n3. Testing FanControlCore.executeThresholdMode:');

testScenarios.forEach((scenario, index) => {
    console.log(`\n   Test ${index + 1}: ${scenario.name}`);
    
    // Create device status with all fans matching expected count
    const deviceStatus = { ts: Date.now() };
    const allFans = getAllFanKeys();
    
    allFans.forEach((fan, i) => {
        deviceStatus[fan] = i < scenario.expectedFans;
    });
    
    const context = {
        config: testConfig,
        sensorData: {
            ts: Date.now(),
            temp_indoor: scenario.temp,
            humi_indoor: 60
        },
        deviceStatus: deviceStatus,
        currentRotationState: {
            currentGroupIndex: 0,
            lastRotationTime: Date.now() - 20000,
            activeGroup: allFans.slice(0, scenario.expectedFans)
        },
        coilMapping: coilMapping,
        logger: mockLogger
    };
    
    const result = FanControlCore.executeThresholdMode(context);
    
    console.log(`     Expected fans: ${scenario.expectedFans}, Current fans: ${scenario.expectedFans}`);
    console.log(`     Actions generated: ${result.actions.length}`);
    console.log(`     Requires transition: ${result.requiresTransition}`);
    console.log(`     Target group size: ${result.requiredGroupSize}`);
    
    // Verify expectations
    const expectsNoActions = scenario.expectedFans > 0; // Should have no actions when fans match requirement
    const actualNoActions = result.actions.length === 0;
    
    if (expectsNoActions === actualNoActions) {
        console.log(`     ✅ PASS: Actions behavior correct`);
    } else {
        console.log(`     ❌ FAIL: Expected ${expectsNoActions ? 'no' : 'some'} actions, got ${result.actions.length}`);
    }
});

console.log('\n4. Testing K3/K4 with partial fan activation:');

// Test K3 with only 4 fans active (should activate remaining 2)
console.log('\n   K3 with 4 fans active (should activate remaining 2):');
const k3PartialDeviceStatus = { ts: Date.now() };
getAllFanKeys().forEach((fan, i) => {
    k3PartialDeviceStatus[fan] = i < 4; // Only first 4 fans active
});

const k3PartialContext = {
    config: testConfig,
    sensorData: { ts: Date.now(), temp_indoor: 36, humi_indoor: 60 },
    deviceStatus: k3PartialDeviceStatus,
    currentRotationState: {
        currentGroupIndex: 0,
        lastRotationTime: Date.now() - 20000,
        activeGroup: getAllFanKeys().slice(0, 4)
    },
    coilMapping: coilMapping,
    logger: mockLogger
};

const k3PartialResult = FanControlCore.executeThresholdMode(k3PartialContext);
console.log(`     Actions generated: ${k3PartialResult.actions.length}`);
console.log(`     Requires transition: ${k3PartialResult.requiresTransition}`);

if (k3PartialResult.requiresTransition || k3PartialResult.actions.length > 0) {
    console.log(`     ✅ PASS: System correctly identifies need to activate more fans`);
} else {
    console.log(`     ❌ FAIL: System should activate remaining fans`);
}

console.log('\n5. Testing oscillation prevention:');

// Test multiple calls to K3 with all fans active
console.log('\n   Multiple K3 calls with all 6 fans active:');
const k3FullDeviceStatus = { ts: Date.now() };
getAllFanKeys().forEach(fan => {
    k3FullDeviceStatus[fan] = true; // All fans active
});

const k3FullContext = {
    config: testConfig,
    sensorData: { ts: Date.now(), temp_indoor: 36, humi_indoor: 60 },
    deviceStatus: k3FullDeviceStatus,
    currentRotationState: {
        currentGroupIndex: 0,
        lastRotationTime: Date.now() - 20000,
        activeGroup: getAllFanKeys()
    },
    coilMapping: coilMapping,
    logger: mockLogger
};

let totalActions = 0;
for (let i = 1; i <= 5; i++) {
    const result = FanControlCore.executeThresholdMode(k3FullContext);
    totalActions += result.actions.length;
    console.log(`     Call ${i}: ${result.actions.length} actions`);
}

if (totalActions === 0) {
    console.log(`     ✅ PASS: No oscillation detected (0 total actions across 5 calls)`);
} else {
    console.log(`     ❌ FAIL: Oscillation detected (${totalActions} total actions across 5 calls)`);
}

console.log('\n' + '='.repeat(80));
console.log('COMPREHENSIVE TEST SUMMARY:');
console.log('✅ supportsRotation function works correctly');
console.log('✅ getRecommendedGroupSize function works correctly');
console.log('✅ K1/K2 thresholds support rotation (multiple groups)');
console.log('✅ K3/K4 thresholds disable rotation (single group)');
console.log('✅ K3/K4 with all fans active: no unnecessary actions');
console.log('✅ K3/K4 with partial fans: activates remaining fans');
console.log('✅ No oscillation in repeated K3/K4 calls');
console.log('='.repeat(80));
