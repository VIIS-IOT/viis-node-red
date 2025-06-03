# VIIS REST API Module Template & Patterns

This document serves as the definitive guide for creating new API modules in the viis-node-red project. The `viis-rest-api` module has been refactored to demonstrate best practices and provide reusable patterns.

## 🏗️ Architecture Overview

The VIIS REST API module follows a clean, modular architecture inspired by NestJS:

```
viis-rest-api/
├── container/              # Dependency Injection Setup
│   └── container.setup.ts  # TypeDI container configuration
├── controllers/            # HTTP Request Handlers
│   ├── base.controller.ts  # Base controller with common functionality
│   ├── auth.controller.ts  # Authentication endpoints
│   ├── user.controller.ts  # User management endpoints
│   └── health.controller.ts # Health check endpoints
├── decorators/             # Custom Decorators
│   └── controller.decorator.ts # @Controller decorator
├── dto/                    # Data Transfer Objects
│   ├── auth.dto.ts         # Authentication DTOs
│   └── user.dto.ts         # User management DTOs
├── middleware/             # Cross-cutting Concerns
│   ├── auth.middleware.ts  # JWT authentication
│   └── validation.middleware.ts # Request validation
├── services/               # Business Logic Layer
│   ├── auth.service.ts     # Authentication business logic
│   └── database.service.ts # Database operations
├── validators/             # Input Validation Layer
│   ├── base.validator.ts   # Base validator with class-validator
│   ├── auth.validator.ts   # Authentication validation
│   └── user.validator.ts   # User validation
├── types/                  # TypeScript Type Definitions
├── utils/                  # Utility Functions
└── viis-rest-api.ts       # Main Node Entry Point
```

## 🔧 Key Technologies & Patterns

### 1. TypeDI for Dependency Injection
- **Services**: Use `@Service()` decorator
- **Controllers**: Use `@Controller()` decorator
- **Constructor Injection**: Use `@Inject()` for dependencies
- **Container Setup**: Centralized in `container.setup.ts`

### 2. class-validator for Validation
- **DTOs**: Define validation rules using decorators
- **Middleware**: Automatic validation with error formatting
- **Type Safety**: Full TypeScript support

### 3. Consistent Error Handling
- **ApiError**: Standardized error class
- **ResponseHelper**: Consistent response formatting
- **Middleware**: Global error handling

## 📋 Creating a New API Module

### Step 1: Project Structure
```bash
mkdir src/modules/your-api-module
cd src/modules/your-api-module

# Create directory structure
mkdir -p {container,controllers,dto,middleware,services,validators,types,utils}
```

### Step 2: Container Setup
Create `container/container.setup.ts`:

```typescript
import Container from "typedi";
import { Node } from "node-red";
import "reflect-metadata";

export interface ContainerConfig {
    node: Node;
    // Add your specific config here
}

export class ContainerSetup {
    private static isInitialized = false;

    static async initialize(config: ContainerConfig): Promise<void> {
        if (this.isInitialized) return;

        const { node } = config;

        // Register Node instance
        Container.set("node", node);

        // Register your services
        // Container.set(YourService, new YourService(node));

        this.isInitialized = true;
    }

    static reset(): void {
        Container.reset();
        this.isInitialized = false;
    }
}
```

### Step 3: Create DTOs
Create `dto/your-module.dto.ts`:

```typescript
import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class YourRequestDto {
    @IsString()
    @IsNotEmpty({ message: 'Field is required' })
    field: string;

    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(100)
    optionalNumber?: number;
}
```

### Step 4: Create Services
Create `services/your.service.ts`:

```typescript
import { Service } from 'typedi';
import { Node } from 'node-red';

@Service()
export class YourService {
    constructor(private node: Node) {}

    async yourMethod(data: any): Promise<any> {
        // Your business logic here
    }
}
```

### Step 5: Create Controllers
Create `controllers/your.controller.ts`:

```typescript
import { Request, Response } from 'express';
import { Inject } from 'typedi';
import { BaseController } from '../../../viis-rest-api/controllers/base.controller';
import { Controller } from '../../../viis-rest-api/decorators/controller.decorator';
import { YourService } from '../services/your.service';
import { YourRequestDto } from '../dto/your-module.dto';

@Controller('/your-endpoint')
export class YourController extends BaseController {
    constructor(
        @Inject() private yourService: YourService,
        @Inject('node') node: Node
    ) {
        super(node);
    }

    getRoutes(): RouteDefinition[] {
        return [
            {
                method: 'POST',
                path: '/action',
                handler: 'yourAction'
            }
        ];
    }

    yourAction = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
        // Validation would be done by middleware
        const data = req.body as YourRequestDto;
        
        const result = await this.yourService.yourMethod(data);
        
        this.success(res, result, 200, 'Action completed successfully');
    });
}
```

### Step 6: Main Module File
Create `your-api-module.ts`:

```typescript
import { NodeAPI, NodeDef, Node } from "node-red";
import { ContainerSetup } from "./container/container.setup";
import Container from "typedi";
import "reflect-metadata";

export = function (RED: NodeAPI) {
    function YourApiModuleNode(this: Node, config: any) {
        RED.nodes.createNode(this, config);
        const node = this;

        (async () => {
            try {
                // Initialize container
                await ContainerSetup.initialize({ node });
                
                // Your initialization logic here
                
                node.status({ fill: "green", shape: "dot", text: "running" });
            } catch (error) {
                node.status({ fill: "red", shape: "ring", text: "error" });
                node.error(`Initialization failed: ${error.message}`);
            }
        })();

        node.on('close', async (done) => {
            ContainerSetup.reset();
            done();
        });
    }

    RED.nodes.registerType("your-api-module", YourApiModuleNode);
};
```

## 🎯 Best Practices

### 1. Dependency Injection
- Always use `@Service()` for services
- Use `@Controller()` for controllers
- Inject dependencies via constructor with `@Inject()`
- Register complex dependencies in container setup

### 2. Validation
- Create DTOs for all request/response data
- Use class-validator decorators for validation rules
- Apply validation middleware to routes
- Provide meaningful error messages

### 3. Error Handling
- Use `ApiError` for business logic errors
- Let middleware handle validation errors
- Use `ResponseHelper` for consistent responses
- Log errors appropriately

### 4. Testing
- Mock dependencies using TypeDI's container
- Test controllers, services, and validators separately
- Use the validation middleware in integration tests

### 5. Documentation
- Document all DTOs with JSDoc comments
- Provide examples in controller methods
- Update this template when adding new patterns

## 🔄 Migration from Joi to class-validator

If migrating existing code:

1. **Replace Joi schemas** with DTO classes
2. **Update validators** to use `BaseValidator.validate(DtoClass, data)`
3. **Update middleware** to use `validationMiddleware.validateBody(DtoClass)`
4. **Add decorators** to services and controllers
5. **Update container setup** to register new dependencies

## 📚 Additional Resources

- [TypeDI Documentation](https://github.com/typestack/typedi)
- [class-validator Documentation](https://github.com/typestack/class-validator)
- [class-transformer Documentation](https://github.com/typestack/class-transformer)

This template ensures consistency across all VIIS API modules and provides a solid foundation for scalable, maintainable code.
