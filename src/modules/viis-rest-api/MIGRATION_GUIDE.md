# Migration Guide: From Function-based Auth Flow to VIIS REST API

This guide shows how to migrate from the complex function-based authentication flow to the new VIIS REST API node.

## Before: Complex Function Flow

The original flow had multiple function nodes with embedded TypeORM code:

```javascript
// Function Node 1: Validate Input
const body = msg.payload;
if (!body || !body.usr || !body.pwd) {
    msg.statusCode = 400;
    // ... validation logic
}

// Function Node 2: Find User  
const { DatabaseService } = global.get('viis_modules').databaseService;
const dbService = new DatabaseService();
await dbService.initialize();
// ... database queries

// Function Node 3: Verify Password
const bcrypt = require('bcrypt');
// ... password verification

// Function Node 4: Load User Details
// ... more database queries

// Function Node 5: Generate JWT Token
const jwt = require('jsonwebtoken');
// ... token generation

// Function Node 6: Log Success
// ... logging
```

**Problems with this approach:**
- ❌ Complex flow with 6+ function nodes
- ❌ Embedded database code in function nodes
- ❌ No reusability across flows
- ❌ Difficult to test and maintain
- ❌ No external API access
- ❌ TypeORM access issues in function nodes

## After: Simple REST API

Replace the entire complex flow with a single VIIS REST API node:

### Step 1: Add VIIS REST API Node

1. Drag the **VIIS REST API** node to your flow
2. Configure it:
   - **Name**: "VIIS API Server"
   - **Enabled**: ✅ true
   - **API Prefix**: "/api/v2"
   - **Enable CORS**: ✅ true
   - **Enable Logging**: ✅ true
3. Deploy the flow

### Step 2: Replace Authentication Flow

**Old Flow (6 nodes):**
```
[HTTP In] → [Validate] → [Find User] → [Verify Password] → [Load Details] → [Generate JWT] → [Log] → [HTTP Response]
```

**New Flow (2 nodes):**
```
[HTTP In] → [HTTP Request to /api/v2/auth/login] → [HTTP Response]
```

### Step 3: Update HTTP In Node

Change your HTTP In node to call the REST API:

```javascript
// Old: Complex function node logic
// New: Simple HTTP request node
POST http://localhost:1880/api/v2/auth/login
{
  "usr": "{{msg.payload.usr}}",
  "pwd": "{{msg.payload.pwd}}"
}
```

## Migration Examples

### Example 1: Login Flow

**Before:**
```json
[
  {
    "id": "http-in-login",
    "type": "http in",
    "url": "/api/v2/auth/login",
    "method": "post",
    "wires": [["validate-input"]]
  },
  {
    "id": "validate-input",
    "type": "function",
    "func": "// 50+ lines of validation code",
    "wires": [["find-user", "error-response"]]
  },
  {
    "id": "find-user", 
    "type": "function",
    "func": "// 80+ lines of database code",
    "wires": [["verify-password", "error-response"]]
  },
  // ... 4 more function nodes
]
```

**After:**
```json
[
  {
    "id": "viis-api-server",
    "type": "viis-rest-api",
    "name": "VIIS API Server",
    "enabled": true,
    "apiPrefix": "/api/v2",
    "wires": []
  }
]
```

### Example 2: External API Integration

**Before:** Not possible - function nodes only work within Node-RED

**After:** 
```javascript
// External application can now authenticate
const response = await fetch('http://localhost:1880/api/v2/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ usr: 'user@example.com', pwd: 'password' })
});

const { result } = await response.json();
const token = result.token;

// Use token for subsequent requests
const userResponse = await fetch('http://localhost:1880/api/v2/users/me', {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### Example 3: Testing

**Before:** Manual testing through Node-RED UI only

**After:** 
```bash
# Run automated tests
node test-viis-rest-api.js

# Manual testing with curl
curl -X POST http://localhost:1880/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{"usr":"admin@example.com","pwd":"password123"}'
```

## Benefits of Migration

### ✅ Simplified Flows
- **Before**: 6+ function nodes with complex logic
- **After**: 1 REST API node

### ✅ Better Maintainability  
- **Before**: Logic scattered across multiple function nodes
- **After**: Centralized, well-structured code

### ✅ External Integration
- **Before**: Only accessible within Node-RED
- **After**: Standard REST API accessible from anywhere

### ✅ Improved Testing
- **Before**: Manual testing only
- **After**: Automated test scripts + manual testing

### ✅ Better Error Handling
- **Before**: Inconsistent error responses
- **After**: Standardized HTTP status codes and error messages

### ✅ Security Features
- **Before**: Basic authentication only
- **After**: CORS, rate limiting, security headers, compression

### ✅ Performance
- **Before**: No caching, no compression
- **After**: Built-in performance optimizations

## Migration Checklist

### Pre-Migration
- [ ] Backup existing flows
- [ ] Document current authentication endpoints
- [ ] Test current functionality
- [ ] Install VIIS REST API dependencies

### Migration Steps
- [ ] Add VIIS REST API node to flow
- [ ] Configure node settings
- [ ] Deploy and test health endpoint
- [ ] Test authentication endpoints
- [ ] Update client applications (if any)
- [ ] Remove old function nodes
- [ ] Update documentation

### Post-Migration
- [ ] Run test suite
- [ ] Monitor API logs
- [ ] Update any dependent flows
- [ ] Train team on new API endpoints

## Troubleshooting Migration Issues

### Issue: "Database service not initialized"
**Solution:** Ensure TypeORM DataSource is properly configured in the existing viis-node-red setup.

### Issue: "Invalid JWT token"
**Solution:** Check that JWT_SECRET environment variable is set consistently.

### Issue: Old flows still calling function nodes
**Solution:** Update HTTP request nodes to call new REST API endpoints.

### Issue: CORS errors from external applications
**Solution:** Enable CORS in the VIIS REST API node configuration.

### Issue: Rate limiting blocking legitimate requests
**Solution:** Adjust maxRequestsPerMinute setting or disable rate limiting for development.

## Rollback Plan

If migration issues occur, you can quickly rollback:

1. **Disable VIIS REST API node** (set enabled = false)
2. **Re-enable old function nodes** 
3. **Redeploy flow**
4. **Investigate and fix issues**
5. **Retry migration**

The old function-based flow can coexist with the new REST API during transition period.

## Support

For migration assistance:
1. Check the troubleshooting section above
2. Run the test script: `node test-viis-rest-api.js`
3. Enable debug logging: `VIIS_API_LOG_LEVEL=DEBUG`
4. Review API logs in Node-RED debug panel
