# ThingsBoard RPC REST API Implementation

## Overview

This document describes the comprehensive ThingsBoard RPC REST API controller implementation that migrates Node-RED flow functionality into proper REST endpoints. The implementation follows the exact patterns from the authentication controller and integrates seamlessly with the enhanced error handling infrastructure.

## Architecture

### File Structure
```
src/modules/viis-rest-api/
├── controllers/thingsboard.controller.ts    # Main REST API controller
├── services/thingsboard.service.ts          # Business logic service
├── dto/thingsboard.dto.ts                   # Request/response validation DTOs
├── types/thingsboard.types.ts               # TypeScript interfaces
└── routes/routing-controllers.routes.ts     # Updated controller registration
```

### Key Features

1. **Enhanced Error Handling**: Uses the same ApiError patterns as auth controller
2. **Automatic Validation**: Leverages class-validator DTOs for request validation
3. **MQTT Integration**: Uses existing core services for MQTT publishing
4. **Telemetry Transformation**: Automatic type detection and conversion
5. **Comprehensive Logging**: Follows existing logger patterns
6. **Dependency Injection**: Uses TypeDI for service management

## API Endpoints

### 1. One-Way RPC Endpoint
**POST** `/api/v2/thingsboard/rpc/oneway/:id`

Primary endpoint that replicates Node-RED flow behavior for processing ThingsBoard RPC messages.

**Features:**
- Automatic request validation using `ThingsBoardRpcRequestDto`
- Support for multiple RPC methods (setTelemetry, controlDevice, etc.)
- Telemetry data transformation with type detection
- MQTT publishing with retry logic
- Comprehensive error handling and logging

**Request Example:**
```json
{
  "method": "setTelemetry",
  "params": {
    "temperature": 25.5,
    "humidity": "60",
    "status": "true",
    "metadata": {"location": "room1"}
  },
  "timeout": 30000,
  "retries": 3
}
```

**Response Example:**
```json
{
  "success": true,
  "deviceId": "device123",
  "method": "setTelemetry",
  "telemetryRecordsCount": 4,
  "mqttPublished": true,
  "mqttTopic": "v1/devices/me/rpc/request/device123",
  "processingTime": 150,
  "requestId": "rpc_1234567890_abc123def"
}
```

### 2. Specialized Telemetry Endpoint
**POST** `/api/v2/thingsboard/rpc/telemetry/:id`

Optimized endpoint specifically for telemetry data with enhanced validation.

### 3. Device Control Endpoint
**POST** `/api/v2/thingsboard/rpc/control/:id`

Specialized endpoint for device control commands with audit logging.

### 4. Custom Command Endpoint
**POST** `/api/v2/thingsboard/rpc/custom/:id`

Flexible endpoint for custom RPC methods and future extensibility.

### 5. Service Health Check
**GET** `/api/v2/thingsboard/health`

Monitors service health, MQTT connection status, and performance metrics.

### 6. Service Statistics
**GET** `/api/v2/thingsboard/stats`

Provides real-time processing statistics and performance metrics.

## Data Transformation

### Telemetry Type Detection

The service automatically detects and converts telemetry values:

- **Boolean**: `"true"` → `true`, `"false"` → `false`
- **Number**: `"25.5"` → `25.5`, `"60"` → `60`
- **String**: Plain text values remain as strings
- **Object**: JSON objects are preserved as objects

### Processing Pipeline

1. **Validation**: Request validated using class-validator DTOs
2. **Transformation**: Raw telemetry data processed with type detection
3. **MQTT Publishing**: Formatted data published to ThingsBoard MQTT broker
4. **Response**: Standardized response with processing details

## Error Handling

### HTTP Status Codes

- **200**: Successful RPC processing
- **400**: Invalid RPC payload or validation errors
- **404**: Device not found
- **500**: MQTT or internal processing errors

### Error Response Format

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Device ID must contain only letters, numbers, hyphens, and underscores",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Enhanced Error Handling

The implementation uses the enhanced error handling middleware that properly handles:
- `ApiError` instances with specific status codes
- Validation errors from class-validator
- MQTT connection and publishing errors
- Service initialization errors

## MQTT Integration

### Existing Core Services

The implementation leverages existing MQTT infrastructure:
- Uses `ClientRegistry.getThingsboardMqttClient()` for connection management
- Implements retry logic with exponential backoff
- Handles connection failures gracefully

### Topic Pattern

Messages are published to: `v1/devices/me/rpc/request/{deviceId}`

### Message Format

```json
{
  "ts": 1640995200000,
  "values": {
    "temperature": 25.5,
    "humidity": 60,
    "status": true
  },
  "deviceId": "device123",
  "method": "setTelemetry",
  "requestId": "rpc_1234567890_abc123def"
}
```

## Validation and DTOs

### Request Validation

Uses class-validator decorators for automatic validation:

```typescript
export class ThingsBoardRpcRequestDto {
    @IsString()
    @IsNotEmpty()
    @Length(1, 100)
    method: string;

    @IsOptional()
    @IsObject()
    params?: Record<string, any>;

    @IsOptional()
    @IsNumber()
    @Min(1000)
    @Max(300000)
    timeout?: number = 30000;
}
```

### Response DTOs

Standardized response format with comprehensive details:

```typescript
export class RpcExecutionResultDto {
    @IsBoolean()
    success: boolean;

    @IsString()
    deviceId: string;

    @IsNumber()
    processingTime: number;

    @IsBoolean()
    mqttPublished: boolean;
}
```

## Service Architecture

### ThingsBoardService

Extends `BaseService` and provides:
- RPC request processing
- Telemetry data transformation
- MQTT publishing with retry logic
- Health monitoring
- Processing statistics

### Dependency Injection

Uses TypeDI for service management:
- Automatic service instantiation
- Dependency resolution
- Lifecycle management

## Testing

### Test Script

Run the comprehensive test script:
```bash
node test-thingsboard-rpc.js
```

### Test Coverage

- All API endpoints
- Request validation
- Error handling
- MQTT integration
- Service health monitoring
- Performance metrics

## Integration

### Controller Registration

The controller is registered in `routing-controllers.routes.ts`:

```typescript
controllers: [
    HealthController, 
    AuthController, 
    UserController, 
    DeviceController, 
    ThingsBoardController
]
```

### Service Registration

The service is registered in the TypeDI container:

```typescript
const thingsBoardService = new ThingsBoardService(serviceContext);
Container.set(ThingsBoardService, thingsBoardService);
```

## Performance Monitoring

### Processing Statistics

The service tracks:
- Total requests processed
- Success/failure rates
- Average processing time
- MQTT publish success rates
- Service uptime

### Health Monitoring

Real-time health checks include:
- MQTT connection status
- Service initialization status
- Processing performance metrics
- Error rates and patterns

## Security Considerations

### Input Validation

- Device ID format validation
- RPC method name validation
- Parameter sanitization
- Timeout and retry limits

### Error Information

- Specific error messages for debugging
- No sensitive information exposure
- Proper HTTP status codes
- Request tracking with unique IDs

## Future Enhancements

### Planned Features

1. **Authentication Integration**: Add JWT token validation
2. **Rate Limiting**: Implement request rate limiting per device
3. **Caching**: Add response caching for frequently accessed data
4. **Metrics**: Enhanced monitoring and alerting
5. **Batch Processing**: Support for batch RPC requests

### Extensibility

The architecture supports easy extension:
- New RPC methods can be added via DTOs
- Custom validation rules
- Additional MQTT topics
- Enhanced telemetry transformations

## Conclusion

This implementation provides a comprehensive, production-ready ThingsBoard RPC REST API that:

- Follows established patterns from the auth controller
- Integrates seamlessly with existing error handling
- Provides robust MQTT integration
- Includes comprehensive validation and monitoring
- Supports future extensibility and enhancements

The implementation successfully migrates Node-RED flow functionality into a proper REST API while maintaining all the benefits of the existing infrastructure.
