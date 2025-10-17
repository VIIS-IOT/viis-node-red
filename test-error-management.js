/**
 * Manual Test Script for Error Management System
 * Run this to verify all components work correctly
 * 
 * Usage: node test-error-management.js
 */

const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

let passedTests = 0;
let failedTests = 0;
let totalTests = 0;

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function assert(condition, testName) {
    totalTests++;
    if (condition) {
        passedTests++;
        log(`  ✓ ${testName}`, 'green');
    } else {
        failedTests++;
        log(`  ✗ ${testName}`, 'red');
    }
}

function testGroup(name, fn) {
    log(`\n${name}`, 'blue');
    fn();
}

// Mock Node Context
function createMockNodeContext(errorCodeMappings = {}) {
    const storage = { errorCodeMappings };
    return {
        global: {
            get: (key) => storage[key],
            set: (key, value) => { storage[key] = value; },
            keys: () => Object.keys(storage)
        }
    };
}

// Test 1: Check if all files exist
testGroup('📁 File Existence Tests', () => {
    const files = [
        'src/services/error-mapping.service.ts',
        'src/services/error-notification.service.ts',
        'src/ultils/global-context-helper.ts',
        '../env-loader/lib/error-code-manager.js',
        '../env-loader/lib/env-loader-core.js',
        '../env-loader/lib/global-context-manager.js',
        '../../../env/error-codes/default.json',
        '../../../env/error-codes/climate-controller.json',
        '../../../env/error-codes/irrigation-system.json'
    ];

    files.forEach(file => {
        const fullPath = path.join(__dirname, file);
        assert(fs.existsSync(fullPath), `File exists: ${file}`);
    });
});

// Test 2: Validate JSON files
testGroup('📋 JSON Validation Tests', () => {
    const jsonFiles = [
        '../../../env/error-codes/default.json',
        '../../../env/error-codes/climate-controller.json',
        '../../../env/error-codes/irrigation-system.json'
    ];

    jsonFiles.forEach(file => {
        try {
            const fullPath = path.join(__dirname, file);
            const content = fs.readFileSync(fullPath, 'utf8');
            const json = JSON.parse(content);
            
            assert(json.device_type, `${path.basename(file)} has device_type`);
            assert(Array.isArray(json.mappings), `${path.basename(file)} has mappings array`);
            
            // Validate structure
            json.mappings.forEach((mapping, index) => {
                assert(
                    ['holding', 'input', 'coil'].includes(mapping.register_type),
                    `${path.basename(file)} mapping[${index}] has valid register_type`
                );
                assert(
                    typeof mapping.address === 'number',
                    `${path.basename(file)} mapping[${index}] has numeric address`
                );
                assert(
                    Array.isArray(mapping.error_codes),
                    `${path.basename(file)} mapping[${index}] has error_codes array`
                );
                
                mapping.error_codes.forEach((ec, ecIndex) => {
                    assert(ec.err_code, `${path.basename(file)} error_code[${ecIndex}] has err_code`);
                    assert(ec.message, `${path.basename(file)} error_code[${ecIndex}] has message`);
                    assert(
                        ['low', 'medium', 'high', 'critical'].includes(ec.severity),
                        `${path.basename(file)} error_code[${ecIndex}] has valid severity`
                    );
                });
            });
        } catch (error) {
            assert(false, `${path.basename(file)} is valid JSON: ${error.message}`);
        }
    });
});

// Test 3: Test ErrorCodeManager
testGroup('🔧 ErrorCodeManager Tests', () => {
    try {
        const { ErrorCodeManager } = require('../env-loader/lib/error-code-manager');
        
        const logger = {
            log: () => {},
            error: () => {},
            warn: () => {}
        };

        const config = {
            errorCodesDir: path.join(__dirname, '../../../env/error-codes'),
            enableErrorCodeLoading: true
        };

        const manager = new ErrorCodeManager(config, logger);
        
        assert(manager !== null, 'ErrorCodeManager created successfully');
        assert(manager.directoryExists(), 'Error codes directory exists');
        
        const mappings = manager.loadErrorCodeMappings();
        assert(Object.keys(mappings).length > 0, 'Error code mappings loaded');
        assert(mappings['default'], 'Default mapping exists');
        assert(mappings['Climate_Controller'], 'Climate_Controller mapping exists');
        
        const stats = manager.getStats();
        assert(stats.loaded, 'Mappings marked as loaded');
        assert(stats.deviceTypeCount >= 3, 'At least 3 device types loaded');
        assert(stats.totalErrorCodes > 0, 'Error codes counted');
        
    } catch (error) {
        assert(false, `ErrorCodeManager tests failed: ${error.message}`);
    }
});

// Test 4: Test GlobalContextManager
testGroup('🌐 GlobalContextManager Tests', () => {
    try {
        const { GlobalContextManager } = require('../env-loader/lib/global-context-manager');
        
        const mockContext = createMockNodeContext();
        const config = {};
        const logger = {
            log: () => {},
            error: () => {},
            warn: () => {}
        };

        const manager = new GlobalContextManager(mockContext, config, logger);
        
        assert(manager !== null, 'GlobalContextManager created successfully');
        
        // Test storing error code mappings
        const testMappings = {
            'Test_Device': {
                device_type: 'Test_Device',
                mappings: []
            }
        };
        
        const result = manager.storeErrorCodeMappings(testMappings);
        assert(result.success, 'Error code mappings stored successfully');
        assert(result.deviceTypeCount === 1, 'Device type count correct');
        
        const retrieved = manager.getErrorCodeMappings();
        assert(retrieved['Test_Device'], 'Error code mappings retrieved successfully');
        
        const metadata = manager.getErrorCodeMappingsMetadata();
        assert(metadata !== null, 'Metadata exists');
        assert(metadata.count === 1, 'Metadata count correct');
        
    } catch (error) {
        assert(false, `GlobalContextManager tests failed: ${error.message}`);
    }
});

// Test 5: Test TypeScript compilation
testGroup('🔨 TypeScript Build Tests', () => {
    const distFiles = [
        'dist/services/error-mapping.service.js',
        'dist/services/error-notification.service.js'
    ];

    distFiles.forEach(file => {
        const fullPath = path.join(__dirname, file);
        assert(fs.existsSync(fullPath), `Compiled file exists: ${file}`);
    });
});

// Test 6: Test Entity Updates
testGroup('📊 Database Entity Tests', () => {
    try {
        const entityPath = path.join(__dirname, 'src/orm/entities/notification/TabiotNotification.ts');
        const content = fs.readFileSync(entityPath, 'utf8');
        
        assert(content.includes('metadata'), 'TabiotNotification has metadata field');
        assert(content.includes('@Column'), 'TabiotNotification uses TypeORM decorators');
        
    } catch (error) {
        assert(false, `Entity tests failed: ${error.message}`);
    }
});

// Test 7: Integration test with real JSON
testGroup('🔗 Integration Tests', () => {
    try {
        const { ErrorCodeManager } = require('../env-loader/lib/error-code-manager');
        const logger = { log: () => {}, error: () => {}, warn: () => {} };
        const config = {
            errorCodesDir: path.join(__dirname, '../../../env/error-codes'),
            enableErrorCodeLoading: true
        };

        const manager = new ErrorCodeManager(config, logger);
        const mappings = manager.loadErrorCodeMappings();
        
        // Test Climate Controller mappings
        const climate = mappings['Climate_Controller'];
        assert(climate, 'Climate Controller mapping loaded');
        assert(climate.mappings.length > 0, 'Climate Controller has mappings');
        
        // Find temperature error register
        const tempRegister = climate.mappings.find(m => 
            m.register_type === 'holding' && m.address === 1000
        );
        assert(tempRegister, 'Temperature error register found');
        assert(tempRegister.error_codes.length > 0, 'Temperature errors defined');
        
        const tempHighError = tempRegister.error_codes.find(ec => ec.err_code === 'ERR_TEMP_HIGH');
        assert(tempHighError, 'ERR_TEMP_HIGH error defined');
        assert(tempHighError.severity === 'high', 'ERR_TEMP_HIGH has high severity');
        assert(tempHighError.auto_resolve === true, 'ERR_TEMP_HIGH auto-resolves');
        
        // Test Irrigation mappings
        const irrigation = mappings['Irrigation_System'];
        assert(irrigation, 'Irrigation System mapping loaded');
        
        const waterPressure = irrigation.mappings.find(m => 
            m.register_type === 'holding' && m.address === 2000
        );
        assert(waterPressure, 'Water pressure register found');
        
    } catch (error) {
        assert(false, `Integration tests failed: ${error.message}`);
    }
});

// Test 8: Documentation tests
testGroup('📚 Documentation Tests', () => {
    const docs = [
        'docs/ERROR_MANAGEMENT_SIMPLIFIED.md',
        'docs/ERROR_MANAGEMENT_IMPLEMENTATION_COMPLETE.md',
        'src/services/__tests__/README.md'
    ];

    docs.forEach(file => {
        const fullPath = path.join(__dirname, file);
        assert(fs.existsSync(fullPath), `Documentation exists: ${file}`);
    });
});

// Print summary
log('\n' + '='.repeat(60), 'blue');
log('Test Summary', 'blue');
log('='.repeat(60), 'blue');
log(`Total Tests: ${totalTests}`);
log(`Passed: ${passedTests}`, passedTests === totalTests ? 'green' : 'yellow');
log(`Failed: ${failedTests}`, failedTests === 0 ? 'green' : 'red');
log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(2)}%`, 
    passedTests === totalTests ? 'green' : 'yellow');

if (failedTests === 0) {
    log('\n✅ ALL TESTS PASSED!', 'green');
    process.exit(0);
} else {
    log('\n❌ SOME TESTS FAILED', 'red');
    process.exit(1);
}
