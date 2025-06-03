#!/usr/bin/env node

/**
 * Test script for VIIS REST API Node
 * Tests all API endpoints and validates responses
 */

const axios = require('axios');

// Configuration
const BASE_URL = process.env.NODE_RED_URL || 'http://localhost:1880';
const API_PREFIX = '/api/v2';
const API_BASE = `${BASE_URL}${API_PREFIX}`;

// Test credentials (update these based on your database)
const TEST_CREDENTIALS = {
    usr: process.env.TEST_USERNAME || 'admin@example.com',
    pwd: process.env.TEST_PASSWORD || 'password123'
};

// Colors for console output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

/**
 * Log with colors
 */
function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Test health endpoint
 */
async function testHealth() {
    log('blue', '\n🔍 Testing Health Endpoint...');
    
    try {
        const response = await axios.get(`${API_BASE}/health`);
        
        if (response.status === 200 && response.data.status === 'ok') {
            log('green', '✅ Health check passed');
            console.log('   Status:', response.data.status);
            console.log('   Services:', JSON.stringify(response.data.services, null, 2));
            return true;
        } else {
            log('red', '❌ Health check failed - unexpected response');
            return false;
        }
    } catch (error) {
        log('red', `❌ Health check failed: ${error.message}`);
        if (error.response) {
            console.log('   Status:', error.response.status);
            console.log('   Data:', JSON.stringify(error.response.data, null, 2));
        }
        return false;
    }
}

/**
 * Test login endpoint
 */
async function testLogin() {
    log('blue', '\n🔐 Testing Login Endpoint...');
    
    try {
        const response = await axios.post(`${API_BASE}/auth/login`, TEST_CREDENTIALS, {
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.status === 200 && response.data.result && response.data.result.token) {
            log('green', '✅ Login successful');
            console.log('   User ID:', response.data.result.user.user_id);
            console.log('   Email:', response.data.result.user.email);
            console.log('   Customer ID:', response.data.result.user.customer_id);
            console.log('   Is Admin:', response.data.result.user.is_admin);
            console.log('   Token length:', response.data.result.token.length);
            return response.data.result.token;
        } else {
            log('red', '❌ Login failed - no token received');
            return null;
        }
    } catch (error) {
        log('red', `❌ Login failed: ${error.message}`);
        if (error.response) {
            console.log('   Status:', error.response.status);
            console.log('   Data:', JSON.stringify(error.response.data, null, 2));
        }
        return null;
    }
}

/**
 * Test login with invalid credentials
 */
async function testInvalidLogin() {
    log('blue', '\n🚫 Testing Invalid Login...');
    
    try {
        const response = await axios.post(`${API_BASE}/auth/login`, {
            usr: 'invalid@example.com',
            pwd: 'wrongpassword'
        }, {
            headers: { 'Content-Type': 'application/json' }
        });
        
        log('red', '❌ Invalid login should have failed but succeeded');
        return false;
    } catch (error) {
        if (error.response && error.response.status === 401) {
            log('green', '✅ Invalid login correctly rejected');
            console.log('   Error message:', error.response.data.message);
            return true;
        } else {
            log('red', `❌ Unexpected error for invalid login: ${error.message}`);
            return false;
        }
    }
}

/**
 * Test token verification
 */
async function testTokenVerification(token) {
    log('blue', '\n🔍 Testing Token Verification...');
    
    try {
        const response = await axios.get(`${API_BASE}/auth/verify`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.status === 200 && response.data.valid) {
            log('green', '✅ Token verification successful');
            console.log('   User ID:', response.data.user.user_id);
            console.log('   Email:', response.data.user.email);
            return true;
        } else {
            log('red', '❌ Token verification failed');
            return false;
        }
    } catch (error) {
        log('red', `❌ Token verification error: ${error.message}`);
        return false;
    }
}

/**
 * Test get current user
 */
async function testGetCurrentUser(token) {
    log('blue', '\n👤 Testing Get Current User...');
    
    try {
        const response = await axios.get(`${API_BASE}/users/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.status === 200 && response.data.result) {
            log('green', '✅ Get current user successful');
            console.log('   Name:', response.data.result.name);
            console.log('   Email:', response.data.result.email);
            console.log('   Customer ID:', response.data.result.customer_id);
            return true;
        } else {
            log('red', '❌ Get current user failed');
            return false;
        }
    } catch (error) {
        log('red', `❌ Get current user error: ${error.message}`);
        if (error.response) {
            console.log('   Status:', error.response.status);
            console.log('   Data:', JSON.stringify(error.response.data, null, 2));
        }
        return false;
    }
}

/**
 * Test unauthorized access
 */
async function testUnauthorizedAccess() {
    log('blue', '\n🚫 Testing Unauthorized Access...');
    
    try {
        const response = await axios.get(`${API_BASE}/users/me`);
        log('red', '❌ Unauthorized access should have failed but succeeded');
        return false;
    } catch (error) {
        if (error.response && error.response.status === 401) {
            log('green', '✅ Unauthorized access correctly rejected');
            console.log('   Error message:', error.response.data.message);
            return true;
        } else {
            log('red', `❌ Unexpected error for unauthorized access: ${error.message}`);
            return false;
        }
    }
}

/**
 * Test devices endpoint
 */
async function testGetDevices(token) {
    log('blue', '\n📱 Testing Get Devices...');
    
    try {
        const response = await axios.get(`${API_BASE}/devices`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.status === 200 && response.data.result) {
            log('green', '✅ Get devices successful');
            console.log('   Device count:', response.data.result.count);
            if (response.data.result.data.length > 0) {
                console.log('   First device:', response.data.result.data[0].name);
            }
            return true;
        } else {
            log('red', '❌ Get devices failed');
            return false;
        }
    } catch (error) {
        log('red', `❌ Get devices error: ${error.message}`);
        if (error.response) {
            console.log('   Status:', error.response.status);
            console.log('   Data:', JSON.stringify(error.response.data, null, 2));
        }
        return false;
    }
}

/**
 * Test logout
 */
async function testLogout(token) {
    log('blue', '\n🚪 Testing Logout...');
    
    try {
        const response = await axios.post(`${API_BASE}/auth/logout`, {}, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.status === 200) {
            log('green', '✅ Logout successful');
            console.log('   Message:', response.data.message);
            return true;
        } else {
            log('red', '❌ Logout failed');
            return false;
        }
    } catch (error) {
        log('red', `❌ Logout error: ${error.message}`);
        return false;
    }
}

/**
 * Run all tests
 */
async function runAllTests() {
    log('yellow', '🚀 Starting VIIS REST API Tests...');
    log('yellow', `📍 Testing against: ${API_BASE}`);
    
    const results = [];
    
    // Test 1: Health check
    results.push(await testHealth());
    
    // Test 2: Invalid login
    results.push(await testInvalidLogin());
    
    // Test 3: Valid login
    const token = await testLogin();
    results.push(!!token);
    
    if (token) {
        // Test 4: Token verification
        results.push(await testTokenVerification(token));
        
        // Test 5: Get current user
        results.push(await testGetCurrentUser(token));
        
        // Test 6: Get devices
        results.push(await testGetDevices(token));
        
        // Test 7: Logout
        results.push(await testLogout(token));
    } else {
        log('yellow', '⚠️  Skipping authenticated tests due to login failure');
        results.push(false, false, false, false);
    }
    
    // Test 8: Unauthorized access
    results.push(await testUnauthorizedAccess());
    
    // Summary
    const passed = results.filter(r => r).length;
    const total = results.length;
    
    log('yellow', '\n📊 Test Summary:');
    log(passed === total ? 'green' : 'red', `   ${passed}/${total} tests passed`);
    
    if (passed === total) {
        log('green', '🎉 All tests passed! VIIS REST API is working correctly.');
        process.exit(0);
    } else {
        log('red', '❌ Some tests failed. Please check the API configuration.');
        process.exit(1);
    }
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
VIIS REST API Test Script

Usage: node test-viis-rest-api.js [options]

Options:
  --help, -h     Show this help message
  
Environment Variables:
  NODE_RED_URL   Base URL for Node-RED (default: http://localhost:1880)
  TEST_USERNAME  Username for testing (default: admin@example.com)
  TEST_PASSWORD  Password for testing (default: password123)

Examples:
  node test-viis-rest-api.js
  NODE_RED_URL=http://localhost:1881 node test-viis-rest-api.js
  TEST_USERNAME=user@test.com TEST_PASSWORD=secret node test-viis-rest-api.js
`);
    process.exit(0);
}

// Run tests
runAllTests().catch(error => {
    log('red', `💥 Test runner crashed: ${error.message}`);
    process.exit(1);
});
