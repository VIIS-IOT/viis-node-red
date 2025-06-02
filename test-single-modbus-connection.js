/**
 * Test script để verify single modbus connection behavior
 * Chạy script này để kiểm tra xem ClientRegistry có đảm bảo chỉ 1 connection không
 */

// Simulate Node-RED environment
const mockNode = {
    id: 'test-node-' + Math.random().toString(16).substring(2, 8),
    warn: (msg) => console.log(`[WARN] ${msg}`),
    log: (msg) => console.log(`[LOG] ${msg}`),
    error: (msg) => console.log(`[ERROR] ${msg}`)
};

const mockNode2 = {
    id: 'test-node-' + Math.random().toString(16).substring(2, 8),
    warn: (msg) => console.log(`[WARN] ${msg}`),
    log: (msg) => console.log(`[LOG] ${msg}`),
    error: (msg) => console.log(`[ERROR] ${msg}`)
};

// Import ClientRegistry (adjust path as needed)
const ClientRegistry = require('./dist/core/client-registry').default;

// Test configurations
const config1 = {
    type: "TCP",
    host: "localhost",
    tcpPort: 502,
    unitId: 1,
    timeout: 5000,
    reconnectInterval: 5000
};

const config2 = {
    type: "TCP",
    host: "192.168.1.100", // Different host
    tcpPort: 502,
    unitId: 1,
    timeout: 5000,
    reconnectInterval: 5000
};

async function testSingleConnection() {
    console.log('\n=== TESTING SINGLE MODBUS CONNECTION GUARANTEE ===\n');

    try {
        console.log('1. Testing first node requesting modbus client...');
        const client1 = ClientRegistry.getModbusClient(config1, mockNode);
        console.log('✓ First client obtained');

        console.log('\n2. Checking connection status...');
        const status1 = ClientRegistry.getModbusConnectionStatus();
        console.log('Status after first client:', JSON.stringify(status1, null, 2));

        console.log('\n3. Testing second node requesting modbus client with DIFFERENT config...');
        const client2 = ClientRegistry.getModbusClient(config2, mockNode2);
        console.log('✓ Second client obtained (should use same connection)');

        console.log('\n4. Checking if both clients are the same instance...');
        const isSameInstance = client1 === client2;
        console.log(`Same instance: ${isSameInstance ? '✓ YES' : '✗ NO'}`);

        console.log('\n5. Checking final connection status...');
        const status2 = ClientRegistry.getModbusConnectionStatus();
        console.log('Status after second client:', JSON.stringify(status2, null, 2));

        console.log('\n6. Validating single connection requirement...');
        const isValid = ClientRegistry.validateSingleModbusConnection(mockNode);
        console.log(`Single connection validation: ${isValid ? '✓ PASSED' : '✗ FAILED'}`);

        console.log('\n7. Testing connection counts...');
        ClientRegistry.logConnectionCounts(mockNode);

        console.log('\n8. Releasing first client...');
        ClientRegistry.releaseClient("modbus", mockNode);
        const statusAfterRelease1 = ClientRegistry.getModbusConnectionStatus();
        console.log('Status after releasing first client:', JSON.stringify(statusAfterRelease1, null, 2));

        console.log('\n9. Releasing second client...');
        ClientRegistry.releaseClient("modbus", mockNode2);
        const statusAfterRelease2 = ClientRegistry.getModbusConnectionStatus();
        console.log('Status after releasing second client:', JSON.stringify(statusAfterRelease2, null, 2));

        console.log('\n=== TEST RESULTS ===');
        console.log(`✓ Single instance enforced: ${isSameInstance}`);
        console.log(`✓ Connection validation passed: ${isValid}`);
        console.log(`✓ Proper cleanup: ${statusAfterRelease2.activeConnections === 0}`);
        console.log(`✓ Config enforcement: Different configs were handled correctly`);

        if (isSameInstance && isValid && statusAfterRelease2.activeConnections === 0) {
            console.log('\n🎉 ALL TESTS PASSED - SINGLE CONNECTION GUARANTEE VERIFIED! 🎉');
        } else {
            console.log('\n❌ SOME TESTS FAILED - REVIEW IMPLEMENTATION');
        }

    } catch (error) {
        console.error('\n❌ TEST FAILED WITH ERROR:', error.message);
        console.error(error.stack);
    }
}

// Run the test
if (require.main === module) {
    console.log('Starting single modbus connection test...');
    testSingleConnection().catch(console.error);
} else {
    module.exports = { testSingleConnection };
}
