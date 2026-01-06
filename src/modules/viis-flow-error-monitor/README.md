# VIIS Flow Error Monitor

Custom Node-RED node for monitoring irrigation flow rates and detecting errors automatically.

## Overview

This node replaces the previous function-based flow error monitoring with a proper custom node that:

- Uses shared `ErrorNotificationService` for backend API integration
- Monitors flow rates across multiple channels (A1, B1, B2, A2, A3, B3)
- Detects F4 and F5 errors based on flow deviation
- Auto-stops pump on critical first-minute errors
- Sends notifications to backend via HTTP API instead of using errorQueue

## Features

### Error Types

1. **F4 Error - Flow Rate Deviation**
   - Detected when machine stops
   - Compares actual volume with expected volume based on set flow rate
   - Uses strict tolerance (default 3%)

2. **F5 Error - Critical First Minute Error**
   - Detected during first 1-1.5 minutes of operation
   - Indicates air leak or fertilizer exhaustion
   - Auto-stops pump when flow is below 80% of expected
   - Prevents equipment damage

### Key Improvements Over Previous Implementation

1. **Backend API Integration**: Uses `ErrorNotificationService` to send notifications directly to backend API (`/api/v2/alarm/notification-by-token`)
2. **Database Persistence**: Errors saved to `TabiotNotification` table with deduplication
3. **Shared Resources**: Uses same infrastructure as schedule-executor and error-monitor nodes
4. **TypeScript**: Type-safe implementation with proper error handling
5. **Configurable**: Tolerance and debounce settings configurable via UI

## Configuration

### Node Settings

- **Name**: Custom name for the node
- **Tolerance (Stopped)**: Acceptable deviation when machine stops (default: 0.03 = 3%)
- **Tolerance (Running)**: Acceptable deviation while running (default: 0.2 = 20%, currently not used)
- **Debounce (min)**: Minimum minutes between error notifications to prevent spam (default: 3)

### Required Global Context

The node reads from global context:

- `inputRegisterData` - Volume measurements
  - `volume_A1`, `volume_B1`, `volume_B2`, `volume_A2`, `volume_A3`, `volume_B3`
  - `set_irrigation_time_count` (countdown timer in seconds)
  
- `holdingRegisterData` - Set values
  - `set_flow_A1..B3` (L/min)
  - `time_valve_A1..B3` (seconds)
  
- `coilRegisterData` - Machine status
  - `main_pump` (0/1)
  - `power` (0/1)
  
- `modbusErrMap` - Error code descriptions
- `modbusCoils` - Coil address mappings (for stopping pump)
- `device_label` - Device label for notifications
- `moment` - Moment.js library

### Environment Variables (via GlobalContextHelper)

- `DEVICE_ID` - Device identifier
- `VIIS_BACKEND` - Backend API URL
- `DEVICE_ACCESS_TOKEN` - Authentication token

## Usage

### In Node-RED Flow

1. **Trigger**: Connect an inject node or timer to trigger periodic checks
2. **Input**: Any message will trigger a check cycle
3. **Output**: Modbus command to stop pump (if critical error detected)

### Example Flow

```
[Inject: 1s] --> [viis-flow-error-monitor] --> [modbus-flex-write]
```

### Migration from Old Flow

Replace the previous Function node "Check lỗi lưu lượng (tolerance = 0.03)" with this node:

**Before:**
```
[Inject] --> [Function: Check lỗi lưu lượng] --> [Modbus Write]
```

**After:**
```
[Inject] --> [viis-flow-error-monitor] --> [Modbus Write]
```

The new node will:
- Read the same global context data
- Apply the same flow checking logic
- Send errors to backend API instead of errorQueue
- Still output Modbus commands to stop pump when needed

## Node Behavior

### State Machine

1. **Machine Idle**: Green ring status, no checks
2. **Machine Starting**: Blue ring, waiting for 1 minute
3. **First Minute Check** (1-1.5 min): Yellow dot, checking initial flow
   - If flow < 80% expected → Stop pump + F5 error
4. **Machine Running** (>1.5 min): Green dot, tracking elapsed time
5. **Machine Stopped**: Checks all channels with strict tolerance
   - If deviation > tolerance → F4 error

### Node Context State

The node maintains state in node context:
- `previousMachineState` - Was machine running in last cycle?
- `previousTimestamp` - Timestamp of last check
- `elapsedRunTime` - Total minutes machine has been running
- `lastErrorTime` - Timestamp of last error notification (for debouncing)

## API Integration

Errors are sent via HTTP POST to:

```
POST {VIIS_BACKEND}/api/v2/alarm/notification-by-token
     ?device_access_token={DEVICE_ACCESS_TOKEN}

Body:
{
  "alarm_name": "F4" | "F5",
  "id": "{DEVICE_ID}",
  "msg": "Lỗi lưu lượng Kênh A1: Thực tế 5.2, Mong đợi 6.0, Thời gian 10.5 phút",
  "severity": "error",
  "trigger_time": "2026-01-06T09:50:00.000Z",
  "tb_alarm_id": "notification_device-001_F4_1234567890_abc123",
  "alarm_status": "Pending",
  "clear_by": "",
  "clear_by_user_id": "",
  "entity": "{DEVICE_ID}",
  "metadata": {
    "channel": "A1",
    "actualVolume": 5.2,
    "expectedVolume": 6.0,
    "setFlow": 0.6,
    "elapsedMinutes": 10.5,
    "tolerance": 0.03,
    "ts": "2026-01-06 09:50:00"
  }
}
```

## Files

- `src/modules/viis-flow-error-monitor/viis-flow-error-monitor.ts` - Node implementation
- `src/modules/viis-flow-error-monitor/viis-flow-error-monitor.html` - Node-RED UI
- `src/modules/viis-flow-error-monitor/README.md` - This file

## Dependencies

- `ErrorNotificationService` - Shared service for error notifications
- `GlobalContextHelper` - Shared helper for accessing global context
- Node-RED standard libraries

## Testing

After deployment:

1. Check node appears in VIIS category in Node-RED palette
2. Configure tolerances and debounce settings
3. Deploy flow with inject trigger
4. Monitor Node-RED debug panel for warnings
5. Verify notifications in backend API
6. Check `TabiotNotification` table in database

## Troubleshooting

### Node not appearing in palette
- Ensure build completed successfully: `npm run build`
- Check package.json includes node registration
- Restart Node-RED

### No errors detected
- Verify global context data is populated
- Check `moment` library is available in global context
- Inspect node status in flow

### Errors not sent to backend
- Check environment variables: `VIIS_BACKEND`, `DEVICE_ACCESS_TOKEN`
- Review Node-RED logs for HTTP errors
- Verify backend API is accessible

## Future Enhancements

- [ ] Add runtime flow monitoring (currently only checks on stop)
- [ ] Configurable channel selection (enable/disable specific channels)
- [ ] Export error statistics/metrics
- [ ] Add visual chart of flow deviation over time
