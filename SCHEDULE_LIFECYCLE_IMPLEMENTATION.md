# Schedule Lifecycle Management Implementation

## Overview

This document describes the comprehensive implementation of automated schedule lifecycle management for the VIIS REST API module. The system handles the complete lifecycle of ThingsBoard RPC-triggered schedules, from activation to completion detection and notification.

## Architecture

### Core Components

1. **Enhanced Schedule Activation Service** (`schedule-activation.service.ts`)
   - Handles schedule activation when `COIL_AUTO_TRON: 1` is received
   - Updates schedule status to "running"
   - Creates schedule logs and notifications
   - Registers schedules for completion monitoring

2. **Schedule Completion Monitor Service** (`schedule-completion-monitor.service.ts`)
   - Monitors global context for `COIL_AUTO_TRON` status changes
   - Detects schedule completion (transition from 1 to 0)
   - Updates schedule status to "finished"
   - Creates completion notifications

3. **Schedule Monitor Controller** (`schedule-monitor.controller.ts`)
   - Provides REST API endpoints for monitoring and management
   - Allows querying active schedules and monitoring status
   - Enables manual removal of schedules from monitoring

## Implementation Details

### 1. Schedule Activation Flow

When a ThingsBoard RPC call is made with the following conditions:
- `COIL_AUTO_TRON: 1` (boolean or numeric)
- Valid `schedule_id` present

The system performs these steps:

1. **Status Update**: Updates the schedule status to "running" in the database
2. **Log Creation**: Creates a schedule log entry with start time
3. **Notification**: Creates and publishes a start notification via MQTT
4. **Monitor Registration**: Registers the schedule for completion monitoring

### 2. Schedule Completion Detection

The completion monitor service runs a cron job every 5 seconds that:

1. **Context Reading**: Reads `coilRegisterData` from Node-RED global context
2. **Status Comparison**: Compares current `COIL_AUTO_TRON` value with last known value
3. **Completion Detection**: Detects transition from 1 (running) to 0 (stopped)
4. **Processing**: Triggers completion processing when detected

### 3. Schedule Completion Processing

When completion is detected:

1. **Status Update**: Updates schedule status to "finished"
2. **Log Update**: Updates schedule log with end time
3. **Notification**: Creates and publishes completion notification
4. **Cleanup**: Removes schedule from active monitoring

## API Endpoints

### Schedule Monitoring Endpoints

#### Get Monitoring Status
```
GET /api/v2/schedule-monitor/status
```
Returns current monitoring status and active schedule count.

#### Get Active Schedules
```
GET /api/v2/schedule-monitor/active-schedules
```
Returns list of all schedules currently being monitored.

#### Get Specific Schedule
```
GET /api/v2/schedule-monitor/active-schedules/:scheduleId
```
Returns details of a specific active schedule.

#### Remove Schedule from Monitoring
```
DELETE /api/v2/schedule-monitor/active-schedules/:scheduleId
```
Manually removes a schedule from active monitoring.

#### Service Health Check
```
GET /api/v2/schedule-monitor/health
```
Returns health status of monitoring services.

### Enhanced ThingsBoard RPC Endpoint

The existing ThingsBoard RPC endpoint has been enhanced:

```
POST /api/v2/thingsboard/rpc/oneway/:deviceId
```

Now automatically handles schedule lifecycle when appropriate conditions are met.

## Database Schema

### Existing Tables Used

#### `tabiot_schedule`
- `status` field: Updated to 'running' on activation, 'finished' on completion
- `modified` field: Updated with timestamps

#### `tabiot_schedule_log`
- `start_time`: Set when schedule is activated
- `end_time`: Set when schedule completes
- `schedule_id`: Links to the schedule
- `customer_user`: User who triggered the schedule

#### `tabiot_notification`
- Created for both start and completion events
- Published to MQTT for real-time updates

## Configuration

### Monitoring Settings

- **Monitoring Interval**: 5 seconds (configurable)
- **Global Context Key**: `coilRegisterData`
- **Target Field**: `COIL_AUTO_TRON`

### Service Dependencies

- **DatabaseService**: For schedule and log management
- **NotificationService**: For creating and publishing notifications
- **GlobalContextHelper**: For accessing Node-RED global context

## Integration Points

### Node-RED Global Context

The system integrates with Node-RED's global context to monitor real-time coil data:

```javascript
// Data is stored by telemetry polling service
const coilRegisterData = node.context().global.get('coilRegisterData');
const currentCoilAutoTron = coilRegisterData.COIL_AUTO_TRON;
```

### TypeDI Container

All services are registered in the TypeDI container with proper dependency injection:

```typescript
// Container registration order
1. DatabaseService
2. NotificationService  
3. ScheduleCompletionMonitorService
4. ScheduleActivationService (with all dependencies)
```

## Error Handling

### Graceful Degradation

- **MQTT Failures**: System continues without MQTT publishing
- **Database Errors**: Logged but don't crash the service
- **Monitoring Errors**: Individual schedule failures don't affect others

### Logging

Comprehensive logging at all levels:
- Info: Normal operations and status changes
- Warn: Non-critical issues and fallbacks
- Error: Failures with full context and stack traces

## Testing

### Test Script

A comprehensive test script is provided (`test-schedule-lifecycle.js`) that:

1. Authenticates with the API
2. Tests health endpoints
3. Triggers schedule activation
4. Monitors active schedules
5. Simulates schedule completion
6. Verifies final state

### Running Tests

```bash
cd services/nodered/custom-nodes/viis-node-red
node test-schedule-lifecycle.js
```

## Monitoring and Observability

### Health Checks

Multiple health check endpoints provide visibility:
- Individual service health
- Overall system health
- Active schedule counts
- Monitoring status

### Metrics

The system tracks:
- Number of active schedules
- Monitoring interval performance
- Success/failure rates
- Processing times

## Security

### Authentication

All monitoring endpoints require authentication:
- JWT token validation
- User context verification
- Role-based access control

### Authorization

- Standard user: Can view monitoring status
- Admin user: Can remove schedules from monitoring

## Performance Considerations

### Efficient Monitoring

- Only monitors when active schedules exist
- Configurable monitoring interval
- Minimal global context access
- Efficient data structures (Map for O(1) lookups)

### Resource Management

- Automatic cleanup of completed schedules
- Memory-efficient active schedule tracking
- Proper timer management and cleanup

## Future Enhancements

### Potential Improvements

1. **Configurable Monitoring Interval**: Per-schedule monitoring intervals
2. **Advanced Notifications**: Email, SMS, webhook notifications
3. **Schedule Analytics**: Duration tracking, success rates
4. **Batch Operations**: Bulk schedule management
5. **Real-time WebSocket**: Live monitoring dashboard

### Scalability

The current implementation supports:
- Multiple concurrent schedules
- High-frequency monitoring
- Extensible notification system
- Modular service architecture

## Troubleshooting

### Common Issues

1. **Schedules Not Detected**: Check global context data availability
2. **Monitoring Not Working**: Verify service initialization order
3. **Notifications Not Sent**: Check MQTT client connectivity
4. **Database Errors**: Verify TypeORM configuration

### Debug Mode

Enable debug logging by setting the appropriate configuration flags in the API config manager.
