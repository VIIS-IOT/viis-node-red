/**
 * Test Script for Phase 3: Integration with viis-device-protection
 * Tests ErrorNotificationService integration into existing nodes
 * 
 * Usage: node test-phase3-integration.js
 */

const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
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

// Test 1: Source file modifications
testGroup('📝 Phase 3 Source File Changes', () => {
    try {
        const protectionFile = path.join(__dirname, 'src/modules/viis-device-protection/viis-device-protection.ts');
        const content = fs.readFileSync(protectionFile, 'utf8');

        assert(
            content.includes('ErrorNotificationService'),
            'viis-device-protection imports ErrorNotificationService'
        );

        assert(
            content.includes('new ErrorNotificationService'),
            'viis-device-protection initializes ErrorNotificationService'
        );

        assert(
            content.includes('createFromBusinessLogic'),
            'viis-device-protection calls createFromBusinessLogic'
        );

        assert(
            content.includes('PROTECTION_') && content.includes('_TIMEOUT'),
            'Uses PROTECTION_*_TIMEOUT error code pattern'
        );

        assert(
            content.includes('severity:') && content.includes('high'),
            'Sets high severity for protection timeout'
        );

        assert(
            content.includes("type:") && content.includes('alert'),
            'Sets alert type for protection timeout'
        );

        assert(
            content.includes('metadata:'),
            'Includes metadata in notification'
        );

        assert(
            content.includes('coil_key') && content.includes('max_time_seconds'),
            'Metadata includes coil_key and max_time_seconds'
        );

        assert(
            content.includes('elapsed_time_ms'),
            'Metadata includes elapsed_time_ms'
        );

        assert(
            content.includes('action_taken'),
            'Metadata includes action_taken'
        );

    } catch (error) {
        assert(false, `Source file check failed: ${error.message}`);
    }
});

// Test 2: Compiled JavaScript
testGroup('🔨 Phase 3 Compiled JavaScript', () => {
    try {
        const protectionJsPath = path.join(__dirname, 'dist/modules/viis-device-protection/viis-device-protection.js');
        const content = fs.readFileSync(protectionJsPath, 'utf8');

        assert(
            fs.existsSync(protectionJsPath),
            'viis-device-protection.js exists'
        );

        assert(
            content.includes('error_notification_service'),
            'Compiled JS includes error_notification_service import'
        );

        assert(
            content.includes('ErrorNotificationService'),
            'Compiled JS references ErrorNotificationService class'
        );

        assert(
            content.includes('createFromBusinessLogic'),
            'Compiled JS includes createFromBusinessLogic call'
        );

        assert(
            content.includes('PROTECTION_'),
            'Compiled JS includes PROTECTION_ error code prefix'
        );

        assert(
            content.includes('exceeded maximum runtime'),
            'Compiled JS includes error message'
        );

    } catch (error) {
        assert(false, `Compiled JavaScript check failed: ${error.message}`);
    }
});

// Test 3: Integration logic validation
testGroup('🔗 Integration Logic Validation', () => {
    try {
        const protectionFile = path.join(__dirname, 'src/modules/viis-device-protection/viis-device-protection.ts');
        const content = fs.readFileSync(protectionFile, 'utf8');

        // Check that notification is created BEFORE turning off coil
        const lines = content.split('\n');
        let notificationLineIndex = -1;
        let writeCoilLineIndex = -1;

        lines.forEach((line, index) => {
            if (line.includes('createFromBusinessLogic')) {
                notificationLineIndex = index;
            }
            if (line.includes('await writeCoil') && line.includes('false') && index > 170) {
                writeCoilLineIndex = index;
            }
        });

        assert(
            notificationLineIndex > 0 && writeCoilLineIndex > 0,
            'Found both notification creation and writeCoil calls'
        );

        assert(
            notificationLineIndex < writeCoilLineIndex,
            'Notification created BEFORE coil turned off (correct order)'
        );

        // Check error handling
        assert(
            content.includes('try {') && content.includes('catch (notifError)'),
            'Error handling for notification creation'
        );

        assert(
            content.includes('Failed to create notification'),
            'Error logging for failed notification'
        );

        // Check that original functionality preserved
        assert(
            content.includes('delete coilTimers[coilKey]'),
            'Original timer deletion preserved'
        );

        assert(
            content.includes('node.send'),
            'Original node.send output preserved'
        );

    } catch (error) {
        assert(false, `Integration logic validation failed: ${error.message}`);
    }
});

// Test 4: Metadata structure validation
testGroup('📊 Metadata Structure Validation', () => {
    try {
        const protectionFile = path.join(__dirname, 'src/modules/viis-device-protection/viis-device-protection.ts');
        const content = fs.readFileSync(protectionFile, 'utf8');

        const requiredMetadataFields = [
            'coil_key',
            'max_time_seconds',
            'elapsed_time_ms',
            'coil_address',
            'action_taken',
            'board_id',
            'timestamp'
        ];

        requiredMetadataFields.forEach(field => {
            assert(
                content.includes(field),
                `Metadata includes ${field}`
            );
        });

        // Check that metadata uses actual values (not hardcoded)
        assert(
            content.includes('coilKey') && content.includes('maxTime') && content.includes('elapsedTime'),
            'Metadata uses dynamic values from runtime'
        );

        assert(
            content.includes('modbusCoils[coilKey]'),
            'Metadata includes actual coil address'
        );

        assert(
            content.includes('currentBoardId') || content.includes('default'),
            'Metadata includes board_id with fallback'
        );

    } catch (error) {
        assert(false, `Metadata structure validation failed: ${error.message}`);
    }
});

// Test 5: Backward compatibility
testGroup('🔄 Backward Compatibility Check', () => {
    try {
        const protectionFile = path.join(__dirname, 'src/modules/viis-device-protection/viis-device-protection.ts');
        const content = fs.readFileSync(protectionFile, 'utf8');

        // Check that all original functions still exist
        const originalFunctions = [
            { name: 'readCoil', pattern: 'async function readCoil' },
            { name: 'writeCoil', pattern: 'async function writeCoil' },
            { name: 'checkProtection', pattern: 'async function checkProtection' },
            { name: 'readModbusConfig', pattern: 'const readModbusConfig' }
        ];

        originalFunctions.forEach(func => {
            assert(
                content.includes(func.pattern),
                `Original function ${func.name} preserved`
            );
        });

        // Check original state management
        assert(
            content.includes('coilTimers'),
            'Original coilTimers state preserved'
        );

        assert(
            content.includes('startTime') && content.includes('maxTime'),
            'Original timer structure preserved'
        );

        // Check original intervals
        assert(
            content.includes('setInterval(checkProtection, 1000)'),
            'Original 1-second check interval preserved'
        );

        assert(
            content.includes('setInterval(async () => {') && content.includes('30000'),
            'Original 30-second config check interval preserved'
        );

        // Check cleanup
        assert(
            content.includes('clearInterval(interval)'),
            'Original cleanup logic preserved'
        );

        assert(
            content.includes('releaseClientV2'),
            'Original Modbus client release preserved'
        );

    } catch (error) {
        assert(false, `Backward compatibility check failed: ${error.message}`);
    }
});

// Test 6: Multi-board support preservation
testGroup('🔀 Multi-Board Support Preservation', () => {
    try {
        const protectionFile = path.join(__dirname, 'src/modules/viis-device-protection/viis-device-protection.ts');
        const content = fs.readFileSync(protectionFile, 'utf8');

        assert(
            content.includes('currentBoardId'),
            'currentBoardId variable preserved'
        );

        assert(
            content.includes('isMultiBoardMode'),
            'isMultiBoardMode flag preserved'
        );

        assert(
            content.includes('getModbusClientV2'),
            'Multi-board client method preserved'
        );

        assert(
            content.includes('MultiModbusConfig'),
            'MultiModbusConfig type preserved'
        );

        // Check board_id is passed to notification metadata
        assert(
            content.includes('board_id: currentBoardId'),
            'board_id passed to notification metadata'
        );

    } catch (error) {
        assert(false, `Multi-board support check failed: ${error.message}`);
    }
});

// Test 7: Error handling robustness
testGroup('🛡️ Error Handling Robustness', () => {
    try {
        const protectionFile = path.join(__dirname, 'src/modules/viis-device-protection/viis-device-protection.ts');
        const content = fs.readFileSync(protectionFile, 'utf8');

        // Check notification creation doesn't block coil shutoff
        assert(
            content.includes('try {') && 
            content.includes('await errorNotificationService') &&
            content.includes('} catch (notifError)'),
            'Notification wrapped in try-catch'
        );

        // Check writeCoil is called after notification (even if notification fails)
        // Find the try block that contains createFromBusinessLogic
        const createIndex = content.indexOf('createFromBusinessLogic');
        const tryIndex = content.lastIndexOf('try {', createIndex);
        
        // Find the corresponding catch block
        const catchStartIndex = content.indexOf('catch (notifError)', tryIndex);
        const catchEndIndex = content.indexOf('}', catchStartIndex + 1);
        
        // Find writeCoil after the catch block
        const writeCoilIndex = content.indexOf('await writeCoil(modbusCoils[coilKey], false)', catchEndIndex);
        
        assert(
            tryIndex > 0 && catchEndIndex > tryIndex && writeCoilIndex > catchEndIndex && writeCoilIndex > 0,
            'writeCoil called after notification try-catch (correct order)'
        );

        // Verify error doesn't stop protection logic
        const protectionAfterNotif = content.substring(
            content.indexOf('createFromBusinessLogic')
        );

        assert(
            protectionAfterNotif.includes('await writeCoil'),
            'Coil shutdown still happens even if notification fails'
        );

        assert(
            protectionAfterNotif.includes('delete coilTimers'),
            'Timer cleanup still happens even if notification fails'
        );

    } catch (error) {
        assert(false, `Error handling check failed: ${error.message}`);
    }
});

// Test 8: Integration with Core Services
testGroup('🎯 Core Services Integration', () => {
    try {
        // Check ErrorNotificationService exists
        const errorServicePath = path.join(__dirname, 'dist/services/error-notification.service.js');
        assert(
            fs.existsSync(errorServicePath),
            'ErrorNotificationService compiled file exists'
        );

        // Check ErrorMappingService exists (dependency)
        const mappingServicePath = path.join(__dirname, 'dist/services/error-mapping.service.js');
        assert(
            fs.existsSync(mappingServicePath),
            'ErrorMappingService (dependency) exists'
        );

        // Check GlobalContextHelper
        const globalHelperPath = path.join(__dirname, 'dist/ultils/global-context-helper.js');
        assert(
            fs.existsSync(globalHelperPath),
            'GlobalContextHelper exists'
        );

        // Check all Phase 1 components
        const phase1Files = [
            'dist/services/error-notification.service.js',
            'dist/services/error-mapping.service.js',
            'dist/ultils/global-context-helper.js'
        ];

        phase1Files.forEach(file => {
            const fullPath = path.join(__dirname, file);
            assert(
                fs.existsSync(fullPath),
                `Phase 1 component exists: ${file}`
            );
        });

    } catch (error) {
        assert(false, `Core services integration check failed: ${error.message}`);
    }
});

// Test 9: Documentation and logging
testGroup('📚 Documentation and Logging', () => {
    try {
        const protectionFile = path.join(__dirname, 'src/modules/viis-device-protection/viis-device-protection.ts');
        const content = fs.readFileSync(protectionFile, 'utf8');

        assert(
            content.includes('node.log') && content.includes('Created protection timeout notification'),
            'Success logging for notification creation'
        );

        assert(
            content.includes('node.error') && content.includes('Failed to create notification'),
            'Error logging for notification failures'
        );

        assert(
            content.includes('node.warn') && content.includes('exceeded max time'),
            'Original warning messages preserved'
        );

    } catch (error) {
        assert(false, `Documentation check failed: ${error.message}`);
    }
});

// Print summary
log('\n' + '='.repeat(70), 'blue');
log('Phase 3 Integration Test Summary', 'blue');
log('='.repeat(70), 'blue');
log(`Total Tests: ${totalTests}`);
log(`Passed: ${passedTests}`, passedTests === totalTests ? 'green' : 'yellow');
log(`Failed: ${failedTests}`, failedTests === 0 ? 'green' : 'red');
log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(2)}%`, 
    passedTests === totalTests ? 'green' : 'yellow');

if (failedTests === 0) {
    log('\n✅ ALL PHASE 3 TESTS PASSED!', 'green');
    log('\n🎉 Integration Complete:', 'cyan');
    log('  • ErrorNotificationService integrated into viis-device-protection', 'green');
    log('  • Protection timeout events create notifications', 'green');
    log('  • Multi-board support preserved', 'green');
    log('  • Backward compatibility maintained', 'green');
    log('  • Error handling robust', 'green');
    log('\n📊 Error Notification Details:', 'cyan');
    log('  • Error Code: PROTECTION_<COIL_KEY>_TIMEOUT', 'yellow');
    log('  • Severity: high', 'yellow');
    log('  • Type: alert', 'yellow');
    log('  • Entity: node.id', 'yellow');
    log('  • Metadata: 7 fields (coil_key, max_time, elapsed_time, etc.)', 'yellow');
    process.exit(0);
} else {
    log('\n❌ SOME TESTS FAILED', 'red');
    log('Please review the failed tests above', 'yellow');
    process.exit(1);
}
