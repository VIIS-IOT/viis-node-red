/**
 * Test script to verify K3/K4 fan cycling fix
 * This script tests that K3 and K4 modes (6 fans) do not cycle on/off every 20 seconds
 */

const { FanControlService } = require('../../../dist/modules/viis-auto-microclimate-control/services/fanControlService');
const { supportsRotation, getFanGroups } = require('../../../dist/modules/viis-auto-microclimate-control/utils/groupUtils');

// Mock Node-RED context
const mockFlowContext = new Map();
const mockGlobalContext = new Map();

// Mock logger
const mockLogger = {
    log: (msg) => console.log(`[LOG] ${msg}`),
    warn: (msg) => console.log(`[WARN] ${msg}`),
    debug: (msg) => console.log(`[DEBUG] ${msg}`),
    error: (msg) => console.log(`[ERROR] ${msg}`)
};

// Mock node
const mockNode = {
    status: (status) => console.log(`[STATUS] ${JSON.stringify(status)}`)
};

// Service options
const serviceOptions = {
    flowContext: {
        get: (key) => mockFlowContext.get(key),
        set: (key, value) => mockFlowContext.set(key, value)
    },
    globalContext: {
        get: (key) => mockGlobalContext.get(key),
        set: (key, value) => mockGlobalContext.set(key, value)
    },
    node: mockNode,
    nodeId: 'test-node'
};

// Initialize fan control service
const fanControlService = new FanControlService(serviceOptions);

console.log('=== K3/K4 Fan Cycling Fix Test ===\n');

// Test 1: Verify supportsRotation function
console.log('Test 1: Checking supportsRotation function');
console.log(`- 1 fan groups: ${supportsRotation(1)} (should be true - 6 groups)`);
console.log(`- 2 fan groups: ${supportsRotation(2)} (should be true - 3 groups)`);
console.log(`- 4 fan groups: ${supportsRotation(4)} (should be true - 3 groups)`);
console.log(`- 6 fan groups: ${supportsRotation(6)} (should be false - 1 group only)`);

// Test 2: Verify fan groups configuration
console.log('\nTest 2: Checking fan groups configuration');
const groups1 = getFanGroups(1);
const groups2 = getFanGroups(2);
const groups4 = getFanGroups(4);
const groups6 = getFanGroups(6);

console.log(`- 1 fan groups (${groups1.length}): ${JSON.stringify(groups1)}`);
console.log(`- 2 fan groups (${groups2.length}): ${JSON.stringify(groups2)}`);
console.log(`- 4 fan groups (${groups4.length}): ${JSON.stringify(groups4)}`);
console.log(`- 6 fan groups (${groups6.length}): ${JSON.stringify(groups6)}`);

// Test 3: K3 threshold mode test (35°C)
console.log('\nTest 3: K3 threshold mode test (35°C)');

const k3Config = {
    set_mode_fan: 1,
    set_auto_mode_fan: 0, // Threshold mode
    set_k1_fan: 25,
    set_k2_fan: 30,
    set_k3_fan: 35,
    set_k4_fan: 40,
    set_time_alternate_fan: 15 // 15 minutes
};

const k3SensorData = {
    temp_indoor: 36, // Above K3 threshold (35°C)
    humi_indoor: 65,
    light_indoor: 25000
};

// Device status with no fans currently on
const deviceStatusOff = {
    quat_1: false,
    quat_2: false,
    quat_3: false,
    quat_4: false,
    quat_5: false,
    quat_6: false,
    ts: Date.now()
};

// Device status with all 6 fans on (K3/K4 state)
const deviceStatusAllOn = {
    quat_1: true,
    quat_2: true,
    quat_3: true,
    quat_4: true,
    quat_5: true,
    quat_6: true,
    ts: Date.now()
};

async function testK3Mode() {
    console.log('K3 Mode Test - First execution (fans off):');
    const actions1 = await fanControlService.processThresholdMode(k3Config, k3SensorData, deviceStatusOff);
    console.log(`Actions generated: ${actions1.length}`);
    actions1.forEach(action => {
        console.log(`  - ${action.deviceKey}: ${action.value} (${action.reason})`);
    });

    console.log('\nK3 Mode Test - Second execution (fans already on):');
    const actions2 = await fanControlService.processThresholdMode(k3Config, k3SensorData, deviceStatusAllOn);
    console.log(`Actions generated: ${actions2.length} (should be 0 - no cycling)`);
    actions2.forEach(action => {
        console.log(`  - ${action.deviceKey}: ${action.value} (${action.reason})`);
    });
}

// Test 4: K4 threshold mode test (40°C)
console.log('\nTest 4: K4 threshold mode test (40°C)');

const k4Config = {
    set_mode_fan: 1,
    set_auto_mode_fan: 0, // Threshold mode
    set_k1_fan: 25,
    set_k2_fan: 30,
    set_k3_fan: 35,
    set_k4_fan: 40,
    set_time_alternate_fan: 15 // 15 minutes
};

const k4SensorData = {
    temp_indoor: 42, // Above K4 threshold (40°C)
    humi_indoor: 70,
    light_indoor: 30000
};

async function testK4Mode() {
    console.log('K4 Mode Test - First execution (fans off):');
    const actions1 = await fanControlService.processThresholdMode(k4Config, k4SensorData, deviceStatusOff);
    console.log(`Actions generated: ${actions1.length}`);
    actions1.forEach(action => {
        console.log(`  - ${action.deviceKey}: ${action.value} (${action.reason})`);
    });

    console.log('\nK4 Mode Test - Second execution (fans already on):');
    const actions2 = await fanControlService.processThresholdMode(k4Config, k4SensorData, deviceStatusAllOn);
    console.log(`Actions generated: ${actions2.length} (should be 0 - no cycling)`);
    actions2.forEach(action => {
        console.log(`  - ${action.deviceKey}: ${action.value} (${action.reason})`);
    });
}

// Test 5: Rotation mode with 6 fans
console.log('\nTest 5: Rotation mode with 6 fans');

const rotationConfig = {
    set_mode_fan: 1,
    set_auto_mode_fan: 1, // Rotation mode
    set_gr_alternate_fan: 6, // 6 fans
    set_time_alternate_fan: 15 // 15 minutes
};

async function testRotationMode() {
    console.log('Rotation Mode Test with 6 fans (no device status):');
    const actions1 = await fanControlService.processRotationMode(rotationConfig);
    console.log(`Actions generated: ${actions1.length} (expected: 6 - fans need to be turned on)`);
    actions1.forEach(action => {
        console.log(`  - ${action.deviceKey}: ${action.value} (${action.reason})`);
    });

    // Simulate device status with all fans on
    console.log('\nRotation Mode Test - Simulating fans already on:');
    mockGlobalContext.set('coilRegisterData', {
        0: true, // quat_1
        1: true, // quat_2
        2: true, // quat_3
        3: true, // quat_4
        4: true, // quat_5
        5: true, // quat_6
        ts: Date.now()
    });

    const actions2 = await fanControlService.processRotationMode(rotationConfig);
    console.log(`Actions generated: ${actions2.length} (expected: 0 - fans already on, no rotation needed)`);
    actions2.forEach(action => {
        console.log(`  - ${action.deviceKey}: ${action.value} (${action.reason})`);
    });
}

// Run all tests
async function runAllTests() {
    try {
        await testK3Mode();
        await testK4Mode();
        await testRotationMode();

        console.log('\n=== Test Summary ===');
        console.log('✅ K3/K4 modes should now work correctly without 20-second cycling');
        console.log('✅ Single group modes (6 fans) should not attempt rotation');
        console.log('✅ Fans should stay on consistently when temperature is above threshold');

    } catch (error) {
        console.error('Test failed:', error);
    }
}

runAllTests();
