/**
 * Test script để kiểm tra kết nối với STM32 Modbus server
 * Chạy script này để verify connection stability và performance
 */

const ModbusRTU = require('modbus-serial');

// Cấu hình STM32
const STM32_CONFIG = {
    host: process.env.MODBUS_HOST || '192.168.1.51',
    port: parseInt(process.env.MODBUS_TCP_PORT || '502'),
    unitId: parseInt(process.env.MODBUS_UNIT_ID || '1'),
    timeout: parseInt(process.env.MODBUS_TIMEOUT || '3000')
};

console.log('STM32 Modbus Connection Test');
console.log('============================');
console.log(`Target: ${STM32_CONFIG.host}:${STM32_CONFIG.port}`);
console.log(`Unit ID: ${STM32_CONFIG.unitId}`);
console.log(`Timeout: ${STM32_CONFIG.timeout}ms\n`);

class STM32ConnectionTester {
    constructor() {
        this.client = new ModbusRTU();
        this.stats = {
            connectionAttempts: 0,
            connectionSuccesses: 0,
            connectionFailures: 0,
            readAttempts: 0,
            readSuccesses: 0,
            readFailures: 0,
            writeAttempts: 0,
            writeSuccesses: 0,
            writeFailures: 0,
            totalErrors: 0,
            errorTypes: {}
        };
        this.isConnected = false;
    }

    log(message) {
        const timestamp = new Date().toISOString().substring(11, 23);
        console.log(`[${timestamp}] ${message}`);
    }

    error(message) {
        const timestamp = new Date().toISOString().substring(11, 23);
        console.error(`[${timestamp}] ERROR: ${message}`);
    }

    recordError(error) {
        this.stats.totalErrors++;
        const errorType = error.message.includes('ECONNREFUSED') ? 'ECONNREFUSED' :
                         error.message.includes('timeout') ? 'TIMEOUT' :
                         error.message.includes('ETIMEDOUT') ? 'ETIMEDOUT' :
                         error.message.includes('ECONNRESET') ? 'ECONNRESET' : 'OTHER';
        
        this.stats.errorTypes[errorType] = (this.stats.errorTypes[errorType] || 0) + 1;
    }

    async connect() {
        this.stats.connectionAttempts++;
        this.log(`[CONNECT] Attempting connection to STM32...`);
        
        try {
            // Sử dụng timeout ngắn như trong implementation
            const connectPromise = this.client.connectTCP(STM32_CONFIG.host, {
                port: STM32_CONFIG.port,
                socketOptions: {
                    keepAlive: false,
                    timeout: STM32_CONFIG.timeout,
                    noDelay: true,
                    family: 4,
                    connectTimeout: 2000
                }
            });

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Connection timeout after 2s')), 2000);
            });

            await Promise.race([connectPromise, timeoutPromise]);
            
            this.client.setTimeout(STM32_CONFIG.timeout);
            this.client.setID(STM32_CONFIG.unitId);
            this.isConnected = true;
            this.stats.connectionSuccesses++;
            this.log(`[CONNECT] ✓ Connected successfully to STM32`);
            return true;
        } catch (error) {
            this.stats.connectionFailures++;
            this.recordError(error);
            this.error(`[CONNECT] ✗ Connection failed: ${error.message}`);
            this.isConnected = false;
            return false;
        }
    }

    async disconnect() {
        if (this.isConnected) {
            try {
                this.client.close();
                this.isConnected = false;
                this.log(`[DISCONNECT] Disconnected from STM32`);
            } catch (error) {
                this.error(`[DISCONNECT] Error during disconnect: ${error.message}`);
            }
        }
    }

    async testRead(address = 0, length = 1, type = 'coils') {
        if (!this.isConnected) {
            this.error(`[READ] Not connected to STM32`);
            return false;
        }

        this.stats.readAttempts++;
        this.log(`[READ] Reading ${type} at address ${address}, length ${length}`);

        try {
            const readPromise = type === 'coils' ? 
                this.client.readCoils(address, length) :
                type === 'input' ?
                this.client.readInputRegisters(address, length) :
                this.client.readHoldingRegisters(address, length);

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Read ${type} timeout after 3s`)), 3000);
            });

            const result = await Promise.race([readPromise, timeoutPromise]);
            this.stats.readSuccesses++;
            this.log(`[READ] ✓ Read successful: ${JSON.stringify(result.data.slice(0, 5))}${result.data.length > 5 ? '...' : ''}`);
            return true;
        } catch (error) {
            this.stats.readFailures++;
            this.recordError(error);
            this.error(`[READ] ✗ Read failed: ${error.message}`);
            
            // Nếu lỗi connection, đánh dấu disconnected
            if (error.message.includes('ECONNREFUSED') || 
                error.message.includes('ECONNRESET') ||
                error.message.includes('socket hang up')) {
                this.isConnected = false;
            }
            return false;
        }
    }

    async testWrite(address = 100, value = 1234, type = 'register') {
        if (!this.isConnected) {
            this.error(`[WRITE] Not connected to STM32`);
            return false;
        }

        this.stats.writeAttempts++;
        this.log(`[WRITE] Writing ${type} at address ${address}, value ${value}`);

        try {
            const writePromise = type === 'register' ?
                this.client.writeRegister(address, value) :
                this.client.writeCoil(address, !!value);

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Write ${type} timeout after 3s`)), 3000);
            });

            await Promise.race([writePromise, timeoutPromise]);
            this.stats.writeSuccesses++;
            this.log(`[WRITE] ✓ Write successful`);
            return true;
        } catch (error) {
            this.stats.writeFailures++;
            this.recordError(error);
            this.error(`[WRITE] ✗ Write failed: ${error.message}`);
            
            // Nếu lỗi connection, đánh dấu disconnected
            if (error.message.includes('ECONNREFUSED') || 
                error.message.includes('ECONNRESET') ||
                error.message.includes('socket hang up')) {
                this.isConnected = false;
            }
            return false;
        }
    }

    printStats() {
        console.log('\n' + '='.repeat(50));
        console.log('TEST STATISTICS');
        console.log('='.repeat(50));
        console.log(`Connection Attempts: ${this.stats.connectionAttempts}`);
        console.log(`Connection Success:  ${this.stats.connectionSuccesses} (${(this.stats.connectionSuccesses/this.stats.connectionAttempts*100).toFixed(1)}%)`);
        console.log(`Connection Failures: ${this.stats.connectionFailures} (${(this.stats.connectionFailures/this.stats.connectionAttempts*100).toFixed(1)}%)`);
        console.log('');
        console.log(`Read Attempts:       ${this.stats.readAttempts}`);
        console.log(`Read Success:        ${this.stats.readSuccesses} (${this.stats.readAttempts > 0 ? (this.stats.readSuccesses/this.stats.readAttempts*100).toFixed(1) : 0}%)`);
        console.log(`Read Failures:       ${this.stats.readFailures} (${this.stats.readAttempts > 0 ? (this.stats.readFailures/this.stats.readAttempts*100).toFixed(1) : 0}%)`);
        console.log('');
        console.log(`Write Attempts:      ${this.stats.writeAttempts}`);
        console.log(`Write Success:       ${this.stats.writeSuccesses} (${this.stats.writeAttempts > 0 ? (this.stats.writeSuccesses/this.stats.writeAttempts*100).toFixed(1) : 0}%)`);
        console.log(`Write Failures:      ${this.stats.writeFailures} (${this.stats.writeAttempts > 0 ? (this.stats.writeFailures/this.stats.writeAttempts*100).toFixed(1) : 0}%)`);
        console.log('');
        console.log(`Total Errors:        ${this.stats.totalErrors}`);
        console.log('Error Types:');
        Object.entries(this.stats.errorTypes).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
        });
        console.log('='.repeat(50));
    }

    async runBasicTest() {
        console.log('\n🔧 BASIC CONNECTION TEST');
        console.log('-'.repeat(30));
        
        const connected = await this.connect();
        if (!connected) {
            console.log('❌ Basic connection test failed');
            return false;
        }

        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s

        const readSuccess = await this.testRead(0, 1, 'coils');
        await new Promise(resolve => setTimeout(resolve, 500));

        await this.disconnect();
        console.log(readSuccess ? '✅ Basic test passed' : '❌ Basic test failed');
        return readSuccess;
    }

    async runStressTest(duration = 30) {
        console.log(`\n🚀 STRESS TEST (${duration}s)`);
        console.log('-'.repeat(30));
        
        const startTime = Date.now();
        const endTime = startTime + (duration * 1000);
        let testCount = 0;

        while (Date.now() < endTime) {
            testCount++;
            this.log(`Test cycle ${testCount}`);

            // Connect if not connected
            if (!this.isConnected) {
                await this.connect();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Random operations
            if (this.isConnected) {
                const operations = [
                    () => this.testRead(0, 5, 'coils'),
                    () => this.testRead(0, 3, 'input'),
                    () => this.testRead(0, 3, 'holding'),
                    () => this.testWrite(100, Math.floor(Math.random() * 1000), 'register'),
                    () => this.testWrite(0, Math.random() > 0.5, 'coil')
                ];

                const operation = operations[Math.floor(Math.random() * operations.length)];
                await operation();
            }

            // Random delay between operations
            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1500));
        }

        await this.disconnect();
        console.log(`✅ Stress test completed (${testCount} cycles)`);
    }
}

async function main() {
    const tester = new STM32ConnectionTester();

    try {
        // Basic test
        await tester.runBasicTest();

        // Stress test
        const stressDuration = process.argv[2] ? parseInt(process.argv[2]) : 30;
        await tester.runStressTest(stressDuration);

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        tester.printStats();
        process.exit(0);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { STM32ConnectionTester };
