/**
 * Test Delay Calculation Logic
 * Debug why zero delays are not working as expected
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
    
    console.log('✓ Successfully imported modules for delay calculation test');
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
    nodeId: 'test-delay-calculation',
    environmentConfig: {
        deviceId: 'test-device',
        modbusCoils: {},
        modbusInputRegisters: {},
        modbusHoldingRegisters: {}
    }
};

async function testDelayCalculation() {
    console.log('=== Delay Calculation Test ===\n');
    
    try {
        // Create fan control service instance
        const fanControlService = new FanControlService(mockServiceOptions);
        
        console.log('1. Constants Check');
        console.log('==================');
        console.log('CONTROL_CONFIG:', JSON.stringify(CONTROL_CONFIG, null, 2));
        
        console.log('\n2. Test Different Configurations');
        console.log('=================================');
        
        const testConfigs = [
            {
                name: 'Zero delays explicitly set',
                config: {
                    set_fan_group_transition_delay: 0,
                    set_fan_group_off_delay: 0
                }
            },
            {
                name: 'No delay config (should use defaults)',
                config: {}
            },
            {
                name: 'Positive delays',
                config: {
                    set_fan_group_transition_delay: 2,
                    set_fan_group_off_delay: 1
                }
            },
            {
                name: 'Undefined delays',
                config: {
                    set_fan_group_transition_delay: undefined,
                    set_fan_group_off_delay: undefined
                }
            }
        ];
        
        testConfigs.forEach((test, index) => {
            console.log(`\nTest ${index + 1}: ${test.name}`);
            console.log('Config:', JSON.stringify(test.config, null, 2));
            
            // Calculate delays using the same logic as the service
            const transitionDelaySeconds = test.config.set_fan_group_transition_delay || 
                (CONTROL_CONFIG.FAN_GROUP_TRANSITION_DELAY_MS / 1000);
            const offDelaySeconds = test.config.set_fan_group_off_delay || 
                (CONTROL_CONFIG.FAN_GROUP_OFF_DELAY_MS / 1000);
            
            const transitionDelayMs = transitionDelaySeconds * 1000;
            const offDelayMs = offDelaySeconds * 1000;
            
            console.log(`  Transition delay: ${transitionDelaySeconds}s (${transitionDelayMs}ms)`);
            console.log(`  Off delay: ${offDelaySeconds}s (${offDelayMs}ms)`);
            
            const useTransitions = transitionDelayMs > 0 || offDelayMs > 0;
            console.log(`  Use transitions: ${useTransitions}`);
            
            if (test.config.set_fan_group_transition_delay === 0 && test.config.set_fan_group_off_delay === 0) {
                if (useTransitions) {
                    console.log('  🚨 BUG: Should NOT use transitions when delays are explicitly set to 0!');
                } else {
                    console.log('  ✓ Correct: Not using transitions when delays are 0');
                }
            }
        });
        
        console.log('\n3. Test Actual Service Method Calls');
        console.log('===================================');
        
        // Test with zero delays
        const zeroDelayConfig = {
            set_fan_group_transition_delay: 0,
            set_fan_group_off_delay: 0
        };
        
        // Access private methods using reflection (for testing purposes)
        const transitionDelayMs = fanControlService.getFanGroupTransitionDelayMs ? 
            fanControlService.getFanGroupTransitionDelayMs(zeroDelayConfig) : 'Method not accessible';
        const offDelayMs = fanControlService.getFanGroupOffDelayMs ? 
            fanControlService.getFanGroupOffDelayMs(zeroDelayConfig) : 'Method not accessible';
        
        console.log('Service method results:');
        console.log(`  Transition delay: ${transitionDelayMs}ms`);
        console.log(`  Off delay: ${offDelayMs}ms`);
        
        if (typeof transitionDelayMs === 'number' && typeof offDelayMs === 'number') {
            const useTransitions = transitionDelayMs > 0 || offDelayMs > 0;
            console.log(`  Use transitions: ${useTransitions}`);
            
            if (zeroDelayConfig.set_fan_group_transition_delay === 0 && zeroDelayConfig.set_fan_group_off_delay === 0) {
                if (useTransitions) {
                    console.log('  🚨 BUG CONFIRMED: Service methods return non-zero delays when config is 0!');
                } else {
                    console.log('  ✓ Service methods correctly handle zero delays');
                }
            }
        } else {
            console.log('  ⚠️ Cannot access private service methods for testing');
        }
        
        console.log('\n=== Delay Calculation Test Summary ===');
        console.log('The issue appears to be in how zero delays are handled.');
        console.log('When delays are explicitly set to 0, the system should use the original rotation logic.');
        console.log('When delays are undefined/not set, the system should use default delays and transitions.');
        
    } catch (error) {
        console.error('Delay calculation test failed:', error);
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
testDelayCalculation().catch(console.error);
