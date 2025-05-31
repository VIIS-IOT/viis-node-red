/**
 * Test script to verify global context integration
 * Run this in Node-RED function node to test global context access
 */

// Test function to check global context variables
function testGlobalContext() {
    const results = {
        timestamp: new Date().toISOString(),
        globalContextTest: {},
        processEnvTest: {},
        comparison: {},
        summary: {}
    };

    // List of variables to test
    const testVariables = [
        'device_id',
        'device_access_token', 
        'device_label',
        'device_serial',
        'backend_url',
        'server_url',
        'modbus_host',
        'modbus_tcp_port',
        'modbusHoldingRegisters',
        'modbusInputRegisters',
        'modbusCoils'
    ];

    const processEnvMapping = {
        'device_id': 'DEVICE_ID',
        'device_access_token': 'DEVICE_ACCESS_TOKEN',
        'device_label': 'DEVICE_LABEL', 
        'device_serial': 'DEVICE_SERIAL',
        'backend_url': 'VIIS_BACKEND',
        'server_url': 'BACKEND_URL',
        'modbus_host': 'MODBUS_HOST',
        'modbus_tcp_port': 'MODBUS_TCP_PORT',
        'modbusHoldingRegisters': 'MODBUS_HOLDING_REGISTERS',
        'modbusInputRegisters': 'MODBUS_INPUT_REGISTERS',
        'modbusCoils': 'MODBUS_COILS'
    };

    // Test global context access
    testVariables.forEach(varName => {
        try {
            const globalValue = global.get(varName);
            results.globalContextTest[varName] = {
                exists: globalValue !== undefined,
                value: globalValue,
                type: typeof globalValue
            };
        } catch (error) {
            results.globalContextTest[varName] = {
                exists: false,
                error: error.message
            };
        }
    });

    // Test process.env access
    Object.entries(processEnvMapping).forEach(([globalName, envName]) => {
        try {
            const envValue = process.env[envName];
            results.processEnvTest[globalName] = {
                envName: envName,
                exists: envValue !== undefined,
                value: envValue,
                type: typeof envValue
            };
        } catch (error) {
            results.processEnvTest[globalName] = {
                envName: envName,
                exists: false,
                error: error.message
            };
        }
    });

    // Compare global context vs process.env
    testVariables.forEach(varName => {
        const globalData = results.globalContextTest[varName];
        const processData = results.processEnvTest[varName];
        
        results.comparison[varName] = {
            globalExists: globalData.exists,
            processExists: processData.exists,
            valuesMatch: globalData.value === processData.value,
            globalValue: globalData.value,
            processValue: processData.value,
            recommendation: ''
        };

        // Add recommendations
        if (globalData.exists && processData.exists) {
            if (globalData.value === processData.value) {
                results.comparison[varName].recommendation = 'Values match - OK';
            } else {
                results.comparison[varName].recommendation = 'Values differ - Global context will be used';
            }
        } else if (globalData.exists && !processData.exists) {
            results.comparison[varName].recommendation = 'Only in global context - env-loader working';
        } else if (!globalData.exists && processData.exists) {
            results.comparison[varName].recommendation = 'Only in process.env - env-loader may not be running';
        } else {
            results.comparison[varName].recommendation = 'Missing in both - check configuration';
        }
    });

    // Generate summary
    const globalCount = Object.values(results.globalContextTest).filter(v => v.exists).length;
    const processCount = Object.values(results.processEnvTest).filter(v => v.exists).length;
    const matchingCount = Object.values(results.comparison).filter(v => v.valuesMatch).length;

    results.summary = {
        totalVariables: testVariables.length,
        globalContextCount: globalCount,
        processEnvCount: processCount,
        matchingValues: matchingCount,
        globalContextCoverage: `${globalCount}/${testVariables.length} (${Math.round(globalCount/testVariables.length*100)}%)`,
        processEnvCoverage: `${processCount}/${testVariables.length} (${Math.round(processCount/testVariables.length*100)}%)`,
        envLoaderStatus: globalCount > 0 ? 'Working' : 'Not working or not deployed',
        recommendations: []
    };

    // Add specific recommendations
    if (globalCount === 0) {
        results.summary.recommendations.push('Deploy and configure env-loader node');
    } else if (globalCount < testVariables.length) {
        results.summary.recommendations.push('Some variables missing in global context - check .env file');
    }

    if (processCount === 0) {
        results.summary.recommendations.push('No process.env variables found - check environment setup');
    }

    if (globalCount > 0 && processCount > 0 && matchingCount < Math.min(globalCount, processCount)) {
        results.summary.recommendations.push('Some values differ between global context and process.env');
    }

    return results;
}

// Test helper function usage
function testHelperFunctions() {
    const results = {
        timestamp: new Date().toISOString(),
        helperTest: {},
        errors: []
    };

    try {
        // Simulate helper function behavior
        const testGetEnvVar = (envVarName, defaultValue) => {
            const mapping = {
                'DEVICE_ID': 'device_id',
                'DEVICE_ACCESS_TOKEN': 'device_access_token',
                'MODBUS_COILS': 'modbusCoils'
            };
            
            const globalVarName = mapping[envVarName];
            if (globalVarName) {
                const globalValue = global.get(globalVarName);
                if (globalValue !== undefined) {
                    return globalValue;
                }
            }
            
            return process.env[envVarName] || defaultValue;
        };

        // Test various scenarios
        results.helperTest.deviceId = {
            value: testGetEnvVar('DEVICE_ID', 'unknown'),
            source: global.get('device_id') !== undefined ? 'global' : 'process.env'
        };

        results.helperTest.deviceToken = {
            value: testGetEnvVar('DEVICE_ACCESS_TOKEN', 'none'),
            source: global.get('device_access_token') !== undefined ? 'global' : 'process.env'
        };

        results.helperTest.modbusCoils = {
            value: testGetEnvVar('MODBUS_COILS', {}),
            source: global.get('modbusCoils') !== undefined ? 'global' : 'process.env'
        };

    } catch (error) {
        results.errors.push({
            function: 'testHelperFunctions',
            error: error.message,
            stack: error.stack
        });
    }

    return results;
}

// Main test execution
function runAllTests() {
    const testResults = {
        timestamp: new Date().toISOString(),
        globalContextTest: null,
        helperTest: null,
        overallStatus: 'unknown',
        recommendations: []
    };

    try {
        // Run global context test
        testResults.globalContextTest = testGlobalContext();
        
        // Run helper function test
        testResults.helperTest = testHelperFunctions();

        // Determine overall status
        const globalWorking = testResults.globalContextTest.summary.globalContextCount > 0;
        const processWorking = testResults.globalContextTest.summary.processEnvCount > 0;

        if (globalWorking && processWorking) {
            testResults.overallStatus = 'excellent';
            testResults.recommendations.push('Both global context and process.env working - hot reload available');
        } else if (globalWorking) {
            testResults.overallStatus = 'good';
            testResults.recommendations.push('Global context working - env-loader is functional');
        } else if (processWorking) {
            testResults.overallStatus = 'basic';
            testResults.recommendations.push('Only process.env working - deploy env-loader for hot reload');
        } else {
            testResults.overallStatus = 'poor';
            testResults.recommendations.push('Neither global context nor process.env working - check configuration');
        }

    } catch (error) {
        testResults.overallStatus = 'error';
        testResults.error = {
            message: error.message,
            stack: error.stack
        };
    }

    return testResults;
}

// Export for use in Node-RED function node
// Copy and paste this into a function node with the following code:
/*
const testResults = runAllTests();
node.warn("Global Context Test Results:");
node.warn(JSON.stringify(testResults, null, 2));
return { payload: testResults };
*/

// For direct execution in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        testGlobalContext,
        testHelperFunctions,
        runAllTests
    };
}
