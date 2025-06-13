/**
 * Debug script to reproduce the specific threshold mode bug
 * Issue: After switching to next fan group, system reverts back after 10 seconds
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

    console.log('✓ Successfully imported modules for threshold bug debug');
} catch (error) {
    console.error('Failed to import modules:', error.message);
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

// Mock current device status - start with fans 1-2 active (simulating current state)
const mockCoilData = {
    0: true,  // quat_1 - initially ON
    1: true,  // quat_2 - initially ON  
    2: false, // quat_3
    3: false, // quat_4
    4: false, // quat_5
    5: false  // quat_6
};
mockGlobalContext.set('coilRegisterData', mockCoilData);

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
    nodeId: 'debug-threshold-bug',
    environmentConfig: {
        deviceId: 'test-device',
        modbusCoils: {},
        modbusInputRegisters: {},
        modbusHoldingRegisters: {}
    }
};

// Configuration for K1 threshold with 2-minute intervals (as described in the bug)
const k1Config = {
    set_mode_fan: 1,
    set_auto_mode_fan: 0, // Threshold mode
    set_k1_fan: 25,
    set_k2_fan: 30,
    set_k3_fan: 35,
    set_k4_fan: 40,
    set_time_alternate_fan: 2, // 2 minutes as mentioned in the bug
    set_fan_group_transition_delay: 2, // 2 seconds
    set_fan_group_off_delay: 1 // 1 second
};

// Sensor data that keeps temperature in K1 zone
const k1SensorData = {
    temp_indoor: 26, // Above K1 threshold (25°C)
    humi_indoor: 65,
    light_indoor: 25000
};

async function debugThresholdBug() {
    console.log('=== Debugging Threshold Mode Fan Switching Bug ===\n');
    console.log('Issue: After switching to next fan group, system reverts back after 10 seconds');
    console.log('Expected: fans 1-2 → fans 3-4 → fans 5-6 → back to fans 1-2 (continuous cycle)');
    console.log('Actual: fans 1-2 → fans 3-4 → back to fans 1-2 (gets stuck)\n');

    try {
        const fanControlService = new FanControlService(mockServiceOptions);

        console.log('1. Initial Setup');
        console.log('================');
        console.log('Configuration:', JSON.stringify(k1Config, null, 2));
        console.log('Temperature:', k1SensorData.temp_indoor + '°C (K1 zone)');
        console.log('Rotation interval:', k1Config.set_time_alternate_fan, 'minutes');
        console.log('Initial fan state: fans 1-2 ON (simulating current state)\n');

        // Create initial device status
        let deviceStatus = {
            quat_1: mockCoilData[0],
            quat_2: mockCoilData[1],
            quat_3: mockCoilData[2],
            quat_4: mockCoilData[3],
            quat_5: mockCoilData[4],
            quat_6: mockCoilData[5],
            ts: Date.now()
        };

        console.log('2. First Execution (Current State Check)');
        console.log('========================================');

        const firstActions = await fanControlService.processFanControl(k1Config, k1SensorData, deviceStatus);
        console.log('Actions:', firstActions.length);

        // Apply actions to simulate execution
        simulateActionExecution(firstActions);
        deviceStatus = updateDeviceStatus();

        console.log('Current fans:', getCurrentActiveFans(deviceStatus));
        logRotationState('After first execution');

        console.log('\n3. Force Rotation (Simulate 2+ minutes elapsed)');
        console.log('===============================================');

        // Force rotation by setting old timestamp
        const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
        let rotationState = mockFlowContext.get(contextKey);
        if (rotationState) {
            rotationState.lastRotationTime = Date.now() - (3 * 60 * 1000); // 3 minutes ago
            mockFlowContext.set(contextKey, rotationState);
            console.log('✓ Forced rotation by setting lastRotationTime to 3 minutes ago');
        }

        const secondActions = await fanControlService.processFanControl(k1Config, k1SensorData, deviceStatus);
        console.log('Actions after forced rotation:', secondActions.length);

        simulateActionExecution(secondActions);
        deviceStatus = updateDeviceStatus();

        console.log('Fans after rotation:', getCurrentActiveFans(deviceStatus));
        logRotationState('After forced rotation');

        console.log('\n4. Test Complete Rotation Cycle');
        console.log('===============================');

        // Test multiple rotations to verify the cycle works
        const rotationTests = [
            { name: 'Second Rotation', waitMinutes: 2.1 },
            { name: 'Third Rotation', waitMinutes: 2.1 },
            { name: 'Fourth Rotation', waitMinutes: 2.1 }
        ];

        for (const test of rotationTests) {
            console.log(`\n--- ${test.name} (Force ${test.waitMinutes} minutes elapsed) ---`);

            // Force rotation by setting old timestamp
            const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
            let rotationState = mockFlowContext.get(contextKey);
            if (rotationState) {
                rotationState.lastRotationTime = Date.now() - (test.waitMinutes * 60 * 1000);
                mockFlowContext.set(contextKey, rotationState);
                console.log(`✓ Forced rotation by setting lastRotationTime to ${test.waitMinutes} minutes ago`);
            }

            const testActions = await fanControlService.processFanControl(k1Config, k1SensorData, deviceStatus);
            console.log('Actions:', testActions.length);

            simulateActionExecution(testActions);
            deviceStatus = updateDeviceStatus();

            const currentFans = getCurrentActiveFans(deviceStatus);
            console.log('Current fans after rotation:', currentFans);
            logRotationState(`After ${test.name}`);

            // Wait for transition to complete
            let transitionCycle = 0;
            while (transitionCycle < 5) {
                transitionCycle++;
                await new Promise(resolve => setTimeout(resolve, 1000));

                const transitionActions = await fanControlService.processFanControl(k1Config, k1SensorData, deviceStatus);
                if (transitionActions.length > 0) {
                    const fanActions = transitionActions.filter(action =>
                        ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)
                    );

                    if (fanActions.length > 0) {
                        console.log(`  Transition cycle ${transitionCycle}:`);
                        fanActions.forEach(action => {
                            console.log(`    ${action.deviceKey}: ${action.value ? 'ON' : 'OFF'}`);
                        });

                        simulateActionExecution(transitionActions);
                        deviceStatus = updateDeviceStatus();
                    }
                }

                const transitionState = mockFlowContext.get(CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE);
                if (!transitionState || !transitionState.isTransitioning) {
                    console.log(`  Transition completed in ${transitionCycle} cycles`);
                    break;
                }
            }

            const finalFans = getCurrentActiveFans(deviceStatus);
            console.log(`Final fans after ${test.name}: [${finalFans.join(', ')}]`);
        }

        console.log('\n=== Bug Analysis Summary ===');
        console.log('Expected behavior: Continuous rotation through fan groups');
        console.log('Expected sequence: [quat_1,quat_2] → [quat_3,quat_4] → [quat_5,quat_6] → [quat_1,quat_2] → ...');
        console.log('Final fan state:', getCurrentActiveFans(deviceStatus));

        // Check if rotation is working properly
        const finalRotationState = mockFlowContext.get(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`);
        if (finalRotationState) {
            console.log(`Final rotation state: group ${finalRotationState.currentGroupIndex + 1}, active=[${finalRotationState.activeGroup?.join(',') || 'none'}]`);

            if (finalRotationState.currentGroupIndex > 0) {
                console.log('✅ SUCCESS: Rotation cycle is working - fan groups are advancing!');
            } else {
                console.log('❌ ISSUE: Rotation may still be stuck on first group');
            }
        }

    } catch (error) {
        console.error('Debug test failed:', error);
        console.error('Stack trace:', error.stack);
    }
}

// Helper functions
function simulateActionExecution(actions) {
    actions.forEach(action => {
        if (['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)) {
            mockCoilData[action.address] = action.value;
        }
    });
    mockGlobalContext.set('coilRegisterData', mockCoilData);
}

function updateDeviceStatus() {
    return {
        quat_1: mockCoilData[0],
        quat_2: mockCoilData[1],
        quat_3: mockCoilData[2],
        quat_4: mockCoilData[3],
        quat_5: mockCoilData[4],
        quat_6: mockCoilData[5],
        ts: Date.now()
    };
}

function getCurrentActiveFans(deviceStatus) {
    return Object.keys(deviceStatus)
        .filter(key => key.startsWith('quat_') && deviceStatus[key] === true)
        .sort();
}

function logRotationState(context) {
    const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
    const rotationState = mockFlowContext.get(contextKey);
    if (rotationState) {
        console.log(`[${context}] Rotation: group ${rotationState.currentGroupIndex + 1}, active=[${rotationState.activeGroup?.join(',') || 'none'}], size=${rotationState.requiredGroupSize}`);
    }
}

function arraysEqual(a, b) {
    return a.length === b.length && a.every((val, index) => val === b[index]);
}

// Run the debug test
debugThresholdBug().catch(console.error);
