/**
 * Test configuration for error notification tests
 */

export const testConfig = {
    database: {
        type: 'mysql' as const,
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

export const testNotificationData = {
    valid: {
        err_code: 'TEST_ERR_001',
        message: 'Test error message',
        severity: 'medium' as const,
        type: 'warning' as const,
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
        severity: 'critical' as const,
        type: 'alert' as const,
        entity: 'test_entity_002',
        metadata: {
            board_id: 'board1'
        }
    },
    fanOverrun: {
        err_code: 'ERR_FAN_OVERRUN',
        message: 'Fan running too long',
        severity: 'medium' as const,
        type: 'warning' as const,
        entity: 'test_device_001',
        metadata: {
            board_id: 'board1',
            register_type: 'coil',
            address: 1
        }
    }
};
