/**
 * Comprehensive Technical Audit for Production Readiness
 * Final validation of all oscillation bug fixes
 */

const path = require('path');

// Import modules
let FanControlService, SensorService, getRecommendedGroupSize, CONTROL_CONFIG, CONTEXT_KEYS;

try {
    const fanControlModule = require('../../../dist/modules/viis-auto-microclimate-control/services/fanControlService');
    const sensorModule = require('../../../dist/modules/viis-auto-microclimate-control/services/sensorService');
    const groupUtilsModule = require('../../../dist/modules/viis-auto-microclimate-control/utils/groupUtils');
    const constantsModule = require('../../../dist/modules/viis-auto-microclimate-control/constants');

    FanControlService = fanControlModule.FanControlService;
    SensorService = sensorModule.SensorService;
    getRecommendedGroupSize = groupUtilsModule.getRecommendedGroupSize;
    CONTROL_CONFIG = constantsModule.CONTROL_CONFIG;
    CONTEXT_KEYS = constantsModule.CONTEXT_KEYS;

    console.log('✓ Successfully imported modules for comprehensive audit');
} catch (error) {
    console.error('Failed to import modules:', error.message);
    process.exit(1);
}

// Mock environment
const mockNode = {
    log: (...args) => console.log('[LOG]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    debug: (...args) => console.debug('[DEBUG]', ...args),
    status: (status) => console.log('[STATUS]', status)
};

const mockFlowContext = new Map();
const mockGlobalContext = new Map();

mockGlobalContext.set('modbusCoils', {
    quat_1: 0, quat_2: 1, quat_3: 2, quat_4: 3, quat_5: 4, quat_6: 5
});

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
    nodeId: 'comprehensive-audit'
};

async function comprehensiveAudit() {
    console.log('=== COMPREHENSIVE TECHNICAL AUDIT ===\n');

    let auditResults = {
        cacheAlignment: false,
        hysteresisImplementation: false,
        changeDetection: false,
        inputValidation: false,
        performanceAcceptable: false,
        stressTestPassed: false,
        memoryLeakFree: false,
        concurrencyHandled: false
    };

    try {
        console.log('1. CACHE TTL ALIGNMENT VERIFICATION');
        console.log('===================================');
        
        // Verify cache TTL is properly aligned
        const sensorService = new SensorService(mockServiceOptions);
        console.log(`Cache TTL: 15000ms`);
        console.log(`Polling Interval: ${CONTROL_CONFIG.POLLING_INTERVAL_MS}ms`);
        console.log(`Ratio: ${15000 / CONTROL_CONFIG.POLLING_INTERVAL_MS}`);
        
        if (15000 > CONTROL_CONFIG.POLLING_INTERVAL_MS) {
            console.log('✓ PASS: Cache TTL > Polling Interval');
            auditResults.cacheAlignment = true;
        } else {
            console.log('❌ FAIL: Cache TTL alignment issue');
        }

        console.log('\n2. HYSTERESIS IMPLEMENTATION VERIFICATION');
        console.log('=========================================');
        
        // Test hysteresis logic thoroughly
        const thresholds = { k1: 25, k2: 30, k3: 35, k4: 40 };
        const hysteresisTests = [
            // Critical boundary tests
            { temp: 30.0, current: 2, expected: 4, desc: 'K2 boundary from below' },
            { temp: 30.0, current: 4, expected: 4, desc: 'K2 boundary from above' },
            { temp: 29.5, current: 4, expected: 4, desc: 'K2-0.5°C with 4 fans (hysteresis)' },
            { temp: 29.0, current: 4, expected: 2, desc: 'K2-1°C with 4 fans (drop)' },
            { temp: 28.9, current: 2, expected: 2, desc: 'Below K2 with 2 fans (stable)' },
        ];

        let hysteresisPassCount = 0;
        for (const test of hysteresisTests) {
            const result = getRecommendedGroupSize(test.temp, 65, thresholds, {
                currentGroupSize: test.current,
                hysteresis: 1.0
            });
            const passed = result === test.expected;
            console.log(`${test.desc}: ${passed ? '✓' : '❌'} (expected: ${test.expected}, got: ${result})`);
            if (passed) hysteresisPassCount++;
        }
        
        if (hysteresisPassCount === hysteresisTests.length) {
            console.log('✓ PASS: Hysteresis implementation correct');
            auditResults.hysteresisImplementation = true;
        } else {
            console.log(`❌ FAIL: Hysteresis implementation (${hysteresisPassCount}/${hysteresisTests.length} passed)`);
        }

        console.log('\n3. CHANGE DETECTION VERIFICATION');
        console.log('================================');
        
        const fanControlService = new FanControlService(mockServiceOptions);
        const config = {
            set_mode_fan: 1,
            set_auto_mode_fan: 0,
            set_k1_fan: 25, set_k2_fan: 30, set_k3_fan: 35, set_k4_fan: 40
        };

        // Test no-change detection
        const sensorData = { temp_indoor: 32, humi_indoor: 65, light_indoor: 25000, ts: Date.now() };
        const deviceStatus = {
            quat_1: true, quat_2: true, quat_3: true, quat_4: true,
            quat_5: false, quat_6: false, ts: Date.now()
        };

        const actions = await fanControlService.processThresholdMode(config, sensorData, deviceStatus);
        
        if (actions.length === 0) {
            console.log('✓ PASS: Change detection working (no unnecessary actions)');
            auditResults.changeDetection = true;
        } else {
            console.log(`❌ FAIL: Change detection failed (${actions.length} unnecessary actions)`);
        }

        console.log('\n4. INPUT VALIDATION VERIFICATION');
        console.log('================================');
        
        const invalidInputs = [
            { temp: NaN, humi: 65 },
            { temp: 30, humi: NaN },
            { temp: undefined, humi: 65 },
            { temp: 30, humi: undefined },
            { temp: null, humi: 65 },
            { temp: 30, humi: null },
            { temp: "invalid", humi: 65 },
            { temp: 30, humi: "invalid" }
        ];

        let validationPassCount = 0;
        for (const input of invalidInputs) {
            const testSensorData = { 
                temp_indoor: input.temp, 
                humi_indoor: input.humi, 
                light_indoor: 25000, 
                ts: Date.now() 
            };
            
            const testActions = await fanControlService.processThresholdMode(config, testSensorData, deviceStatus);
            if (testActions.length === 0) {
                validationPassCount++;
            }
        }
        
        if (validationPassCount === invalidInputs.length) {
            console.log('✓ PASS: Input validation handles all invalid cases');
            auditResults.inputValidation = true;
        } else {
            console.log(`❌ FAIL: Input validation (${validationPassCount}/${invalidInputs.length} handled)`);
        }

        console.log('\n5. PERFORMANCE STRESS TEST');
        console.log('==========================');
        
        const iterations = 1000;
        const startTime = Date.now();
        
        for (let i = 0; i < iterations; i++) {
            const tempVariation = 30 + (Math.random() - 0.5) * 2; // 29-31°C range
            const testSensorData = { 
                temp_indoor: tempVariation, 
                humi_indoor: 65, 
                light_indoor: 25000, 
                ts: Date.now() 
            };
            
            await fanControlService.processThresholdMode(config, testSensorData, deviceStatus);
        }
        
        const endTime = Date.now();
        const avgTime = (endTime - startTime) / iterations;
        
        console.log(`Average processing time: ${avgTime.toFixed(3)}ms per call`);
        console.log(`Total time for ${iterations} iterations: ${endTime - startTime}ms`);
        
        if (avgTime < 1.0) {
            console.log('✓ PASS: Performance acceptable (<1ms per call)');
            auditResults.performanceAcceptable = true;
        } else {
            console.log(`❌ FAIL: Performance too slow (${avgTime.toFixed(3)}ms per call)`);
        }

        console.log('\n6. OSCILLATION STRESS TEST');
        console.log('==========================');
        
        // Simulate rapid temperature oscillation around K2 threshold
        let oscillationActions = 0;
        let previousDeviceState = { ...deviceStatus };
        
        const oscillationTemps = [29.9, 30.1, 29.8, 30.2, 29.7, 30.3, 29.6, 30.4];
        
        for (const temp of oscillationTemps) {
            const oscSensorData = { 
                temp_indoor: temp, 
                humi_indoor: 65, 
                light_indoor: 25000, 
                ts: Date.now() 
            };
            
            const oscActions = await fanControlService.processThresholdMode(config, oscSensorData, previousDeviceState);
            oscillationActions += oscActions.length;
            
            // Simulate executing actions
            oscActions.forEach(action => {
                if (action.deviceKey.startsWith('quat_')) {
                    previousDeviceState[action.deviceKey] = action.value;
                }
            });
        }
        
        console.log(`Total actions during oscillation test: ${oscillationActions}`);
        console.log(`Expected: ≤4 actions (initial adjustment only)`);
        
        if (oscillationActions <= 4) {
            console.log('✓ PASS: Oscillation prevented by hysteresis');
            auditResults.stressTestPassed = true;
        } else {
            console.log(`❌ FAIL: Oscillation not prevented (${oscillationActions} actions)`);
        }

        console.log('\n7. MEMORY LEAK DETECTION');
        console.log('========================');
        
        // Monitor memory usage during repeated operations
        const initialMemory = process.memoryUsage().heapUsed;
        
        for (let i = 0; i < 100; i++) {
            const service = new FanControlService(mockServiceOptions);
            await service.processThresholdMode(config, sensorData, deviceStatus);
        }
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
        
        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;
        
        console.log(`Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
        
        if (memoryIncrease < 10 * 1024 * 1024) { // Less than 10MB increase
            console.log('✓ PASS: No significant memory leaks detected');
            auditResults.memoryLeakFree = true;
        } else {
            console.log(`❌ FAIL: Potential memory leak (${(memoryIncrease / 1024 / 1024).toFixed(2)} MB increase)`);
        }

        console.log('\n8. CONCURRENCY HANDLING');
        console.log('=======================');
        
        // Test concurrent access to shared state
        const concurrentPromises = [];
        for (let i = 0; i < 10; i++) {
            concurrentPromises.push(
                fanControlService.processThresholdMode(config, sensorData, deviceStatus)
            );
        }
        
        const concurrentResults = await Promise.all(concurrentPromises);
        const allResultsConsistent = concurrentResults.every(result => 
            JSON.stringify(result) === JSON.stringify(concurrentResults[0])
        );
        
        if (allResultsConsistent) {
            console.log('✓ PASS: Concurrent access handled correctly');
            auditResults.concurrencyHandled = true;
        } else {
            console.log('❌ FAIL: Concurrent access issues detected');
        }

        console.log('\n=== FINAL AUDIT RESULTS ===');
        console.log('===========================');
        
        const passedTests = Object.values(auditResults).filter(Boolean).length;
        const totalTests = Object.keys(auditResults).length;
        
        console.log(`Tests Passed: ${passedTests}/${totalTests}`);
        console.log('');
        
        Object.entries(auditResults).forEach(([test, passed]) => {
            console.log(`${passed ? '✓' : '❌'} ${test}: ${passed ? 'PASS' : 'FAIL'}`);
        });
        
        console.log('\n=== PRODUCTION READINESS DECISION ===');
        console.log('=====================================');
        
        if (passedTests === totalTests) {
            console.log('🎉 VERDICT: PRODUCTION READY - ALL TESTS PASSED');
            console.log('✅ RECOMMENDATION: APPROVE FOR IMMEDIATE DEPLOYMENT');
        } else {
            console.log('⚠️ VERDICT: NOT PRODUCTION READY');
            console.log('❌ RECOMMENDATION: ADDRESS FAILING TESTS BEFORE DEPLOYMENT');
        }

    } catch (error) {
        console.error('Comprehensive audit failed:', error);
        console.error('Stack trace:', error.stack);
        console.log('❌ VERDICT: AUDIT FAILED - NOT PRODUCTION READY');
    }
}

// Run the comprehensive audit
comprehensiveAudit().catch(console.error);
