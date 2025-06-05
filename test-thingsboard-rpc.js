/**
 * Test script to verify ThingsBoard RPC REST API functionality
 * This script tests the comprehensive ThingsBoard RPC controller implementation
 */

const axios = require('axios');

// Configuration
const API_BASE_URL = 'http://localhost:1880/api/v2';
const TEST_DEVICE_ID = 'test-device-123';

// Test data for different RPC methods
const TEST_RPC_REQUESTS = {
    setTelemetry: {
        method: 'setTelemetry',
        params: {
            temperature: 25.5,
            humidity: '60',
            status: 'true',
            pressure: 1013.25,
            location: 'room1',
            metadata: {
                sensor_type: 'DHT22',
                firmware_version: '1.2.3'
            }
        },
        timeout: 30000,
        retries: 3
    },
    controlDevice: {
        method: 'controlDevice',
        params: {
            command: 'turn_on',
            parameters: {
                brightness: 80,
                color: 'blue'
            }
        },
        timeout: 15000,
        retries: 2
    },
    customCommand: {
        method: 'updateFirmware',
        params: {
            version: '2.0.0',
            url: 'https://example.com/firmware.bin',
            checksum: 'abc123'
        },
        timeout: 60000,
        retries: 5
    }
};

/**
 * Test ThingsBoard RPC endpoints
 */
async function testThingsBoardRpc() {
    console.log('🧪 Testing ThingsBoard RPC REST API...\n');

    // Test 1: One-way RPC endpoint
    console.log('Test 1: One-way RPC endpoint (setTelemetry)');
    try {
        const response = await axios.post(
            `${API_BASE_URL}/thingsboard/rpc/oneway/${TEST_DEVICE_ID}`,
            TEST_RPC_REQUESTS.setTelemetry
        );
        
        console.log(`✅ Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        
        // Validate response structure
        const data = response.data;
        if (data.success && data.deviceId === TEST_DEVICE_ID && data.method === 'setTelemetry') {
            console.log('✅ Response structure is correct');
            console.log(`✅ Processing time: ${data.processingTime}ms`);
            console.log(`✅ Telemetry records processed: ${data.telemetryRecordsCount}`);
            console.log(`✅ MQTT published: ${data.mqttPublished}`);
        } else {
            console.log('❌ Response structure is incorrect');
        }
    } catch (error) {
        if (error.response) {
            console.log(`❌ Status: ${error.response.status}`);
            console.log(`Response:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.log('❌ Network error:', error.message);
        }
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 2: Specialized telemetry endpoint
    console.log('Test 2: Specialized telemetry endpoint');
    try {
        const telemetryData = {
            method: 'setTelemetry',
            params: {
                cpu_usage: 45.2,
                memory_usage: '78',
                disk_space: 'available',
                network_status: 'connected'
            }
        };

        const response = await axios.post(
            `${API_BASE_URL}/thingsboard/rpc/telemetry/${TEST_DEVICE_ID}`,
            telemetryData
        );
        
        console.log(`✅ Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        
        if (response.data.success && response.data.telemetryRecordsCount > 0) {
            console.log('✅ Telemetry endpoint working correctly');
        }
    } catch (error) {
        if (error.response) {
            console.log(`❌ Status: ${error.response.status}`);
            console.log(`Response:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.log('❌ Network error:', error.message);
        }
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 3: Device control endpoint
    console.log('Test 3: Device control endpoint');
    try {
        const response = await axios.post(
            `${API_BASE_URL}/thingsboard/rpc/control/${TEST_DEVICE_ID}`,
            TEST_RPC_REQUESTS.controlDevice
        );
        
        console.log(`✅ Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        
        if (response.data.success && response.data.method === 'controlDevice') {
            console.log('✅ Device control endpoint working correctly');
        }
    } catch (error) {
        if (error.response) {
            console.log(`❌ Status: ${error.response.status}`);
            console.log(`Response:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.log('❌ Network error:', error.message);
        }
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 4: Custom command endpoint
    console.log('Test 4: Custom command endpoint');
    try {
        const response = await axios.post(
            `${API_BASE_URL}/thingsboard/rpc/custom/${TEST_DEVICE_ID}`,
            TEST_RPC_REQUESTS.customCommand
        );
        
        console.log(`✅ Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        
        if (response.data.success && response.data.method === 'updateFirmware') {
            console.log('✅ Custom command endpoint working correctly');
        }
    } catch (error) {
        if (error.response) {
            console.log(`❌ Status: ${error.response.status}`);
            console.log(`Response:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.log('❌ Network error:', error.message);
        }
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 5: Service health check
    console.log('Test 5: Service health check');
    try {
        const response = await axios.get(`${API_BASE_URL}/thingsboard/health`);
        
        console.log(`✅ Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        
        if (response.data.service === 'ThingsBoard RPC' && response.data.status) {
            console.log('✅ Health check endpoint working correctly');
            console.log(`✅ Service status: ${response.data.status}`);
        }
    } catch (error) {
        if (error.response) {
            console.log(`❌ Status: ${error.response.status}`);
            console.log(`Response:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.log('❌ Network error:', error.message);
        }
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 6: Service statistics
    console.log('Test 6: Service statistics');
    try {
        const response = await axios.get(`${API_BASE_URL}/thingsboard/stats`);
        
        console.log(`✅ Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        
        if (response.data.service === 'ThingsBoard RPC' && response.data.statistics) {
            console.log('✅ Statistics endpoint working correctly');
            console.log(`✅ Total requests: ${response.data.statistics.totalRequests}`);
            console.log(`✅ Success rate: ${response.data.statistics.successfulRequests}/${response.data.statistics.totalRequests}`);
        }
    } catch (error) {
        if (error.response) {
            console.log(`❌ Status: ${error.response.status}`);
            console.log(`Response:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.log('❌ Network error:', error.message);
        }
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 7: Error handling - Invalid device ID
    console.log('Test 7: Error handling - Invalid device ID');
    try {
        const response = await axios.post(
            `${API_BASE_URL}/thingsboard/rpc/oneway/invalid@device!`,
            TEST_RPC_REQUESTS.setTelemetry
        );
        console.log('❌ Expected validation error but got success:', response.status);
    } catch (error) {
        if (error.response && error.response.status === 400) {
            console.log(`✅ Correct validation error: ${error.response.status}`);
            console.log(`Response:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.log(`❌ Unexpected error: ${error.response?.status || 'Network error'}`);
        }
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 8: Error handling - Invalid RPC method
    console.log('Test 8: Error handling - Invalid RPC method');
    try {
        const invalidRequest = {
            method: '', // Invalid empty method
            params: { test: 'value' }
        };

        const response = await axios.post(
            `${API_BASE_URL}/thingsboard/rpc/oneway/${TEST_DEVICE_ID}`,
            invalidRequest
        );
        console.log('❌ Expected validation error but got success:', response.status);
    } catch (error) {
        if (error.response && error.response.status === 400) {
            console.log(`✅ Correct validation error: ${error.response.status}`);
            console.log(`Response:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.log(`❌ Unexpected error: ${error.response?.status || 'Network error'}`);
        }
    }
}

/**
 * Main execution
 */
async function main() {
    console.log('ThingsBoard RPC REST API Test');
    console.log('==============================\n');
    
    console.log('This test verifies:');
    console.log('1. One-way RPC endpoint functionality');
    console.log('2. Specialized telemetry endpoint');
    console.log('3. Device control endpoint');
    console.log('4. Custom command endpoint');
    console.log('5. Service health monitoring');
    console.log('6. Service statistics');
    console.log('7. Input validation and error handling');
    console.log('8. MQTT integration (check logs)');
    console.log('9. Telemetry data transformation\n');

    await testThingsBoardRpc();

    console.log('\n🏁 Test completed!');
    console.log('\nExpected behavior:');
    console.log('- All endpoints should return 200 status codes');
    console.log('- RPC requests should be processed and transformed');
    console.log('- MQTT messages should be published (check Node-RED logs)');
    console.log('- Validation errors should return 400 status codes');
    console.log('- Service health and statistics should be available');
}

// Run the test
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { testThingsBoardRpc };
