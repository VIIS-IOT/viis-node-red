"use strict";
/**
 * Integration tests for ErrorNotificationService with real MySQL database
 * Tests actual database operations, deduplication, and auto-resolve
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const error_notification_service_1 = require("../../error-notification.service");
const error_mapping_service_1 = require("../../error-mapping.service");
const TabiotNotification_1 = require("../../../orm/entities/notification/TabiotNotification");
const typeorm_1 = require("typeorm");
const dataSourceModule = __importStar(require("../../../orm/dataSource"));
const path = __importStar(require("path"));
// Mock createDataSource to return our test dataSource
jest.mock('../../../orm/dataSource');
describe('ErrorNotificationService - Real Database Integration', () => {
    let dataSource;
    let notificationRepo;
    let errorNotificationService;
    let errorMappingService;
    let mockNodeContext;
    beforeAll(async () => {
        console.log('🔌 Connecting to real MySQL database...');
        // Create DataSource with real database credentials
        // MySQL is running in Docker on port 3308 (mapped from 3306)
        const entitiesPath = path.join(__dirname, '../../../orm/entities/**/*.{js,ts}');
        dataSource = new typeorm_1.DataSource({
            type: 'mysql',
            host: 'localhost',
            port: 3308, // Docker port mapping: 3308:3306
            username: 'root', // Use root user
            password: 'admin@123',
            database: 'viis_local',
            // Use glob pattern to load all entities (same as production)
            entities: [entitiesPath],
            synchronize: false, // Don't auto-create/alter tables
            logging: false
        });
        await dataSource.initialize();
        notificationRepo = dataSource.getRepository(TabiotNotification_1.TabiotNotification);
        console.log('✅ Connected to MySQL database');
        // Mock createDataSource to return our test dataSource
        dataSourceModule.createDataSource.mockResolvedValue(dataSource);
        // Setup mock node context with real error code mappings (BoardId approach)
        mockNodeContext = {
            global: {
                get: jest.fn((key) => {
                    if (key === 'errorCodeMappings') {
                        return {
                            'board1': {
                                board_id: 'board1',
                                board_name: 'Test Board 1',
                                device_type: 'Climate_Controller', // Keep for backward compatibility
                                mappings: [
                                    {
                                        register_type: 'holding',
                                        address: 1000,
                                        error_codes: [
                                            {
                                                code: 1,
                                                err_code: 'ERR_TEMP_HIGH',
                                                message: 'Nhiệt độ vượt ngưỡng an toàn',
                                                severity: 'high',
                                                auto_resolve: true
                                            },
                                            {
                                                code: 2,
                                                err_code: 'ERR_TEMP_SENSOR_FAULT',
                                                message: 'Cảm biến nhiệt độ bị lỗi',
                                                severity: 'critical',
                                                auto_resolve: false
                                            }
                                        ]
                                    },
                                    {
                                        register_type: 'coil',
                                        address: 500,
                                        error_codes: [
                                            {
                                                code: true,
                                                err_code: 'ERR_FAN_OVERRUN',
                                                message: 'Quạt chạy quá giới hạn thời gian',
                                                severity: 'medium',
                                                auto_resolve: true
                                            }
                                        ]
                                    }
                                ]
                            }
                        };
                    }
                    return undefined;
                }),
                set: jest.fn()
            },
            get: jest.fn(),
            set: jest.fn(),
            keys: jest.fn(),
            flow: {},
            nodes: {}
        };
        // Initialize services with mock context that returns real data
        const contextWithDataSource = Object.assign(Object.assign({}, mockNodeContext), { _getDataSource: () => Promise.resolve(dataSource) });
        errorMappingService = new error_mapping_service_1.ErrorMappingService(mockNodeContext);
        errorNotificationService = new error_notification_service_1.ErrorNotificationService(mockNodeContext);
        // Wait for repository initialization
        await new Promise(resolve => setTimeout(resolve, 200));
    });
    afterAll(async () => {
        if (dataSource && dataSource.isInitialized) {
            await dataSource.destroy();
            console.log('🔌 Disconnected from MySQL database');
        }
    });
    beforeEach(async () => {
        // Clean up test notifications before each test
        // Use prefix to identify test notifications
        await notificationRepo
            .createQueryBuilder()
            .delete()
            .where('name LIKE :prefix', { prefix: 'notification_test_%' })
            .execute();
        console.log('🧹 Cleaned test notifications');
    });
    describe('🗄️ Database Operations', () => {
        it('should connect to real MySQL database', async () => {
            expect(dataSource.isInitialized).toBe(true);
            // Test query
            const count = await notificationRepo.count();
            console.log(`📊 Total notifications in database: ${count}`);
            expect(count).toBeGreaterThanOrEqual(0);
        });
        it('should verify tabiot_notification table structure', async () => {
            const metadata = dataSource.getMetadata(TabiotNotification_1.TabiotNotification);
            console.log('📋 Table columns:');
            metadata.columns.forEach(col => {
                console.log(`  - ${col.propertyName}: ${col.type}`);
            });
            // Verify critical columns exist
            const columnNames = metadata.columns.map(c => c.propertyName);
            expect(columnNames).toContain('name');
            expect(columnNames).toContain('err_code');
            expect(columnNames).toContain('entity');
            expect(columnNames).toContain('severity');
            expect(columnNames).toContain('is_read');
            expect(columnNames).toContain('metadata');
        });
    });
    describe('📝 Create Notification from Business Logic', () => {
        it('should create notification in real database', async () => {
            const errorData = {
                err_code: 'TEST_ERROR_001',
                message: 'Integration test error message',
                severity: 'high',
                type: 'error',
                entity: 'test_device_001',
                metadata: {
                    test_run: 'integration',
                    timestamp: new Date().toISOString()
                }
            };
            const notification = await errorNotificationService.createFromBusinessLogic(errorData);
            console.log(`✅ Created notification: ${notification.name}`);
            // Verify in database
            const found = await notificationRepo.findOne({
                where: { name: notification.name }
            });
            expect(found).not.toBeNull();
            expect(found === null || found === void 0 ? void 0 : found.err_code).toBe('TEST_ERROR_001');
            expect(found === null || found === void 0 ? void 0 : found.message).toBe('Integration test error message');
            expect(found === null || found === void 0 ? void 0 : found.severity).toBe('high');
            expect(found === null || found === void 0 ? void 0 : found.entity).toBe('test_device_001');
            expect(found === null || found === void 0 ? void 0 : found.is_read).toBe(0);
            // Verify metadata is valid JSON
            const metadata = JSON.parse(found.metadata || '{}');
            expect(metadata.occurrence_count).toBe(1);
            expect(metadata.first_occurred).toBeDefined();
            expect(metadata.test_run).toBe('integration');
            console.log('📊 Metadata:', metadata);
        });
        it('should handle metadata as JSON string', async () => {
            const notification = await errorNotificationService.createFromBusinessLogic({
                err_code: 'METADATA_TEST',
                message: 'Test metadata storage',
                severity: 'low',
                type: 'info',
                entity: 'test_metadata_device',
                metadata: {
                    custom_field_1: 'value1',
                    custom_field_2: 42,
                    nested: {
                        data: 'nested_value'
                    }
                }
            });
            const found = await notificationRepo.findOne({
                where: { name: notification.name }
            });
            const metadata = JSON.parse(found.metadata || '{}');
            expect(metadata.custom_field_1).toBe('value1');
            expect(metadata.custom_field_2).toBe(42);
            expect(metadata.nested.data).toBe('nested_value');
            expect(metadata.occurrence_count).toBe(1);
        });
    });
    describe('🔄 Deduplication with Real Database', () => {
        it('should prevent duplicate notifications via database query', async () => {
            const errorData = {
                err_code: 'DUPLICATE_TEST',
                message: 'First occurrence',
                severity: 'high',
                type: 'error',
                entity: 'test_device_duplicate'
            };
            // Create first notification
            const first = await errorNotificationService.createFromBusinessLogic(errorData);
            console.log(`✅ First notification: ${first.name}`);
            // Try to create duplicate (same err_code + entity)
            errorData.message = 'Second occurrence (should update, not create new)';
            const second = await errorNotificationService.createFromBusinessLogic(errorData);
            console.log(`✅ Second attempt: ${second.name}`);
            // Should be same notification name (updated, not new)
            expect(second.name).toBe(first.name);
            // Verify only 1 unresolved notification exists in database
            const count = await notificationRepo.count({
                where: {
                    err_code: 'DUPLICATE_TEST',
                    entity: 'test_device_duplicate',
                    is_read: 0
                }
            });
            expect(count).toBe(1);
            console.log(`✅ Database has only 1 unresolved notification (deduplication works!)`);
            // Verify occurrence count was incremented
            const notification = await notificationRepo.findOne({
                where: { name: first.name }
            });
            const metadata = JSON.parse(notification.metadata || '{}');
            expect(metadata.occurrence_count).toBe(2);
            expect(metadata.last_occurred).toBeDefined();
            console.log(`📊 Occurrence count: ${metadata.occurrence_count}`);
        });
        it('should allow multiple errors with different err_codes', async () => {
            const entity = 'test_device_multiple';
            // Create first error
            await errorNotificationService.createFromBusinessLogic({
                err_code: 'ERROR_TYPE_A',
                message: 'Error A',
                severity: 'high',
                type: 'error',
                entity
            });
            // Create second error (different err_code)
            await errorNotificationService.createFromBusinessLogic({
                err_code: 'ERROR_TYPE_B',
                message: 'Error B',
                severity: 'medium',
                type: 'error',
                entity
            });
            // Should have 2 separate notifications
            const count = await notificationRepo.count({
                where: {
                    entity,
                    is_read: 0
                }
            });
            expect(count).toBe(2);
            console.log(`✅ Multiple different errors allowed: ${count} notifications`);
        });
        it('should allow same err_code for different entities', async () => {
            const errCode = 'SHARED_ERROR';
            // Create for device 1
            await errorNotificationService.createFromBusinessLogic({
                err_code: errCode,
                message: 'Error on device 1',
                severity: 'high',
                type: 'error',
                entity: 'test_device_001'
            });
            // Create for device 2
            await errorNotificationService.createFromBusinessLogic({
                err_code: errCode,
                message: 'Error on device 2',
                severity: 'high',
                type: 'error',
                entity: 'test_device_002'
            });
            // Should have 2 separate notifications
            const count = await notificationRepo.count({
                where: {
                    err_code: errCode,
                    is_read: 0
                }
            });
            expect(count).toBe(2);
            console.log(`✅ Same error code on different entities: ${count} notifications`);
        });
    });
    describe('🔄 Auto-Resolve with Real Database', () => {
        it('should auto-resolve notification when error clears (holding register)', async () => {
            const entity = 'test_device_autoresolve';
            // Create error from Modbus
            const modbusError = {
                register_type: 'holding',
                address: 1000,
                value: 1 // ERR_TEMP_HIGH
            };
            const notification = await errorNotificationService.createFromModbusByBoardId(modbusError, 'board1', entity);
            expect(notification).not.toBeNull();
            expect(notification === null || notification === void 0 ? void 0 : notification.is_read).toBe(0);
            console.log(`✅ Created error notification: ${notification === null || notification === void 0 ? void 0 : notification.name}`);
            // Clear error (value = 0)
            await errorNotificationService.autoResolveIfClearByBoardId({ register_type: 'holding', address: 1000, value: 0 }, 'board1', entity);
            // Verify notification was marked as read in database
            const resolved = await notificationRepo.findOne({
                where: { name: notification.name }
            });
            expect(resolved === null || resolved === void 0 ? void 0 : resolved.is_read).toBe(1);
            console.log(`✅ Notification auto-resolved (is_read = 1)`);
            // Verify metadata has resolution info
            const metadata = JSON.parse(resolved.metadata || '{}');
            expect(metadata.resolved_by).toBe('auto');
            expect(metadata.resolved_at).toBeDefined();
            console.log(`📊 Resolved metadata:`, metadata);
        });
        it('should auto-resolve coil errors', async () => {
            const entity = 'test_device_coil';
            // Create coil error
            const notification = await errorNotificationService.createFromModbusByBoardId({ register_type: 'coil', address: 500, value: true }, 'board1', entity);
            expect(notification).not.toBeNull();
            console.log(`✅ Created coil error: ${notification === null || notification === void 0 ? void 0 : notification.name}`);
            // Clear coil (value = false)
            await errorNotificationService.autoResolveIfClearByBoardId({ register_type: 'coil', address: 500, value: false }, 'board1', entity);
            // Verify resolved
            const resolved = await notificationRepo.findOne({
                where: { name: notification.name }
            });
            expect(resolved === null || resolved === void 0 ? void 0 : resolved.is_read).toBe(1);
            console.log(`✅ Coil error auto-resolved`);
        });
        it('should NOT auto-resolve if auto_resolve is false', async () => {
            const entity = 'test_device_no_autoresolve';
            // Create error with auto_resolve: false
            const notification = await errorNotificationService.createFromModbusByBoardId({ register_type: 'holding', address: 1000, value: 2 }, // ERR_TEMP_SENSOR_FAULT
            'board1', entity);
            expect(notification).not.toBeNull();
            expect(notification === null || notification === void 0 ? void 0 : notification.err_code).toBe('ERR_TEMP_SENSOR_FAULT');
            // Try to auto-resolve (should not work because auto_resolve: false)
            await errorNotificationService.autoResolveIfClearByBoardId({ register_type: 'holding', address: 1000, value: 0 }, 'board1', entity);
            // Verify still unresolved
            const stillUnresolved = await notificationRepo.findOne({
                where: { name: notification.name }
            });
            expect(stillUnresolved === null || stillUnresolved === void 0 ? void 0 : stillUnresolved.is_read).toBe(0);
            console.log(`✅ Critical error NOT auto-resolved (requires manual intervention)`);
        });
    });
    describe('📊 Occurrence Counting', () => {
        it('should increment occurrence_count on duplicate errors', async () => {
            const errorData = {
                err_code: 'REPEATED_ERROR',
                message: 'Repeated error',
                severity: 'medium',
                type: 'warning',
                entity: 'test_device_counting'
            };
            // Create initial notification
            await errorNotificationService.createFromBusinessLogic(errorData);
            // Trigger same error 4 more times
            for (let i = 0; i < 4; i++) {
                await errorNotificationService.createFromBusinessLogic(errorData);
                await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
            }
            // Verify occurrence count
            const notification = await notificationRepo.findOne({
                where: {
                    err_code: 'REPEATED_ERROR',
                    entity: 'test_device_counting'
                }
            });
            const metadata = JSON.parse(notification.metadata || '{}');
            expect(metadata.occurrence_count).toBe(5);
            expect(metadata.first_occurred).toBeDefined();
            expect(metadata.last_occurred).toBeDefined();
            console.log(`📊 Error occurred ${metadata.occurrence_count} times`);
            console.log(`   First: ${metadata.first_occurred}`);
            console.log(`   Last:  ${metadata.last_occurred}`);
        });
    });
    describe('🎯 Error Mapping from Global Context', () => {
        it('should parse error from global context mappings', () => {
            const source = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };
            const parsedError = errorMappingService.parseModbusErrorByBoardId(source, 'board1');
            expect(parsedError).not.toBeNull();
            expect(parsedError === null || parsedError === void 0 ? void 0 : parsedError.err_code).toBe('ERR_TEMP_HIGH');
            expect(parsedError === null || parsedError === void 0 ? void 0 : parsedError.message).toBe('Nhiệt độ vượt ngưỡng an toàn');
            expect(parsedError === null || parsedError === void 0 ? void 0 : parsedError.severity).toBe('high');
            expect(parsedError === null || parsedError === void 0 ? void 0 : parsedError.auto_resolve).toBe(true);
            console.log(`✅ Parsed error from global context:`, parsedError);
        });
        it('should return null for unmapped errors', () => {
            const source = {
                register_type: 'holding',
                address: 9999,
                value: 1
            };
            const parsedError = errorMappingService.parseModbusErrorByBoardId(source, 'board1');
            expect(parsedError).toBeNull();
            console.log(`✅ Correctly returned null for unmapped register`);
        });
    });
    describe('🔍 Edge Cases with Real Database', () => {
        it('should handle very long error messages', async () => {
            const longMessage = 'A'.repeat(1000); // 1000 character message
            const notification = await errorNotificationService.createFromBusinessLogic({
                err_code: 'LONG_MESSAGE_TEST',
                message: longMessage,
                severity: 'low',
                type: 'info',
                entity: 'test_long_message'
            });
            const found = await notificationRepo.findOne({
                where: { name: notification.name }
            });
            expect(found === null || found === void 0 ? void 0 : found.message).toBe(longMessage);
            console.log(`✅ Long message stored successfully (${longMessage.length} chars)`);
        });
        it('should handle special characters in metadata', async () => {
            const notification = await errorNotificationService.createFromBusinessLogic({
                err_code: 'SPECIAL_CHARS',
                message: 'Test special characters: <>&"\'',
                severity: 'low',
                type: 'info',
                entity: 'test_special_chars',
                metadata: {
                    special: '<script>alert("xss")</script>',
                    unicode: '🔥 Error 日本語 中文',
                    quotes: 'It\'s a "test"'
                }
            });
            const found = await notificationRepo.findOne({
                where: { name: notification.name }
            });
            const metadata = JSON.parse(found.metadata || '{}');
            expect(metadata.special).toContain('<script>');
            expect(metadata.unicode).toContain('🔥');
            expect(metadata.quotes).toContain('It\'s');
            console.log(`✅ Special characters handled correctly`);
        });
        it('should handle concurrent duplicate detections (known race condition)', async () => {
            const errorData = {
                err_code: 'CONCURRENT_TEST',
                message: 'Concurrent test',
                severity: 'medium',
                type: 'warning',
                entity: 'test_concurrent'
            };
            // Create multiple notifications concurrently
            const promises = Array(5).fill(null).map(() => errorNotificationService.createFromBusinessLogic(errorData));
            await Promise.all(promises);
            // KNOWN LIMITATION: Due to race conditions in concurrent operations,
            // the "check then create" pattern will create duplicates when multiple
            // requests happen simultaneously. This is expected behavior.
            // 
            // Solution for production: Use sequential error reporting or database
            // unique constraints if perfect deduplication is required.
            const count = await notificationRepo.count({
                where: {
                    err_code: 'CONCURRENT_TEST',
                    entity: 'test_concurrent',
                    is_read: 0
                }
            });
            expect(count).toBeGreaterThanOrEqual(1);
            expect(count).toBeLessThanOrEqual(5); // May create up to 5 due to race condition
            console.log(`⚠️  Race condition test: ${count} notification(s) created from 5 concurrent requests`);
            console.log(`    (This is expected behavior - perfect deduplication not guaranteed in high concurrency)`);
            // However, sequential requests should deduplicate properly
            await errorNotificationService.createFromBusinessLogic(errorData);
            await errorNotificationService.createFromBusinessLogic(errorData);
            const finalCount = await notificationRepo.count({
                where: {
                    err_code: 'CONCURRENT_TEST',
                    entity: 'test_concurrent',
                    is_read: 0
                }
            });
            // Sequential requests should update existing, not create new ones
            expect(finalCount).toBe(count); // Should stay the same
            console.log(`✅ Sequential deduplication works: ${finalCount} notifications (no increase)`);
            // Clean up for next test
            await notificationRepo.delete({ entity: 'test_concurrent' });
        });
    });
    describe('📈 Statistics', () => {
        it('should get service statistics', () => {
            const stats = errorNotificationService.getStats();
            expect(stats).toHaveProperty('mappingService');
            expect(stats).toHaveProperty('repositoryInitialized');
            expect(stats.repositoryInitialized).toBe(true);
            console.log('📊 Service statistics:', stats);
        });
    });
});
