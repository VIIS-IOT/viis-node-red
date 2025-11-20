"use strict";
/**
 * Test configuration for error notification tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testNotificationData = exports.testConfig = void 0;
exports.testConfig = {
    database: {
        type: 'mysql',
        host: 'localhost',
        port: 3308, // External port mapped from docker
        username: 'root',
        password: 'admin@123',
        database: 'viis_local',
        synchronize: false,
        logging: false
    },
    api: {
        baseUrl: 'http://localhost:1881',
        apiPrefix: '/api/v2',
        timeout: 5000
    },
    auth: {
        testUser: {
            email: 'test@viis.com',
            password: 'test123',
            user_id: 'test_user_001'
        }
    }
};
exports.testNotificationData = {
    valid: {
        err_code: 'TEST_ERR_001',
        message: 'Test error message',
        severity: 'medium',
        type: 'warning',
        entity: 'test_entity_001',
        entity_label: 'Test Entity',
        metadata: {
            board_id: 'board1',
            test: true
        }
    },
    critical: {
        err_code: 'TEST_ERR_CRITICAL',
        message: 'Critical test error',
        severity: 'critical',
        type: 'alert',
        entity: 'test_entity_002',
        metadata: {
            board_id: 'board1'
        }
    },
    fanOverrun: {
        err_code: 'ERR_FAN_OVERRUN',
        message: 'Fan running too long',
        severity: 'medium',
        type: 'warning',
        entity: 'test_device_001',
        metadata: {
            board_id: 'board1',
            register_type: 'coil',
            address: 1
        }
    }
};
