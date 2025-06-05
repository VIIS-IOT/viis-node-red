# Enhanced Validation System Testing Guide

## Overview

This guide provides comprehensive testing strategies and examples for the enhanced validation system implemented in the Node-RED REST API module. It covers testing approaches for all validation features including basic validation, custom validators, nested objects, arrays, and business rules.

## Testing Strategy

### 1. Unit Testing for DTOs

#### Basic Validation Testing
```typescript
import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { LoginDto } from '../dto/auth.dto';

describe('LoginDto Validation', () => {
    it('should validate a correct login request', async () => {
        const loginData = {
            usr: 'admin@example.com',
            pwd: 'SecurePass123!',
            rememberMe: true,
            authMethod: 'password'
        };

        const dto = plainToClass(LoginDto, loginData);
        const errors = await validate(dto);

        expect(errors).toHaveLength(0);
    });

    it('should reject invalid username', async () => {
        const loginData = {
            usr: 'ab', // Too short
            pwd: 'SecurePass123!'
        };

        const dto = plainToClass(LoginDto, loginData);
        const errors = await validate(dto);

        expect(errors).toHaveLength(1);
        expect(errors[0].property).toBe('usr');
        expect(errors[0].constraints).toHaveProperty('minLength');
    });

    it('should transform username to lowercase', async () => {
        const loginData = {
            usr: 'ADMIN@EXAMPLE.COM',
            pwd: 'SecurePass123!'
        };

        const dto = plainToClass(LoginDto, loginData);
        await validate(dto);

        expect(dto.usr).toBe('admin@example.com');
    });
});
```

#### Custom Validator Testing
```typescript
import { PasswordMatchConstraint } from '../validators/custom.validators';

describe('PasswordMatchConstraint', () => {
    let constraint: PasswordMatchConstraint;

    beforeEach(() => {
        constraint = new PasswordMatchConstraint();
    });

    it('should validate matching passwords', () => {
        const args = {
            constraints: ['password'],
            object: { password: 'test123', confirmPassword: 'test123' },
            property: 'confirmPassword',
            value: 'test123'
        } as any;

        const result = constraint.validate('test123', args);
        expect(result).toBe(true);
    });

    it('should reject non-matching passwords', () => {
        const args = {
            constraints: ['password'],
            object: { password: 'test123', confirmPassword: 'different' },
            property: 'confirmPassword',
            value: 'different'
        } as any;

        const result = constraint.validate('different', args);
        expect(result).toBe(false);
    });
});
```

### 2. Integration Testing with Controllers

#### Testing Enhanced Endpoints
```typescript
import request from 'supertest';
import { app } from '../test-setup';

describe('Enhanced Auth Controller', () => {
    describe('POST /auth/login', () => {
        it('should login with valid credentials', async () => {
            const response = await request(app)
                .post('/api/v2/auth/login')
                .send({
                    usr: 'admin@example.com',
                    pwd: 'SecurePass123!',
                    rememberMe: true,
                    authMethod: 'password'
                })
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(response.body.data).toHaveProperty('accessToken');
            expect(response.body.data).toHaveProperty('user');
        });

        it('should reject invalid credentials with detailed errors', async () => {
            const response = await request(app)
                .post('/api/v2/auth/login')
                .send({
                    usr: 'ab', // Too short
                    pwd: '123', // Too short
                    authMethod: 'invalid' // Invalid enum
                })
                .expect(400);

            expect(response.body).toHaveProperty('success', false);
            expect(response.body.error).toHaveProperty('type', 'ValidationError');
            expect(response.body.error.details).toHaveLength(3);
            
            const errors = response.body.error.details;
            expect(errors.some(e => e.field === 'usr')).toBe(true);
            expect(errors.some(e => e.field === 'pwd')).toBe(true);
            expect(errors.some(e => e.field === 'authMethod')).toBe(true);
        });

        it('should transform and validate data correctly', async () => {
            const response = await request(app)
                .post('/api/v2/auth/login')
                .send({
                    usr: '  ADMIN@EXAMPLE.COM  ', // Should be trimmed and lowercased
                    pwd: 'SecurePass123!',
                    rememberMe: 'true' // Should be converted to boolean
                })
                .expect(200);

            // Verify transformation occurred (check logs or response)
            expect(response.body).toHaveProperty('success', true);
        });
    });
});
```

### 3. Testing Nested Object Validation

```typescript
describe('Device Creation with Nested Validation', () => {
    it('should validate device with complete configuration', async () => {
        const deviceData = {
            name: 'Temperature Sensor 01',
            deviceType: 'sensor',
            status: 'active',
            location: {
                building: 'Main Building',
                floor: '1st Floor',
                room: 'Hall A',
                latitude: 40.7128,
                longitude: -74.0060
            },
            configuration: {
                ipAddress: '192.168.1.100',
                port: 502,
                protocol: 'modbus_tcp',
                pollingInterval: 30,
                timeout: 10
            },
            capabilities: ['temperature', 'humidity'],
            tags: ['hvac', 'monitoring']
        };

        const response = await request(app)
            .post('/api/v2/devices')
            .set('Authorization', 'Bearer valid-token')
            .send(deviceData)
            .expect(201);

        expect(response.body).toHaveProperty('success', true);
    });

    it('should reject invalid nested configuration', async () => {
        const deviceData = {
            name: 'Invalid Device',
            deviceType: 'sensor',
            location: {
                latitude: 91, // Invalid latitude (> 90)
                longitude: -181 // Invalid longitude (< -180)
            },
            configuration: {
                ipAddress: '999.999.999.999', // Invalid IP
                port: 70000, // Invalid port (> 65535)
                pollingInterval: -1 // Invalid interval (< 1)
            },
            capabilities: ['temp', 'temp'], // Duplicate values
            tags: ['tag1', 'tag1'] // Duplicate values
        };

        const response = await request(app)
            .post('/api/v2/devices')
            .set('Authorization', 'Bearer valid-token')
            .send(deviceData)
            .expect(400);

        expect(response.body.error.details).toHaveLength(7); // All validation errors
    });
});
```

### 4. Testing Array Validation

```typescript
describe('Array Validation Testing', () => {
    it('should validate unique array elements', async () => {
        const userData = {
            username: 'testuser',
            email: 'test@example.com',
            password: 'SecurePass123!',
            roles: ['user', 'viewer'], // Unique values
            tags: ['tag1', 'tag2', 'tag3'] // Unique values
        };

        const dto = plainToClass(CreateUserDto, userData);
        const errors = await validate(dto);

        expect(errors).toHaveLength(0);
    });

    it('should reject duplicate array elements', async () => {
        const userData = {
            username: 'testuser',
            email: 'test@example.com',
            password: 'SecurePass123!',
            roles: ['user', 'user'], // Duplicate values
            tags: ['tag1', 'tag1'] // Duplicate values
        };

        const dto = plainToClass(CreateUserDto, userData);
        const errors = await validate(dto);

        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.property === 'roles')).toBe(true);
        expect(errors.some(e => e.property === 'tags')).toBe(true);
    });
});
```

### 5. Testing Query Parameter Validation

```typescript
describe('Query Parameter Validation', () => {
    it('should validate and transform query parameters', async () => {
        const response = await request(app)
            .get('/api/v2/devices')
            .query({
                page: '2',
                limit: '20',
                search: 'temperature',
                status: ['active', 'maintenance'],
                deviceType: 'sensor',
                sortBy: 'name',
                sortOrder: 'ASC'
            })
            .set('Authorization', 'Bearer valid-token')
            .expect(200);

        expect(response.body.data).toBeDefined();
        expect(response.body.pagination).toBeDefined();
    });

    it('should reject invalid query parameters', async () => {
        const response = await request(app)
            .get('/api/v2/devices')
            .query({
                page: '0', // Invalid (< 1)
                limit: '200', // Invalid (> 100)
                status: ['invalid_status'], // Invalid enum value
                sortBy: 'invalid_field', // Invalid sort field
                sortOrder: 'INVALID' // Invalid sort order
            })
            .set('Authorization', 'Bearer valid-token')
            .expect(400);

        expect(response.body.error.details.length).toBeGreaterThan(0);
    });
});
```

### 6. Testing Business Rule Validation

```typescript
describe('Business Rule Validation', () => {
    it('should validate device configuration based on device type', async () => {
        // Gateway device should require IP address and port
        const gatewayData = {
            name: 'Gateway Device',
            deviceType: 'gateway',
            configuration: {
                ipAddress: '192.168.1.1',
                port: 502
            }
        };

        const dto = plainToClass(CreateDeviceDto, gatewayData);
        const errors = await validate(dto);

        expect(errors).toHaveLength(0);
    });

    it('should reject invalid device configuration for device type', async () => {
        // Gateway device without required IP and port
        const gatewayData = {
            name: 'Invalid Gateway',
            deviceType: 'gateway',
            configuration: {
                pollingInterval: 30 // Wrong config for gateway
            }
        };

        const dto = plainToClass(CreateDeviceDto, gatewayData);
        const errors = await validate(dto);

        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.constraints?.deviceConfigValid)).toBe(true);
    });
});
```

## Test Data Generators

### Valid Test Data
```typescript
export const validTestData = {
    login: {
        usr: 'admin@example.com',
        pwd: 'SecurePass123!',
        rememberMe: true,
        authMethod: 'password'
    },
    
    user: {
        username: 'testuser123',
        email: 'test@example.com',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
        roles: ['user'],
        preferences: {
            language: 'en',
            timezone: 'UTC',
            emailNotifications: true
        }
    },
    
    device: {
        name: 'Test Device',
        deviceType: 'sensor',
        status: 'active',
        location: {
            building: 'Test Building',
            floor: '1st Floor',
            latitude: 40.7128,
            longitude: -74.0060
        },
        configuration: {
            pollingInterval: 30,
            timeout: 10
        },
        capabilities: ['temperature', 'humidity'],
        tags: ['test', 'sensor']
    }
};
```

### Invalid Test Data
```typescript
export const invalidTestData = {
    login: {
        emptyUsername: { usr: '', pwd: 'SecurePass123!' },
        shortUsername: { usr: 'ab', pwd: 'SecurePass123!' },
        weakPassword: { usr: 'admin@example.com', pwd: '123' },
        invalidAuthMethod: { usr: 'admin@example.com', pwd: 'SecurePass123!', authMethod: 'invalid' }
    },
    
    user: {
        invalidEmail: { username: 'test', email: 'invalid-email', password: 'SecurePass123!' },
        weakPassword: { username: 'test', email: 'test@example.com', password: '123' },
        duplicateRoles: { username: 'test', email: 'test@example.com', password: 'SecurePass123!', roles: ['user', 'user'] }
    },
    
    device: {
        invalidLocation: { name: 'Test', deviceType: 'sensor', location: { latitude: 91, longitude: -181 } },
        invalidConfiguration: { name: 'Test', deviceType: 'gateway', configuration: { ipAddress: '999.999.999.999' } },
        duplicateCapabilities: { name: 'Test', deviceType: 'sensor', capabilities: ['temp', 'temp'] }
    }
};
```

## Performance Testing

### Validation Performance Tests
```typescript
describe('Validation Performance', () => {
    it('should validate large datasets efficiently', async () => {
        const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
            name: `Device ${i}`,
            deviceType: 'sensor',
            capabilities: [`cap${i}`, `cap${i + 1000}`],
            tags: [`tag${i}`, `tag${i + 1000}`]
        }));

        const startTime = Date.now();
        
        for (const data of largeDataset) {
            const dto = plainToClass(CreateDeviceDto, data);
            await validate(dto);
        }
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
});
```

## Best Practices for Testing

1. **Test All Validation Scenarios**: Cover valid data, invalid data, edge cases, and boundary conditions
2. **Test Transformations**: Verify that data transformations work correctly
3. **Test Custom Validators**: Ensure custom business logic validation works as expected
4. **Test Error Messages**: Verify that error messages are clear and helpful
5. **Test Performance**: Ensure validation doesn't significantly impact response times
6. **Test Integration**: Verify that validation works correctly in the full request/response cycle
7. **Use Test Data Generators**: Create reusable test data for consistent testing
8. **Mock External Dependencies**: Use mocks for database calls and external services
9. **Test Security**: Verify that validation prevents security vulnerabilities
10. **Document Test Cases**: Maintain clear documentation of what each test validates

This comprehensive testing approach ensures that the enhanced validation system works correctly and provides a robust foundation for the Node-RED REST API module.
