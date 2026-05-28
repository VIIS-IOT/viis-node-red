# Schedule Executor V2 - Composable Architecture

## Overview

Schedule Executor V2 refactors the monolithic `viis-schedule-executor` (V1, ~3500 lines) into a **composable architecture** that leverages existing node ecosystem instead of reimplementing everything custom.

### Key Principle
Schedule nodes handle **scheduling logic only**. Modbus read/write via `viis-modbus-flex`, MQTT via `viis-mqtt-client`, HTTP via built-in `http out` node.

## Architecture

### V1 (Monolithic)
```
inject → viis-schedule-executor (3500 lines, does everything) → debug
```

### V2 (Composable)
```
[inject] → [trigger-v2] → [logic-v2] → [function: build msg] → [viis-modbus-flex] → [executor-v2: state] → [viis-mqtt-client] → [http out]
```

### Data Flow
```
[viis-modbus-flex: write done]
        │
        ▼
[executor-v2: update DB status + track active commands]
        │
        ├──► [function: build telemetry] ──► [viis-mqtt-client: publish TB + EMQX]
        ├──► [function: build audit] ─────► [viis-mqtt-client: publish TB + EMQX]
        ├──► [function: build notification] ► [http out: POST notification API]
        └──► [function: build schedule log] ► [http out: POST schedule log API]
```

## Folder Structure

```
src/modules/schedule-executor-v2/
├── common/
│   ├── types.ts                     # Shared interfaces
│   └── schedule-utils.ts            # Shared utilities
├── viis-schedule-trigger-v2/        # Timing check + stuck schedule recovery
├── viis-schedule-logic-v2/          # Mode/safety check + schedule-to-Modbus mapping
├── viis-schedule-executor-v2/       # State manager (active commands, DB status)
├── templates/                       # Function node templates for flow wiring
│   ├── build-modbus-write-msg.js    # Convert logic output → viis-modbus-flex input
│   ├── build-modbus-reset-msg.js    # Build reset commands for schedule stop
│   ├── build-mqtt-telemetry-msg.js  # Build MQTT telemetry payload
│   ├── build-mqtt-audit-msg.js      # Build MQTT audit log payload
│   ├── build-http-notification-msg.js # Build HTTP notification payload
│   └── build-schedule-log-msg.js    # Build schedule log payload
└── README.md                        # This file
```

## Nodes

### 1. viis-schedule-trigger-v2 (2 outputs)
- **Output 1**: Due schedules for normal execution
- **Output 2**: Stuck schedules for recovery
- Queries DB, checks timing, detects stuck "running" schedules

### 2. viis-schedule-logic-v2
- Control mode check (AUTO/MANUAL/OFF)
- Safety conditions (water level, emergency stop, pump/flow error)
- Schedule-to-Modbus mapping (with luoi expansion)
- Manual overrides

### 3. viis-schedule-executor-v2 (Slim State Manager)
- Active command tracking
- DB status updates
- Startup/power-outage recovery
- Outputs msg for downstream nodes (MQTT, HTTP)

### 4. viis-schedule-rpc (5 outputs)
- Routes RPC commands to appropriate outputs
- Output 1: schedule-disable-by-backend
- Output 2: confirm-devices-off
- Output 3: control
- Output 4: set_control_mode
- Output 5: unknown methods

## Wiring Examples

### Basic Schedule Execution
```
[inject: 1min] → [trigger-v2:1] → [logic-v2] → [function: build write] → [viis-modbus-flex] → [executor-v2] → [function: build mqtt] → [viis-mqtt-client]
```

### With HTTP Notification
```
[executor-v2] → [function: build notification] → [http out: POST /api/v2/alarm/notification-by-token]
```

### With RPC Control
```
[viis-mqtt-client: RPC subscribe] → [viis-schedule-rpc] → [switch: method]
    ├─ schedule-disable → [executor-v2: stop] → [function: reset] → [viis-modbus-flex]
    ├─ confirm-devices-off → [executor-v2: confirm]
    ├─ control → [function: write] → [viis-modbus-flex]
    └─ set_control_mode → [logic-v2: set mode]
```

### Recovery Flow
```
[inject: 1min] → [trigger-v2:2] → [executor-v2: recover] → [function: reset] → [viis-modbus-flex]
```

## Node Details

### 1. viis-schedule-trigger-v2

**Responsibility**: Check timing and determine which schedules are due

**Input**:
- `msg` - Any message to trigger a check

**Output**:
```typescript
{
  schedules: TabiotSchedule[],
  timestamp: number,
  checkInterval: number,
  scheduleCount: number
}
```

**Configuration**:
- `Check Interval`: Minimum interval between checks (default: 1 minute)
- `Debug`: Enable debug logging

**Service Methods**:
- `getDueSchedules()`: Query enabled schedules from DB
- `checkScheduleDue(schedule)`: Check if single schedule is due
- `filterDueSchedules(schedules)`: Filter to only due schedules
- `checkTriggers()`: Main entry point

### 2. viis-schedule-logic-v2

**Responsibility**: Check control modes and safety conditions

**Input**:
```typescript
{
  payload: {
    schedules: TabiotSchedule[]
  }
}
```

**Output**:
```typescript
{
  payload: {
    allowed: boolean,
    commands: ModbusCmd[],
    mode: ControlMode,
    conditions: SafetyConditions,
    blockedReason?: string,
    scheduleCount: number,
    commandCount: number,
    configParameters: ConfigParameter[]
  }
}
```

**Configuration**:
- `Debug`: Enable debug logging

**Service Methods**:
- `readControlMode()`: Read AUTO/MANUAL/OFF
- `readSafetyConditions()`: Read water level, emergency stop, etc.
- `checkBeforeExecute(input)`: Main entry point
- `hasCommandOverlap()`: Detect conflicts
- `applyManualOverrides()`: Apply user overrides

**RPC Commands**:
```json
{
  "method": "set_control_mode",
  "params": { "mode": "AUTO" }
}
```

### 3. viis-schedule-executor-v2

**Responsibility**: Execute Modbus commands and verify

**Input**:
```typescript
{
  payload: {
    allowed: boolean,
    commands: ModbusCmd[],
    schedule?: TabiotSchedule
  }
}
```

**Output**:
```typescript
{
  payload: {
    success: boolean,
    executedCommands: number,
    failedCommands: number,
    errorMessage?: string
  }
}
```

**Configuration**:
- `Board Mode`: Auto/Single/Multi
- `Board ID`: Specific board for multi-board
- `Verify`: Enable write verification
- `Debug`: Enable debug logging

**Service Methods**:
- `executeModbusCommands()`: Main execution
- `verifyModbusWrite()`: Read back and verify
- `resetModbusCommands()`: Reset to safe state
- `trackActiveCommands()`: Track running schedules
- `canExecuteCommands()`: Check for conflicts

**RPC Commands**:
```json
{
  "method": "reset_schedule",
  "params": { "scheduleId": "schedule-name" }
}
```

## Migration Steps

### Step 1: Backup Existing Flow

1. Export your current flow that uses `viis-schedule-executor`
2. Save the JSON backup
3. Document current node configurations

### Step 2: Install V2 Nodes

1. Build the custom nodes:
```bash
cd ~/viis-local-docker/services/nodered/custom-nodes/viis-node-red
npm run build
```

2. Restart Node-RED:
```bash
docker restart nodered1
```

### Step 3: Replace Nodes in Flow

**Original Flow Pattern**:
```
inject → viis-schedule-executor → debug
```

**New Flow Pattern**:
```
inject → trigger-v2 → logic-v2 → executor-v2 → debug
```

### Step 4: Configure Nodes

#### trigger-v2 Configuration
```javascript
{
  name: "Schedule Trigger",
  debugEnable: false,
  cleanupInterval: 1
}
```

#### logic-v2 Configuration
```javascript
{
  name: "Schedule Logic",
  debugEnable: false
}
```

#### executor-v2 Configuration
```javascript
{
  name: "Schedule Executor",
  debugEnable: false,
  verifyAfterWrite: true,
  boardMode: "auto"
}
```

### Step 5: Update Global Context Keys

V2 uses the same global context keys as v1 for backward compatibility:

- `activeModbusCommands`
- `scheduleLastCheckTimestamps`
- `scheduleStatusHistory`
- `manualModbusOverrides`
- `scheduleConfigValues`

No changes needed to existing context management.

### Step 6: Test Migration

1. **Unit Tests**:
```bash
npm test -- schedule-executor-v2
```

2. **Integration Test**:
- Create test schedule in database
- Trigger flow manually
- Verify Modbus commands execute
- Check MQTT notifications

3. **Monitor Logs**:
```bash
docker logs -f nodered1 | grep -E "trigger-v2|logic-v2|executor-v2"
```

## Backward Compatibility

### What's Preserved

✅ Same database queries
✅ Same Modbus mappings
✅ Same global context structure
✅ Same MQTT notifications
✅ Same schedule status tracking
✅ Same RPC command format

### What's Changed

❌ Node names (now have `-v2` suffix)
❌ Message flow (now 3 nodes instead of 1)
❌ Internal service architecture
❌ Test coverage (now >80%)

## Testing

### Run All Tests
```bash
cd ~/viis-local-docker/services/nodered/custom-nodes/viis-node-red
npm test -- schedule-executor-v2
```

### Run Specific Test Files
```bash
# Trigger service tests
npm test -- schedule-trigger.service.test.ts

# Logic service tests
npm test -- logic-control.service.test.ts
npm test -- schedule-mapper.service.test.ts

# Executor service tests
npm test -- modbus-executor.service.test.ts
```

### Test Coverage
```bash
npm test -- schedule-executor-v2 --coverage
```

Expected coverage:
- `schedule-trigger-service.ts`: >80%
- `logic-control-service.ts`: >80%
- `schedule-mapper-service.ts`: >80%
- `modbus-executor-service.ts`: >80%

## Wiring Examples

### Basic Schedule Execution
```
[Inject: Every Minute] → [trigger-v2] → [logic-v2] → [executor-v2] → [Debug]
```

### With Error Handling
```
[Inject] → [trigger-v2] → [logic-v2] → [executor-v2] → [Switch: Success]
                                                        ├─→ [Debug: Success]
                                                        └─→ [Debug: Error]
```

### With Manual Override
```
[Inject] → [trigger-v2] → [logic-v2] → [Function: Add Overrides] → [executor-v2]
```

## Troubleshooting

### Issue: Schedules Not Triggering

**Check**:
1. Is schedule enabled in database? (`enable = 1`)
2. Is current time within start/end time?
3. Is current day in interval?
4. Check `scheduleLastCheckTimestamps` for duplicate prevention

**Debug**:
```javascript
// In trigger-v2, enable debug and check logs
debugEnable: true
```

### Issue: Execution Blocked

**Check**:
1. What is `blockedReason` in output?
2. Is control mode AUTO?
3. Are safety conditions OK?
4. Check global context for blocking conditions

**Debug**:
```javascript
// In logic-v2, enable debug
debugEnable: true
// Check node.warn output for blocked reason
```

### Issue: Modbus Commands Fail

**Check**:
1. Is Modbus client connected?
2. Are addresses correct in MODBUS_HOLDING_REGISTERS/MODBUS_COILS?
3. Is verifyAfterWrite causing timeout?
4. Check board configuration for multi-board

**Debug**:
```javascript
// In executor-v2, enable debug
debugEnable: true
// Temporarily disable verification
verifyAfterWrite: false
```

## Performance Considerations

### Memory Usage
- V2 uses same global context structure as v1
- No significant memory increase
- Services are stateless (created per node instance)

### Execution Time
- Trigger: ~50-100ms (DB query)
- Logic: ~10-20ms (in-memory checks)
- Executor: ~100-500ms per command (Modbus latency)

### Optimization Tips
1. Use appropriate `checkInterval` (don't check too frequently)
2. Enable `verifyAfterWrite` only for critical commands
3. Use debug logging sparingly in production

## Development Guidelines

### Adding New Features

1. **Update Common Types**:
```typescript
// common/types.ts
export interface NewFeature {
  // Define interface
}
```

2. **Create Service Method**:
```typescript
// service.ts
public async newFeature(): Promise<void> {
  // Implement with dependency injection
}
```

3. **Write Tests First**:
```typescript
// tests/service.test.ts
describe('newFeature', () => {
  it('should work correctly', () => {
    // Test implementation
  });
});
```

### Code Style

- Use TypeScript strict mode
- Follow Single Responsibility Principle
- Inject dependencies via constructor
- Use async/await for async operations
- Log via `node.warn()` for debug
- Handle errors gracefully

## Version History

### v2.0.0 (Current)
- ✅ Split monolithic node into 3 specialized nodes
- ✅ Added comprehensive unit tests (>80% coverage)
- ✅ Implemented dependency injection
- ✅ Added TypeScript types
- ✅ Backward compatible with v1

### v1.0.0 (Original)
- Monolithic schedule executor
- Limited test coverage
- Mixed responsibilities

## Support

For issues or questions:
1. Check this README
2. Review unit tests for usage examples
3. Enable debug logging on nodes
4. Check Node-RED debug panel

## License

Same as viis-node-red project
