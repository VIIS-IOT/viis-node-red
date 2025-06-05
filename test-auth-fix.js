#!/usr/bin/env node

/**
 * Test script to verify the authentication double response fix
 * 
 * This script tests:
 * 1. Successful login - should return 200 with token and user data
 * 2. Failed login - should return 401 with error message
 * 3. No double response errors should occur
 */

const http = require('http');

// Configuration
const config = {
    host: 'localhost',
    port: 1881, // Node-RED port
    apiPrefix: '/api/v2'
};

/**
 * Make HTTP request and return promise
 */
function makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: jsonData
                    });
                } catch (error) {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: data,
                        parseError: error.message
                    });
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        if (postData) {
            req.write(postData);
        }
        
        req.end();
    });
}

/**
 * Test successful login
 */
async function testSuccessfulLogin() {
    console.log('\n🧪 Testing successful login...');
    
    const loginData = JSON.stringify({
        usr: 'dev@vietplants.com',
        pwd: 'password123',
        authMethod: 'password',
        rememberMe: false
    });
    
    const options = {
        hostname: config.host,
        port: config.port,
        path: `${config.apiPrefix}/auth/login`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(loginData)
        }
    };
    
    try {
        const response = await makeRequest(options, loginData);
        
        console.log(`📊 Status Code: ${response.statusCode}`);
        console.log(`📋 Response:`, JSON.stringify(response.data, null, 2));
        
        if (response.statusCode === 200 && response.data.result && response.data.result.token) {
            console.log('✅ Successful login test PASSED');
            return true;
        } else {
            console.log('❌ Successful login test FAILED - Expected 200 with token');
            return false;
        }
    } catch (error) {
        console.log('❌ Successful login test ERROR:', error.message);
        return false;
    }
}

/**
 * Test failed login
 */
async function testFailedLogin() {
    console.log('\n🧪 Testing failed login...');
    
    const loginData = JSON.stringify({
        usr: 'nonexistent@user.com',
        pwd: 'wrongpassword',
        authMethod: 'password',
        rememberMe: false
    });
    
    const options = {
        hostname: config.host,
        port: config.port,
        path: `${config.apiPrefix}/auth/login`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(loginData)
        }
    };
    
    try {
        const response = await makeRequest(options, loginData);
        
        console.log(`📊 Status Code: ${response.statusCode}`);
        console.log(`📋 Response:`, JSON.stringify(response.data, null, 2));
        
        if (response.statusCode === 401 && response.data.error) {
            console.log('✅ Failed login test PASSED');
            return true;
        } else {
            console.log('❌ Failed login test FAILED - Expected 401 with error');
            return false;
        }
    } catch (error) {
        console.log('❌ Failed login test ERROR:', error.message);
        return false;
    }
}

/**
 * Test health endpoint to ensure API is working
 */
async function testHealthEndpoint() {
    console.log('\n🧪 Testing health endpoint...');
    
    const options = {
        hostname: config.host,
        port: config.port,
        path: `${config.apiPrefix}/health`,
        method: 'GET'
    };
    
    try {
        const response = await makeRequest(options);
        
        console.log(`📊 Status Code: ${response.statusCode}`);
        console.log(`📋 Response:`, JSON.stringify(response.data, null, 2));
        
        if (response.statusCode === 200) {
            console.log('✅ Health endpoint test PASSED');
            return true;
        } else {
            console.log('❌ Health endpoint test FAILED');
            return false;
        }
    } catch (error) {
        console.log('❌ Health endpoint test ERROR:', error.message);
        return false;
    }
}

/**
 * Main test runner
 */
async function runTests() {
    console.log('🚀 Starting VIIS REST API Authentication Fix Tests');
    console.log(`🔗 Testing against: http://${config.host}:${config.port}${config.apiPrefix}`);
    
    const results = [];
    
    // Test health endpoint first
    results.push(await testHealthEndpoint());
    
    // Test authentication endpoints
    results.push(await testSuccessfulLogin());
    results.push(await testFailedLogin());
    
    // Summary
    const passed = results.filter(r => r).length;
    const total = results.length;
    
    console.log('\n📊 Test Results Summary:');
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${total - passed}/${total}`);
    
    if (passed === total) {
        console.log('\n🎉 All tests PASSED! The double response fix is working correctly.');
        process.exit(0);
    } else {
        console.log('\n💥 Some tests FAILED. Please check the Node-RED logs for errors.');
        process.exit(1);
    }
}

// Run the tests
runTests().catch((error) => {
    console.error('💥 Test runner error:', error);
    process.exit(1);
});
