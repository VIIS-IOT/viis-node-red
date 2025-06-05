# VIIS REST API Development Guide

This guide will help you understand how to extend and develop new features for the VIIS REST API module.

## Quick Start

### Adding a New API Endpoint

The fastest way to add a new endpoint is using the generator:

```bash
cd src/modules/viis-rest-api
node scripts/generate-endpoint.js Device --crud
```

This generates:
- Controller with CRUD operations
- Service with business logic
- Types and DTOs
- Validator with input validation

### Manual Development Process

1. **Define Types** (`types/entity.types.ts`)
2. **Create DTOs** (`dto/entity.dto.ts`) 
3. **Build Validator** (`validators/entity.validator.ts`)
4. **Implement Service** (`services/entity.service.ts`)
5. **Create Controller** (`controllers/entity.controller.ts`)
6. **Register in Container** (`container/container.setup.ts`)

## Architecture Overview

### Layer Responsibilities

```
┌─────────────────┐
│   Controllers   │ ← HTTP handling, validation, response formatting
├─────────────────┤
│    Services     │ ← Business logic, data processing
├─────────────────┤
│   Repositories  │ ← Data access (via DatabaseService)
├─────────────────┤
│   Database      │ ← TypeORM entities and connections
└─────────────────┘
```

### Key Patterns

- **Dependency Injection**: Use TypeDI for all dependencies
- **Error Handling**: Use ApiError for consistent error responses
- **Validation**: Use class-validator DTOs for input validation
- **Logging**: Use structured logging with context
- **Configuration**: Use ApiConfigManager for all settings

## Development Features

### Debug Mode

Enable debug mode for enhanced development experience:

```typescript
// In node configuration or environment
enableDebugMode: true
```

Features:
- Detailed request/response logging
- Performance metrics
- Request tracing
- Error stack traces
- Development dashboard

### Debug Endpoints

When debug mode is enabled:

- `GET /api/v2/debug/routes` - List all registered routes
- `GET /api/v2/debug/dashboard` - Development dashboard
- `GET /api/v2/debug/metrics` - Performance metrics
- `GET /api/v2/debug/docs` - Auto-generated API docs

### Configuration Management

Use the centralized configuration system:

```typescript
// In your service or controller
constructor(
    @Inject('configManager') private configManager: ApiConfigManager
) {}

// Check feature flags
if (this.configManager.isEnabled('enableDebugMode')) {
    // Debug-specific code
}

// Get configuration values
const timeout = this.configManager.get('requestTimeout');
```

## Creating New Controllers

### Basic Controller Template

```typescript
import { Request, Response } from 'express';
import { Inject } from 'typedi';
import { BaseController } from './base.controller';
import { Controller } from '../decorators/controller.decorator';

@Controller('/my-endpoint')
export class MyController extends BaseController {
    constructor(
        @Inject() private myService: MyService,
        @Inject('node') node: Node,
        @Inject('configManager') configManager: ApiConfigManager
    ) {
        super(node, configManager);
    }

    getRoutes(): RouteDefinition[] {
        return [
            {
                method: 'GET',
                path: '/my-endpoint',
                handler: 'list',
                middleware: ['auth']
            }
        ];
    }

    list = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const result = await this.executeOperation(
            'listItems',
            () => this.myService.list()
        );
        
        this.success(res, result);
    }, 'list');
}
```

### Controller Best Practices

1. **Use asyncHandler**: Wraps async functions with error handling
2. **Use executeOperation**: Provides operation logging and metrics
3. **Validate Inputs**: Use validator methods or DTOs
4. **Structured Logging**: Use the built-in logging methods
5. **Consistent Responses**: Use ResponseHelper methods

## Creating New Services

### Service Template

```typescript
import { Service } from 'typedi';
import { BaseService, ServiceContext } from './base.service';

@Service()
export class MyService extends BaseService {
    constructor(context: ServiceContext) {
        super(context, 'MyService');
    }

    protected async onInitialize(): Promise<void> {
        this.logInfo('MyService initialized');
    }

    async myBusinessLogic(data: any): Promise<any> {
        return this.executeOperation('myBusinessLogic', async () => {
            this.ensureDatabaseService();
            
            // Your business logic here
            const repository = this.databaseService.getMyRepository();
            return await repository.find();
        });
    }
}
```

### Service Best Practices

1. **Extend BaseService**: Provides common functionality
2. **Use executeOperation**: Standardized error handling and logging
3. **Validate Inputs**: Use validation helper methods
4. **Database Access**: Always use ensureDatabaseService()
5. **Transaction Support**: Use executeWithTransaction() when needed

## Input Validation

### Using DTOs with class-validator

```typescript
import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

export class CreateDeviceDto {
    @IsString()
    @IsNotEmpty({ message: 'Device name is required' })
    name: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsNumber()
    @IsOptional()
    timeout?: number;
}
```

### Validator Implementation

```typescript
@Service()
export class MyValidator extends BaseValidator {
    async validateCreate(data: any): Promise<CreateDeviceDto> {
        return this.validate(CreateDeviceDto, data);
    }
}
```

## Error Handling

### Using ApiError

```typescript
import { ApiError, ErrorType } from '../types/common.types';

// In your service
if (!user) {
    throw new ApiError(
        ErrorType.NOT_FOUND_ERROR,
        'User not found',
        404,
        { userId: id }
    );
}
```

### Error Types

- `VALIDATION_ERROR` (400)
- `AUTHENTICATION_ERROR` (401)
- `AUTHORIZATION_ERROR` (403)
- `NOT_FOUND_ERROR` (404)
- `INTERNAL_ERROR` (500)
- `DATABASE_ERROR` (500)

## Database Integration

### Using DatabaseService

```typescript
// In your service
async getDevices(): Promise<Device[]> {
    this.ensureDatabaseService();
    const repository = this.databaseService.getDeviceRepository();
    return await repository.find();
}

// With transactions
async createDeviceWithTelemetry(deviceData: any, telemetryData: any): Promise<Device> {
    return this.executeWithTransaction(async (manager) => {
        const device = await manager.save(Device, deviceData);
        await manager.save(Telemetry, { ...telemetryData, deviceId: device.id });
        return device;
    }, 'createDeviceWithTelemetry');
}
```

## Testing Your Endpoints

### Using the Test Script

```bash
# Test all endpoints
node test-viis-rest-api.js

# Test with custom credentials
TEST_USERNAME=admin@test.com TEST_PASSWORD=secret node test-viis-rest-api.js
```

### Manual Testing

```bash
# Health check
curl -X GET http://localhost:1880/api/v2/health

# Login
curl -X POST http://localhost:1880/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{"usr":"admin@example.com","pwd":"password123"}'

# Use token
curl -X GET http://localhost:1880/api/v2/users/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Performance Optimization

### Caching Strategies

```typescript
// In your service
private cache = new Map<string, any>();

async getCachedData(key: string): Promise<any> {
    if (this.cache.has(key)) {
        return this.cache.get(key);
    }
    
    const data = await this.fetchData(key);
    this.cache.set(key, data);
    return data;
}
```

### Database Query Optimization

```typescript
// Use select to limit fields
const users = await repository.find({
    select: ['id', 'name', 'email'],
    where: { active: true }
});

// Use relations efficiently
const devices = await repository.find({
    relations: ['customer'],
    where: { customerId: id }
});
```

## Monitoring and Debugging

### Request Tracing

Enable request tracing to see detailed request flow:

```typescript
// Automatic with enableRequestTracing: true
// Each request gets a unique trace ID
// Logs include timing, parameters, and context
```

### Performance Metrics

Access performance data:

```bash
curl http://localhost:1880/api/v2/debug/metrics
```

### Development Dashboard

View comprehensive development information:

```bash
curl http://localhost:1880/api/v2/debug/dashboard
```

## Common Patterns

### Pagination

```typescript
// In controller
const { page, limit, offset } = this.getPaginationParams(req);
const result = await this.myService.list({ page, limit, offset });

// In service
async list(options: PaginationParams): Promise<PaginatedResponse<MyEntity>> {
    const [items, total] = await repository.findAndCount({
        skip: options.offset,
        take: options.limit
    });
    
    return {
        data: items,
        pagination: {
            page: options.page,
            limit: options.limit,
            total,
            totalPages: Math.ceil(total / options.limit)
        }
    };
}
```

### Filtering and Search

```typescript
// In DTO
export class SearchDto {
    @IsOptional()
    @IsString()
    search?: string;
    
    @IsOptional()
    @IsString()
    status?: string;
}

// In service
async search(criteria: SearchDto): Promise<MyEntity[]> {
    const queryBuilder = repository.createQueryBuilder('entity');
    
    if (criteria.search) {
        queryBuilder.andWhere('entity.name LIKE :search', { 
            search: `%${criteria.search}%` 
        });
    }
    
    if (criteria.status) {
        queryBuilder.andWhere('entity.status = :status', { 
            status: criteria.status 
        });
    }
    
    return queryBuilder.getMany();
}
```

## Troubleshooting

### Common Issues

1. **Service not found**: Check container registration
2. **Validation errors**: Verify DTO decorators
3. **Database errors**: Check entity relationships
4. **Route not found**: Verify route registration

### Debug Checklist

1. Check logs for error details
2. Verify configuration values
3. Test database connectivity
4. Validate request format
5. Check middleware execution order

### Getting Help

1. Check the debug dashboard for system status
2. Review request traces for detailed flow
3. Use performance metrics to identify bottlenecks
4. Enable debug mode for detailed logging
