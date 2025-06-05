# Authentication Error Handling Fix

## Problem Description

The Node-RED custom node REST API was experiencing an authentication error handling issue where:

1. **AuthService** correctly threw `ApiError` instances with 401 status codes and specific error messages like "Invalid username or password"
2. **Client** received generic 500 Internal Server Error responses with the message "An unexpected error occurred"
3. **Server logs** showed the detailed authentication errors, but they weren't being properly propagated to the client

## Root Cause Analysis

The issue was in the error handling middleware chain for routing-controllers:

1. **AuthService** throws `ApiError` with `statusCode: 401` (✅ Correct)
2. **AuthController** re-throws the error (✅ Correct)
3. **EnhancedValidationMiddleware** didn't handle `ApiError` instances, so it called `next(error)`
4. **setupCustomErrorHandling** in routing-controllers.routes.ts only handled errors with `httpCode` property, but `ApiError` has `statusCode`
5. **Fallback handler** converted all unhandled errors to generic 500 errors with "An unexpected error occurred"

## Solution Implemented

### 1. Enhanced routing-controllers Error Handler

**File**: `src/modules/viis-rest-api/routes/routing-controllers.routes.ts`

**Changes**:
- Added specific handling for `ApiError` instances before the generic `httpCode` check
- Check for `error.name === 'ApiError' && error.statusCode` 
- Return proper status code and error format for authentication errors
- Improved logging to include error type information

```typescript
// Handle ApiError instances (our custom authentication/business logic errors)
if (error.name === 'ApiError' && error.statusCode) {
    return res.status(error.statusCode).json({
        error: error.type,
        message: error.message,
        timestamp: new Date().toISOString(),
        ...(error.details && { details: error.details })
    });
}
```

### 2. Enhanced Validation Middleware

**File**: `src/modules/viis-rest-api/middleware/enhanced-validation.middleware.ts`

**Changes**:
- Added `ApiError` import from common types
- Added `isApiError()` method to detect ApiError instances
- Added `handleApiError()` method to properly format ApiError responses
- Updated error handling flow to check for ApiError first

```typescript
// Check if this is an ApiError (authentication, business logic errors)
if (this.isApiError(error)) {
    this.handleApiError(error, request, response);
    return;
}
```

## Error Response Format

### Before Fix
```json
{
    "success": false,
    "error": {
        "type": "InternalServerError",
        "message": "An unexpected error occurred"
    },
    "timestamp": "2024-01-01T12:00:00.000Z"
}
```
**Status Code**: 500

### After Fix
```json
{
    "error": "AUTHENTICATION_ERROR",
    "message": "Invalid username or password",
    "timestamp": "2024-01-01T12:00:00.000Z"
}
```
**Status Code**: 401

## Testing

A test script has been created to verify the fix:

**File**: `test-auth-error-handling.js`

**Test Cases**:
1. Invalid credentials - should return 401 with specific error message
2. Non-existent user - should return 401 with specific error message  
3. Health check - ensures API is responding correctly

**Usage**:
```bash
node test-auth-error-handling.js
```

## Files Modified

1. `src/modules/viis-rest-api/routes/routing-controllers.routes.ts`
   - Enhanced `setupCustomErrorHandling()` method
   - Added ApiError-specific handling

2. `src/modules/viis-rest-api/middleware/enhanced-validation.middleware.ts`
   - Added ApiError import
   - Added `isApiError()` and `handleApiError()` methods
   - Updated error handling flow

3. `dist/` files (auto-generated via TypeScript compilation)

## Verification Steps

1. **Build the project**: `npm run build`
2. **Start Node-RED** with the custom node
3. **Test authentication** with invalid credentials
4. **Verify response**:
   - Status code should be 401 (not 500)
   - Error type should be "AUTHENTICATION_ERROR"
   - Message should be specific (not "An unexpected error occurred")

## Impact

- ✅ Authentication failures now return proper 401 status codes
- ✅ Clients receive specific error messages for better UX
- ✅ Error handling preserves detailed error information
- ✅ Maintains backward compatibility for other error types
- ✅ Improved debugging with better error logging

## Future Considerations

- Consider implementing similar handling for other custom error types
- Add rate limiting for authentication attempts
- Implement proper error monitoring and alerting
- Consider adding request IDs for better error tracking
