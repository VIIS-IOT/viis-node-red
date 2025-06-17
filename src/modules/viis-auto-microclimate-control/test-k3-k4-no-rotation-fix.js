/**
 * Test K3/K4 No Rotation Fix
 * Verifies that K3/K4 thresholds disable group switching when all 6 fans are already active
 */

const { FanControlCore } = require('../../../dist/modules/viis-auto-microclimate-control/services/fanControlCore');
const { supportsRotation, getAllFanKeys } = require('../../../dist/modules/viis-auto-microclimate-control/utils/groupUtils');

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
    "quat_1": 0,
    "quat_2": 1,
    "quat_3": 2,
    "quat_4": 3,
    "quat_5": 4,
    "quat_6": 5
};

console.log('='.repeat(80));
console.log('K3/K4 No Rotation Fix Test');
console.log('='.repeat(80));

// Test 1: Verify supportsRotation function
console.log('\n1. Testing supportsRotation function:');
console.log(`   - 1 fan group: supports rotation = ${supportsRotation(1)}`);
console.log(`   - 2 fan groups: supports rotation = ${supportsRotation(2)}`);
console.log(`   - 4 fan groups: supports rotation = ${supportsRotation(4)}`);
console.log(`   - 6 fan groups: supports rotation = ${supportsRotation(6)}`);

// Test 2: K3 threshold with all 6 fans already active
console.log('\n2. Testing K3 threshold (35°C) with all 6 fans already active:');

const k3Context = {
    config: testConfig,
    sensorData: {
        ts: Date.now(),
        temp_indoor: 35.5,
        humi_indoor: 60
    },
    deviceStatus: {
        ts: Date.now(),
        quat_1: true,
        quat_2: true,
        quat_3: true,
        quat_4: true,
        quat_5: true,
        quat_6: true
    },
    currentRotationState: {
        currentGroupIndex: 0,
        lastRotationTime: Date.now() - 20000, // 20 seconds ago
        activeGroup: getAllFanKeys()
    },
    coilMapping: coilMapping,
    logger: mockLogger
};

const k3Result = FanControlCore.executeThresholdMode(k3Context);
console.log(`   Result: ${k3Result.actions.length} actions, requiresTransition: ${k3Result.requiresTransition}`);
console.log(`   Reason: ${k3Result.reason}`);
if (k3Result.actions.length > 0) {
    console.log(`   Actions: ${k3Result.actions.map(a => `${a.deviceKey}=${a.value}`).join(', ')}`);
}

// Test 3: K4 threshold with all 6 fans already active
console.log('\n3. Testing K4 threshold (40°C) with all 6 fans already active:');

const k4Context = {
    ...k3Context,
    sensorData: {
        ts: Date.now(),
        temp_indoor: 41.0,
        humi_indoor: 65
    }
};

const k4Result = FanControlCore.executeThresholdMode(k4Context);
console.log(`   Result: ${k4Result.actions.length} actions, requiresTransition: ${k4Result.requiresTransition}`);
console.log(`   Reason: ${k4Result.reason}`);
if (k4Result.actions.length > 0) {
    console.log(`   Actions: ${k4Result.actions.map(a => `${a.deviceKey}=${a.value}`).join(', ')}`);
}

// Test 4: K3 threshold with only 4 fans active (should activate remaining fans)
console.log('\n4. Testing K3 threshold with only 4 fans active (should activate remaining fans):');

const k3PartialContext = {
    ...k3Context,
    deviceStatus: {
        ts: Date.now(),
        quat_1: true,
        quat_2: true,
        quat_3: true,
        quat_4: true,
        quat_5: false,
        quat_6: false
    }
};

const k3PartialResult = FanControlCore.executeThresholdMode(k3PartialContext);
console.log(`   Result: ${k3PartialResult.actions.length} actions, requiresTransition: ${k3PartialResult.requiresTransition}`);
console.log(`   Reason: ${k3PartialResult.reason}`);
if (k3PartialResult.actions.length > 0) {
    console.log(`   Actions: ${k3PartialResult.actions.map(a => `${a.deviceKey}=${a.value}`).join(', ')}`);
}

// Test 5: K2 threshold (should still support rotation)
console.log('\n5. Testing K2 threshold (30°C) - should still support rotation:');

const k2Context = {
    ...k3Context,
    sensorData: {
        ts: Date.now(),
        temp_indoor: 31.0,
        humi_indoor: 55
    },
    deviceStatus: {
        ts: Date.now(),
        quat_1: true,
        quat_2: true,
        quat_3: true,
        quat_4: true,
        quat_5: false,
        quat_6: false
    }
};

const k2Result = FanControlCore.executeThresholdMode(k2Context);
console.log(`   Result: ${k2Result.actions.length} actions, requiresTransition: ${k2Result.requiresTransition}`);
console.log(`   Reason: ${k2Result.reason}`);
console.log(`   Target group: [${k2Result.targetGroup.join(', ')}]`);
if (k2Result.actions.length > 0) {
    console.log(`   Actions: ${k2Result.actions.map(a => `${a.deviceKey}=${a.value}`).join(', ')}`);
}

console.log('\n' + '='.repeat(80));
console.log('Test Summary:');
console.log('- K3/K4 with 6 fans active: Should generate 0 actions (no rotation)');
console.log('- K3/K4 with <6 fans active: Should activate remaining fans');
console.log('- K1/K2: Should continue to support rotation as before');
console.log('='.repeat(80));
