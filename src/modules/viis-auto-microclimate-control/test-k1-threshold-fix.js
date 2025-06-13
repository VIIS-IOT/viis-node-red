/**
 * Test script for K1 Threshold Fan Control Bug Fix
 * Simulates the K1 threshold bug where fan switching doesn't work correctly
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

    console.log('✓ Successfully imported modules for K1 threshold test');
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
    nodeId: 'test-k1-threshold-fix',
    environmentConfig: {
        deviceId: 'test-device',
        modbusCoils: {},
        modbusInputRegisters: {},
        modbusHoldingRegisters: {}
    }
};

// K1 threshold configuration
const k1Config = {
    set_mode_fan: 1,
    set_auto_mode_fan: 0, // Threshold mode (not rotation)
    set_k1_fan: 25,
    set_k2_fan: 30,
    set_k3_fan: 35,
    set_k4_fan: 40,
    set_time_alternate_fan: 2, // 2 minutes rotation for K1 groups
    set_fan_group_transition_delay: 2, // 2 seconds
    set_fan_group_off_delay: 1 // 1 second
};

// Test scenarios
const testScenarios = [
    {
        name: "K1 threshold - First activation",
        sensorData: { temp_indoor: 26, humi_indoor: 65, light_indoor: 25000 },
        expectedFanCount: 2,
        description: "Temperature at 26°C (K1=25°C) should activate 2 fans"
    },
    {
        name: "K1 threshold - After rotation interval",
        sensorData: { temp_indoor: 27, humi_indoor: 60, light_indoor: 25000 },
        expectedFanCount: 2,
        description: "After rotation interval, should switch to different 2-fan group"
    },
    {
        name: "Below K1 threshold",
        sensorData: { temp_indoor: 24, humi_indoor: 70, light_indoor: 25000 },
        expectedFanCount: 0,
        description: "Temperature below K1 should turn off all fans"
    }
];

async function testK1ThresholdFix() {
    console.log('=== K1 Threshold Fan Control Bug Fix Test ===\n');

    try {
        // Create fan control service instance
        const fanControlService = new FanControlService(mockServiceOptions);

        console.log('Test Configuration:');
        console.log('==================');
        console.log('K1 threshold:', k1Config.set_k1_fan + '°C');
        console.log('Expected behavior: 2 fans active at K1, rotating every', k1Config.set_time_alternate_fan, 'minutes');
        console.log('Available 2-fan groups:');
        console.log('  - Group 1: [quat_1, quat_2]');
        console.log('  - Group 2: [quat_2, quat_3]');
        console.log('  - Group 3: [quat_3, quat_4]');
        console.log('  - Group 4: [quat_4, quat_5]');
        console.log('  - Group 5: [quat_5, quat_6]');
        console.log('');

        let testResults = [];

        for (let i = 0; i < testScenarios.length; i++) {
            const scenario = testScenarios[i];
            console.log(`Test ${i + 1}: ${scenario.name}`);
            console.log('=====================================');
            console.log(`Temperature: ${scenario.sensorData.temp_indoor}°C`);
            console.log(`Humidity: ${scenario.sensorData.humi_indoor}%`);
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

            console.log('Current device status:', JSON.stringify(deviceStatus));

            // If this is the rotation test, force rotation by setting old timestamp
            if (scenario.name.includes("After rotation interval")) {
                const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
                const rotationState = mockFlowContext.get(contextKey);
                if (rotationState) {
                    // Set rotation time to 3 minutes ago to force rotation
                    rotationState.lastRotationTime = Date.now() - (3 * 60 * 1000);
                    mockFlowContext.set(contextKey, rotationState);
                    console.log('Forced rotation by setting lastRotationTime to 3 minutes ago');
                }
            }

            // Execute fan control
            const actions = await fanControlService.processFanControl(k1Config, scenario.sensorData, deviceStatus);

            // Analyze results
            const fanActions = actions.filter(action =>
                ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)
            );

            console.log(`Actions generated: ${actions.length} total, ${fanActions.length} fan-related`);

            if (fanActions.length > 0) {
                console.log('Fan actions:');
                fanActions.forEach(action => {
                    console.log(`  ${action.deviceKey}: ${action.value ? 'ON' : 'OFF'} - ${action.reason}`);
                });

                // Simulate executing the actions
                fanActions.forEach(action => {
                    const fanIndex = ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].indexOf(action.deviceKey);
                    if (fanIndex >= 0) {
                        mockCoilData[fanIndex] = action.value;
                    }
                });
                mockGlobalContext.set('coilRegisterData', mockCoilData);
            }

            // Count active fans after actions
            const activeFans = Object.keys(mockCoilData).filter(key => mockCoilData[key] === true);
            const activeFanCount = activeFans.length;
            const activeFanNames = activeFans.map(key => `quat_${parseInt(key) + 1}`);

            console.log(`Result: ${activeFanCount} fans active [${activeFanNames.join(', ')}]`);
            console.log(`Expected: ${scenario.expectedFanCount} fans active`);

            // Check test result
            const testPassed = activeFanCount === scenario.expectedFanCount;
            console.log(`Status: ${testPassed ? '✅ PASS' : '❌ FAIL'}`);

            // Log rotation state for debugging
            const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
            const rotationState = mockFlowContext.get(contextKey);
            if (rotationState) {
                console.log(`Rotation state: group ${rotationState.currentGroupIndex + 1}, active=[${rotationState.activeGroup?.join(',') || 'none'}]`);
            }

            testResults.push({
                name: scenario.name,
                expected: scenario.expectedFanCount,
                actual: activeFanCount,
                passed: testPassed,
                activeFans: activeFanNames
            });

            console.log('');

            // Add delay between tests
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Summary
        console.log('=== Test Summary ===');
        const passedTests = testResults.filter(result => result.passed).length;
        const totalTests = testResults.length;

        console.log(`Passed: ${passedTests}/${totalTests} tests`);

        testResults.forEach(result => {
            const status = result.passed ? '✅' : '❌';
            console.log(`${status} ${result.name}: expected ${result.expected}, got ${result.actual} fans ${result.activeFans.length > 0 ? '[' + result.activeFans.join(', ') + ']' : ''}`);
        });

        if (passedTests === totalTests) {
            console.log('\n🎉 All tests passed! K1 threshold bug appears to be fixed.');
        } else {
            console.log('\n⚠️  Some tests failed. Bug may still exist or additional issues found.');
        }

        return testResults;

    } catch (error) {
        console.error('Test execution failed:', error);
        console.error('Stack trace:', error.stack);
        return [];
    }
}

// Run the test
testK1ThresholdFix().catch(console.error); 