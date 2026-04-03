/**
 * Test Setup for Marine IoT Tests
 * 
 * This file ensures environment variables are loaded before tests run
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load test environment variables
const envPath = path.resolve(__dirname, '../../../../.env.test');
dotenv.config({ path: envPath });

// Set default test database name if not specified
if (!process.env.DB_NAME) {
    process.env.DB_NAME = 'viis_local_test';
}

console.log('Test environment loaded:');
console.log('- DB_HOST:', process.env.DB_HOST || 'localhost');
console.log('- DB_PORT:', process.env.DB_PORT || '3306');
console.log('- DB_USER:', process.env.DB_USER || 'root');
console.log('- DB_NAME:', process.env.DB_NAME);
