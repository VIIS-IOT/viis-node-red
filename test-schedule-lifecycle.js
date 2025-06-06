/**
 * Test Script for Schedule Lifecycle Management
 * Tests the automated schedule lifecycle management implementation
 */

const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:1881'; // Node-RED server port
const API_PREFIX = '/api/v2';
const TEST_DEVICE_ID = 'b0b3cd50-3c27-11f0-98dc-bf024c096c4a';
const TEST_SCHEDULE_ID = '2653d364dbe67632';

// Test credentials (adjust as needed)
const TEST_USER = {
    username: 'admin',
    password: 'admin123'
};

let authToken = null;

/**
 * Helper function to make authenticated API requests
 */
async function apiRequest(method, endpoint, data = null) {
    const config = {
        method,
        url: `${BASE_URL}${API_PREFIX}${endpoint}`,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if (authToken) {
        config.headers.Authorization = `Bearer ${authToken}`;
    }

    if (data) {
        config.data = data;
    }

    try {
        const response = await axios(config);
        return response.data;
    } catch (error) {
        console.error(`API Request failed: ${method} ${endpoint}`);
        console.error('Error:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Authenticate and get token
 */
async function authenticate() {
    console.log('🔐 Authenticating...');
    try {
        const response = await apiRequest('POST', '/auth/login', TEST_USER);
        authToken = response.token;
        console.log('✅ Authentication successful');
        return true;
    } catch (error) {
        console.log('❌ Authentication failed:', error.message);
        return false;
    }
}

/**
 * Test health endpoints
 */
async function testHealthEndpoints() {
    console.log('\n📊 Testing health endpoints...');
    
    try {
        // Test ThingsBoard service health
        const thingsBoardHealth = await apiRequest('GET', '/thingsboard/health');
        console.log('✅ ThingsBoard health:', thingsBoardHealth.status);

        // Test Schedule Monitor service health
        const scheduleMonitorHealth = await apiRequest('GET', '/schedule-monitor/health');
        console.log('✅ Schedule Monitor health:', scheduleMonitorHealth.status);

        return true;
    } catch (error) {
        console.log('❌ Health check failed:', error.message);
        return false;
    }
}

/**
 * Test schedule activation (start)
 */
async function testScheduleActivation() {
    console.log('\n🚀 Testing schedule activation...');
    
    const rpcPayload = {
        method: 'set_state',
        params: {
            COIL_VAN_NUOC_VAO: 1,
            COIL_BOM_TRON: 1,
            COIL_AUTO_TRON: 1,
            HOLDING_THOI_GIAN_TRON_TOI_DA: 200,
            schedule_id: TEST_SCHEDULE_ID
        },
        timeout: 5000
    };

    try {
        const response = await apiRequest('POST', `/thingsboard/rpc/oneway/${TEST_DEVICE_ID}`, rpcPayload);
        console.log('✅ Schedule activation RPC sent successfully');
        console.log('   - Device ID:', response.deviceId);
        console.log('   - Method:', response.method);
        console.log('   - MQTT Published:', response.mqttPublished);
        console.log('   - Processing Time:', response.processingTime, 'ms');
        
        return true;
    } catch (error) {
        console.log('❌ Schedule activation failed:', error.message);
        return false;
    }
}

/**
 * Test monitoring status
 */
async function testMonitoringStatus() {
    console.log('\n📈 Testing monitoring status...');
    
    try {
        const status = await apiRequest('GET', '/schedule-monitor/status');
        console.log('✅ Monitoring status retrieved');
        console.log('   - Is Monitoring:', status.isMonitoring);
        console.log('   - Active Schedules Count:', status.activeSchedulesCount);
        console.log('   - Monitoring Interval:', status.monitoringIntervalMs, 'ms');
        
        return status;
    } catch (error) {
        console.log('❌ Failed to get monitoring status:', error.message);
        return null;
    }
}

/**
 * Test active schedules
 */
async function testActiveSchedules() {
    console.log('\n📋 Testing active schedules...');
    
    try {
        const activeSchedules = await apiRequest('GET', '/schedule-monitor/active-schedules');
        console.log('✅ Active schedules retrieved');
        console.log('   - Total Count:', activeSchedules.totalCount);
        console.log('   - Is Monitoring:', activeSchedules.monitoringStatus.isMonitoring);
        
        if (activeSchedules.activeSchedules.length > 0) {
            console.log('   - Active Schedules:');
            activeSchedules.activeSchedules.forEach((schedule, index) => {
                console.log(`     ${index + 1}. Schedule ID: ${schedule.scheduleId}`);
                console.log(`        Device ID: ${schedule.deviceId}`);
                console.log(`        Start Time: ${schedule.startTime}`);
                console.log(`        Customer User: ${schedule.customerUser}`);
            });
        }
        
        return activeSchedules;
    } catch (error) {
        console.log('❌ Failed to get active schedules:', error.message);
        return null;
    }
}

/**
 * Test specific schedule details
 */
async function testScheduleDetails(scheduleId) {
    console.log(`\n🔍 Testing schedule details for: ${scheduleId}...`);
    
    try {
        const scheduleDetails = await apiRequest('GET', `/schedule-monitor/active-schedules/${scheduleId}`);
        console.log('✅ Schedule details retrieved');
        console.log('   - Schedule ID:', scheduleDetails.schedule.scheduleId);
        console.log('   - Device ID:', scheduleDetails.schedule.deviceId);
        console.log('   - Start Time:', scheduleDetails.schedule.startTime);
        console.log('   - Last COIL_AUTO_TRON Value:', scheduleDetails.schedule.lastCoilAutoTronValue);
        
        return scheduleDetails;
    } catch (error) {
        console.log('❌ Failed to get schedule details:', error.message);
        return null;
    }
}

/**
 * Simulate schedule completion by sending COIL_AUTO_TRON = 0
 */
async function simulateScheduleCompletion() {
    console.log('\n🏁 Simulating schedule completion...');
    
    const rpcPayload = {
        method: 'set_state',
        params: {
            COIL_AUTO_TRON: 0,
            // Other parameters can remain the same or be omitted
        },
        timeout: 5000
    };

    try {
        const response = await apiRequest('POST', `/thingsboard/rpc/oneway/${TEST_DEVICE_ID}`, rpcPayload);
        console.log('✅ Schedule completion simulation sent');
        console.log('   - COIL_AUTO_TRON set to 0');
        console.log('   - MQTT Published:', response.mqttPublished);
        
        return true;
    } catch (error) {
        console.log('❌ Schedule completion simulation failed:', error.message);
        return false;
    }
}

/**
 * Wait for a specified duration
 */
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main test execution
 */
async function runTests() {
    console.log('🧪 Starting Schedule Lifecycle Management Tests');
    console.log('='.repeat(50));

    // Step 1: Authenticate
    const authSuccess = await authenticate();
    if (!authSuccess) {
        console.log('❌ Cannot proceed without authentication');
        return;
    }

    // Step 2: Test health endpoints
    await testHealthEndpoints();

    // Step 3: Test initial monitoring status
    await testMonitoringStatus();

    // Step 4: Test schedule activation
    const activationSuccess = await testScheduleActivation();
    if (!activationSuccess) {
        console.log('❌ Schedule activation failed, skipping remaining tests');
        return;
    }

    // Step 5: Wait a moment for processing
    console.log('\n⏳ Waiting 3 seconds for processing...');
    await wait(3000);

    // Step 6: Check active schedules
    const activeSchedules = await testActiveSchedules();

    // Step 7: Test specific schedule details if we have active schedules
    if (activeSchedules && activeSchedules.activeSchedules.length > 0) {
        const firstSchedule = activeSchedules.activeSchedules[0];
        await testScheduleDetails(firstSchedule.scheduleId);
    }

    // Step 8: Test monitoring status again
    await testMonitoringStatus();

    // Step 9: Simulate schedule completion
    console.log('\n⏳ Waiting 5 seconds before simulating completion...');
    await wait(5000);
    
    await simulateScheduleCompletion();

    // Step 10: Wait for completion processing
    console.log('\n⏳ Waiting 10 seconds for completion processing...');
    await wait(10000);

    // Step 11: Check final status
    await testMonitoringStatus();
    await testActiveSchedules();

    console.log('\n✅ Schedule Lifecycle Management Tests Completed');
    console.log('='.repeat(50));
}

// Run the tests
runTests().catch(error => {
    console.error('❌ Test execution failed:', error.message);
    process.exit(1);
});
