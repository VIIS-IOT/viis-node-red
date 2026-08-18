# VIIS Schedule Executor - Quick Reference

## 📋 Overview

The **viis-schedule-executor** node manages time-based automation schedules for IoT devices, executing Modbus commands and publishing telemetry.

**Location**: `services/nodered/custom-nodes/viis-node-red/src/modules/viis-schedule-executor`

**Files**:
- `viis-schedule-executor.ts` - Node entry point (971 lines)
- `viis-schedule-executor-service.ts` - Business logic (2288 lines)
- `resilience-utils.ts` - Fault tolerance patterns
- `type.ts` - TypeScript interfaces

---

## 🚀 Quick Start

### Basic Flow Setup

```
[Inject Node] ──► [viis-schedule-executor] ──► [Debug Node]
   (every 10-30s)
```

### Node Configuration

| Property | Default | Description |
|----------|---------|-------------|
| Name | `""` | Display name |
| Debug Enable | `false` | Enable verbose logging |
| Verify After Write | `true` | Per-key holding read-back only; does not gate status |
| Skip Coil Verify | `true` | Skip per-key coil read-back (default) |
| Cleanup Interval | `15` | Minutes for stale cleanup |

---

## 📥 Input Messages

### 1. Schedule Check (Empty Message)
```javascript
msg = {}
```
Triggers schedule evaluation.

### 2. RPC: Disable Schedule
```javascript
msg = {
  payload: {
    method: "schedule-disable-by-backend",
    params: { scheduleId: "sch-001" }
  }
}
```

### 3. RPC: Manual Recovery
```javascript
msg = {
  payload: {
    method: "confirm-devices-off",
    params: { 
      scheduleId: "sch-001",
      verifyDevices: true 
    }
  }
}
```

### 4. RPC: Control Parameters
```javascript
msg = {
  payload: {
    method: "control",
    params: { 
      scheduleId: "any",
      irrigation_mode: "drip",
      set_ec: 2.5 
    }
  }
}
```

---

## 🔄 Main Execution Flow

```
1. Fetch schedules from DB (enable=1, not deleted)
2. For each schedule:
   ├─ Check if due (time window, date range, day of week)
   ├─ If due and not running: START
   │  ├─ Map action JSON to Modbus commands
   │  ├─ Check for command overlap
   │  ├─ Execute: Holding → Valves → 5s delay → Pumps
   │  ├─ Verify writes (always for coils, conditional for holding)
   │  ├─ Store active commands
   │  ├─ Publish telemetry (start)
   │  ├─ Publish audit log
   │  ├─ Send HTTP notification
   │  └─ Sync schedule log
   │
   ├─ If running and still due: WAIT (1-min check)
   │
   └─ If running and not due: FINISH
      ├─ Reset all commands (Pumps → 5s delay → Valves → Holding)
      ├─ If reset success:
      │  ├─ Clear active commands
      │  ├─ Clear config values (set to 0)
      │  ├─ Update status to "finished"
      │  ├─ Clear status history
      │  ├─ Publish telemetry (end)
      │  ├─ Publish audit log
      │  ├─ Send HTTP notification
      │  └─ Sync schedule log
      │
      └─ If reset fail:
         ├─ Keep status as "running"
         ├─ Send error notification
         └─ Publish failure audit log
```

---

## 🎯 Key Behaviors

### Start Sequence (Equipment Protection)
```
1. Write all holding registers (FC=6)
2. Write valve coils (FC=5)
3. DELAY 5 SECONDS
4. Write pump/power coils (FC=5)
```

### Finish Sequence (Reverse Order)
```
1. Turn OFF pump/power coils (FC=5)
2. DELAY 5 SECONDS
3. Turn OFF valve coils (FC=5)
4. Reset holding registers to 0 (FC=6)
```

### Command Overlap Prevention
- Schedules cannot write to same Modbus address
- Config parameter keys skip overlap check
- Prevents race conditions between schedules

### Telemetry Deduplication
- 5-second window per schedule+action
- Hash-based comparison (excludes timestamp)
- Prevents duplicates from retries

---

## 🔧 Global Context Variables

| Variable | Type | Purpose |
|----------|------|---------|
| `activeModbusCommands` | `{[scheduleId]: ModbusCmd[]}` | Track executing commands |
| `configKeyValues` | `{[key]: any}` | Config parameters from schedules |
| `scheduleConfigKeys` | `{[scheduleId]: string[]}` | Track config keys per schedule |
| `scheduleStatusHistory` | `{[scheduleId]: string}` | Status change tracking |
| `scheduleLastCheckTimestamps` | `{[scheduleId]: number}` | Running schedule checks |
| `manualModbusOverrides` | `{[address-fc]: object}` | Manual overrides |

---

## 📡 MQTT Topics

### Publish Topics

| Topic | Broker | Content |
|-------|--------|---------|
| `v1/devices/me/telemetry` | ThingsBoard | Telemetry, audit, config |
| `viis/things/v2/{deviceId}/telemetry` | EMQX | Same as ThingsBoard |

### Telemetry Format

**Start**:
```json
{
  "ts": 1712923200000,
  "_schedule_action": "start",
  "_schedule_id": "sch-001",
  "_schedule_label": "Morning Irrigation",
  "valve_1": true,
  "pump_air": true,
  "set_ec": 2.5
}
```

**Finish**:
```json
{
  "ts": 1712930400000,
  "_schedule_action": "end",
  "_schedule_id": "sch-001",
  "_schedule_label": "Morning Irrigation",
  "valve_1": false,
  "pump_air": false,
  "set_ec": 0,
  "irrigation_mode": 0
}
```

---

## 🌐 HTTP Notification

**Endpoint**: `{VIIS_BACKEND}/api/v2/alarm/notification-by-token?device_access_token={TOKEN}`

**Method**: POST

**Payload**:
```json
{
  "alarm_name": "Schedule Label",
  "id": "device-001",
  "msg": "Lịch trình \"Morning Irrigation\" đã bắt đầu chạy thành công",
  "message_key": "iot.notification.schedule.started",
  "message_params": { "scheduleName": "Morning Irrigation" },
  "message_locale": "vi-VN",
  "severity": "notification",
  "trigger_time": "2026-04-13T10:00:00.000Z",
  "alarm_status": "Pending"
}
```

---

## ⚠️ Error Handling

### Startup Recovery
- Detects power cycle via startup ID
- Clears stale active commands
- Preserves config structure
- Re-evaluates all schedules fresh

### Modbus Write Failure
- Retries up to 3 times (start or finish sequence)
- Verification always for coils
- **Status ALWAYS set to "finished"** (prevents stuck "running")
- Error notification sent **ONCE** (no spam on subsequent triggers)

### Power Outage Recovery
- Detects "running" schedules with no active commands
- Re-executes start sequence
- Publishes telemetry and notifications

### Stale Status Cleanup
- Runs every `cleanupInterval` minutes (default: 15)
- Removes "running" entries without active commands
- Prevents stuck status

---

## 🐛 Troubleshooting

### Schedule Not Executing
**Check**:
1. `schedule.enable = 1`
2. Current time within `start_time` - `end_time` (UTC+7)
3. Current date within `start_date` - `end_date` (if set)
4. Current day in `interval` (if set)
5. No command overlap with other schedules

### Devices Stuck ON
**Symptoms**: Modbus reset failed, devices may still be physically ON
**Behavior**: Status is "finished" (not stuck), but devices may need manual check
**Solution**:
```javascript
// Option 1: RPC disable
msg = {
  payload: {
    method: "schedule-disable-by-backend",
    params: { scheduleId: "sch-001" }
  }
}

// Option 2: Manual recovery (verifies devices OFF)
msg = {
  payload: {
    method: "confirm-devices-off",
    params: { 
      scheduleId: "sch-001",
      verifyDevices: true 
    }
  }
}
```

### Verification Failed
**Causes**:
- Modbus communication error
- Device didn't respond
- Scaling misconfiguration

**Check**: Node logs with `debugEnable: true`

### MQTT Publish Errors
- Non-fatal (execution continues)
- Failed messages queued for retry
- Check MQTT broker connection

---

## 📊 Monitoring

### Enable Debug Logging
Set `debugEnable: true` in node config to see:
- Schedule due checks
- Modbus read/write operations
- Verification results
- MQTT publish attempts
- Config parameter storage
- Cleanup operations

### Key Log Patterns

**Successful Execution**:
```
▶️ STATUS CHANGE: sch-001 | none → running
🔧 MODBUS START SEQUENCE: sch-001
✅ VERIFICATION SUCCESS: 5 commands verified
📊 SCHEDULE TELEMETRY: sch-001 | Action: start
📡 HTTP NOTIFICATION SENT: sch-001
```

**Failed Execution**:
```
❌ MODBUS ERROR: sch-001 | Failed to write coil
❌ VERIFICATION FAILED: valve_1 | Expected: true, Got: false
🚨 CRITICAL: sch-001 cannot turn off devices
```

**Recovery**:
```
🔄 STARTUP RECOVERY: Detected potential stale state
✅ STARTUP RECOVERY: Cleared stale active state
🔄 POWER RECOVERY: Schedule sch-001 marked as "running" but no active commands
```

---

## 🔑 Environment Variables

**Required**:
- `DEVICE_ID` - Device identifier
- `DEVICE_ACCESS_TOKEN` - ThingsBoard auth token
- `VIIS_BACKEND` - Backend API URL

**Modbus** (single board):
- `MODBUS_HOST`, `MODBUS_TCP_PORT`
- `MODBUS_COILS`, `MODBUS_HOLDING_REGISTERS`

**Modbus** (multi-board):
- `MODBUS_BOARDS` - JSON array of board configs
- `MODBUS_{BOARDID}_COILS`
- `MODBUS_{BOARDID}_HOLDING_REGISTERS`

**MQTT**:
- `THINGSBOARD_HOST`, `THINGSBOARD_PORT`
- `EMQX_HOST`, `EMQX_PORT`

**Optional**:
- `MODBUS_MAX_RETRIES` - Max retry attempts (default: 3)

---

## 🧪 Testing Commands

### Trigger Schedule Check
```javascript
// Inject node
msg = {}
```

### Check Global Context
```javascript
// Function node
const activeCmds = global.get("activeModbusCommands");
const configVals = global.get("configKeyValues");
const statusHist = global.get("scheduleStatusHistory");

msg.payload = {
  activeCommands: activeCmds,
  configValues: configVals,
  statusHistory: statusHist
};

return msg;
```

### Manually Clear Stale State
```javascript
// Function node (emergency recovery)
global.set("activeModbusCommands", {});
global.set("scheduleStatusHistory", {});
global.set("scheduleLastCheckTimestamps", {});
global.set("manualModbusOverrides", {});

msg.payload = "Cleared all stale state";
return msg;
```

---

## 📚 Related Documentation

- [FLOW-DOCUMENTATION.md](./FLOW-DOCUMENTATION.md) - Complete flow documentation
- [ARCHITECTURE-DIAGRAMS.md](./ARCHITECTURE-DIAGRAMS.md) - Architecture diagrams
- [README-audit-log.md](../README-audit-log.md) - Audit log details
- [README-rpc-control.md](../README-rpc-control.md) - RPC control guide
- [README-unmapped-keys.md](../README-unmapped-keys.md) - Configuration parameters

---

*Quick reference generated on April 13, 2026*
