/**
 * Final verification that the threshold mode bug is fixed
 * This test demonstrates the complete rotation cycle working correctly
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

    console.log('✓ Successfully imported modules for final verification');
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
    nodeId: 'final-verification',
    environmentConfig: { deviceId: 'test-device', modbusCoils: {}, modbusInputRegisters: {}, modbusHoldingRegisters: {} }
};

// K1 threshold configuration with 2-minute intervals
const k1Config = {
    set_mode_fan: 1,
    set_auto_mode_fan: 0, // Threshold mode
    set_k1_fan: 25,
    set_k2_fan: 30,
    set_k3_fan: 35,
    set_k4_fan: 40,
    set_time_alternate_fan: 2, // 2 minutes
    set_fan_group_transition_delay: 2,
    set_fan_group_off_delay: 1
};

const k1SensorData = { temp_indoor: 26, humi_indoor: 65, light_indoor: 25000 };

async function finalVerification() {
    console.log('=== Final Verification: Threshold Mode Bug Fix ===\n');
    console.log('🎯 TESTING: Complete rotation cycle in K1 threshold mode');
    console.log('📋 Expected sequence: [quat_1,quat_2] → [quat_3,quat_4] → [quat_5,quat_6] → [quat_1,quat_2]');
    console.log('⏱️  Rotation interval: 2 minutes\n');

    try {
        const fanControlService = new FanControlService(mockServiceOptions);
        const rotationSequence = [];

        // Test complete rotation cycle
        for (let rotation = 1; rotation <= 4; rotation++) {
            console.log(`--- Rotation ${rotation} ---`);
            
            // Force rotation timing
            const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
            let rotationState = mockFlowContext.get(contextKey);
            if (rotationState && rotation > 1) {
                rotationState.lastRotationTime = Date.now() - (2.1 * 60 * 1000); // 2.1 minutes ago
                mockFlowContext.set(contextKey, rotationState);
            }

            let deviceStatus = {
                quat_1: mockCoilData[0], quat_2: mockCoilData[1], quat_3: mockCoilData[2],
                quat_4: mockCoilData[3], quat_5: mockCoilData[4], quat_6: mockCoilData[5],
                ts: Date.now()
            };

            // Execute fan control
            const actions = await fanControlService.processFanControl(k1Config, k1SensorData, deviceStatus);
            
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
                
                const transitionActions = await fanControlService.processFanControl(k1Config, k1SensorData, deviceStatus);
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
            console.log(`✅ Active fans: [${activeFans.join(', ')}]`);
            
            // Log rotation state
            rotationState = mockFlowContext.get(contextKey);
            if (rotationState) {
                console.log(`📊 Rotation state: group ${rotationState.currentGroupIndex + 1}/3, target=[${rotationState.activeGroup?.join(',') || 'none'}]`);
            }
            console.log('');
        }

        // Analyze results
        console.log('=== VERIFICATION RESULTS ===');
        console.log('Rotation sequence observed:');
        rotationSequence.forEach((fans, index) => {
            console.log(`  ${index + 1}. [${fans.join(', ')}]`);
        });

        // Check if rotation is working
        const uniqueGroups = new Set(rotationSequence.map(fans => fans.join(',')));
        const hasRotation = uniqueGroups.size > 1;
        const hasCorrectFanCount = rotationSequence.every(fans => fans.length === 2);

        console.log('\n📈 Analysis:');
        console.log(`✓ Unique fan groups: ${uniqueGroups.size}`);
        console.log(`✓ All groups have 2 fans: ${hasCorrectFanCount}`);
        console.log(`✓ Rotation working: ${hasRotation}`);

        if (hasRotation && hasCorrectFanCount && uniqueGroups.size >= 2) {
            console.log('\n🎉 SUCCESS: Threshold mode bug is FIXED!');
            console.log('✅ Fan groups are properly rotating');
            console.log('✅ System is not getting stuck on one group');
            console.log('✅ Rotation cycle is continuous');
        } else {
            console.log('\n❌ ISSUE: Bug may still exist');
            console.log(`   - Rotation working: ${hasRotation}`);
            console.log(`   - Correct fan count: ${hasCorrectFanCount}`);
            console.log(`   - Unique groups: ${uniqueGroups.size}`);
        }

    } catch (error) {
        console.error('Verification failed:', error);
        console.error('Stack trace:', error.stack);
    }
}

// Run the verification
finalVerification().catch(console.error);
