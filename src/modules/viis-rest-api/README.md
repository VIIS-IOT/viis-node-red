# VIIS REST API Node

A comprehensive REST API server node for Node-RED that provides authentication and data access endpoints using Node-RED's built-in Express server with TypeORM database integration.

## Features

- ✅ **Real User Authentication** - JWT-based authentication with database validation
- ✅ **TypeORM Integration** - Reuses existing database entities and connections
- ✅ **Built-in Express Server** - Uses Node-RED's Express server (no separate server needed)
- ✅ **Security Middleware** - CORS, Helmet, Rate limiting, Compression
- ✅ **Comprehensive Logging** - Detailed API request/response logging
- ✅ **Role-based Access** - Admin and customer-level access controls
- ✅ **Hot-reload Support** - Environment variable changes without restart

## Architecture

```
Node-RED Server (port 1880)
├── Editor UI (/admin)
├── Flow Runtime
├── Built-in HTTP endpoints
└── VIIS-REST-API Custom Node
    ├── /api/v2/auth/*     (Authentication)
    ├── /api/v2/users/*    (User Management)
    ├── /api/v2/devices/*  (Device Management)
    ├── /api/v2/telemetry/* (Telemetry Data)
    └── /api/v2/health     (Health Check)
```

## Installation

1. The node is part of the `viis-node-red` package
2. Add the node to your Node-RED flow
3. Configure the settings in the node properties
4. Deploy the flow

## Configuration

### Node Properties

- **Name**: Display name for the node
- **Enabled**: Enable/disable the REST API server
- **API Prefix**: Base path for all endpoints (default: `/api/v2`)
- **JWT Secret**: Secret key for JWT token signing (uses `JWT_SECRET` env var if empty)
- **Enable CORS**: Allow cross-origin requests
- **Rate Limiting**: Enable request rate limiting
- **Max Requests/Min**: Maximum requests per minute per IP
- **Enable Logging**: Log API requests and responses

### Environment Variables

```bash
# JWT Secret (optional, has default)
JWT_SECRET=your-secret-key-here

# Log level for API module
VIIS_API_LOG_LEVEL=INFO  # ERROR, WARN, INFO, DEBUG

# Database connection (inherited from existing setup)
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=password
DB_DATABASE=viis_local
```

## API Endpoints

### Authentication

#### POST /api/v2/auth/login
Authenticate user with username/email and password.

**Request:**
```json
{
  "usr": "username_or_email",
  "pwd": "password"
}
```

**Response:**
```json
{
  "result": {
    "token": "jwt_token_here",
    "user": {
      "user_id": "user123",
      "first_name": "John",
      "last_name": "Doe",
      "email": "john@example.com",
      "customer_id": "customer123",
      "is_admin": 0,
      "iot_dynamic_role": "user",
      "sections": "section1,section2",
      "credential_id": "cred123",
      "enable": 1
    }
  }
}
```

#### POST /api/v2/auth/logout
Logout current user (requires authentication).

#### GET /api/v2/auth/verify
Verify JWT token validity (requires authentication).

### User Management

#### GET /api/v2/users
Get all users (admin only, requires authentication).

#### GET /api/v2/users/me
Get current user information (requires authentication).

### Device Management

#### GET /api/v2/devices
Get devices for current user's customer (requires authentication).

**Query Parameters:**
- `customer_id`: Filter by customer ID (admin only)

### Telemetry

#### GET /api/v2/telemetry/latest/:deviceId
Get latest telemetry data for a device (requires authentication).

### Health Check

#### GET /api/v2/health
Check API and database health status.

## Security Features

### Authentication
- JWT tokens with HS512 algorithm
- Multiple password hash support (bcrypt, MD5, SHA256, plain text)
- Token expiration (1 year default)
- Session ID tracking

### Authorization
- Role-based access control (admin vs user)
- Customer-level data isolation
- Protected endpoints with middleware

### Security Middleware
- **CORS**: Configurable cross-origin resource sharing
- **Helmet**: Security headers protection
- **Rate Limiting**: Configurable request rate limits
- **Compression**: Response compression for better performance

## Usage Examples

### Using with Node-RED Flow

Replace your current authentication flow with simple HTTP requests:

```javascript
// Instead of complex function nodes, use simple HTTP request
POST http://localhost:1880/api/v2/auth/login
{
  "usr": "admin@example.com",
  "pwd": "password123"
}
```

### Using with External Applications

```javascript
// Login
const response = await fetch('http://localhost:1880/api/v2/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ usr: 'user@example.com', pwd: 'password' })
});

const { result } = await response.json();
const token = result.token;

// Use token for authenticated requests
const userResponse = await fetch('http://localhost:1880/api/v2/users/me', {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error Type",
  "message": "Human readable error message",
  "details": "Additional error details (development only)"
}
```

Common HTTP status codes:
- `200`: Success
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (authentication required)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found
- `429`: Too Many Requests (rate limit exceeded)
- `500`: Internal Server Error

## Logging

The module provides comprehensive logging:

- **API Requests**: Method, URL, IP address
- **API Responses**: Status code, response time
- **Authentication Events**: Login attempts, token verification
- **Database Operations**: Query execution, connection status
- **Security Events**: Rate limit violations, access denials

Log levels: ERROR, WARN, INFO, DEBUG

## Troubleshooting

### Common Issues

1. **"Database service not initialized"**
   - Ensure TypeORM DataSource is properly configured
   - Check database connection settings

2. **"Invalid or expired token"**
   - Verify JWT_SECRET is consistent
   - Check token expiration time

3. **"Rate limit exceeded"**
   - Adjust `maxRequestsPerMinute` setting
   - Check if rate limiting is needed

4. **CORS errors**
   - Enable CORS in node configuration
   - Check allowed origins

### Debug Mode

Enable debug logging:
```bash
VIIS_API_LOG_LEVEL=DEBUG
```

This will log detailed information about:
- Database queries
- JWT token operations
- Middleware execution
- Request/response data

## Integration with Existing Flow

This node replaces the complex function-based authentication flow with a simple, robust REST API that:

1. **Maintains compatibility** with existing database schema
2. **Reuses TypeORM entities** and connections
3. **Provides the same authentication logic** but as REST endpoints
4. **Enables external application integration**
5. **Simplifies Node-RED flows** by removing complex function nodes

The original flow can be simplified to just HTTP request nodes calling these endpoints.
