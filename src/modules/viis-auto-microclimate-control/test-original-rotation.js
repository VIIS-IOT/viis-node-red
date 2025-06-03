/**
 * Test Original Rotation Mode (Without Transition Delays)
 * Tests the original rotation logic to see if the bug exists there
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
    
    console.log('✓ Successfully imported modules for original rotation test');
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
    nodeId: 'test-original-rotation',
    environmentConfig: {
        deviceId: 'test-device',
        modbusCoils: {},
        modbusInputRegisters: {},
        modbusHoldingRegisters: {}
    }
};

// Configuration without transition delays (set to 0)
const originalConfig = {
    set_mode_fan: 1,
    set_auto_mode_fan: 1, // Rotation mode
    set_gr_alternate_fan: 1, // 1-fan groups
    set_time_alternate_fan: 1, // 1 minute rotation
    set_fan_group_transition_delay: 0, // NO DELAY
    set_fan_group_off_delay: 0 // NO DELAY
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

async function testOriginalRotation() {
    console.log('=== Original Rotation Mode Test (No Transition Delays) ===\n');
    
    try {
        // Create fan control service instance
        const fanControlService = new FanControlService(mockServiceOptions);
        
        console.log('1. Configuration Analysis');
        console.log('=========================');
        console.log('Original config (no delays):', JSON.stringify(originalConfig, null, 2));
        console.log('Expected: Only 1 fan should be active at a time');
        console.log('Expected: Immediate switching without delays\n');
        
        console.log('2. First Execution');
        console.log('==================');
        
        // First execution
        const firstActions = await fanControlService.processFanControl(originalConfig, testSensorData, testDeviceStatus);
        console.log(`First execution actions: ${firstActions.length}`);
        
        const fanActions = firstActions.filter(action => 
            ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)
        );
        
        console.log('Fan-related actions:');
        fanActions.forEach(action => {
            console.log(`  ${action.deviceKey}: ${action.value} - ${action.reason}`);
        });
        
        const fansBeingTurnedOn = fanActions.filter(action => action.value === true);
        console.log(`\nFans being turned ON: ${fansBeingTurnedOn.length}`);
        
        if (fansBeingTurnedOn.length > 1) {
            console.log('🚨 BUG DETECTED: Multiple fans being turned on simultaneously!');
            console.log('Fans being turned on:', fansBeingTurnedOn.map(a => a.deviceKey));
        } else if (fansBeingTurnedOn.length === 1) {
            console.log('✓ Correct: Only 1 fan being turned on');
        } else {
            console.log('⚠️ Warning: No fans being turned on');
        }
        
        // Simulate executing actions
        fanActions.forEach(action => {
            mockCoilData[action.address] = action.value;
        });
        mockGlobalContext.set('coilRegisterData', mockCoilData);
        
        console.log('\n3. Force Rotation (No Delays)');
        console.log('==============================');
        
        // Force rotation
        const rotationState = mockFlowContext.get(CONTEXT_KEYS.FAN_ROTATION_STATE);
        if (rotationState) {
            rotationState.lastRotationTime = Date.now() - 70000; // Force rotation
            mockFlowContext.set(CONTEXT_KEYS.FAN_ROTATION_STATE, rotationState);
        }
        
        // Execute again
        const secondActions = await fanControlService.processFanControl(originalConfig, testSensorData, testDeviceStatus);
        console.log(`Second execution actions: ${secondActions.length}`);
        
        const secondFanActions = secondActions.filter(action => 
            ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)
        );
        
        console.log('Fan-related actions after forced rotation:');
        secondFanActions.forEach(action => {
            console.log(`  ${action.deviceKey}: ${action.value} - ${action.reason}`);
        });
        
        const secondFansBeingTurnedOn = secondFanActions.filter(action => action.value === true);
        const secondFansBeingTurnedOff = secondFanActions.filter(action => action.value === false);
        
        console.log(`\nFans being turned ON: ${secondFansBeingTurnedOn.length}`);
        console.log(`Fans being turned OFF: ${secondFansBeingTurnedOff.length}`);
        
        if (secondFansBeingTurnedOn.length > 1) {
            console.log('🚨 BUG DETECTED: Multiple fans being turned on simultaneously!');
            console.log('Fans being turned on:', secondFansBeingTurnedOn.map(a => a.deviceKey));
        }
        
        console.log('\n4. Test Multiple Rapid Rotations');
        console.log('=================================');
        
        // Test multiple rapid rotations to see if we can trigger the bug
        for (let i = 0; i < 5; i++) {
            console.log(`\nRapid rotation ${i + 1}:`);
            
            // Force rotation each time
            const currentRotationState = mockFlowContext.get(CONTEXT_KEYS.FAN_ROTATION_STATE);
            if (currentRotationState) {
                currentRotationState.lastRotationTime = Date.now() - 70000;
                mockFlowContext.set(CONTEXT_KEYS.FAN_ROTATION_STATE, currentRotationState);
            }
            
            const rapidActions = await fanControlService.processFanControl(originalConfig, testSensorData, testDeviceStatus);
            const rapidFanActions = rapidActions.filter(action => 
                ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].includes(action.deviceKey)
            );
            
            console.log(`  Actions: ${rapidFanActions.length}`);
            rapidFanActions.forEach(action => {
                console.log(`    ${action.deviceKey}: ${action.value}`);
            });
            
            const rapidFansOn = rapidFanActions.filter(action => action.value === true);
            if (rapidFansOn.length > 1) {
                console.log('  🚨 BUG: Multiple fans being turned on!');
                console.log('  Fans:', rapidFansOn.map(a => a.deviceKey));
            }
            
            // Simulate executing actions
            rapidFanActions.forEach(action => {
                mockCoilData[action.address] = action.value;
            });
            mockGlobalContext.set('coilRegisterData', mockCoilData);
        }
        
        console.log('\n=== Original Rotation Test Summary ===');
        console.log('Configuration: 1-fan rotation mode with NO delays');
        console.log(`First execution - Fans turned on: ${fansBeingTurnedOn.length}`);
        console.log(`Second execution - Fans turned on: ${secondFansBeingTurnedOn.length}`);
        
        if (fansBeingTurnedOn.length > 1 || secondFansBeingTurnedOn.length > 1) {
            console.log('\n🚨 BUG CONFIRMED in original rotation logic');
        } else {
            console.log('\n✓ No bug detected in original rotation logic');
        }
        
    } catch (error) {
        console.error('Original rotation test failed:', error);
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
testOriginalRotation().catch(console.error);
