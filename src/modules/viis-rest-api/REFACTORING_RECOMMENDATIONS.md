# VIIS REST API - Dependency Injection Refactoring Recommendations

## 🎯 Executive Summary

The current VIIS REST API uses manual `Container.get()` patterns that defeat the purpose of TypeDI and routing-controllers. This document provides specific refactoring steps to achieve proper dependency injection, making the codebase truly extensible and maintainable.

## 🔍 Current Architecture Issues

### **1. Manual Service Retrieval Anti-Pattern**
**Location**: `viis-rest-api.ts:85-86`
```typescript
// ❌ CURRENT: Manual container retrieval
databaseService = Container.get(DatabaseService);
authService = Container.get(AuthService);
```

**Impact**: 
- Tight coupling between components
- Difficult to test (hard to mock dependencies)
- Manual dependency management
- Defeats TypeDI's automatic injection

### **2. Mixed Initialization Patterns**
**Location**: `container/container.setup.ts:87-130`
```typescript
// ❌ CURRENT: Manual instantiation despite @Service() decorators
const authService = new AuthService(databaseService, jwtSecret, node, configManager);
await authService.initialize();
Container.set(AuthService, authService);
```

**Impact**:
- Inconsistent with TypeDI best practices
- Lots of boilerplate registration code
- Error-prone dependency ordering
- Hard to extend with new services

### **3. Inconsistent Dependency Injection**
**Location**: `controllers/auth.controller.ts:44-45`
```typescript
// ❌ CURRENT: Mixed injection patterns
@Inject() private authService: AuthService,
@Inject('node') private node: Node
```

**Impact**:
- Inconsistent token usage
- Manual validation of injected dependencies
- Mixed patterns across codebase

## 🚀 Specific Refactoring Steps

### **Step 1: Update Container Setup (COMPLETED)**

**File**: `container/container.setup.ts`

**Changes Made**:
- ✅ Added proper tokens for primitive dependencies
- ✅ Removed manual service instantiation for @Service() decorated classes
- ✅ Added helper methods `getService()` and `getServiceByToken()`
- ✅ Separated concerns into private methods

**Benefits**:
- Proper token-based injection for primitives
- Automatic service registration for @Service() classes
- Cleaner, more maintainable container setup

### **Step 2: Update Main Entry Point (COMPLETED)**

**File**: `viis-rest-api.ts`

**Changes Made**:
- ✅ Replaced `Container.get()` with `ContainerSetup.getService()`
- ✅ Removed direct Container import

**Benefits**:
- Proper abstraction of container access
- Validation of container initialization
- Cleaner dependency retrieval

### **Step 3: Update Services (RECOMMENDED)**

**Files to Update**:
- `services/auth.service.ts`
- `services/database.service.ts`
- `services/thingsboard.service.ts`
- `services/device.service.ts`
- All other services

**Recommended Changes**:

```typescript
// ✅ RECOMMENDED: Proper service with automatic injection
@Service()
export class AuthService extends BaseService {
    constructor(
        // Automatic injection of services
        private readonly databaseService: DatabaseService,
        
        // Token-based injection of primitives
        @Inject(JWT_SECRET_TOKEN) private readonly jwtSecret: string,
        @Inject(NODE_TOKEN) node: Node,
        @Inject(CONFIG_MANAGER_TOKEN) configManager: ApiConfigManager
    ) {
        // Create service context for BaseService
        const context: ServiceContext = { node, databaseService, configManager };
        super(context, 'AuthService');
        
        if (!jwtSecret) {
            throw new Error("JWT secret is required for AuthService");
        }
    }
}
```

### **Step 4: Update Controllers (PARTIALLY COMPLETED)**

**Current Status**: Controllers already use proper patterns but can be improved

**Recommended Improvements**:

```typescript
// ✅ RECOMMENDED: Consistent token usage
@JsonController('/auth')
@Service()
export class AuthController {
    constructor(
        // Automatic service injection
        private readonly authService: AuthService,
        
        // Consistent token-based injection
        @Inject(NODE_TOKEN) private readonly node: Node
    ) {
        // Remove manual validation - TypeDI handles this
        logger.info(this.node, 'AuthController initialized with automatic DI');
    }
}
```

### **Step 5: Create Service Factory Pattern (OPTIONAL)**

**For complex services that need special initialization**:

```typescript
@Service()
export class ServiceFactory {
    constructor(
        @Inject(NODE_TOKEN) private readonly node: Node,
        @Inject(CONFIG_MANAGER_TOKEN) private readonly configManager: ApiConfigManager
    ) {}

    async createComplexService(): Promise<ComplexService> {
        const service = new ComplexService(this.node, this.configManager);
        await service.initialize();
        return service;
    }
}
```

## 📋 Implementation Priority

### **High Priority (Immediate)**
1. ✅ **Container Setup** - Already completed
2. ✅ **Main Entry Point** - Already completed
3. 🔄 **Update AuthService** - Use token-based injection
4. 🔄 **Update DatabaseService** - Add @Service() decorator if not present

### **Medium Priority (Next Sprint)**
5. 🔄 **Update remaining services** - ThingsBoardService, DeviceService, etc.
6. 🔄 **Improve controller consistency** - Standardize token usage
7. 🔄 **Add comprehensive tests** - Test automatic injection

### **Low Priority (Future)**
8. 🔄 **Service factory pattern** - For complex initialization scenarios
9. 🔄 **Performance optimization** - Lazy loading of services
10. 🔄 **Documentation** - Update API documentation

## 🧪 Testing Strategy

### **Unit Testing with Proper DI**

```typescript
describe('AuthService', () => {
    let authService: AuthService;
    let mockDatabaseService: jest.Mocked<DatabaseService>;

    beforeEach(() => {
        // Setup container with mocks
        Container.set(DatabaseService, mockDatabaseService);
        Container.set(JWT_SECRET_TOKEN, 'test-secret');
        Container.set(NODE_TOKEN, mockNode);
        Container.set(CONFIG_MANAGER_TOKEN, mockConfigManager);
        
        // Get service with automatic injection
        authService = Container.get(AuthService);
    });
});
```

### **Integration Testing**

```typescript
describe('API Integration', () => {
    beforeEach(async () => {
        // Initialize container with real dependencies
        await ContainerSetup.initialize({
            node: testNode,
            jwtSecret: 'test-secret',
            configManager: testConfigManager
        });
    });
    
    afterEach(() => {
        ContainerSetup.reset();
    });
});
```

## 🎯 Expected Benefits

### **Immediate Benefits**
- ✅ Eliminated manual Container.get() calls in main entry point
- ✅ Proper container abstraction with validation
- ✅ Cleaner initialization code

### **After Full Implementation**
- 🎯 **80% reduction** in boilerplate registration code
- 🎯 **Easy extensibility** - new services require only @Service() decorator
- 🎯 **Better testability** - easy mocking of dependencies
- 🎯 **Consistent patterns** - all services follow same injection approach
- 🎯 **Type safety** - full TypeScript support for dependencies
- 🎯 **Error prevention** - TypeDI validates dependencies at startup

## 📚 Reference Implementation

See these files for complete examples:
- ✅ `container/container.setup.ts` - Proper container configuration
- ✅ `services/example-auto-injected.service.ts` - Ideal service pattern
- ✅ `controllers/example-auto-injected.controller.ts` - Ideal controller pattern
- ✅ `DEPENDENCY_INJECTION_GUIDE.md` - Comprehensive guide

## 🚦 Next Steps

1. **Review the updated container setup** and example implementations
2. **Update AuthService** to use token-based injection (highest impact)
3. **Update remaining services** one by one following the pattern
4. **Add comprehensive tests** for the new injection patterns
5. **Update documentation** to reflect the new patterns

This refactoring will transform the VIIS REST API into a truly extensible, maintainable, and testable codebase that follows industry best practices for dependency injection.
