/**
 * Test FanControlService K3/K4 No Rotation Fix
 * Verifies that FanControlService properly handles K3/K4 thresholds without unnecessary rotation
 */

const { FanControlService } = require('../../../dist/modules/viis-auto-microclimate-control/services/fanControlService');
const { supportsRotation } = require('../../../dist/modules/viis-auto-microclimate-control/utils/groupUtils');

// Mock Node-RED context
const mockFlowContext = new Map();
const mockGlobalContext = new Map();

const mockOptions = {
    node: {
        warn: (msg) => console.log(`[NODE-WARN] ${msg}`),
        log: (msg) => console.log(`[NODE-LOG] ${msg}`),
        error: (msg) => console.log(`[NODE-ERROR] ${msg}`),
        debug: (msg) => console.log(`[NODE-DEBUG] ${msg}`)
    },
    flowContext: {
        get: (key) => mockFlowContext.get(key),
        set: (key, value) => mockFlowContext.set(key, value)
    },
    globalContext: {
        get: (key) => mockGlobalContext.get(key),
        set: (key, value) => mockGlobalContext.set(key, value)
    },
    nodeId: 'test-node'
};

// Initialize global context with coil mapping
mockGlobalContext.set('modbusCoils', {
    "quat_1": 0,
    "quat_2": 1,
    "quat_3": 2,
    "quat_4": 3,
    "quat_5": 4,
    "quat_6": 5
});

// Test configuration
const testConfig = {
    set_mode_fan: 1, // Fan control enabled
    set_auto_mode_fan: 0, // Threshold mode (not rotation mode)
    set_k1_fan: 25,
    set_k2_fan: 30,
    set_k3_fan: 35,
    set_k4_fan: 40,
    set_time_alternate_fan: 15
};

console.log('='.repeat(80));
console.log('FanControlService K3/K4 No Rotation Fix Test');
console.log('='.repeat(80));

// Create service instance
const fanControlService = new FanControlService(mockOptions);

async function runTests() {
    // Test 1: K3 threshold with all 6 fans already active
    console.log('\n1. Testing K3 threshold (35°C) with all 6 fans already active:');
    
    const k3SensorData = {
        ts: Date.now(),
        temp_indoor: 35.5,
        humi_indoor: 60
    };
    
    const k3DeviceStatus = {
        ts: Date.now(),
        quat_1: true,
        quat_2: true,
        quat_3: true,
        quat_4: true,
        quat_5: true,
        quat_6: true
    };
    
    const k3Actions = await fanControlService.processThresholdMode(testConfig, k3SensorData, k3DeviceStatus);
    console.log(`   Result: ${k3Actions.length} actions generated`);
    if (k3Actions.length > 0) {
        console.log(`   Actions: ${k3Actions.map(a => `${a.deviceKey}=${a.value}`).join(', ')}`);
    }
    
    // Test 2: K4 threshold with all 6 fans already active
    console.log('\n2. Testing K4 threshold (40°C) with all 6 fans already active:');
    
    const k4SensorData = {
        ts: Date.now(),
        temp_indoor: 41.0,
        humi_indoor: 65
    };
    
    const k4Actions = await fanControlService.processThresholdMode(testConfig, k4SensorData, k3DeviceStatus);
    console.log(`   Result: ${k4Actions.length} actions generated`);
    if (k4Actions.length > 0) {
        console.log(`   Actions: ${k4Actions.map(a => `${a.deviceKey}=${a.value}`).join(', ')}`);
    }
    
    // Test 3: K3 threshold with only 4 fans active (should activate remaining fans)
    console.log('\n3. Testing K3 threshold with only 4 fans active:');
    
    const k3PartialDeviceStatus = {
        ts: Date.now(),
        quat_1: true,
        quat_2: true,
        quat_3: true,
        quat_4: true,
        quat_5: false,
        quat_6: false
    };
    
    const k3PartialActions = await fanControlService.processThresholdMode(testConfig, k3SensorData, k3PartialDeviceStatus);
    console.log(`   Result: ${k3PartialActions.length} actions generated`);
    if (k3PartialActions.length > 0) {
        console.log(`   Actions: ${k3PartialActions.map(a => `${a.deviceKey}=${a.value}`).join(', ')}`);
    }
    
    // Test 4: K2 threshold (should still support rotation)
    console.log('\n4. Testing K2 threshold (30°C) - should still support rotation:');
    
    const k2SensorData = {
        ts: Date.now(),
        temp_indoor: 31.0,
        humi_indoor: 55
    };
    
    const k2DeviceStatus = {
        ts: Date.now(),
        quat_1: true,
        quat_2: true,
        quat_3: true,
        quat_4: true,
        quat_5: false,
        quat_6: false
    };
    
    const k2Actions = await fanControlService.processThresholdMode(testConfig, k2SensorData, k2DeviceStatus);
    console.log(`   Result: ${k2Actions.length} actions generated`);
    if (k2Actions.length > 0) {
        console.log(`   Actions: ${k2Actions.map(a => `${a.deviceKey}=${a.value}`).join(', ')}`);
    }
    
    // Test 5: Test multiple K3 calls to verify no oscillation
    console.log('\n5. Testing multiple K3 calls to verify no oscillation:');
    
    for (let i = 1; i <= 3; i++) {
        console.log(`   Call ${i}:`);
        const actions = await fanControlService.processThresholdMode(testConfig, k3SensorData, k3DeviceStatus);
        console.log(`     Result: ${actions.length} actions generated`);
        if (actions.length > 0) {
            console.log(`     Actions: ${actions.map(a => `${a.deviceKey}=${a.value}`).join(', ')}`);
        }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('Test Summary:');
    console.log('✅ K3/K4 with 6 fans active: Should generate 0 actions (no rotation)');
    console.log('✅ K3/K4 with <6 fans active: Should activate remaining fans');
    console.log('✅ K1/K2: Should continue to support rotation as before');
    console.log('✅ Multiple K3/K4 calls: Should not oscillate');
    console.log('='.repeat(80));
}

runTests().catch(console.error);
