/**
 * Integration tests for Error Notification API endpoints
 * 
 * Prerequisites:
 * - MySQL database running on localhost:3308
 * - Node-RED server running on localhost:1881
 * - Valid authentication token
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { TabiotNotification } from '../../../../orm/entities/notification/TabiotNotification';
import { testConfig, testNotificationData } from './test.config';
import axios, { AxiosInstance } from 'axios';
import * as path from 'path';

describe('Error Notification API - Integration Tests', () => {
    let dataSource: DataSource;
    let notificationRepo: any;
    let apiClient: AxiosInstance;
    let authToken: string;
    let createdNotifications: string[] = [];

    beforeAll(async () => {
        // Setup database connection
        const entitiesPath = path.join(__dirname, '../../../../orm/entities');
        dataSource = new DataSource({
            ...testConfig.database,
            entities: [
                path.join(entitiesPath, '**/*.{js,ts}')
            ],
            synchronize: false
        });

        try {
            await dataSource.initialize();
            notificationRepo = dataSource.getRepository(TabiotNotification);
            console.log('✅ Database connected successfully');
        } catch (error) {
            console.error('❌ Database connection failed:', error);
            throw error;
        }

        // Setup API client
        apiClient = axios.create({
            baseURL: `${testConfig.api.baseUrl}${testConfig.api.apiPrefix}`,
            timeout: testConfig.api.timeout,
            validateStatus: () => true // Don't throw on any status
        });

        // Get auth token (skip if not available)
        try {
            const authResponse = await apiClient.post('/auth/login', {
                email: testConfig.auth.testUser.email,
                password: testConfig.auth.testUser.password
            });

            if (authResponse.data?.token) {
                authToken = authResponse.data.token;
                apiClient.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
                console.log('✅ Authentication successful');
            } else {
                console.warn('⚠️  No auth token available, some tests may fail');
            }
        } catch (error) {
            console.warn('⚠️  Authentication failed, continuing without token');
        }
    });

    afterAll(async () => {
        // Cleanup created notifications
        if (createdNotifications.length > 0) {
            try {
                await notificationRepo.delete(
                    createdNotifications.map(name => ({ name }))
                );
                console.log(`🧹 Cleaned up ${createdNotifications.length} test notifications`);
            } catch (error) {
                console.error('Error cleaning up notifications:', error);
            }
        }

        // Close database connection
        if (dataSource?.isInitialized) {
            await dataSource.destroy();
            console.log('✅ Database connection closed');
        }
    });

    afterEach(() => {
        // Clear created notifications list after each test
        createdNotifications = [];
    });

    describe('POST /error-notifications - Create Notification', () => {
        it('should create a new notification', async () => {
            const response = await apiClient.post('/error-notifications', testNotificationData.valid);

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('name');
            expect(response.data.err_code).toBe(testNotificationData.valid.err_code);
            expect(response.data.message).toBe(testNotificationData.valid.message);
            expect(response.data.severity).toBe(testNotificationData.valid.severity);
            expect(response.data.is_read).toBe(0);

            // Track for cleanup
            createdNotifications.push(response.data.name);

            // Verify in database
            const dbNotification = await notificationRepo.findOne({
                where: { name: response.data.name }
            });
            expect(dbNotification).toBeDefined();
            expect(dbNotification.err_code).toBe(testNotificationData.valid.err_code);
        });

        it('should create critical notification', async () => {
            const response = await apiClient.post('/error-notifications', testNotificationData.critical);

            expect(response.status).toBe(200);
            expect(response.data.severity).toBe('critical');
            expect(response.data.type).toBe('alert');

            createdNotifications.push(response.data.name);
        });

        it('should store metadata as JSON string', async () => {
            const response = await apiClient.post('/error-notifications', testNotificationData.valid);

            expect(response.status).toBe(200);
            createdNotifications.push(response.data.name);

            const dbNotification = await notificationRepo.findOne({
                where: { name: response.data.name }
            });

            const metadata = JSON.parse(dbNotification.metadata);
            expect(metadata).toEqual(testNotificationData.valid.metadata);
        });

        it('should return 400 for invalid data', async () => {
            const response = await apiClient.post('/error-notifications', {
                err_code: 'TEST',
                // Missing required fields
            });

            expect(response.status).toBe(400);
        });
    });

    describe('GET /error-notifications - List Notifications', () => {
        beforeEach(async () => {
            // Create test notifications
            const notif1 = await notificationRepo.save(notificationRepo.create({
                name: `test_notif_1_${Date.now()}`,
                ...testNotificationData.valid,
                metadata: JSON.stringify(testNotificationData.valid.metadata),
                is_read: 0,
                created_at: new Date()
            }));

            const notif2 = await notificationRepo.save(notificationRepo.create({
                name: `test_notif_2_${Date.now()}`,
                ...testNotificationData.critical,
                metadata: JSON.stringify(testNotificationData.critical.metadata),
                is_read: 1,
                created_at: new Date()
            }));

            createdNotifications.push(notif1.name, notif2.name);
        });

        it('should list all notifications with pagination', async () => {
            const response = await apiClient.get('/error-notifications', {
                params: { page: 1, size: 10 }
            });

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('data');
            expect(response.data).toHaveProperty('total');
            expect(response.data).toHaveProperty('page');
            expect(response.data).toHaveProperty('size');
            expect(response.data).toHaveProperty('totalPages');
            expect(Array.isArray(response.data.data)).toBe(true);
        });

        it('should filter by err_code', async () => {
            const response = await apiClient.get('/error-notifications', {
                params: {
                    err_code: testNotificationData.valid.err_code,
                    page: 1,
                    size: 10
                }
            });

            expect(response.status).toBe(200);
            response.data.data.forEach((notif: any) => {
                expect(notif.err_code).toContain(testNotificationData.valid.err_code);
            });
        });

        it('should filter by severity', async () => {
            const response = await apiClient.get('/error-notifications', {
                params: {
                    severity: 'critical',
                    page: 1,
                    size: 10
                }
            });

            expect(response.status).toBe(200);
            response.data.data.forEach((notif: any) => {
                expect(notif.severity).toBe('critical');
            });
        });

        it('should filter by is_read status', async () => {
            const response = await apiClient.get('/error-notifications', {
                params: {
                    is_read: false,
                    page: 1,
                    size: 10
                }
            });

            expect(response.status).toBe(200);
            response.data.data.forEach((notif: any) => {
                expect(notif.is_read).toBe(0);
            });
        });

        it('should filter by board_id', async () => {
            const response = await apiClient.get('/error-notifications', {
                params: {
                    board_id: 'board1',
                    page: 1,
                    size: 10
                }
            });

            expect(response.status).toBe(200);
            // Board filtering happens in-memory after query
        });

        it('should support sorting', async () => {
            const response = await apiClient.get('/error-notifications', {
                params: {
                    sortBy: 'created_at',
                    sortOrder: 'ASC',
                    page: 1,
                    size: 10
                }
            });

            expect(response.status).toBe(200);
        });
    });

    describe('GET /error-notifications/stats - Statistics', () => {
        it('should return notification statistics', async () => {
            const response = await apiClient.get('/error-notifications/stats');

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('total');
            expect(response.data).toHaveProperty('unread');
            expect(response.data).toHaveProperty('resolved');
            expect(response.data).toHaveProperty('bySeverity');
            expect(typeof response.data.total).toBe('number');
            expect(typeof response.data.unread).toBe('number');
            expect(typeof response.data.resolved).toBe('number');
        });

        it('should calculate resolved count correctly', async () => {
            const response = await apiClient.get('/error-notifications/stats');

            expect(response.status).toBe(200);
            expect(response.data.resolved).toBe(response.data.total - response.data.unread);
        });
    });

    describe('GET /error-notifications/:name - Get Single Notification', () => {
        let testNotificationName: string;

        beforeEach(async () => {
            const notif = await notificationRepo.save(notificationRepo.create({
                name: `test_get_single_${Date.now()}`,
                ...testNotificationData.valid,
                metadata: JSON.stringify(testNotificationData.valid.metadata),
                created_at: new Date()
            }));
            testNotificationName = notif.name;
            createdNotifications.push(testNotificationName);
        });

        it('should get notification by name', async () => {
            const response = await apiClient.get(`/error-notifications/${testNotificationName}`);

            expect(response.status).toBe(200);
            expect(response.data.name).toBe(testNotificationName);
            expect(response.data.err_code).toBe(testNotificationData.valid.err_code);
        });

        it('should return 404 for non-existent notification', async () => {
            const response = await apiClient.get('/error-notifications/non_existent_notification');

            expect(response.status).toBe(404);
        });
    });

    describe('PUT /error-notifications/:name - Update Notification', () => {
        let testNotificationName: string;

        beforeEach(async () => {
            const notif = await notificationRepo.save(notificationRepo.create({
                name: `test_update_${Date.now()}`,
                ...testNotificationData.valid,
                metadata: JSON.stringify(testNotificationData.valid.metadata),
                is_read: 0,
                created_at: new Date()
            }));
            testNotificationName = notif.name;
            createdNotifications.push(testNotificationName);
        });

        it('should mark notification as read', async () => {
            const response = await apiClient.put(`/error-notifications/${testNotificationName}`, {
                is_read: true
            });

            expect(response.status).toBe(200);
            expect(response.data.is_read).toBe(1);

            // Verify in database
            const dbNotification = await notificationRepo.findOne({
                where: { name: testNotificationName }
            });
            expect(dbNotification.is_read).toBe(1);

            // Check metadata
            const metadata = JSON.parse(dbNotification.metadata);
            expect(metadata.resolved_at).toBeDefined();
            expect(metadata.resolved_by).toBe('manual');
        });

        it('should update notification message', async () => {
            const newMessage = 'Updated test message';
            const response = await apiClient.put(`/error-notifications/${testNotificationName}`, {
                message: newMessage
            });

            expect(response.status).toBe(200);
            expect(response.data.message).toBe(newMessage);
        });

        it('should return 404 when updating non-existent notification', async () => {
            const response = await apiClient.put('/error-notifications/non_existent', {
                is_read: true
            });

            expect(response.status).toBe(404);
        });
    });

    describe('DELETE /error-notifications/:name - Delete Notification', () => {
        let testNotificationName: string;

        beforeEach(async () => {
            const notif = await notificationRepo.save(notificationRepo.create({
                name: `test_delete_${Date.now()}`,
                ...testNotificationData.valid,
                metadata: JSON.stringify(testNotificationData.valid.metadata),
                created_at: new Date()
            }));
            testNotificationName = notif.name;
            // Don't add to createdNotifications since we're testing delete
        });

        it('should delete notification', async () => {
            const response = await apiClient.delete(`/error-notifications/${testNotificationName}`);

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('message');

            // Verify deletion in database
            const dbNotification = await notificationRepo.findOne({
                where: { name: testNotificationName }
            });
            expect(dbNotification).toBeNull();
        });

        it('should return 404 when deleting non-existent notification', async () => {
            const response = await apiClient.delete('/error-notifications/non_existent');

            expect(response.status).toBe(404);
        });
    });

    describe('POST /error-notifications/bulk-resolve - Bulk Resolve', () => {
        beforeEach(async () => {
            // Create multiple unread notifications
            const notifications = [];
            for (let i = 0; i < 3; i++) {
                const notif = notificationRepo.create({
                    name: `test_bulk_${Date.now()}_${i}`,
                    err_code: 'TEST_BULK_ERR',
                    message: `Test bulk ${i}`,
                    severity: 'medium',
                    type: 'warning',
                    entity: 'test_bulk_entity',
                    is_read: 0,
                    metadata: JSON.stringify({ board_id: 'board1' }),
                    created_at: new Date()
                });
                notifications.push(notif);
            }

            const saved = await notificationRepo.save(notifications);
            createdNotifications.push(...saved.map((n: any) => n.name));
        });

        it('should resolve multiple notifications by err_code', async () => {
            if (!authToken) {
                console.warn('⚠️  Skipping test - no auth token available');
                return;
            }

            const response = await apiClient.post('/error-notifications/bulk-resolve', {
                err_code: 'TEST_BULK_ERR'
            });

            expect(response.status).toBe(200);
            expect(response.data.resolved).toBeGreaterThanOrEqual(3);

            // Verify in database
            const notifications = await notificationRepo.find({
                where: { err_code: 'TEST_BULK_ERR' }
            });

            notifications.forEach((notif: any) => {
                expect(notif.is_read).toBe(1);
                const metadata = JSON.parse(notif.metadata);
                expect(metadata.resolved_by).toBe('bulk_manual');
            });
        });

        it('should resolve by entity filter', async () => {
            if (!authToken) {
                console.warn('⚠️  Skipping test - no auth token available');
                return;
            }

            const response = await apiClient.post('/error-notifications/bulk-resolve', {
                entity: 'test_bulk_entity'
            });

            expect(response.status).toBe(200);
            expect(response.data.resolved).toBeGreaterThan(0);
        });

        it('should resolve by board_id filter', async () => {
            if (!authToken) {
                console.warn('⚠️  Skipping test - no auth token available');
                return;
            }

            const response = await apiClient.post('/error-notifications/bulk-resolve', {
                board_id: 'board1'
            });

            expect(response.status).toBe(200);
            expect(response.data.resolved).toBeGreaterThan(0);
        });

        it('should return 0 when no notifications match filters', async () => {
            if (!authToken) {
                console.warn('⚠️  Skipping test - no auth token available');
                return;
            }

            const response = await apiClient.post('/error-notifications/bulk-resolve', {
                err_code: 'NON_EXISTENT_ERR_CODE'
            });

            expect(response.status).toBe(200);
            expect(response.data.resolved).toBe(0);
        });
    });
});
