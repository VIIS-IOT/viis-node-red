/**
 * Simple test script to verify OR filtering functionality
 * This can be run to test the API endpoint manually
 */

const axios = require('axios');

async function testOrFilters() {
    const baseUrl = 'http://localhost:1880/api/v2/notification';
    
    // Test data - adjust these values based on your actual data
    const testParams = {
        order_by: 'created_at desc',
        or_filters: JSON.stringify([
            ["iot_notification", "customer_id", "=", "c08d3dd4-9786-4e94-b3bb-10d01b499ce9"],
            ["iot_notification", "customer_user", "=", "a08abc5c-039b-44a3-afa3-c1fc6ab28675"]
        ]),
        filters: JSON.stringify([]),
        page: 1,
        size: 10
    };

    try {
        console.log('Testing OR filters with parameters:', testParams);
        
        const response = await axios.get(baseUrl, {
            params: testParams,
            headers: {
                'Authorization': 'Bearer YOUR_TOKEN_HERE', // Replace with actual token
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ Success! OR filters are working correctly');
        console.log('Response status:', response.status);
        console.log('Response data:', JSON.stringify(response.data, null, 2));
        
    } catch (error) {
        if (error.response) {
            console.log('❌ Error response:', error.response.status);
            console.log('Error data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.log('❌ Network error:', error.message);
        }
    }
}

// Test with different OR filter combinations
async function testMultipleScenarios() {
    console.log('=== Testing OR Filters Functionality ===\n');
    
    // Scenario 1: Basic OR filter
    console.log('Scenario 1: Basic OR filter');
    await testOrFilters();
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Scenario 2: OR filter with different operators
    console.log('Scenario 2: OR filter with different operators');
    const testParams2 = {
        or_filters: JSON.stringify([
            ["iot_notification", "type", "=", "alert"],
            ["iot_notification", "severity", "=", "high"]
        ]),
        page: 1,
        size: 5
    };
    
    try {
        const response = await axios.get('http://localhost:1880/api/v2/notification', {
            params: testParams2,
            headers: {
                'Authorization': 'Bearer YOUR_TOKEN_HERE',
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ Scenario 2 Success!');
        console.log('Found', response.data.total, 'notifications');
        
    } catch (error) {
        console.log('❌ Scenario 2 Error:', error.response?.data || error.message);
    }
}

if (require.main === module) {
    testMultipleScenarios();
}

module.exports = { testOrFilters, testMultipleScenarios };
