/**
 * Test script to verify authentication error handling
 * This script tests that authentication errors return proper 401 status codes
 * instead of generic 500 errors.
 */

const axios = require('axios');

// Configuration
const API_BASE_URL = 'http://localhost:1880/api/v2';
const TEST_CREDENTIALS = {
    invalid: {
        usr: 'invalid@example.com',
        pwd: 'wrongpassword'
    },
    nonexistent: {
        usr: 'nonexistent@example.com', 
        pwd: 'anypassword'
    }
};

/**
 * Test authentication error handling
 */
async function testAuthErrorHandling() {
    console.log('🧪 Testing Authentication Error Handling...\n');

    // Test 1: Invalid credentials
    console.log('Test 1: Invalid credentials');
    try {
        const response = await axios.post(`${API_BASE_URL}/auth/login`, TEST_CREDENTIALS.invalid);
        console.log('❌ Expected authentication error but got success:', response.status);
    } catch (error) {
        if (error.response) {
            const { status, data } = error.response;
            console.log(`Status: ${status}`);
            console.log(`Response:`, JSON.stringify(data, null, 2));
            
            if (status === 401) {
                console.log('✅ Correct 401 status code returned');
                if (data.error === 'AUTHENTICATION_ERROR') {
                    console.log('✅ Correct error type returned');
                } else {
                    console.log('❌ Wrong error type:', data.error);
                }
                if (data.message && data.message !== 'An unexpected error occurred') {
                    console.log('✅ Specific error message returned');
                } else {
                    console.log('❌ Generic error message returned');
                }
            } else if (status === 500) {
                console.log('❌ Still returning 500 error - fix not working');
            } else {
                console.log(`❌ Unexpected status code: ${status}`);
            }
        } else {
            console.log('❌ Network error:', error.message);
        }
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 2: Non-existent user
    console.log('Test 2: Non-existent user');
    try {
        const response = await axios.post(`${API_BASE_URL}/auth/login`, TEST_CREDENTIALS.nonexistent);
        console.log('❌ Expected authentication error but got success:', response.status);
    } catch (error) {
        if (error.response) {
            const { status, data } = error.response;
            console.log(`Status: ${status}`);
            console.log(`Response:`, JSON.stringify(data, null, 2));
            
            if (status === 401) {
                console.log('✅ Correct 401 status code returned');
                if (data.error === 'AUTHENTICATION_ERROR') {
                    console.log('✅ Correct error type returned');
                } else {
                    console.log('❌ Wrong error type:', data.error);
                }
                if (data.message && data.message !== 'An unexpected error occurred') {
                    console.log('✅ Specific error message returned');
                } else {
                    console.log('❌ Generic error message returned');
                }
            } else if (status === 500) {
                console.log('❌ Still returning 500 error - fix not working');
            } else {
                console.log(`❌ Unexpected status code: ${status}`);
            }
        } else {
            console.log('❌ Network error:', error.message);
        }
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 3: Health check to ensure API is working
    console.log('Test 3: Health check');
    try {
        const response = await axios.get(`${API_BASE_URL}/health`);
        console.log('✅ API is responding:', response.status);
        console.log('Health data:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        if (error.response) {
            console.log('❌ Health check failed:', error.response.status);
        } else {
            console.log('❌ Health check network error:', error.message);
        }
    }
}

/**
 * Main execution
 */
async function main() {
    console.log('Authentication Error Handling Test');
    console.log('==================================\n');
    
    console.log('This test verifies that:');
    console.log('1. Authentication failures return 401 status code');
    console.log('2. Error responses contain proper error type (AUTHENTICATION_ERROR)');
    console.log('3. Error messages are specific, not generic');
    console.log('4. API is accessible and responding\n');

    await testAuthErrorHandling();

    console.log('\n🏁 Test completed!');
    console.log('\nExpected behavior after fix:');
    console.log('- Status: 401 (not 500)');
    console.log('- Error type: AUTHENTICATION_ERROR');
    console.log('- Message: "Invalid username or password" (not "An unexpected error occurred")');
}

// Run the test
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { testAuthErrorHandling };
