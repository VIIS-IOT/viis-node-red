/**
 * Comprehensive test for ALL threshold levels (K1, K2, K3, K4)
 * Verifies that the bug fix works correctly across all temperature thresholds
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
    quat_1: 0, quat_2: 1, quat_3: 2, quat_4: 3, quat_5: 4, quat_6: 5
});

const mockCoilData = { 0: false, 1: false, 2: false, 3: false, 4: false, 5: false };
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
    environmentConfig: { deviceId: 'test-device', modbusCoils: {}, modbusInputRegisters: {}, modbusHoldingRegisters: {} }
};

// Configuration for all thresholds
const thresholdConfig = {
    set_mode_fan: 1,
    set_auto_mode_fan: 0, // Threshold mode
    set_k1_fan: 25,  // K1: 2 fans
    set_k2_fan: 30,  // K2: 4 fans  
    set_k3_fan: 35,  // K3: 6 fans (all)
    set_k4_fan: 40,  // K4: 6 fans (all)
    set_time_alternate_fan: 2, // 2 minutes
    set_fan_group_transition_delay: 2,
    set_fan_group_off_delay: 1
};

// Test scenarios for each threshold
const testScenarios = [
    {
        name: 'K1 Threshold (2 fans)',
        temperature: 26, // Above K1 (25°C)
        expectedFanCount: 2,
        expectedRotation: true,
        description: 'Should activate 2 fans with rotation between 3 groups'
    },
    {
        name: 'K2 Threshold (4 fans)', 
        temperature: 31, // Above K2 (30°C)
        expectedFanCount: 4,
        expectedRotation: true,
        description: 'Should activate 4 fans with rotation between 3 groups'
    },
    {
        name: 'K3 Threshold (6 fans)',
        temperature: 36, // Above K3 (35°C)
        expectedFanCount: 6,
        expectedRotation: false,
        description: 'Should activate all 6 fans (no rotation needed)'
    },
    {
        name: 'K4 Threshold (6 fans)',
        temperature: 41, // Above K4 (40°C)
        expectedFanCount: 6,
        expectedRotation: false,
        description: 'Should activate all 6 fans (no rotation needed)'
    }
];

async function testAllThresholds() {
    console.log('=== Comprehensive Test: ALL Threshold Levels ===\n');
    console.log('🎯 Testing K1, K2, K3, and K4 thresholds');
    console.log('🔄 Verifying rotation behavior for each threshold\n');

    const results = [];

    for (const scenario of testScenarios) {
        console.log(`--- ${scenario.name} ---`);
        console.log(`Temperature: ${scenario.temperature}°C`);
        console.log(`Expected: ${scenario.expectedFanCount} fans, rotation: ${scenario.expectedRotation}`);
        console.log(`Description: ${scenario.description}\n`);

        try {
            // Reset environment for each test
            mockFlowContext.clear();
            Object.keys(mockCoilData).forEach(key => mockCoilData[key] = false);
            mockGlobalContext.set('coilRegisterData', mockCoilData);

            const fanControlService = new FanControlService(mockServiceOptions);
            const sensorData = { temp_indoor: scenario.temperature, humi_indoor: 65, light_indoor: 25000 };
            
            const rotationSequence = [];
            const testRotations = scenario.expectedRotation ? 3 : 1; // Test rotation only if expected

            for (let rotation = 1; rotation <= testRotations; rotation++) {
                console.log(`  Rotation ${rotation}:`);
                
                // Force rotation timing for subsequent rotations
                if (rotation > 1) {
                    const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
                    let rotationState = mockFlowContext.get(contextKey);
                    if (rotationState) {
                        rotationState.lastRotationTime = Date.now() - (2.1 * 60 * 1000);
                        mockFlowContext.set(contextKey, rotationState);
                    }
                }

                let deviceStatus = {
                    quat_1: mockCoilData[0], quat_2: mockCoilData[1], quat_3: mockCoilData[2],
                    quat_4: mockCoilData[3], quat_5: mockCoilData[4], quat_6: mockCoilData[5],
                    ts: Date.now()
                };

                // Execute fan control
                const actions = await fanControlService.processFanControl(thresholdConfig, sensorData, deviceStatus);
                
                // Apply actions
                actions.forEach(action => {
                    if (['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)) {
                        mockCoilData[action.address] = action.value;
                    }
                });
                mockGlobalContext.set('coilRegisterData', mockCoilData);

                // Wait for transitions to complete
                let transitionCycles = 0;
                while (transitionCycles < 5) {
                    transitionCycles++;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    deviceStatus = {
                        quat_1: mockCoilData[0], quat_2: mockCoilData[1], quat_3: mockCoilData[2],
                        quat_4: mockCoilData[3], quat_5: mockCoilData[4], quat_6: mockCoilData[5],
                        ts: Date.now()
                    };
                    
                    const transitionActions = await fanControlService.processFanControl(thresholdConfig, sensorData, deviceStatus);
                    transitionActions.forEach(action => {
                        if (['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)) {
                            mockCoilData[action.address] = action.value;
                        }
                    });
                    mockGlobalContext.set('coilRegisterData', mockCoilData);
                    
                    const transitionState = mockFlowContext.get(CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE);
                    if (!transitionState || !transitionState.isTransitioning) {
                        break;
                    }
                }

                // Get final active fans
                const activeFans = Object.keys(mockCoilData)
                    .filter(key => mockCoilData[key] === true)
                    .map(key => `quat_${parseInt(key) + 1}`)
                    .sort();

                rotationSequence.push(activeFans);
                console.log(`    Active fans: [${activeFans.join(', ')}] (${activeFans.length} fans)`);
            }

            // Analyze results
            const fanCounts = rotationSequence.map(fans => fans.length);
            const correctFanCount = fanCounts.every(count => count === scenario.expectedFanCount);
            const uniqueGroups = new Set(rotationSequence.map(fans => fans.join(',')));
            const hasRotation = uniqueGroups.size > 1;
            const rotationWorking = scenario.expectedRotation ? hasRotation : true; // For K3/K4, rotation not expected

            console.log(`\n  📊 Analysis:`);
            console.log(`    ✓ Correct fan count (${scenario.expectedFanCount}): ${correctFanCount}`);
            console.log(`    ✓ Unique groups: ${uniqueGroups.size}`);
            console.log(`    ✓ Rotation working: ${rotationWorking}`);

            const testPassed = correctFanCount && rotationWorking;
            console.log(`    ${testPassed ? '✅ PASS' : '❌ FAIL'}: ${scenario.name}`);

            results.push({
                name: scenario.name,
                temperature: scenario.temperature,
                expectedFanCount: scenario.expectedFanCount,
                actualFanCounts: fanCounts,
                expectedRotation: scenario.expectedRotation,
                actualRotation: hasRotation,
                uniqueGroups: uniqueGroups.size,
                rotationSequence: rotationSequence,
                passed: testPassed
            });

        } catch (error) {
            console.error(`    ❌ ERROR in ${scenario.name}:`, error.message);
            results.push({
                name: scenario.name,
                passed: false,
                error: error.message
            });
        }

        console.log('');
    }

    // Final summary
    console.log('=== COMPREHENSIVE TEST RESULTS ===');
    const passedTests = results.filter(r => r.passed).length;
    const totalTests = results.length;
    
    console.log(`Overall: ${passedTests}/${totalTests} tests passed\n`);

    results.forEach(result => {
        const status = result.passed ? '✅' : '❌';
        console.log(`${status} ${result.name}`);
        if (result.passed && !result.error) {
            console.log(`   Fan counts: ${result.actualFanCounts.join(', ')} (expected: ${result.expectedFanCount})`);
            console.log(`   Rotation: ${result.actualRotation} (expected: ${result.expectedRotation})`);
            console.log(`   Unique groups: ${result.uniqueGroups}`);
        } else if (result.error) {
            console.log(`   Error: ${result.error}`);
        }
    });

    if (passedTests === totalTests) {
        console.log('\n🎉 SUCCESS: All threshold levels working correctly!');
        console.log('✅ K1, K2, K3, and K4 thresholds all pass');
        console.log('✅ Rotation logic works for K1 and K2');
        console.log('✅ All-fan activation works for K3 and K4');
        console.log('✅ The bug fix is comprehensive and complete!');
    } else {
        console.log('\n⚠️ ISSUES DETECTED: Some threshold levels have problems');
        console.log('The bug fix may need additional work for certain thresholds');
    }

    return results;
}

// Run the comprehensive test
testAllThresholds().catch(console.error);
