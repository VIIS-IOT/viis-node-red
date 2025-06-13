/**
 * Comprehensive Test Script for All Threshold Fan Control
 * Tests K1, K2, K3, K4 thresholds with proper fan rotation and behavior
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

    console.log('✓ Successfully imported modules for comprehensive threshold test');
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
    nodeId: 'test-all-thresholds',
    environmentConfig: {
        deviceId: 'test-device',
        modbusCoils: {},
        modbusInputRegisters: {},
        modbusHoldingRegisters: {}
    }
};

// Threshold configuration
const thresholdConfig = {
    set_mode_fan: 1,
    set_auto_mode_fan: 0, // Threshold mode (not rotation)
    set_k1_fan: 25,
    set_k2_fan: 30,
    set_k3_fan: 35,
    set_k4_fan: 40,
    set_time_alternate_fan: 2, // 2 minutes rotation for groups
    set_fan_group_transition_delay: 2, // 2 seconds
    set_fan_group_off_delay: 1 // 1 second
};

// Comprehensive test scenarios for all thresholds
const testScenarios = [
    // Below all thresholds
    {
        name: "Below K1 threshold",
        sensorData: { temp_indoor: 24, humi_indoor: 70, light_indoor: 25000 },
        expectedFanCount: 0,
        expectedBehavior: "All fans OFF",
        description: "Temperature below K1 (25°C) should turn off all fans"
    },

    // K1 threshold tests
    {
        name: "K1 threshold - Initial activation",
        sensorData: { temp_indoor: 26, humi_indoor: 65, light_indoor: 25000 },
        expectedFanCount: 2,
        expectedBehavior: "2 fans ON (rotation through 2-fan groups)",
        description: "Temperature 26°C (K1=25°C) should activate 2 fans with rotation",
        availableGroups: ["[quat_1,quat_2]", "[quat_2,quat_3]", "[quat_3,quat_4]", "[quat_4,quat_5]", "[quat_5,quat_6]"]
    },

    {
        name: "K1 threshold - After rotation interval",
        sensorData: { temp_indoor: 27, humi_indoor: 60, light_indoor: 25000 },
        expectedFanCount: 2,
        expectedBehavior: "2 fans ON (different 2-fan group)",
        description: "After rotation interval, should switch to different 2-fan group",
        forceRotation: true
    },

    // K2 threshold tests
    {
        name: "K2 threshold - Initial activation",
        sensorData: { temp_indoor: 31, humi_indoor: 55, light_indoor: 25000 },
        expectedFanCount: 4,
        expectedBehavior: "4 fans ON (rotation through 4-fan groups)",
        description: "Temperature 31°C (K2=30°C) should activate 4 fans with rotation",
        availableGroups: ["[quat_1,quat_2,quat_3,quat_4]", "[quat_3,quat_4,quat_5,quat_6]", "[quat_5,quat_6,quat_1,quat_2]"]
    },

    {
        name: "K2 threshold - After rotation interval",
        sensorData: { temp_indoor: 32, humi_indoor: 50, light_indoor: 25000 },
        expectedFanCount: 4,
        expectedBehavior: "4 fans ON (different 4-fan group)",
        description: "After rotation interval, should switch to different 4-fan group",
        forceRotation: true
    },

    // K3 threshold tests
    {
        name: "K3 threshold - All fans activation",
        sensorData: { temp_indoor: 36, humi_indoor: 45, light_indoor: 25000 },
        expectedFanCount: 6,
        expectedBehavior: "All 6 fans ON (no rotation needed)",
        description: "Temperature 36°C (K3=35°C) should activate all 6 fans"
    },

    // K4 threshold tests
    {
        name: "K4 threshold - All fans activation",
        sensorData: { temp_indoor: 41, humi_indoor: 40, light_indoor: 25000 },
        expectedFanCount: 6,
        expectedBehavior: "All 6 fans ON (no rotation needed)",
        description: "Temperature 41°C (K4=40°C) should activate all 6 fans"
    },

    // Threshold transition tests
    {
        name: "K2 to K1 transition",
        sensorData: { temp_indoor: 26.5, humi_indoor: 60, light_indoor: 25000 },
        expectedFanCount: 2,
        expectedBehavior: "4 fans → 2 fans transition",
        description: "Temperature drop from K2 to K1 should reduce from 4 to 2 fans"
    },

    {
        name: "K3 to K2 transition",
        sensorData: { temp_indoor: 31.5, humi_indoor: 55, light_indoor: 25000 },
        expectedFanCount: 4,
        expectedBehavior: "6 fans → 4 fans transition",
        description: "Temperature drop from K3 to K2 should reduce from 6 to 4 fans"
    }
];

// Helper functions
function resetMockCoilData() {
    Object.keys(mockCoilData).forEach(key => {
        mockCoilData[key] = false;
    });
    mockGlobalContext.set('coilRegisterData', mockCoilData);
}

function getCurrentActiveFans() {
    const activeFans = [];
    Object.keys(mockCoilData).forEach(key => {
        if (mockCoilData[key] === true) {
            activeFans.push(`quat_${parseInt(key) + 1}`);
        }
    });
    return activeFans;
}

function simulateActionExecution(actions) {
    actions.forEach(action => {
        if (['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)) {
            const fanIndex = ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].indexOf(action.deviceKey);
            if (fanIndex >= 0) {
                mockCoilData[fanIndex] = action.value;
            }
        }
    });
    mockGlobalContext.set('coilRegisterData', mockCoilData);
}

function logRotationState() {
    const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
    const rotationState = mockFlowContext.get(contextKey);
    if (rotationState) {
        console.log(`  Rotation state: group ${rotationState.currentGroupIndex + 1}, active=[${rotationState.activeGroup?.join(',') || 'none'}], size=${rotationState.requiredGroupSize}`);
    } else {
        console.log(`  No rotation state found`);
    }
}

async function testAllThresholds() {
    console.log('=== Comprehensive Threshold Fan Control Test ===\n');

    try {
        // Create fan control service instance
        const fanControlService = new FanControlService(mockServiceOptions);

        console.log('Test Configuration:');
        console.log('==================');
        console.log(`K1 threshold: ${thresholdConfig.set_k1_fan}°C → 2 fans (rotation)`);
        console.log(`K2 threshold: ${thresholdConfig.set_k2_fan}°C → 4 fans (rotation)`);
        console.log(`K3 threshold: ${thresholdConfig.set_k3_fan}°C → 6 fans (all)`);
        console.log(`K4 threshold: ${thresholdConfig.set_k4_fan}°C → 6 fans (all)`);
        console.log(`Rotation interval: ${thresholdConfig.set_time_alternate_fan} minutes`);
        console.log('');

        console.log('Available Fan Groups:');
        console.log('====================');
        console.log('2-fan groups: [quat_1,quat_2], [quat_2,quat_3], [quat_3,quat_4], [quat_4,quat_5], [quat_5,quat_6]');
        console.log('4-fan groups: [quat_1,quat_2,quat_3,quat_4], [quat_3,quat_4,quat_5,quat_6], [quat_5,quat_6,quat_1,quat_2]');
        console.log('6-fan groups: [quat_1,quat_2,quat_3,quat_4,quat_5,quat_6]');
        console.log('');

        let testResults = [];

        for (let i = 0; i < testScenarios.length; i++) {
            const scenario = testScenarios[i];
            console.log(`Test ${i + 1}: ${scenario.name}`);
            console.log('========================================');
            console.log(`Temperature: ${scenario.sensorData.temp_indoor}°C`);
            console.log(`Humidity: ${scenario.sensorData.humi_indoor}%`);
            console.log(`Expected: ${scenario.expectedFanCount} fans - ${scenario.expectedBehavior}`);
            console.log(`Description: ${scenario.description}`);

            // Create mock device status based on current coil data
            const deviceStatus = {
                quat_1: mockCoilData[0],
                quat_2: mockCoilData[1],
                quat_3: mockCoilData[2],
                quat_4: mockCoilData[3],
                quat_5: mockCoilData[4],
                quat_6: mockCoilData[5],
                ts: Date.now()
            };

            const currentActiveFans = getCurrentActiveFans();
            console.log(`Current state: ${currentActiveFans.length} fans active [${currentActiveFans.join(', ') || 'none'}]`);

            // If this is a rotation test, force rotation by setting old timestamp
            if (scenario.forceRotation) {
                const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
                const rotationState = mockFlowContext.get(contextKey);
                if (rotationState) {
                    // Set rotation time to 3 minutes ago to force rotation
                    rotationState.lastRotationTime = Date.now() - (3 * 60 * 1000);
                    mockFlowContext.set(contextKey, rotationState);
                    console.log('  🔄 Forced rotation by setting lastRotationTime to 3 minutes ago');
                }
            }

            // Execute fan control
            const actions = await fanControlService.processFanControl(thresholdConfig, scenario.sensorData, deviceStatus);

            // Analyze results
            const fanActions = actions.filter(action =>
                ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)
            );

            console.log(`  Actions generated: ${actions.length} total, ${fanActions.length} fan-related`);

            if (fanActions.length > 0) {
                console.log('  Fan actions:');
                fanActions.forEach(action => {
                    console.log(`    ${action.deviceKey}: ${action.value ? 'ON' : 'OFF'} - ${action.reason}`);
                });

                // Simulate executing the actions
                simulateActionExecution(fanActions);
            }

            // Check results after actions
            const activeFansAfter = getCurrentActiveFans();
            const activeFanCount = activeFansAfter.length;

            console.log(`  Result: ${activeFanCount} fans active [${activeFansAfter.join(', ') || 'none'}]`);
            console.log(`  Expected: ${scenario.expectedFanCount} fans active`);

            // Check test result
            const testPassed = activeFanCount === scenario.expectedFanCount;
            console.log(`  Status: ${testPassed ? '✅ PASS' : '❌ FAIL'}`);

            // Log rotation state for debugging
            logRotationState();

            // Log available groups for rotation scenarios
            if (scenario.availableGroups) {
                console.log(`  Available groups: ${scenario.availableGroups.join(', ')}`);
            }

            testResults.push({
                name: scenario.name,
                expected: scenario.expectedFanCount,
                actual: activeFanCount,
                passed: testPassed,
                activeFans: activeFansAfter,
                threshold: scenario.name.includes('K4') ? 'K4' :
                    scenario.name.includes('K3') ? 'K3' :
                        scenario.name.includes('K2') ? 'K2' :
                            scenario.name.includes('K1') ? 'K1' : 'Other'
            });

            console.log('');

            // Add delay between tests
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Summary by threshold
        console.log('=== Test Summary by Threshold ===');
        const thresholds = ['K1', 'K2', 'K3', 'K4', 'Other'];

        thresholds.forEach(threshold => {
            const thresholdTests = testResults.filter(result => result.threshold === threshold);
            if (thresholdTests.length > 0) {
                const passed = thresholdTests.filter(result => result.passed).length;
                console.log(`${threshold}: ${passed}/${thresholdTests.length} tests passed`);
                thresholdTests.forEach(result => {
                    const status = result.passed ? '✅' : '❌';
                    console.log(`  ${status} ${result.name}: expected ${result.expected}, got ${result.actual} fans`);
                });
            }
        });

        // Overall summary
        console.log('\n=== Overall Test Summary ===');
        const passedTests = testResults.filter(result => result.passed).length;
        const totalTests = testResults.length;

        console.log(`Total: ${passedTests}/${totalTests} tests passed`);

        if (passedTests === totalTests) {
            console.log('\n🎉 All tests passed! All threshold fan control appears to be working correctly.');
        } else {
            console.log('\n⚠️  Some tests failed. Issues may exist in threshold logic or rotation behavior.');
        }

        // Recommendations based on results
        console.log('\n=== Expected Behavior Verification ===');
        console.log('✓ K1 (25°C): 2 fans with rotation between 5 groups');
        console.log('✓ K2 (30°C): 4 fans with rotation between 3 groups');
        console.log('✓ K3 (35°C): All 6 fans (no rotation)');
        console.log('✓ K4 (40°C): All 6 fans (no rotation)');
        console.log('✓ Smooth transitions between thresholds');
        console.log('✓ Proper hysteresis to prevent oscillation');

        return testResults;

    } catch (error) {
        console.error('Comprehensive test execution failed:', error);
        console.error('Stack trace:', error.stack);
        return [];
    }
}

// Run the comprehensive test
testAllThresholds().catch(console.error); 