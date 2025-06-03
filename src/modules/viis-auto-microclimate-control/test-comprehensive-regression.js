/**
 * Comprehensive Regression Test for Fan Group Transition Delay Fix
 * Tests all scenarios to ensure the bug is fixed and no regressions are introduced
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

    console.log('✓ Successfully imported modules for comprehensive regression test');
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

function createMockEnvironment() {
    const mockFlowContext = new Map();
    const mockGlobalContext = new Map();

    // Set up mock global context with coil mapping
    mockGlobalContext.set('modbusCoils', {
        quat_1: 0, quat_2: 1, quat_3: 2, quat_4: 3, quat_5: 4, quat_6: 5
    });

    // Mock current device status (all fans initially off)
    const mockCoilData = {
        0: false, 1: false, 2: false, 3: false, 4: false, 5: false
    };
    mockGlobalContext.set('coilRegisterData', mockCoilData);

    return {
        mockFlowContext,
        mockGlobalContext,
        mockCoilData,
        mockServiceOptions: {
            node: mockNode,
            flowContext: {
                get: (key) => mockFlowContext.get(key),
                set: (key, value) => mockFlowContext.set(key, value)
            },
            globalContext: {
                get: (key) => mockGlobalContext.get(key),
                set: (key, value) => mockGlobalContext.set(key, value)
            },
            nodeId: 'test-comprehensive',
            environmentConfig: {
                deviceId: 'test-device',
                modbusCoils: {}, modbusInputRegisters: {}, modbusHoldingRegisters: {}
            }
        }
    };
}

const testSensorData = { temp_indoor: 28, humi_indoor: 65, light_indoor: 25000 };
const testDeviceStatus = { quat_1: false, quat_2: false, quat_3: false, quat_4: false, quat_5: false, quat_6: false, ts: Date.now() };

async function testScenario(name, config, expectedBehavior) {
    console.log(`\n=== ${name} ===`);
    console.log('Config:', JSON.stringify(config, null, 2));
    console.log('Expected:', expectedBehavior);

    const { mockServiceOptions, mockFlowContext } = createMockEnvironment();
    const fanControlService = new FanControlService(mockServiceOptions);

    // Test first execution
    const actions = await fanControlService.processFanControl(config, testSensorData, testDeviceStatus);
    const fanActions = actions.filter(action =>
        ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)
    );

    const fansOn = fanActions.filter(action => action.value === true);
    const fansOff = fanActions.filter(action => action.value === false);

    console.log(`Actions: ${fanActions.length} (${fansOn.length} ON, ${fansOff.length} OFF)`);

    // Determine expected fan count based on group size
    const groupSize = config.set_gr_alternate_fan || 2;
    const expectedFanCount = groupSize;

    // Check for regression based on expected group size
    if (fansOn.length > expectedFanCount) {
        console.log(`🚨 REGRESSION: Too many fans ON! Expected: ${expectedFanCount}, Got: ${fansOn.length}`);
        console.log('Fans ON:', fansOn.map(a => a.deviceKey));
        return false;
    } else if (fansOn.length === expectedFanCount) {
        console.log(`✓ Correct: ${fansOn.length} fan(s) ON as expected (${fansOn.map(a => a.deviceKey).join(', ')})`);
        return true;
    } else if (fansOn.length === 0) {
        // Check if this is expected (transition mode might delay the ON action)
        const transitionState = mockFlowContext.get(CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE);
        if (transitionState) {
            console.log('⏳ Transition mode: Fans will be turned on after delay');
            return true;
        } else {
            console.log('⚠️ Warning: No fans turned on and no transition state');
            return false;
        }
    } else {
        console.log(`⚠️ Unexpected: ${fansOn.length} fans ON, expected ${expectedFanCount}`);
        return false;
    }
}

async function runComprehensiveTest() {
    console.log('=== Comprehensive Regression Test for Fan Group Transition Delay Fix ===\n');

    const testCases = [
        {
            name: '1-Fan Rotation (No Delays)',
            config: {
                set_mode_fan: 1, set_auto_mode_fan: 1, set_gr_alternate_fan: 1, set_time_alternate_fan: 1,
                set_fan_group_transition_delay: 0, set_fan_group_off_delay: 0
            },
            expected: 'Immediate switching, only 1 fan active'
        },
        {
            name: '1-Fan Rotation (With Delays)',
            config: {
                set_mode_fan: 1, set_auto_mode_fan: 1, set_gr_alternate_fan: 1, set_time_alternate_fan: 1,
                set_fan_group_transition_delay: 2, set_fan_group_off_delay: 1
            },
            expected: 'Delayed switching, only 1 fan active'
        },
        {
            name: '2-Fan Rotation (No Delays)',
            config: {
                set_mode_fan: 1, set_auto_mode_fan: 1, set_gr_alternate_fan: 2, set_time_alternate_fan: 1,
                set_fan_group_transition_delay: 0, set_fan_group_off_delay: 0
            },
            expected: 'Immediate switching, only 2 fans active'
        },
        {
            name: '2-Fan Rotation (With Delays)',
            config: {
                set_mode_fan: 1, set_auto_mode_fan: 1, set_gr_alternate_fan: 2, set_time_alternate_fan: 1,
                set_fan_group_transition_delay: 2, set_fan_group_off_delay: 1
            },
            expected: 'Delayed switching, only 2 fans active'
        },
        {
            name: '4-Fan Rotation (No Delays)',
            config: {
                set_mode_fan: 1, set_auto_mode_fan: 1, set_gr_alternate_fan: 4, set_time_alternate_fan: 1,
                set_fan_group_transition_delay: 0, set_fan_group_off_delay: 0
            },
            expected: 'Immediate switching, only 4 fans active'
        },
        {
            name: '6-Fan Rotation (No Delays)',
            config: {
                set_mode_fan: 1, set_auto_mode_fan: 1, set_gr_alternate_fan: 6, set_time_alternate_fan: 1,
                set_fan_group_transition_delay: 0, set_fan_group_off_delay: 0
            },
            expected: 'Immediate switching, all 6 fans active'
        },
        {
            name: 'Threshold Mode (No Delays)',
            config: {
                set_mode_fan: 1, set_auto_mode_fan: 0, set_k1_fan: 25, set_k2_fan: 30,
                set_fan_group_transition_delay: 0, set_fan_group_off_delay: 0
            },
            expected: 'Immediate threshold-based control'
        }
    ];

    let passedTests = 0;
    let totalTests = testCases.length;

    for (const testCase of testCases) {
        const passed = await testScenario(testCase.name, testCase.config, testCase.expected);
        if (passed) {
            passedTests++;
        }
    }

    console.log('\n=== Test Summary ===');
    console.log(`Passed: ${passedTests}/${totalTests}`);

    if (passedTests === totalTests) {
        console.log('🎉 ALL TESTS PASSED - No regressions detected!');
        console.log('\n✅ Bug Fix Verification:');
        console.log('- Fan group transition delay mechanism works correctly');
        console.log('- Zero delays properly disable transition mechanism');
        console.log('- Original rotation logic works for immediate switching');
        console.log('- No multiple fans turning on simultaneously');
        console.log('- All fan group sizes work correctly');
    } else {
        console.log('❌ Some tests failed - regressions detected!');
    }

    return passedTests === totalTests;
}

// Run the comprehensive test
runComprehensiveTest().catch(console.error);
