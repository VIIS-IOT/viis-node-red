/**
 * Fix Stuck Rotation State - Debug Script
 * Use this script to diagnose and fix stuck rotation states
 */

const path = require('path');

// Import the compiled JavaScript version
let FanControlService, CONTEXT_KEYS, CONTROL_CONFIG;

try {
    const fanControlModule = require('../../../dist/modules/viis-auto-microclimate-control/services/fanControlService');
    const constantsModule = require('../../../dist/modules/viis-auto-microclimate-control/constants');

    FanControlService = fanControlModule.FanControlService;
    CONTEXT_KEYS = constantsModule.CONTEXT_KEYS;
    CONTROL_CONFIG = constantsModule.CONTROL_CONFIG;

    console.log('✓ Successfully imported modules for stuck rotation fix');
} catch (error) {
    console.error('Failed to import modules:', error.message);
    console.log('Make sure to compile TypeScript first: npm run build');
    process.exit(1);
}

// Mock Node-RED environment
const mockNode = {
    log: (...args) => console.log('[LOG]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    debug: (...args) => console.debug('[DEBUG]', ...args),
    status: (status) => console.log('[STATUS]', status)
};

const mockFlowContext = new Map();
const mockGlobalContext = new Map();

// Set up mock global context with coil mapping
mockGlobalContext.set('modbusCoils', {
    quat_1: 0,
    quat_2: 1,
    quat_3: 2,
    quat_4: 3,
    quat_5: 4,
    quat_6: 5
});

// Simulate your current device status (quat_1, quat_2 ON)
const mockCoilData = {
    0: true,  // quat_1 - ON
    1: true,  // quat_2 - ON
    2: false, // quat_3 - OFF
    3: false, // quat_4 - OFF
    4: false, // quat_5 - OFF
    5: false  // quat_6 - OFF
};
mockGlobalContext.set('coilRegisterData', mockCoilData);

// Simulate your stuck rotation state
const stuckRotationState = {
    currentGroupIndex: 2,
    lastRotationTime: 1749799142399, // Your actual timestamp
    activeGroup: ["quat_3", "quat_4"],
    requiredGroupSize: 2
};

// Set the old context key with stuck state
mockFlowContext.set('fanRotationState_threshold_2', stuckRotationState);

const mockServiceOptions = {
    node: mockNode,
    flowContext: {
        get: (key) => mockFlowContext.get(key),
        set: (key, value) => mockFlowContext.set(key, value)
    },
    globalContext: {
        get: (key) => mockGlobalContext.get(key),
        set: (key, value) => mockGlobalContext.set(key, value)
    },
    nodeId: 'fix-stuck-rotation',
    environmentConfig: {
        deviceId: 'test-device',
        modbusCoils: {},
        modbusInputRegisters: {},
        modbusHoldingRegisters: {}
    }
};

// Your actual configuration
const config = {
    set_mode_fan: 1,
    set_auto_mode_fan: 0, // Threshold mode
    set_k1_fan: 26,  // Your K1 threshold
    set_k2_fan: 30,
    set_k3_fan: 32,
    set_k4_fan: 33,
    set_time_alternate_fan: 1, // 1 minute rotation
    set_fan_group_transition_delay: 2,
    set_fan_group_off_delay: 1
};

// Your actual sensor data
const sensorData = {
    temp_indoor: 27.1,
    humi_indoor: 60,
    light_indoor: 9317
};

const deviceStatus = {
    quat_1: true,
    quat_2: true,
    quat_3: false,
    quat_4: false,
    quat_5: false,
    quat_6: false,
    ts: Date.now()
};

async function diagnosisAndFix() {
    console.log('=== Stuck Rotation State Diagnosis & Fix ===\n');

    try {
        // Create fan control service instance
        const fanControlService = new FanControlService(mockServiceOptions);

        console.log('1. Current State Analysis');
        console.log('========================');

        // Check all possible context keys
        const possibleKeys = [
            'fanRotationState_threshold_1',
            'fanRotationState_threshold_2',
            'fanRotationState_threshold_4',
            'fanRotationState_threshold_6',
            'fanRotationState_threshold_mode'
        ];

        console.log('Checking all rotation context keys:');
        possibleKeys.forEach(key => {
            const state = mockFlowContext.get(key);
            if (state) {
                console.log(`  ✓ ${key}:`, JSON.stringify(state, null, 2));
            } else {
                console.log(`  ✗ ${key}: not found`);
            }
        });

        console.log('\nCurrent device status:');
        console.log('  Active fans:', Object.keys(mockCoilData).filter(key => mockCoilData[key]).map(key => `quat_${parseInt(key) + 1}`));

        console.log('\nTime analysis:');
        const currentTime = Date.now();
        const stuckTime = stuckRotationState.lastRotationTime;
        const timeDiff = currentTime - stuckTime;
        console.log(`  Current time: ${currentTime}`);
        console.log(`  Last rotation: ${stuckTime}`);
        console.log(`  Time difference: ${Math.round(timeDiff / 1000)}s (${Math.round(timeDiff / 60000)} minutes)`);
        console.log(`  Rotation interval: ${config.set_time_alternate_fan} minute(s)`);
        console.log(`  Should have rotated: ${timeDiff > (config.set_time_alternate_fan * 60000) ? 'YES' : 'NO'}`);

        console.log('\n2. Executing Fan Control (Before Fix)');
        console.log('=====================================');

        // Execute fan control to see current behavior
        const actionsBeforeFix = await fanControlService.processFanControl(config, sensorData, deviceStatus);

        console.log('Actions generated:');
        actionsBeforeFix.forEach(action => {
            if (['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)) {
                console.log(`  ${action.deviceKey}: ${action.value ? 'ON' : 'OFF'} - ${action.reason}`);
            }
        });

        console.log('\n3. State After First Execution');
        console.log('==============================');

        possibleKeys.forEach(key => {
            const state = mockFlowContext.get(key);
            if (state) {
                console.log(`  ✓ ${key}:`, JSON.stringify(state, null, 2));
            }
        });

        console.log('\n4. Force Another Execution (Should Trigger Rotation)');
        console.log('===================================================');

        // Execute again to see if rotation happens
        const actionsAfterFix = await fanControlService.processFanControl(config, sensorData, deviceStatus);

        console.log('Actions generated:');
        actionsAfterFix.forEach(action => {
            if (['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)) {
                console.log(`  ${action.deviceKey}: ${action.value ? 'ON' : 'OFF'} - ${action.reason}`);
            }
        });

        console.log('\n5. Final State Analysis');
        console.log('=======================');

        possibleKeys.forEach(key => {
            const state = mockFlowContext.get(key);
            if (state) {
                console.log(`  ✓ ${key}:`, JSON.stringify(state, null, 2));
            }
        });

        console.log('\n=== Diagnosis Summary ===');

        const newContextKey = 'fanRotationState_threshold_mode';
        const newState = mockFlowContext.get(newContextKey);

        if (newState) {
            console.log('✅ Migration to new context key successful');
            console.log(`✅ New state: group ${newState.currentGroupIndex + 1}, active=[${newState.activeGroup?.join(',') || 'none'}]`);

            const newTimeDiff = Date.now() - newState.lastRotationTime;
            if (newTimeDiff < 5000) { // Less than 5 seconds means it was just updated
                console.log('✅ Rotation state was refreshed');
            } else {
                console.log('⚠️  Rotation state may still be stuck');
            }
        } else {
            console.log('❌ Migration failed - no new state found');
        }

        console.log('\n=== Recommended Actions ===');
        console.log('1. Check logs for migration messages');
        console.log('2. Verify rotation happens in next few cycles');
        console.log('3. If still stuck, manually clear context keys in Node-RED');
        console.log('4. Monitor rotation intervals for proper timing');

        return { actionsBeforeFix, actionsAfterFix, newState };

    } catch (error) {
        console.error('Diagnosis failed:', error);
        console.error('Stack trace:', error.stack);
        return null;
    }
}

// Run the diagnosis
diagnosisAndFix().catch(console.error); 