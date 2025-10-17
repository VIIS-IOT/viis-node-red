/**
 * Test Script for Phase 2: Custom Node-RED Nodes
 * Tests viis-modbus-error-monitor and viis-error-trigger nodes
 * 
 * Usage: node test-phase2-nodes.js
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

// Test 1: Source files exist
testGroup('📁 Phase 2 Source Files', () => {
    const files = [
        'src/modules/viis-modbus-error-monitor/viis-modbus-error-monitor.ts',
        'src/modules/viis-modbus-error-monitor/viis-modbus-error-monitor.html',
        'src/modules/viis-error-trigger/viis-error-trigger.ts',
        'src/modules/viis-error-trigger/viis-error-trigger.html'
    ];

    files.forEach(file => {
        const fullPath = path.join(__dirname, file);
        assert(fs.existsSync(fullPath), `Source file exists: ${file}`);
    });
});

// Test 2: Compiled files exist
testGroup('🔨 Compiled JavaScript Files', () => {
    const files = [
        'dist/modules/viis-modbus-error-monitor/viis-modbus-error-monitor.js',
        'dist/modules/viis-modbus-error-monitor/viis-modbus-error-monitor.html',
        'dist/modules/viis-error-trigger/viis-error-trigger.js',
        'dist/modules/viis-error-trigger/viis-error-trigger.html'
    ];

    files.forEach(file => {
        const fullPath = path.join(__dirname, file);
        assert(fs.existsSync(fullPath), `Compiled file exists: ${file}`);
    });
});

// Test 3: Package.json registration
testGroup('📦 Node Registration in package.json', () => {
    try {
        const packagePath = path.join(__dirname, 'package.json');
        const packageContent = fs.readFileSync(packagePath, 'utf8');
        const packageJson = JSON.parse(packageContent);

        assert(
            packageJson['node-red'] && packageJson['node-red'].nodes,
            'package.json has node-red.nodes section'
        );

        const nodes = packageJson['node-red'].nodes;

        assert(
            nodes['viis-modbus-error-monitor'] === 'dist/modules/viis-modbus-error-monitor/viis-modbus-error-monitor.js',
            'viis-modbus-error-monitor is registered'
        );

        assert(
            nodes['viis-error-trigger'] === 'dist/modules/viis-error-trigger/viis-error-trigger.js',
            'viis-error-trigger is registered'
        );
    } catch (error) {
        assert(false, `package.json registration failed: ${error.message}`);
    }
});

// Test 4: TypeScript compilation (check for module exports)
testGroup('⚙️ TypeScript Compilation', () => {
    try {
        // Check viis-modbus-error-monitor
        const monitorPath = path.join(__dirname, 'dist/modules/viis-modbus-error-monitor/viis-modbus-error-monitor.js');
        const monitorContent = fs.readFileSync(monitorPath, 'utf8');

        assert(
            monitorContent.includes('module.exports'),
            'viis-modbus-error-monitor has module.exports'
        );

        assert(
            monitorContent.includes('RED.nodes.registerType'),
            'viis-modbus-error-monitor registers with Node-RED'
        );

        assert(
            monitorContent.includes('ErrorNotificationService'),
            'viis-modbus-error-monitor imports ErrorNotificationService'
        );

        assert(
            monitorContent.includes('ErrorMappingService'),
            'viis-modbus-error-monitor imports ErrorMappingService'
        );

        // Check viis-error-trigger
        const triggerPath = path.join(__dirname, 'dist/modules/viis-error-trigger/viis-error-trigger.js');
        const triggerContent = fs.readFileSync(triggerPath, 'utf8');

        assert(
            triggerContent.includes('module.exports'),
            'viis-error-trigger has module.exports'
        );

        assert(
            triggerContent.includes('RED.nodes.registerType'),
            'viis-error-trigger registers with Node-RED'
        );

        assert(
            triggerContent.includes('ErrorNotificationService'),
            'viis-error-trigger imports ErrorNotificationService'
        );
    } catch (error) {
        assert(false, `TypeScript compilation check failed: ${error.message}`);
    }
});

// Test 5: HTML files structure
testGroup('🎨 Node-RED Editor HTML Files', () => {
    try {
        // Check viis-modbus-error-monitor HTML
        const monitorHtmlPath = path.join(__dirname, 'dist/modules/viis-modbus-error-monitor/viis-modbus-error-monitor.html');
        const monitorHtml = fs.readFileSync(monitorHtmlPath, 'utf8');

        assert(
            monitorHtml.includes('RED.nodes.registerType'),
            'Monitor HTML has registerType'
        );

        assert(
            monitorHtml.includes('viis-modbus-error-monitor'),
            'Monitor HTML registers correct node type'
        );

        assert(
            monitorHtml.includes('deviceType'),
            'Monitor HTML has deviceType config'
        );

        assert(
            monitorHtml.includes('pollInterval'),
            'Monitor HTML has pollInterval config'
        );

        assert(
            monitorHtml.includes('data-template-name'),
            'Monitor HTML has template'
        );

        assert(
            monitorHtml.includes('data-help-name'),
            'Monitor HTML has help documentation'
        );

        // Check viis-error-trigger HTML
        const triggerHtmlPath = path.join(__dirname, 'dist/modules/viis-error-trigger/viis-error-trigger.html');
        const triggerHtml = fs.readFileSync(triggerHtmlPath, 'utf8');

        assert(
            triggerHtml.includes('RED.nodes.registerType'),
            'Trigger HTML has registerType'
        );

        assert(
            triggerHtml.includes('viis-error-trigger'),
            'Trigger HTML registers correct node type'
        );

        assert(
            triggerHtml.includes('err_code'),
            'Trigger HTML has err_code config'
        );

        assert(
            triggerHtml.includes('severity'),
            'Trigger HTML has severity config'
        );

        assert(
            triggerHtml.includes('data-template-name'),
            'Trigger HTML has template'
        );

        assert(
            triggerHtml.includes('data-help-name'),
            'Trigger HTML has help documentation'
        );
    } catch (error) {
        assert(false, `HTML structure check failed: ${error.message}`);
    }
});

// Test 6: Node configuration validation
testGroup('🔧 Node Configuration Validation', () => {
    try {
        // Check monitor configuration
        const monitorHtmlPath = path.join(__dirname, 'dist/modules/viis-modbus-error-monitor/viis-modbus-error-monitor.html');
        const monitorHtml = fs.readFileSync(monitorHtmlPath, 'utf8');

        assert(
            monitorHtml.includes('required: true') && monitorHtml.includes('deviceType'),
            'Monitor has required deviceType validation'
        );

        assert(
            monitorHtml.includes('outputs: 2'),
            'Monitor has 2 outputs (error detected, error resolved)'
        );

        assert(
            monitorHtml.includes('category: \'VIIS\''),
            'Monitor is in VIIS category'
        );

        // Check trigger configuration
        const triggerHtmlPath = path.join(__dirname, 'dist/modules/viis-error-trigger/viis-error-trigger.html');
        const triggerHtml = fs.readFileSync(triggerHtmlPath, 'utf8');

        assert(
            triggerHtml.includes('inputs: 1'),
            'Trigger has 1 input'
        );

        assert(
            triggerHtml.includes('outputs: 1'),
            'Trigger has 1 output'
        );

        assert(
            triggerHtml.includes('category: \'VIIS\''),
            'Trigger is in VIIS category'
        );
    } catch (error) {
        assert(false, `Configuration validation failed: ${error.message}`);
    }
});

// Test 7: Integration with core services
testGroup('🔗 Integration with Core Services', () => {
    try {
        const monitorPath = path.join(__dirname, 'dist/modules/viis-modbus-error-monitor/viis-modbus-error-monitor.js');
        const monitorContent = fs.readFileSync(monitorPath, 'utf8');

        assert(
            monitorContent.includes('ErrorNotificationService') &&
            monitorContent.includes('ErrorMappingService'),
            'Monitor integrates with error services'
        );

        assert(
            monitorContent.includes('ClientRegistry') || monitorContent.includes('client_registry'),
            'Monitor integrates with ClientRegistry'
        );

        assert(
            monitorContent.includes('GlobalContextHelper'),
            'Monitor uses GlobalContextHelper'
        );

        const triggerPath = path.join(__dirname, 'dist/modules/viis-error-trigger/viis-error-trigger.js');
        const triggerContent = fs.readFileSync(triggerPath, 'utf8');

        assert(
            triggerContent.includes('ErrorNotificationService'),
            'Trigger integrates with ErrorNotificationService'
        );

        assert(
            triggerContent.includes('BusinessLogicError') || triggerContent.includes('createFromBusinessLogic'),
            'Trigger uses BusinessLogicError interface'
        );
    } catch (error) {
        assert(false, `Integration check failed: ${error.message}`);
    }
});

// Test 8: Node functionality features
testGroup('⚡ Node Functionality Features', () => {
    try {
        const monitorPath = path.join(__dirname, 'dist/modules/viis-modbus-error-monitor/viis-modbus-error-monitor.js');
        const monitorContent = fs.readFileSync(monitorPath, 'utf8');

        assert(
            monitorContent.includes('pollErrors'),
            'Monitor has pollErrors function'
        );

        assert(
            monitorContent.includes('startPolling') && monitorContent.includes('stopPolling'),
            'Monitor has start/stop polling controls'
        );

        assert(
            monitorContent.includes('createFromModbus'),
            'Monitor creates notifications from Modbus'
        );

        assert(
            monitorContent.includes('autoResolveIfClear'),
            'Monitor has auto-resolve functionality'
        );

        const triggerPath = path.join(__dirname, 'dist/modules/viis-error-trigger/viis-error-trigger.js');
        const triggerContent = fs.readFileSync(triggerPath, 'utf8');

        assert(
            triggerContent.includes('createFromBusinessLogic'),
            'Trigger creates notifications from business logic'
        );

        assert(
            triggerContent.includes('msg.notification'),
            'Trigger outputs notification object'
        );

        assert(
            triggerContent.includes('node.status'),
            'Trigger updates node status'
        );
    } catch (error) {
        assert(false, `Functionality check failed: ${error.message}`);
    }
});

// Print summary
log('\n' + '='.repeat(60), 'blue');
log('Phase 2 Test Summary', 'blue');
log('='.repeat(60), 'blue');
log(`Total Tests: ${totalTests}`);
log(`Passed: ${passedTests}`, passedTests === totalTests ? 'green' : 'yellow');
log(`Failed: ${failedTests}`, failedTests === 0 ? 'green' : 'red');
log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(2)}%`, 
    passedTests === totalTests ? 'green' : 'yellow');

if (failedTests === 0) {
    log('\n✅ ALL PHASE 2 TESTS PASSED!', 'green');
    log('\n📦 Custom Nodes Ready:', 'blue');
    log('  • viis-modbus-error-monitor - Automatic Modbus error monitoring', 'green');
    log('  • viis-error-trigger - Business logic error notifications', 'green');
    process.exit(0);
} else {
    log('\n❌ SOME TESTS FAILED', 'red');
    process.exit(1);
}
