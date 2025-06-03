/**
 * Bug Reproduction Test for 1-Fan Rotation Mode
 * Tests the critical regression where all fans turn on instead of single fan rotation
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

    console.log('✓ Successfully imported modules for bug reproduction test');
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

// Mock current device status (all fans initially off)
const mockCoilData = {
    0: false, // quat_1
    1: false, // quat_2
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
    nodeId: 'test-bug-reproduction',
    environmentConfig: {
        deviceId: 'test-device',
        modbusCoils: {},
        modbusInputRegisters: {},
        modbusHoldingRegisters: {}
    }
};

// Bug reproduction configuration - 1-fan rotation mode
const bugConfig = {
    set_mode_fan: 1,
    set_auto_mode_fan: 1, // Rotation mode
    set_gr_alternate_fan: 1, // 1-fan groups (THIS IS THE BUG CASE)
    set_time_alternate_fan: 1, // 1 minute rotation
    set_fan_group_transition_delay: 2, // 2 seconds
    set_fan_group_off_delay: 1 // 1 second
};

const testSensorData = {
    temp_indoor: 28,
    humi_indoor: 65,
    light_indoor: 25000
};

const testDeviceStatus = {
    quat_1: false,
    quat_2: false,
    quat_3: false,
    quat_4: false,
    quat_5: false,
    quat_6: false,
    ts: Date.now()
};

async function reproduceBug() {
    console.log('=== Bug Reproduction Test: 1-Fan Rotation Mode ===\n');

    try {
        // Create fan control service instance
        const fanControlService = new FanControlService(mockServiceOptions);

        console.log('1. Initial Configuration Analysis');
        console.log('=================================');
        console.log('Bug configuration:', JSON.stringify(bugConfig, null, 2));
        console.log('Expected: Only 1 fan should be active at a time');
        console.log('Expected rotation: quat_1 → quat_2 → quat_3 → quat_4 → quat_5 → quat_6 → repeat\n');

        console.log('2. First Execution (Initial State)');
        console.log('===================================');

        // First execution - should initialize rotation state
        const firstActions = await fanControlService.processFanControl(bugConfig, testSensorData, testDeviceStatus);
        console.log(`First execution actions: ${firstActions.length}`);

        // Analyze the actions
        const fanActions = firstActions.filter(action =>
            ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)
        );

        console.log('Fan-related actions:');
        fanActions.forEach(action => {
            console.log(`  ${action.deviceKey}: ${action.value} - ${action.reason}`);
        });

        // Count how many fans are being turned on
        const fansBeingTurnedOn = fanActions.filter(action => action.value === true);
        console.log(`\nFans being turned ON: ${fansBeingTurnedOn.length}`);
        console.log(`Expected: 1, Actual: ${fansBeingTurnedOn.length}`);

        if (fansBeingTurnedOn.length > 1) {
            console.log('🚨 BUG DETECTED: Multiple fans being turned on simultaneously!');
            console.log('Fans being turned on:', fansBeingTurnedOn.map(a => a.deviceKey));
        } else if (fansBeingTurnedOn.length === 1) {
            console.log('✓ Correct: Only 1 fan being turned on');
        } else {
            console.log('⚠️ Warning: No fans being turned on');
        }

        console.log('\n3. Check Rotation State');
        console.log('=======================');

        const rotationState = mockFlowContext.get(CONTEXT_KEYS.FAN_ROTATION_STATE);
        if (rotationState) {
            console.log('Rotation state:', JSON.stringify(rotationState, null, 2));
            console.log(`Active group: [${rotationState.activeGroup.join(', ')}]`);
            console.log(`Group size: ${rotationState.activeGroup.length}`);

            if (rotationState.activeGroup.length > 1) {
                console.log('🚨 BUG: Active group has more than 1 fan!');
            }
        } else {
            console.log('No rotation state found');
        }

        console.log('\n4. Check Transition State');
        console.log('=========================');

        const transitionState = mockFlowContext.get(CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE);
        if (transitionState) {
            console.log('Transition state:', JSON.stringify(transitionState, null, 2));
            console.log(`Previous group: [${transitionState.previousGroup.join(', ')}]`);
            console.log(`Next group: [${transitionState.nextGroup.join(', ')}]`);

            if (transitionState.nextGroup.length > 1) {
                console.log('🚨 BUG: Next group in transition has more than 1 fan!');
            }
        } else {
            console.log('No transition state found');
        }

        console.log('\n5. Force Rotation Test');
        console.log('======================');

        // Force a rotation by setting last rotation time to past
        if (rotationState) {
            rotationState.lastRotationTime = Date.now() - 70000; // 70 seconds ago (> 1 minute)
            mockFlowContext.set(CONTEXT_KEYS.FAN_ROTATION_STATE, rotationState);
            console.log('Forced rotation by setting lastRotationTime to 70 seconds ago');
        }

        // Execute again to trigger rotation
        const secondActions = await fanControlService.processFanControl(bugConfig, testSensorData, testDeviceStatus);
        console.log(`Second execution actions: ${secondActions.length}`);

        const secondFanActions = secondActions.filter(action =>
            ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)
        );

        console.log('Fan-related actions after forced rotation:');
        secondFanActions.forEach(action => {
            console.log(`  ${action.deviceKey}: ${action.value} - ${action.reason}`);
        });

        const secondFansBeingTurnedOn = secondFanActions.filter(action => action.value === true);
        console.log(`\nFans being turned ON after rotation: ${secondFansBeingTurnedOn.length}`);

        if (secondFansBeingTurnedOn.length > 1) {
            console.log('🚨 BUG CONFIRMED: Multiple fans being turned on after rotation!');
            console.log('Fans being turned on:', secondFansBeingTurnedOn.map(a => a.deviceKey));
        }

        console.log('\n6. Simulate Complete Transition Cycle');
        console.log('=====================================');

        // Simulate the complete transition cycle by waiting for delays
        let cycle = 0;
        let maxCycles = 10;

        while (cycle < maxCycles) {
            cycle++;
            console.log(`\nTransition Cycle ${cycle}:`);

            // Wait for the off delay (1 second)
            await new Promise(resolve => setTimeout(resolve, 1100));

            const cycleActions = await fanControlService.processFanControl(bugConfig, testSensorData, testDeviceStatus);
            console.log(`  Actions: ${cycleActions.length}`);

            const cycleFanActions = cycleActions.filter(action =>
                ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)
            );

            if (cycleFanActions.length > 0) {
                console.log('  Fan actions:');
                cycleFanActions.forEach(action => {
                    console.log(`    ${action.deviceKey}: ${action.value} - ${action.reason}`);
                });

                // Simulate executing the actions to update device status
                simulateActionExecution(cycleFanActions);

                const cycleFansOn = cycleFanActions.filter(action => action.value === true);
                if (cycleFansOn.length > 1) {
                    console.log('  🚨 BUG: Multiple fans being turned on!');
                    console.log('  Fans:', cycleFansOn.map(a => a.deviceKey));
                }
            } else {
                console.log('  No fan actions');
            }

            const currentTransitionState = mockFlowContext.get(CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE);
            if (currentTransitionState) {
                console.log(`  Transition phase: ${currentTransitionState.phase}`);
            } else {
                console.log('  Transition completed');
                break;
            }
        }

        console.log('\n=== Bug Analysis Summary ===');
        console.log('Configuration: 1-fan rotation mode');
        console.log(`First execution - Fans turned on: ${fansBeingTurnedOn.length}`);
        console.log(`Second execution - Fans turned on: ${secondFansBeingTurnedOn.length}`);

        if (fansBeingTurnedOn.length > 1 || secondFansBeingTurnedOn.length > 1) {
            console.log('\n🚨 CRITICAL BUG CONFIRMED');
            console.log('Expected: Only 1 fan active at a time');
            console.log('Actual: Multiple fans being activated simultaneously');
            console.log('\nThis confirms the regression in the fan group transition mechanism.');
        } else {
            console.log('\n✓ No bug detected in this test run');
        }

    } catch (error) {
        console.error('Bug reproduction test failed:', error);
        console.error('Stack trace:', error.stack);
    }
}

// Helper function to simulate executing actions and update mock device status
function simulateActionExecution(actions) {
    actions.forEach(action => {
        if (['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)) {
            mockCoilData[action.address] = action.value;
            console.log(`  Simulated: ${action.deviceKey} (address ${action.address}) = ${action.value}`);
        }
    });
    // Update the global context
    mockGlobalContext.set('coilRegisterData', mockCoilData);
}

// Run the bug reproduction test
reproduceBug().catch(console.error);
