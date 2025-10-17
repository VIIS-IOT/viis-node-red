# Error Management System - Test Suite

## 📋 Test Overview

Comprehensive test suite for the Error/Warning Management System covering:
- **ErrorCodeManager** (JavaScript - env-loader)
- **ErrorMappingService** (TypeScript)
- **ErrorNotificationService** (TypeScript)
- **GlobalContextHelper** (TypeScript - error code methods)
- **Integration Tests** (End-to-end flows)

---

## 🧪 Test Files

### Unit Tests

#### 1. **error-code-manager.test.js**
Tests for env-loader's ErrorCodeManager
- ✅ Constructor initialization
- ✅ Directory existence checks
- ✅ JSON file loading
- ✅ Validation logic
- ✅ Error handling
- ✅ Statistics
- ✅ Cache management

**Location**: `/env-loader/test/unit/error-code-manager.test.js`

#### 2. **error-mapping.service.test.ts**
Tests for ErrorMappingService
- ✅ Modbus error parsing (holding registers, coils)
- ✅ Error code lookups
- ✅ Auto-resolve logic
- ✅ Device type fallback
- ✅ Statistics and discovery

**Location**: `/src/services/__tests__/error-mapping.service.test.ts`

#### 3. **error-notification.service.test.ts**
Tests for ErrorNotificationService
- ✅ Notification creation from Modbus errors
- ✅ Notification creation from business logic
- ✅ DB-based deduplication
- ✅ Occurrence counting
- ✅ Auto-resolve functionality
- ✅ Edge cases (malformed metadata, null handling)

**Location**: `/src/services/__tests__/error-notification.service.test.ts`

#### 4. **global-context-helper.error-codes.test.ts**
Tests for GlobalContextHelper error code methods
- ✅ Get all error code mappings
- ✅ Get mapping for specific device
- ✅ Get available device types
- ✅ Check if mappings loaded
- ✅ Namespace handling

**Location**: `/src/ultils/__tests__/global-context-helper.error-codes.test.ts`

### Integration Tests

#### 5. **error-management.integration.test.ts**
End-to-end integration tests
- ✅ Full Modbus error flow
- ✅ Auto-resolve lifecycle
- ✅ Device type discovery
- ✅ Real-world scenarios
- ✅ Error edge cases

**Location**: `/src/services/__tests__/error-management.integration.test.ts`

---

## 🚀 Running Tests

### Run All Tests
```bash
npm test
```

### Run Specific Test File
```bash
# TypeScript tests
npm test -- error-mapping.service.test.ts
npm test -- error-notification.service.test.ts
npm test -- global-context-helper.error-codes.test.ts
npm test -- error-management.integration.test.ts

# JavaScript tests (env-loader)
cd ../../../env-loader
npm test -- error-code-manager.test.js
```

### Run Tests with Coverage
```bash
npm test -- --coverage
```

### Run Tests in Watch Mode
```bash
npm test -- --watch
```

### Run Integration Tests Only
```bash
npm test -- --testPathPattern=integration
```

### Run Unit Tests Only
```bash
npm test -- --testPathPattern=service.test
```

---

## 📊 Test Coverage Goals

| Component | Target Coverage | Current |
|-----------|----------------|---------|
| **ErrorCodeManager** | 90%+ | ✅ |
| **ErrorMappingService** | 95%+ | ✅ |
| **ErrorNotificationService** | 90%+ | ✅ |
| **GlobalContextHelper** | 85%+ | ✅ |
| **Integration** | 80%+ | ✅ |

---

## ✅ Test Scenarios Covered

### Error Detection
- [x] Holding register errors
- [x] Input register errors
- [x] Coil errors
- [x] Multiple error codes per register
- [x] Unknown error codes
- [x] Unknown registers
- [x] Unknown device types

### Error Resolution
- [x] Auto-resolve when error clears
- [x] Manual resolve required (auto_resolve: false)
- [x] Coil-based resolution (false = cleared)
- [x] Register-based resolution (0 = cleared)

### Deduplication
- [x] Detect existing unresolved notifications
- [x] Update occurrence count
- [x] Update timestamps
- [x] Create new if not exists

### Edge Cases
- [x] Null metadata
- [x] Malformed JSON metadata
- [x] Empty error code mappings
- [x] Missing device type (fallback to default)
- [x] Repository not initialized
- [x] Database errors

### Real-World Scenarios
- [x] Temperature alarm lifecycle
- [x] Sensor fault detection
- [x] Fan overrun detection
- [x] Multiple simultaneous errors
- [x] Error storm handling

---

## 🔧 Test Dependencies

### Required Packages
```json
{
  "jest": "^29.x",
  "ts-jest": "^29.x",
  "@types/jest": "^29.x",
  "chai": "^4.x",
  "sinon": "^15.x",
  "@types/sinon": "^10.x"
}
```

### Mocked Dependencies
- `node-red` - NodeContext mocked
- `typeorm` - Repository mocked
- `GlobalContextHelper` - Mocked in service tests
- `ErrorMappingService` - Mocked in notification tests
- `fs` - Mocked in ErrorCodeManager tests

---

## 📝 Writing New Tests

### Test Structure
```typescript
describe('ComponentName', () => {
    let component: ComponentType;
    let mockDependencies: MockType;

    beforeEach(() => {
        // Setup mocks
        // Initialize component
    });

    afterEach(() => {
        // Cleanup
        jest.clearAllMocks();
    });

    describe('methodName()', () => {
        it('should handle normal case', () => {
            // Arrange
            // Act
            // Assert
        });

        it('should handle edge case', () => {
            // Test edge cases
        });
    });
});
```

### Assertion Examples
```typescript
// Jest matchers
expect(result).toBe(expected);
expect(result).toEqual(expected);
expect(result).not.toBeNull();
expect(array).toHaveLength(3);
expect(array).toContain('item');
expect(fn).toHaveBeenCalled();
expect(fn).toHaveBeenCalledWith(arg1, arg2);
expect(promise).resolves.toBe(value);
expect(promise).rejects.toThrow();

// Chai assertions
expect(result).to.be.true;
expect(result).to.equal(expected);
expect(array).to.have.lengthOf(3);
expect(obj).to.have.property('key');
```

---

## 🐛 Debugging Tests

### Enable Verbose Output
```bash
npm test -- --verbose
```

### Debug Single Test
```bash
npm test -- --testNamePattern="should parse Modbus error"
```

### Debug with Node Inspector
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

### View Console Logs
```bash
npm test -- --silent=false
```

---

## 📚 Additional Resources

- **Jest Documentation**: https://jestjs.io/
- **ts-jest**: https://kulshekhar.github.io/ts-jest/
- **Chai Assertions**: https://www.chaijs.com/
- **Sinon Mocking**: https://sinonjs.org/

---

## ✅ Pre-Commit Checklist

Before committing code:
- [ ] All tests pass (`npm test`)
- [ ] Coverage meets minimum thresholds
- [ ] New tests added for new features
- [ ] Edge cases covered
- [ ] Integration tests updated if needed
- [ ] No console.log left in tests
- [ ] Test descriptions are clear
- [ ] Mocks are properly cleaned up

---

**Last Updated**: 2025-01-17  
**Test Suite Version**: 1.0.0
