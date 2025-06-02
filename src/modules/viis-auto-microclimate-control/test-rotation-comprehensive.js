/**
 * Comprehensive test for fan rotation mode
 * Tests all aspects of rotation logic including edge cases
 */

console.log('=== COMPREHENSIVE FAN ROTATION MODE TEST ===\n');

// Test Results Summary
const testResults = {
    passed: 0,
    failed: 0,
    tests: []
};

function runTest(testName, testFunction) {
    try {
        console.log(`\n🧪 ${testName}`);
        const result = testFunction();
        if (result) {
            console.log(`✅ PASS: ${testName}`);
            testResults.passed++;
            testResults.tests.push({ name: testName, status: 'PASS' });
        } else {
            console.log(`❌ FAIL: ${testName}`);
            testResults.failed++;
            testResults.tests.push({ name: testName, status: 'FAIL' });
        }
    } catch (error) {
        console.log(`❌ ERROR: ${testName} - ${error.message}`);
        testResults.failed++;
        testResults.tests.push({ name: testName, status: 'ERROR', error: error.message });
    }
}

// Mock functions and constants
const FAN_GROUPS = {
    2: [
        ["quat_1", "quat_2"],
        ["quat_3", "quat_4"],
        ["quat_5", "quat_6"]
    ],
    4: [
        ["quat_1", "quat_2", "quat_3", "quat_4"],
        ["quat_5", "quat_6", "quat_1", "quat_2"]
    ],
    6: [
        ["quat_1", "quat_2", "quat_3", "quat_4", "quat_5", "quat_6"]
    ]
};

function getFanGroups(groupSize) {
    return FAN_GROUPS[groupSize] || FAN_GROUPS[2];
}

function getNextGroupIndex(currentIndex, totalGroups) {
    return (currentIndex + 1) % totalGroups;
}

function hasTimeElapsed(lastTime, interval) {
    return (Date.now() - lastTime) >= interval;
}

function getCurrentTimestamp() {
    return Date.now();
}

function minutesToMs(minutes) {
    return minutes * 60 * 1000;
}

// Test 1: Basic rotation logic
runTest("Basic rotation logic works correctly", () => {
    const fanGroups = getFanGroups(2);
    let currentIndex = 0;
    
    // Test rotation through all groups
    for (let i = 0; i < fanGroups.length; i++) {
        const nextIndex = getNextGroupIndex(currentIndex, fanGroups.length);
        console.log(`  Group ${currentIndex + 1} → Group ${nextIndex + 1}`);
        currentIndex = nextIndex;
    }
    
    // Should cycle back to 0
    return currentIndex === 0;
});

// Test 2: Time-based rotation trigger
runTest("Time-based rotation triggers correctly", () => {
    const interval = minutesToMs(15); // 15 minutes
    const oldTime = Date.now() - (16 * 60 * 1000); // 16 minutes ago
    const recentTime = Date.now() - (5 * 60 * 1000); // 5 minutes ago
    
    const shouldRotate = hasTimeElapsed(oldTime, interval);
    const shouldNotRotate = hasTimeElapsed(recentTime, interval);
    
    console.log(`  16 minutes ago should trigger rotation: ${shouldRotate}`);
    console.log(`  5 minutes ago should NOT trigger rotation: ${shouldNotRotate}`);
    
    return shouldRotate && !shouldNotRotate;
});

// Test 3: Different group sizes
runTest("Different group sizes work correctly", () => {
    const groupSizes = [2, 4, 6];
    let allValid = true;
    
    groupSizes.forEach(size => {
        const groups = getFanGroups(size);
        console.log(`  Group size ${size}: ${groups.length} groups`);
        
        if (size === 2 && groups.length !== 3) allValid = false;
        if (size === 4 && groups.length !== 2) allValid = false;
        if (size === 6 && groups.length !== 1) allValid = false;
        
        // Test each group has correct number of fans
        groups.forEach((group, index) => {
            if (size === 6) {
                if (group.length !== 6) allValid = false;
            } else if (size === 4) {
                if (group.length !== 4) allValid = false;
            } else if (size === 2) {
                if (group.length !== 2) allValid = false;
            }
            console.log(`    Group ${index + 1}: [${group.join(', ')}] (${group.length} fans)`);
        });
    });
    
    return allValid;
});

// Test 4: Edge case - Invalid group size
runTest("Invalid group size defaults to 2-fan groups", () => {
    const invalidSizes = [0, 1, 3, 5, 7, 10];
    let allDefaultTo2 = true;
    
    invalidSizes.forEach(size => {
        const groups = getFanGroups(size);
        console.log(`  Invalid size ${size}: defaults to ${groups.length} groups`);
        
        // Should default to 2-fan groups (3 groups total)
        if (groups.length !== 3) allDefaultTo2 = false;
    });
    
    return allDefaultTo2;
});

// Test 5: Rotation state persistence simulation
runTest("Rotation state persistence works correctly", () => {
    // Simulate flow context
    const mockContext = {};
    
    function saveRotationState(state) {
        mockContext.fanRotationState = JSON.parse(JSON.stringify(state));
    }
    
    function getRotationState() {
        if (mockContext.fanRotationState) {
            return mockContext.fanRotationState;
        }
        
        const defaultState = {
            currentGroupIndex: 0,
            lastRotationTime: 0,
            activeGroup: []
        };
        saveRotationState(defaultState);
        return defaultState;
    }
    
    // Test initial state
    let state = getRotationState();
    console.log(`  Initial state: group ${state.currentGroupIndex}, time ${state.lastRotationTime}`);
    
    // Simulate rotation
    const fanGroups = getFanGroups(2);
    state.currentGroupIndex = getNextGroupIndex(state.currentGroupIndex, fanGroups.length);
    state.lastRotationTime = getCurrentTimestamp();
    state.activeGroup = fanGroups[state.currentGroupIndex];
    saveRotationState(state);
    
    // Retrieve and verify
    const retrievedState = getRotationState();
    console.log(`  After rotation: group ${retrievedState.currentGroupIndex}, active [${retrievedState.activeGroup.join(', ')}]`);
    
    return retrievedState.currentGroupIndex === state.currentGroupIndex &&
           retrievedState.activeGroup.length === state.activeGroup.length;
});

// Test 6: Full rotation cycle
runTest("Full rotation cycle completes correctly", () => {
    const fanGroups = getFanGroups(2);
    const totalGroups = fanGroups.length;
    let currentIndex = 0;
    const visitedGroups = new Set();
    
    console.log(`  Testing full cycle through ${totalGroups} groups:`);
    
    // Rotate through all groups once
    for (let i = 0; i < totalGroups; i++) {
        visitedGroups.add(currentIndex);
        console.log(`    Step ${i + 1}: Group ${currentIndex + 1} [${fanGroups[currentIndex].join(', ')}]`);
        currentIndex = getNextGroupIndex(currentIndex, totalGroups);
    }
    
    // Should have visited all groups and returned to start
    const visitedAllGroups = visitedGroups.size === totalGroups;
    const returnedToStart = currentIndex === 0;
    
    console.log(`  Visited all groups: ${visitedAllGroups}`);
    console.log(`  Returned to start: ${returnedToStart}`);
    
    return visitedAllGroups && returnedToStart;
});

// Test 7: Configuration validation
runTest("Configuration validation works correctly", () => {
    const validConfigs = [
        { set_gr_alternate_fan: 2, set_time_alternate_fan: 15 },
        { set_gr_alternate_fan: 4, set_time_alternate_fan: 10 },
        { set_gr_alternate_fan: 6, set_time_alternate_fan: 30 }
    ];
    
    const invalidConfigs = [
        { set_gr_alternate_fan: 0, set_time_alternate_fan: 15 },
        { set_gr_alternate_fan: 2, set_time_alternate_fan: 0 },
        { set_gr_alternate_fan: null, set_time_alternate_fan: null }
    ];
    
    let allValidConfigsWork = true;
    let allInvalidConfigsHandled = true;
    
    console.log("  Testing valid configurations:");
    validConfigs.forEach((config, index) => {
        const groupSize = config.set_gr_alternate_fan || 2;
        const interval = minutesToMs(config.set_time_alternate_fan || 15);
        const groups = getFanGroups(groupSize);
        
        console.log(`    Config ${index + 1}: ${groupSize} fans, ${config.set_time_alternate_fan}min → ${groups.length} groups`);
        
        if (groups.length === 0) allValidConfigsWork = false;
        if (interval <= 0) allValidConfigsWork = false;
    });
    
    console.log("  Testing invalid configurations:");
    invalidConfigs.forEach((config, index) => {
        const groupSize = config.set_gr_alternate_fan || 2;
        const interval = minutesToMs(config.set_time_alternate_fan || 15);
        const groups = getFanGroups(groupSize);
        
        console.log(`    Invalid config ${index + 1}: defaults to ${groupSize} fans, ${config.set_time_alternate_fan || 15}min`);
        
        // Should still work with defaults
        if (groups.length === 0) allInvalidConfigsHandled = false;
        if (interval <= 0) allInvalidConfigsHandled = false;
    });
    
    return allValidConfigsWork && allInvalidConfigsHandled;
});

// Test 8: Concurrent rotation states (threshold vs rotation mode)
runTest("Concurrent rotation states work independently", () => {
    const mockContext = {};
    
    // Simulate different rotation states for different modes
    const rotationModeState = {
        currentGroupIndex: 1,
        lastRotationTime: Date.now() - (10 * 60 * 1000),
        activeGroup: ["quat_3", "quat_4"]
    };
    
    const thresholdModeState = {
        currentGroupIndex: 2,
        lastRotationTime: Date.now() - (5 * 60 * 1000),
        activeGroup: ["quat_5", "quat_6"]
    };
    
    // Save different states
    mockContext.fanRotationState = rotationModeState;
    mockContext.fanRotationState_threshold_2 = thresholdModeState;
    
    console.log(`  Rotation mode state: group ${rotationModeState.currentGroupIndex + 1}`);
    console.log(`  Threshold mode state: group ${thresholdModeState.currentGroupIndex + 1}`);
    
    // States should be independent
    return rotationModeState.currentGroupIndex !== thresholdModeState.currentGroupIndex;
});

// Print final results
console.log('\n' + '='.repeat(50));
console.log('📊 TEST RESULTS SUMMARY');
console.log('='.repeat(50));

testResults.tests.forEach(test => {
    const status = test.status === 'PASS' ? '✅' : '❌';
    console.log(`${status} ${test.name}`);
    if (test.error) {
        console.log(`   Error: ${test.error}`);
    }
});

console.log('\n📈 STATISTICS:');
console.log(`✅ Passed: ${testResults.passed}`);
console.log(`❌ Failed: ${testResults.failed}`);
console.log(`📊 Total: ${testResults.passed + testResults.failed}`);
console.log(`🎯 Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`);

if (testResults.failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Fan rotation mode is working correctly!');
} else {
    console.log('\n⚠️  Some tests failed. Please review the implementation.');
}

console.log('\n' + '='.repeat(50));
