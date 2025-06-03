# VIIS REST API - NestJS-like Architecture Guide

This guide explains the new NestJS-inspired architecture implemented for the VIIS REST API module.

## Architecture Overview

The API now follows a clean, modular architecture similar to NestJS:

```
viis-rest-api/
├── controllers/              # HTTP Request Handlers
│   ├── base.controller.ts    # Base controller with common functionality
│   ├── auth.controller.ts    # Authentication endpoints
│   ├── user.controller.ts    # User management endpoints
│   └── health.controller.ts  # Health check endpoints
├── services/                 # Business Logic Layer
│   ├── auth.service.ts       # Authentication business logic
│   ├── database.service.ts   # Database operations
│   └── user.service.ts       # User business logic (future)
├── validators/               # Input Validation Layer
│   ├── base.validator.ts     # Base validator with Joi
│   ├── auth.validator.ts     # Authentication validation
│   └── user.validator.ts     # User validation
├── middleware/               # Cross-cutting Concerns
│   ├── auth.middleware.ts    # JWT authentication
│   └── validation.middleware.ts # Request validation
├── types/                    # TypeScript Definitions
│   ├── common.types.ts       # Common interfaces
│   ├── auth.types.ts         # Authentication types
│   └── user.types.ts         # User types
├── routes/                   # Route Registration
│   └── api.routes.ts         # Central route registry
└── utils/                    # Utilities
    ├── logger.ts             # Logging utility
    └── response.helper.ts    # Response formatting
```

## Core Principles

### 1. Separation of Concerns
- **Controllers**: Handle HTTP requests/responses only
- **Services**: Contain business logic and data operations
- **Validators**: Handle input validation and sanitization
- **Middleware**: Handle cross-cutting concerns (auth, logging, etc.)

### 2. Dependency Injection
Services are injected into controllers, promoting testability and modularity.

### 3. Type Safety
Comprehensive TypeScript interfaces ensure type safety throughout the application.

### 4. Consistent Error Handling
Standardized error responses using the `ApiError` class and `ResponseHelper`.

## Key Components

### Controllers

Controllers handle HTTP requests and delegate business logic to services:

```typescript
export class AuthController extends BaseController {
    constructor(private authService: AuthService, node: Node) {
        super(node);
    }

    login = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const loginData = await this.authValidator.validateLogin(req.body);
        const result = await this.authService.login(loginData);
        this.success(res, result.result, 200, 'Login successful');
    });
}
```

### Services

Services contain business logic and interact with the database:

```typescript
export class AuthService implements IService {
    async login(loginData: LoginRequest): Promise<LoginResponse> {
        // Business logic for authentication
        const user = await this.findUser(loginData.usr);
        const isValid = await this.verifyPassword(loginData.pwd, user.password);
        const token = await this.generateJwtToken(user);
        return { result: { token, user } };
    }
}
```

### Validators

Validators use Joi schemas for comprehensive input validation:

```typescript
export class AuthValidator extends BaseValidator {
    private static loginSchema = Joi.object({
        usr: Joi.string().required().min(1).max(255),
        pwd: Joi.string().required().min(1).max(255)
    });

    async validateLogin(data: any): Promise<LoginRequest> {
        return this.validate(data, AuthValidator.loginSchema);
    }
}
```

### Middleware

Middleware handles cross-cutting concerns:

```typescript
export class AuthMiddleware {
    authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const token = await this.authValidator.validateAndExtractToken(req.headers);
        const decoded = await this.authService.verifyToken(token);
        (req as AuthenticatedRequest).user = decoded;
        next();
    };
}
```

## Route Definition System

Routes are defined declaratively in controllers:

```typescript
getRoutes(): RouteDefinition[] {
    return [
        {
            method: 'POST',
            path: '/auth/login',
            handler: 'login'
        },
        {
            method: 'GET',
            path: '/users',
            handler: 'getAllUsers',
            middleware: ['auth', 'admin', 'pagination']
        }
    ];
}
```

## Available Endpoints

### Authentication
- `POST /api/v2/auth/login` - User authentication
- `GET /api/v2/auth/verify` - Token verification
- `POST /api/v2/auth/logout` - User logout

### User Management
- `GET /api/v2/users` - Get all users (admin only)
- `GET /api/v2/users/me` - Get current user info
- `GET /api/v2/users/:userId` - Get user by ID

### Health Check
- `GET /api/v2/health` - Basic health check
- `GET /api/v2/health/detailed` - Detailed health check (admin only)

## Middleware System

### Available Middleware
- `auth`: Requires valid JWT token
- `admin`: Requires admin role
- `customer`: Customer-level access control
- `optionalAuth`: Optional authentication
- `pagination`: Validates pagination parameters
- `dateRange`: Validates date range parameters

### Usage
Middleware is applied declaratively in route definitions:

```typescript
{
    method: 'GET',
    path: '/users',
    handler: 'getAllUsers',
    middleware: ['auth', 'admin', 'pagination']  // Applied in order
}
```

## Error Handling

### Standardized Error Types
```typescript
enum ErrorType {
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
    AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
    NOT_FOUND_ERROR = 'NOT_FOUND_ERROR',
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',
    RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR'
}
```

### Error Response Format
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Validation failed",
  "details": [
    {
      "field": "email",
      "message": "Please provide a valid email address",
      "value": "invalid-email"
    }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Adding New Features

### 1. Create a Controller
```typescript
export class DeviceController extends BaseController {
    getRoutes(): RouteDefinition[] {
        return [
            {
                method: 'GET',
                path: '/devices',
                handler: 'getAllDevices',
                middleware: ['auth', 'customer']
            }
        ];
    }

    getAllDevices = this.asyncHandler(async (req, res) => {
        // Implementation
    });
}
```

### 2. Create a Service
```typescript
export class DeviceService implements IService {
    async getDevicesByCustomer(customerId: string) {
        // Business logic
    }
}
```

### 3. Create a Validator
```typescript
export class DeviceValidator extends BaseValidator {
    private static deviceQuerySchema = Joi.object({
        customer_id: Joi.string().optional(),
        status: Joi.string().valid('online', 'offline').optional()
    });
}
```

### 4. Register the Controller
```typescript
// In api.routes.ts
this.controllers.set('device', new DeviceController(this.databaseService, this.node));
```

## Testing

The modular architecture makes testing straightforward:

```typescript
// Test controller
const controller = new AuthController(mockAuthService, mockNode);
const routes = controller.getRoutes();

// Test service
const service = new AuthService(mockDb, 'secret', mockNode);
const result = await service.login({ usr: 'test', pwd: 'password' });

// Test validator
const validator = new AuthValidator();
const result = await validator.validateLogin({ usr: 'test', pwd: 'password' });
```

## Benefits

### 1. Maintainability
- Clear separation of concerns
- Modular, reusable components
- Consistent code structure

### 2. Scalability
- Easy to add new endpoints
- Pluggable middleware system
- Service-oriented architecture

### 3. Type Safety
- Comprehensive TypeScript coverage
- Compile-time error detection
- Better IDE support

### 4. Testability
- Dependency injection
- Isolated components
- Mockable services

### 5. Developer Experience
- Familiar NestJS-like patterns
- Consistent API design
- Comprehensive error handling

## Best Practices

### Controller Guidelines
- Keep controllers thin
- Delegate business logic to services
- Use async handlers for all endpoints
- Leverage base controller helpers

### Service Guidelines
- Implement the IService interface
- Handle all business logic
- Throw ApiError for consistent errors
- Use dependency injection

### Validation Guidelines
- Create comprehensive Joi schemas
- Provide descriptive error messages
- Validate all inputs (body, query, params)
- Sanitize and transform data

### Error Handling Guidelines
- Use ApiError class for custom errors
- Provide meaningful error messages
- Include validation details
- Use proper HTTP status codes

This architecture provides a solid foundation for building scalable, maintainable REST APIs while maintaining the simplicity and flexibility of Node-RED integration.
