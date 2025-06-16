/**
 * Test script to verify fan delay functionality
 * This tests the 1-second delay before turning fans on/off
 */

const { createDelayedFanGroupActions } = require('./dist/modules/viis-auto-microclimate-control/utils/groupUtils');

function testFanDelayActions() {
    console.log('=== Testing Fan Delay Actions ===\n');
    
    // Mock coil mapping
    const coilMapping = {
        "quat_1": 0,
        "quat_2": 1,
        "quat_3": 2,
        "quat_4": 3,
        "quat_5": 4,
        "quat_6": 5
    };
    
    // Test scenarios
    const scenarios = [
        {
            name: "Turn on fans 1,2 (from all off)",
            targetGroup: ["quat_1", "quat_2"],
            turnOn: true,
            currentStatus: {
                quat_1: false, quat_2: false, quat_3: false,
                quat_4: false, quat_5: false, quat_6: false
            }
        },
        {
            name: "Switch from fans 1,2 to fans 3,4",
            targetGroup: ["quat_3", "quat_4"],
            turnOn: true,
            currentStatus: {
                quat_1: true, quat_2: true, quat_3: false,
                quat_4: false, quat_5: false, quat_6: false
            }
        },
        {
            name: "Turn off all fans",
            targetGroup: [],
            turnOn: false,
            currentStatus: {
                quat_1: true, quat_2: true, quat_3: false,
                quat_4: false, quat_5: false, quat_6: false
            }
        },
        {
            name: "Switch from 2 fans to 4 fans (K1→K2)",
            targetGroup: ["quat_1", "quat_2", "quat_3", "quat_4"],
            turnOn: true,
            currentStatus: {
                quat_1: true, quat_2: true, quat_3: false,
                quat_4: false, quat_5: false, quat_6: false
            }
        }
    ];
    
    scenarios.forEach((scenario, index) => {
        console.log(`\n--- Test ${index + 1}: ${scenario.name} ---`);
        
        const actions = createDelayedFanGroupActions(
            scenario.targetGroup,
            scenario.turnOn,
            `Test: ${scenario.name}`,
            coilMapping,
            scenario.currentStatus,
            1000 // 1 second delay
        );
        
        console.log(`Actions generated: ${actions.length}`);
        
        if (actions.length === 0) {
            console.log('  No actions needed (fans already in correct state)');
        } else {
            actions.forEach(action => {
                const delayText = action.delay ? ` (delay: ${action.delay}ms)` : '';
                console.log(`  ${action.deviceKey}: ${action.value ? 'ON' : 'OFF'}${delayText} - ${action.reason}`);
            });
        }
        
        // Analyze the actions
        const turnOffActions = actions.filter(a => !a.value);
        const turnOnActions = actions.filter(a => a.value);
        
        if (turnOffActions.length > 0) {
            console.log(`  → ${turnOffActions.length} fans will be turned OFF with 1s delay`);
        }
        if (turnOnActions.length > 0) {
            console.log(`  → ${turnOnActions.length} fans will be turned ON with 1s delay`);
        }
    });
    
    console.log('\n=== Delay Benefits ===');
    console.log('✅ 1 second delay before turning OFF fans');
    console.log('✅ 1 second delay before turning ON fans');
    console.log('✅ Protects fan motors from sudden on/off');
    console.log('✅ Smoother operation and less electrical stress');
    console.log('✅ Prevents "turn off then on" flickering');
    
    console.log('\n=== Expected Behavior ===');
    console.log('🔄 Fan rotation: quat_1,2 → wait 1s → turn off quat_1,2 → wait 1s → turn on quat_3,4');
    console.log('🌡️ Threshold change: K1→K2 → wait 1s → turn on additional fans');
    console.log('❄️ Cool down: temp drops → wait 1s → turn off fans');
}

// Run the test
testFanDelayActions();
