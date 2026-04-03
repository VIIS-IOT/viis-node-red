# Error Notification API Tests

Comprehensive test suite for Error Notification CRUD API endpoints.

## 📋 Prerequisites

### Database
- MySQL running on `localhost:3308`
- Database: `viis_local`
- Username: `admin`
- Password: `admin@123`

### Node-RED
- Server running on `localhost:1881`
- REST API module loaded
- Error Notification endpoints registered

### Dependencies
```bash
npm install --save-dev @types/jest jest ts-jest axios
```

## 🚀 Running Tests

### Run All Tests
```bash
# From project root
npm test -- error-notification

# Or with coverage
npm test -- error-notification --coverage
```

### Run Unit Tests Only
```bash
npm test -- service.unit.test
```

### Run Integration Tests Only
```bash
npm test -- api.integration.test
```

### Run Specific Test Suite
```bash
npm test -- --testNamePattern="should create a new notification"
```

### Watch Mode
```bash
npm test -- --watch error-notification
```

## 📊 Test Coverage

### Unit Tests (service.unit.test.ts)
- ✅ Create notification
- ✅ Get notification by name
- ✅ List all notifications with pagination
- ✅ Filter notifications (err_code, severity, is_read, entity, board_id)
- ✅ Update notification (message, is_read, metadata)
- ✅ Delete notification
- ✅ Bulk resolve notifications
- ✅ Get statistics

**Total: 25+ unit test cases**

### Integration Tests (api.integration.test.ts)
- ✅ POST /error-notifications - Create
- ✅ GET /error-notifications - List with filters
- ✅ GET /error-notifications/stats - Statistics
- ✅ GET /error-notifications/:name - Get single
- ✅ PUT /error-notifications/:name - Update
- ✅ DELETE /error-notifications/:name - Delete
- ✅ POST /error-notifications/bulk-resolve - Bulk operations

**Total: 20+ integration test cases**

## 🔧 Test Configuration

Edit `test.config.ts` to customize:

```typescript
export const testConfig = {
    database: {
        host: 'localhost',
        port: 3308,
        username: 'admin',
        password: 'admin@123',
        database: 'viis_local'
    },
    api: {
        baseUrl: 'http://localhost:1881',
        apiPrefix: '/api/v2'
    }
};
```

## 🐛 Troubleshooting

### Database Connection Failed
```bash
# Check MySQL is running
docker ps | grep mysql

# Test connection
mysql -h localhost -P 3308 -u admin -padmin@123 viis_local
```

### API Endpoints Not Found (404)
```bash
# Rebuild Node-RED modules
cd /services/nodered/custom-nodes/viis-node-red
npm run build

# Restart Node-RED
docker restart nodered1

# Check logs
docker logs nodered1 | grep ErrorNotificationController
```

### Authentication Failed
```bash
# Create test user or update testConfig.auth in test.config.ts
# Tests will continue without auth token but some may fail
```

### Tests Hanging
```bash
# Check for leftover database connections
# Ensure afterAll hooks are running
# Try running tests with --forceExit flag
npm test -- error-notification --forceExit
```

## 📈 Expected Results

### Successful Test Run
```
PASS  src/modules/viis-rest-api/tests/error-notification/service.unit.test.ts
  ErrorNotificationApiService - Unit Tests
    ✓ should create a notification successfully (5ms)
    ✓ should get notification by name (3ms)
    ✓ should return paginated notifications (4ms)
    ...

PASS  src/modules/viis-rest-api/tests/error-notification/api.integration.test.ts
  Error Notification API - Integration Tests
    ✓ should create a new notification (150ms)
    ✓ should list all notifications with pagination (120ms)
    ✓ should mark notification as read (135ms)
    ...

Test Suites: 2 passed, 2 total
Tests:       45 passed, 45 total
Time:        15.234s
```

## 🧹 Cleanup

Integration tests automatically clean up created test data in `afterAll` hooks.

Manual cleanup if needed:
```sql
DELETE FROM tabiot_notification 
WHERE name LIKE 'test_%' OR name LIKE 'notification_test_%';
```

## 📝 Writing New Tests

### Add Unit Test
```typescript
it('should do something', async () => {
    // Arrange
    mockRepository.someMethod.mockResolvedValue(mockData);
    
    // Act
    const result = await service.someMethod(input);
    
    // Assert
    expect(result).toEqual(expected);
});
```

### Add Integration Test
```typescript
it('should test endpoint', async () => {
    // Create test data
    const testData = { ... };
    
    // Call API
    const response = await apiClient.post('/endpoint', testData);
    
    // Assert response
    expect(response.status).toBe(200);
    
    // Verify in database
    const dbRecord = await notificationRepo.findOne(...);
    expect(dbRecord).toBeDefined();
    
    // Track for cleanup
    createdNotifications.push(dbRecord.name);
});
```

## 🎯 Best Practices

1. **Isolation** - Each test should be independent
2. **Cleanup** - Always clean up test data
3. **Descriptive** - Use clear test names
4. **Fast** - Keep tests fast (mock external dependencies)
5. **Reliable** - Tests should pass consistently

## 📚 References

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [TypeORM Testing](https://typeorm.io/testing)
- [Axios Testing](https://axios-http.com/docs/intro)
