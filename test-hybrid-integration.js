/**
 * Test script for hybrid routing-controllers integration
 * This script validates that our proof of concept works correctly
 */

const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:1880'; // Node-RED default port
const API_PREFIX = '/api/v2';
const HYBRID_PREFIX = '/api/v2/hybrid';

// Test endpoints
const ENDPOINTS = {
    // Original health endpoint
    originalHealth: `${BASE_URL}${API_PREFIX}/health`,
    
    // Hybrid routing-controllers endpoints
    hybridHealth: `${BASE_URL}${HYBRID_PREFIX}/health`,
    hybridHealthSystem: `${BASE_URL}${HYBRID_PREFIX}/health/system`,
    hybridHealthReady: `${BASE_URL}${HYBRID_PREFIX}/health/ready`,
    hybridHealthLive: `${BASE_URL}${HYBRID_PREFIX}/health/live`,
    
    // Debug endpoints
    debugRoutes: `${BASE_URL}${API_PREFIX}/debug/routes`,
    hybridStatus: `${BASE_URL}${API_PREFIX}/debug/hybrid-status`
};

/**
 * Test helper function
 */
async function testEndpoint(name, url, expectedStatus = 200, headers = {}) {
    try {
        console.log(`\n🧪 Testing ${name}...`);
        console.log(`   URL: ${url}`);
        
        const response = await axios.get(url, { 
            headers,
            timeout: 5000,
            validateStatus: () => true // Don't throw on non-2xx status
        });
        
        const success = response.status === expectedStatus;
        const icon = success ? '✅' : '❌';
        
        console.log(`   ${icon} Status: ${response.status} (expected: ${expectedStatus})`);
        
        if (response.data) {
            console.log(`   📄 Response type: ${typeof response.data}`);
            if (typeof response.data === 'object') {
                console.log(`   📊 Keys: ${Object.keys(response.data).join(', ')}`);
            }
        }
        
        return { success, status: response.status, data: response.data };
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Test authentication with a mock token
 */
async function testAuthenticatedEndpoint(name, url, token) {
    return testEndpoint(name, url, 200, {
        'Authorization': `Bearer ${token}`
    });
}

/**
 * Main test function
 */
async function runTests() {
    console.log('🚀 Starting Hybrid routing-controllers Integration Tests');
    console.log('=' .repeat(60));
    
    const results = [];
    
    // Test 1: Original health endpoint (should still work)
    results.push(await testEndpoint(
        'Original Health Endpoint', 
        ENDPOINTS.originalHealth
    ));
    
    // Test 2: Hybrid health endpoint (basic)
    results.push(await testEndpoint(
        'Hybrid Health Endpoint (Basic)', 
        ENDPOINTS.hybridHealth
    ));
    
    // Test 3: Hybrid readiness probe
    results.push(await testEndpoint(
        'Hybrid Readiness Probe', 
        ENDPOINTS.hybridHealthReady
    ));
    
    // Test 4: Hybrid liveness probe
    results.push(await testEndpoint(
        'Hybrid Liveness Probe', 
        ENDPOINTS.hybridHealthLive
    ));
    
    // Test 5: Authenticated endpoint (should fail without token)
    results.push(await testEndpoint(
        'Hybrid System Info (No Auth)', 
        ENDPOINTS.hybridHealthSystem,
        401 // Expect unauthorized
    ));
    
    // Test 6: Debug routes (check if hybrid routes are registered)
    results.push(await testEndpoint(
        'Debug Routes List', 
        ENDPOINTS.debugRoutes
    ));
    
    // Test 7: Hybrid status
    results.push(await testEndpoint(
        'Hybrid Integration Status', 
        ENDPOINTS.hybridStatus
    ));
    
    // Test 8: Test with mock JWT token (if available)
    const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdCIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTYzMDAwMDAwMH0.test';
    results.push(await testAuthenticatedEndpoint(
        'Hybrid System Info (With Mock Token)', 
        ENDPOINTS.hybridHealthSystem,
        mockToken
    ));
    
    // Summary
    console.log('\n' + '=' .repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('=' .repeat(60));
    
    const passed = results.filter(r => r.success).length;
    const total = results.length;
    
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${total - passed}/${total}`);
    
    if (passed === total) {
        console.log('\n🎉 All tests passed! Hybrid integration is working correctly.');
    } else {
        console.log('\n⚠️  Some tests failed. Check the output above for details.');
    }
    
    // Additional validation
    console.log('\n🔍 VALIDATION CHECKLIST:');
    console.log('- [ ] Original API endpoints still work');
    console.log('- [ ] Hybrid endpoints respond correctly');
    console.log('- [ ] Authentication integration works');
    console.log('- [ ] Error handling is consistent');
    console.log('- [ ] Debug endpoints show hybrid routes');
    
    return passed === total;
}

/**
 * Check if Node-RED is running
 */
async function checkNodeRedStatus() {
    try {
        console.log('🔍 Checking if Node-RED is running...');
        const response = await axios.get(`${BASE_URL}/`, { timeout: 3000 });
        console.log('✅ Node-RED is running');
        return true;
    } catch (error) {
        console.log('❌ Node-RED is not running or not accessible');
        console.log('   Please start Node-RED and ensure the VIIS REST API node is deployed');
        return false;
    }
}

/**
 * Run the test suite
 */
async function main() {
    console.log('🧪 VIIS REST API - Hybrid routing-controllers Integration Test');
    console.log('================================================================');
    
    // Check prerequisites
    const nodeRedRunning = await checkNodeRedStatus();
    if (!nodeRedRunning) {
        process.exit(1);
    }
    
    // Wait a moment for services to be ready
    console.log('⏳ Waiting 2 seconds for services to be ready...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Run tests
    const success = await runTests();
    
    // Exit with appropriate code
    process.exit(success ? 0 : 1);
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Test suite failed:', error);
        process.exit(1);
    });
}

module.exports = { runTests, testEndpoint, checkNodeRedStatus };
