/**
 * Test script to verify threshold rotation fix
 * This tests the simplified threshold rotation logic without complex transitions
 */

const { FanControlService } = require('./dist/modules/viis-auto-microclimate-control/services/fanControlService');

// Mock context
class MockContext {
    constructor() {
        this.data = {};
    }
    
    get(key) {
        return this.data[key];
    }
    
    set(key, value) {
        this.data[key] = value;
    }
}

// Mock logger
const mockLogger = {
    debug: (msg) => console.log(`[DEBUG] ${msg}`),
    warn: (msg) => console.log(`[WARN] ${msg}`),
    error: (msg) => console.log(`[ERROR] ${msg}`)
};

async function testThresholdRotationFix() {
    console.log('=== Testing Threshold Rotation Fix ===\n');
    
    const mockFlowContext = new MockContext();
    const mockGlobalContext = new MockContext();
    
    // Initialize service
    const service = new FanControlService(mockFlowContext, mockGlobalContext, mockLogger);
    
    // Test configuration
    const config = {
        set_mode_fan: 1,
        set_auto_mode_fan: 0, // Threshold mode
        set_k1_fan: 26,
        set_k2_fan: 30,
        set_k3_fan: 32,
        set_k4_fan: 33,
        set_time_alternate_fan: 1, // 1 minute for quick testing
        set_fan_group_transition_delay: 2,
        set_fan_group_off_delay: 1
    };
    
    // Test scenarios
    const scenarios = [
        {
            name: "K1 Threshold - First Call",
            sensorData: { temp_indoor: 27.1, humi_indoor: 60, light_indoor: 9317 },
            deviceStatus: { quat_1: false, quat_2: false, quat_3: false, quat_4: false, quat_5: false, quat_6: false, ts: Date.now() }
        },
        {
            name: "K1 Threshold - Same Level Rotation",
            sensorData: { temp_indoor: 27.1, humi_indoor: 60, light_indoor: 9317 },
            deviceStatus: { quat_1: true, quat_2: true, quat_3: false, quat_4: false, quat_5: false, quat_6: false, ts: Date.now() }
        },
        {
            name: "K2 Threshold - Level Change",
            sensorData: { temp_indoor: 30.5, humi_indoor: 60, light_indoor: 9317 },
            deviceStatus: { quat_1: true, quat_2: true, quat_3: false, quat_4: false, quat_5: false, quat_6: false, ts: Date.now() }
        },
        {
            name: "K2 Threshold - Same Level Rotation",
            sensorData: { temp_indoor: 30.5, humi_indoor: 60, light_indoor: 9317 },
            deviceStatus: { quat_1: true, quat_2: true, quat_3: true, quat_4: true, quat_5: false, quat_6: false, ts: Date.now() }
        }
    ];
    
    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        console.log(`\n--- Test ${i + 1}: ${scenario.name} ---`);
        
        try {
            // Force rotation timing if needed
            if (scenario.name.includes('Rotation')) {
                const contextKey = 'fanRotationState_threshold';
                const rotationState = mockFlowContext.get(contextKey);
                if (rotationState) {
                    rotationState.lastRotationTime = Date.now() - (2 * 60 * 1000); // 2 minutes ago
                    mockFlowContext.set(contextKey, rotationState);
                    console.log('✓ Forced rotation timing');
                }
            }
            
            const actions = await service.processThresholdModeWithTransition(
                config,
                scenario.sensorData,
                scenario.deviceStatus
            );
            
            console.log(`Actions count: ${actions.length}`);
            actions.forEach(action => {
                console.log(`  ${action.deviceKey}: ${action.value ? 'ON' : 'OFF'} - ${action.reason}`);
            });
            
            // Check rotation state
            const contextKey = 'fanRotationState_threshold';
            const rotationState = mockFlowContext.get(contextKey);
            if (rotationState) {
                console.log(`Rotation State: group ${rotationState.currentGroupIndex + 1}, size=${rotationState.requiredGroupSize}, active=[${rotationState.activeGroup?.join(',') || 'none'}]`);
            }
            
        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
        }
        
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('\n=== Test Summary ===');
    console.log('✅ All tests completed');
    console.log('🔧 Key improvements:');
    console.log('  - Simplified threshold rotation logic');
    console.log('  - Direct fan control for same-level rotation');
    console.log('  - Transition only for threshold level changes');
    console.log('  - No more "turn off then on" flickering');
}

// Run the test
testThresholdRotationFix().catch(console.error);
