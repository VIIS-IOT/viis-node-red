# VIIS REST API - Proper Dependency Injection Guide

## 🎯 Overview

This guide demonstrates how to implement proper dependency injection using TypeDI and routing-controllers, eliminating the need for manual `Container.get()` calls and making the codebase truly extensible.

## ❌ Current Issues with Manual Container.get()

### **Problem 1: Anti-Pattern Usage**
```typescript
// ❌ WRONG: Manual container retrieval (current approach)
databaseService = Container.get(DatabaseService);
authService = Container.get(AuthService);
```

**Issues:**
- Defeats the purpose of dependency injection
- Creates tight coupling
- Hard to test (can't easily mock dependencies)
- Requires manual service registration
- Error-prone initialization order management

### **Problem 2: Mixed Initialization Patterns**
```typescript
// ❌ WRONG: Manual instantiation despite @Service() decorator
const authService = new AuthService(databaseService, jwtSecret, node, configManager);
await authService.initialize();
Container.set(AuthService, authService);
```

**Issues:**
- Inconsistent with TypeDI patterns
- Lots of boilerplate code
- Easy to forget dependencies
- Manual lifecycle management

## ✅ Proper TypeDI Integration

### **1. Service Definition with Automatic Injection**

```typescript
// ✅ CORRECT: Proper service with automatic dependency injection
@Service()
export class ExampleService {
    constructor(
        // Automatic injection of other services
        private readonly databaseService: DatabaseService,
        private readonly authService: AuthService,
        
        // Injection of primitive values using tokens
        @Inject(NODE_TOKEN) private readonly node: Node,
        @Inject(JWT_SECRET_TOKEN) private readonly jwtSecret: string,
        @Inject(CONFIG_MANAGER_TOKEN) private readonly configManager: ApiConfigManager
    ) {
        // Dependencies are automatically injected
        logger.info(this.node, 'Service initialized with automatic DI');
    }
}
```

### **2. Controller Definition with Automatic Injection**

```typescript
// ✅ CORRECT: Proper controller with automatic dependency injection
@JsonController('/example')
@Service()
export class ExampleController {
    constructor(
        // Automatic injection of services
        private readonly exampleService: ExampleService,
        private readonly authService: AuthService,
        
        // Injection of primitive values
        @Inject(NODE_TOKEN) private readonly node: Node,
        @Inject(CONFIG_MANAGER_TOKEN) private readonly configManager: ApiConfigManager
    ) {
        // All dependencies automatically injected
    }

    @Get('/health')
    async getHealth(): Promise<any> {
        // Use injected services directly
        return await this.exampleService.performOperation();
    }
}
```

### **3. Container Setup with Tokens**

```typescript
// ✅ CORRECT: Proper container setup with tokens
export const NODE_TOKEN = new Token<Node>('node');
export const JWT_SECRET_TOKEN = new Token<string>('jwtSecret');
export const CONFIG_MANAGER_TOKEN = new Token<ApiConfigManager>('configManager');

export class ContainerSetup {
    static async initialize(config: ContainerConfig): Promise<void> {
        // Register primitive dependencies using tokens
        Container.set(NODE_TOKEN, config.node);
        Container.set(JWT_SECRET_TOKEN, config.jwtSecret);
        Container.set(CONFIG_MANAGER_TOKEN, config.configManager);
        
        // Services with @Service() decorator are automatically registered
        // No manual instantiation needed!
    }
}
```

## 🚀 Extension Guidelines

### **Adding New Services**

1. **Create the service with proper decorators:**
```typescript
@Service()
export class NewService {
    constructor(
        private readonly databaseService: DatabaseService,
        @Inject(NODE_TOKEN) private readonly node: Node
    ) {}
}
```

2. **That's it!** No manual registration needed. TypeDI handles everything.

### **Adding New Controllers**

1. **Create the controller with proper decorators:**
```typescript
@JsonController('/new-feature')
@Service()
export class NewFeatureController {
    constructor(
        private readonly newService: NewService,
        @Inject(NODE_TOKEN) private readonly node: Node
    ) {}
}
```

2. **That's it!** routing-controllers automatically discovers and registers it.

### **Adding New Dependencies**

1. **For primitive values, create a token:**
```typescript
export const NEW_CONFIG_TOKEN = new Token<string>('newConfig');
```

2. **Register in container setup:**
```typescript
Container.set(NEW_CONFIG_TOKEN, config.newValue);
```

3. **Inject in services/controllers:**
```typescript
constructor(
    @Inject(NEW_CONFIG_TOKEN) private readonly newConfig: string
) {}
```

## 🧪 Testing Benefits

### **Easy Mocking with Proper DI**

```typescript
// ✅ CORRECT: Easy to test with mocked dependencies
describe('ExampleService', () => {
    let service: ExampleService;
    let mockDatabaseService: jest.Mocked<DatabaseService>;
    let mockNode: jest.Mocked<Node>;

    beforeEach(() => {
        // Create mocks
        mockDatabaseService = createMock<DatabaseService>();
        mockNode = createMock<Node>();
        
        // Set up container with mocks
        Container.set(DatabaseService, mockDatabaseService);
        Container.set(NODE_TOKEN, mockNode);
        
        // Get service with mocked dependencies
        service = Container.get(ExampleService);
    });
});
```

## 📋 Migration Checklist

### **Phase 1: Update Container Setup**
- [x] Add proper tokens for primitive dependencies
- [x] Remove manual service instantiation
- [x] Add helper methods for service retrieval

### **Phase 2: Update Services**
- [ ] Add @Service() decorators to all services
- [ ] Use @Inject() for primitive dependencies
- [ ] Remove manual initialization where possible

### **Phase 3: Update Controllers**
- [x] Controllers already use proper patterns
- [x] Ensure all use @Service() decorator

### **Phase 4: Update Main Entry Point**
- [x] Replace Container.get() with ContainerSetup.getService()
- [x] Remove manual service management

## 🎯 Key Benefits Achieved

1. **True Dependency Injection**: No more manual Container.get() calls
2. **Easy Extensibility**: Adding new services/controllers requires minimal code
3. **Better Testing**: Easy to mock dependencies for unit tests
4. **Consistent Patterns**: All services follow the same injection patterns
5. **Automatic Registration**: TypeDI handles service lifecycle automatically
6. **Type Safety**: Full TypeScript support with proper typing
7. **Reduced Boilerplate**: Less manual registration code
8. **Error Prevention**: TypeDI validates dependencies at startup

## 📚 Examples

See the following files for complete examples:
- `services/example-auto-injected.service.ts` - Proper service implementation
- `controllers/example-auto-injected.controller.ts` - Proper controller implementation
- `container/container.setup.ts` - Updated container configuration
