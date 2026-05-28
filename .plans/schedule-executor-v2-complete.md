# Feature: Schedule Executor V2 — Complete Refactoring Plan

> **Created**: 2026-05-28
> **Status**: Draft
> **Priority**: High
> **Estimated Total Points**: ~47

---

## Vision

Refactor the monolithic `viis-schedule-executor` (V1, ~3500 lines) into a composable V2 architecture that **leverages existing node ecosystem** instead of reimplementing everything custom.

### Current V1 (Monolithic)
```
inject → viis-schedule-executor (3500 lines, does everything) → debug
```

### Current V2 (Partially Split — 3 nodes, still heavy)
```
inject → trigger-v2 → logic-v2 → executor-v2 → debug
```

### Target V2 (Composable — thin orchestration + existing nodes)
```
inject → trigger-v2 → logic-v2 → [function: build msg] → viis-modbus-flex → [function: process result] → viis-mqtt-client → http out
```

**Key Principle**: Schedule nodes handle **scheduling logic only**. Modbus read/write via `viis-modbus-flex`, MQTT via `viis-mqtt-client`, HTTP via built-in `http out` node.

---

## Existing Nodes to Leverage (Confirmed)

| Node | Read | Write | Capability |
|------|------|-------|------------|
| **`viis-modbus-flex`** | fc 1-4 | fc 5, 6, 15, 16 | Full Modbus read/write via `msg.payload` |
| **`viis-mqtt-client`** | — | — | MQTT publish/subscribe (ThingsBoard + EMQX) |
| **`http out`** (built-in) | — | — | HTTP POST/GET to backend API |
| **`function`** (built-in) | — | — | Message transformation |

### How `viis-modbus-flex` Works

```javascript
// READ example
msg.payload = { fc: 3, unitid: 1, address: 100, quantity: 10 };

// WRITE example
msg.payload = { fc: 6, unitid: 1, address: 100, value: 50 };

// WRITE coil
msg.payload = { fc: 5, unitid: 1, address: 10, value: true };
```

---

## Missing V1 Features to Port to V2 Nodes

### MUST HAVE (Critical)

| # | Feature | V1 Location | V2 Target Node |
|---|---------|-------------|----------------|
| 1 | Luoi mapping (luoi_1/2/3 → thu/dai) | Service L236-261 | `logic-v2` (ScheduleMapperService) |
| 2 | Reset time_valve_*/set_flow* at start | Executor L706-719 | `logic-v2` or function node |
| 3 | Config clear on finish | Service L1858-1892 | `executor-v2` (slim) |
| 4 | Startup recovery (clear stale state) | Executor L20-91 | `executor-v2` (slim) |
| 5 | Power outage recovery | Executor L678-687 | `executor-v2` (slim) |
| 6 | Stuck schedule recovery | Service L1295-1397 | `executor-v2` (slim) |
| 7 | RPC: schedule-disable-by-backend | Executor L326-488 | `viis-schedule-rpc` (NEW) |
| 8 | RPC: confirm-devices-off | Executor L491-605 | `viis-schedule-rpc` (NEW) |
| 9 | RPC: control (general) | Executor L607-646 | Wire to `viis-modbus-flex` |
| 10 | Schedule no-longer-due stop | Executor L812-900+ | `executor-v2` (slim) |
| 11 | Modbus write sequencing (START/FINISH) | Service L699-837 | Function node (build ordered msg) |
| 12 | Stale status cleanup | Executor L145-177 | `executor-v2` (slim) |

### NICE TO HAVE (Later)

| # | Feature | V1 Location |
|---|---------|-------------|
| 13 | Resilience utils (circuit breaker) | resilience-utils.ts |
| 14 | MQTT failed queue | Resilience L285-332 |
| 15 | Published value dedup cache | Service L114-156 |

---

## Proposed Flow Architecture

### Data Flow After Modbus Write

```
[viis-modbus-flex: write done]
        │
        ▼
[executor-v2: update DB status + track active commands]
        │
        ├──► [function: build MQTT telemetry msg] ──► [viis-mqtt-client: publish TB + EMQX]
        │
        ├──► [function: build MQTT audit msg] ──────► [viis-mqtt-client: publish TB + EMQX]
        │
        ├──► [function: build HTTP notification] ───► [http out: POST /api/v2/alarm/notification-by-token]
        │
        └──► [function: build schedule log] ────────► [http out: POST schedule log API]
```

### Complete Production Flow

```
[inject: 1min]
    │
    ▼
[trigger-v2] ─── query DB: getDueSchedules()
    │
    ▼
[logic-v2] ─── mode/safety check + mapScheduleToModbus()
    │
    ▼
[function: build modbus write msg] ─── convert commands to viis-modbus-flex format
    │                                  (with START/FINISH sequencing logic)
    ▼
[viis-modbus-flex: write coils/registers]
    │
    ▼
[executor-v2: update DB status] ─── updateScheduleStatus() + trackActiveCommands()
    │
    ├──► [function: build telemetry] ──► [viis-mqtt-client] ──► ThingsBoard topic: v1/devices/me/telemetry
    │                                                         ──► EMQX topic: viis/things/v2/{deviceId}/telemetry
    │
    ├──► [function: build audit] ─────► [viis-mqtt-client] ──► ThingsBoard topic: v1/devices/me/telemetry
    │                                                         ──► EMQX topic: viis/things/v2/{deviceId}/telemetry
    │
    ├──► [function: build notification] ► [http out] ──► POST /api/v2/alarm/notification-by-token
    │
    └──► [function: build schedule log] ► [http out] ──► POST schedule log API
```

### RPC Control Flow

```
[viis-schedule-rpc] ─── subscribe to v1/devices/me/rpc/request/+
    │
    ├──► [switch: method]
    │       │
    │       ├── schedule-disable-by-backend ──► [executor-v2: stop schedule]
    │       │                                       │
    │       │                                       ├──► [function: build reset msg] ──► [viis-modbus-flex: reset coils/registers]
    │       │                                       │
    │       │                                       ├──► [function: build telemetry] ──► [viis-mqtt-client]
    │       │                                       │
    │       │                                       └──► [function: build notification] ► [http out]
    │       │
    │       ├── confirm-devices-off ──► [executor-v2: confirm OFF]
    │       │                               │
    │       │                               ├──► [function: build telemetry] ──► [viis-mqtt-client]
    │       │                               │
    │       │                               └──► [function: build notification] ► [http out]
    │       │
    │       ├── control ──► [function: build write msg] ──► [viis-modbus-flex: write]
    │       │
    │       └── set_control_mode ──► [logic-v2: set CONTROL_MODE in global context]
    │
    └──► [debug: log RPC command]
```

### Schedule Stop Flow (no longer due)

```
[trigger-v2] ─── schedule not in due list
    │
    ▼
[executor-v2: detect running schedule no longer due]
    │
    ├──► [function: build reset msg] ──► [viis-modbus-flex: reset all active commands]
    │
    ├──► [function: update DB] ──► updateScheduleStatus("finished")
    │
    ├──► [function: build telemetry] ──► [viis-mqtt-client]
    │
    └──► [function: build notification] ► [http out]
```

### MQTT Publishing Details (Dual Broker)

| Payload Type | Topic (ThingsBoard) | Topic (EMQX) | When |
|-------------|---------------------|--------------|------|
| Telemetry | `v1/devices/me/telemetry` | `viis/things/v2/{deviceId}/telemetry` | Schedule start/end |
| Audit Log | `v1/devices/me/telemetry` | `viis/things/v2/{deviceId}/telemetry` | Schedule start/end |
| Config Update | `v1/devices/me/telemetry` | `viis/things/v2/{deviceId}/telemetry` | Config param changed |
| Active Schedule | `v1/devices/me/telemetry` | `viis/things/v2/{deviceId}/telemetry` | Status change |

### HTTP Notification Details

| Endpoint | Payload | When |
|----------|---------|------|
| `/api/v2/alarm/notification-by-token` | alarm_name, msg, severity, alarm_status | Schedule start/end |
| Schedule log API | start_time, end_time, schedule_id | Schedule start/end |

---

## Implementation Tasks

### TASK 1: Enhance ScheduleMapperService — Port Missing V1 Logic
**Priority**: High | **Points**: 5 | **Depends On**: None

**Description**: The V2 `ScheduleMapperService` is missing critical V1 features. Port them.

**Subtasks**:
| # | Subtask | Points |
|---|---------|--------|
| 1.1 | Add `expandLuoiActionParams()` — convert luoi_1/2/3 to luoi_X_thu/dai coils | 2 |
| 1.2 | Add `normalizeLuoiValue()` helper | 0.5 |
| 1.3 | Add `resetTimeValveAndSetFlow()` — pre-reset time_valve_*/set_flow* before schedule start | 1 |
| 1.4 | Add `clearScheduleConfigValues()` — reset config keys to defaults on finish, return reset values | 1 |
| 1.5 | Add schedule config key tracking (`scheduleConfigKeys` in global context) | 0.5 |

**Acceptance Criteria**:
- [ ] Luoi mapping works: `luoi_1=1` → `luoi_1_dai=true, luoi_1_thu=false`
- [ ] time_valve_* and set_flow* are reset to 0 before schedule start
- [ ] Config values are cleared on schedule finish
- [ ] All existing tests still pass

**Files to modify**:
- `src/modules/schedule-executor-v2/viis-schedule-logic-v2/schedule-mapper-service.ts`
- `src/modules/schedule-executor-v2/viis-schedule-logic-v2/tests/schedule-mapper.service.test.ts`

---

### TASK 2: Slim Down `viis-schedule-executor-v2` — State Manager Only
**Priority**: High | **Points**: 5 | **Depends On**: None

**Description**: Refactor executor-v2 to be a thin state manager. Remove Modbus execution (→ viis-modbus-flex), MQTT publishing (→ viis-mqtt-client), HTTP notification (→ http out). Keep ONLY: active command tracking, status state machine, recovery logic.

**Subtasks**:
| # | Subtask | Points |
|---|---------|--------|
| 2.1 | Remove Modbus execution logic (replaced by viis-modbus-flex) | 0.5 |
| 2.2 | Remove MQTT publishing (replaced by viis-mqtt-client) | 0.5 |
| 2.3 | Remove HTTP notification (replaced by http out node) | 0.5 |
| 2.4 | Add startup recovery (port from V1 executor L20-91) | 1 |
| 2.5 | Add power outage recovery (port from V1 executor L678-687) | 1 |
| 2.6 | Add stuck schedule recovery (port from V1 service L1295-1397) | 1 |

**Acceptance Criteria**:
- [ ] Executor-v2 is <200 lines
- [ ] Handles startup recovery: clears stale activeModbusCommands on boot
- [ ] Handles power outage: detects "running" with no active commands, re-triggers
- [ ] Handles stuck schedules: detects "running" past end time, auto-finishes
- [ ] Outputs `{ success, scheduleId, action, statusChanged }` for downstream nodes
- [ ] All existing tests updated and passing

**Files to modify**:
- `src/modules/schedule-executor-v2/viis-schedule-executor-v2/viis-schedule-executor-v2.ts`
- `src/modules/schedule-executor-v2/viis-schedule-executor-v2/schedule-status-service.ts`

---

### TASK 3: Create `viis-schedule-rpc` Node
**Priority**: Medium | **Points**: 3 | **Depends On**: Task 2

**Description**: Create a dedicated RPC command handler node for schedule-related RPC commands. Subscribes to ThingsBoard RPC topic and routes commands to appropriate outputs.

**Subtasks**:
| # | Subtask | Points |
|---|---------|--------|
| 3.1 | Create node structure with MQTT subscription | 1 |
| 3.2 | Implement RPC routing: schedule-disable, confirm-devices-off, control, set_control_mode | 1 |
| 3.3 | Add HTML editor UI and tests | 1 |

**Acceptance Criteria**:
- [ ] Subscribes to `v1/devices/me/rpc/request/+`
- [ ] Routes `schedule-disable-by-backend` to output 1
- [ ] Routes `confirm-devices-off` to output 2
- [ ] Routes `control` to output 3
- [ ] Routes `set_control_mode` to output 4
- [ ] Unknown methods logged and passed to catch-all output 5

**Files to create**:
- `src/modules/viis-schedule-rpc/viis-schedule-rpc.ts`
- `src/modules/viis-schedule-rpc/viis-schedule-rpc.html`
- `src/modules/viis-schedule-rpc/schedule-rpc-service.ts`
- `src/modules/viis-schedule-rpc/tests/schedule-rpc.service.test.ts`

---

### TASK 4: Enhance `viis-schedule-trigger-v2` — Recovery Integration
**Priority**: Medium | **Points**: 2 | **Depends On**: Task 2

**Description**: Add startup recovery and stuck schedule recovery integration to trigger node.

**Subtasks**:
| # | Subtask | Points |
|---|---------|--------|
| 4.1 | Add startup stale state clearing | 1 |
| 4.2 | Add `checkAndRecoverStuckSchedules()` call on each trigger | 1 |

**Acceptance Criteria**:
- [ ] On first boot, clears stale `activeModbusCommands`, `scheduleStatusHistory`, `scheduleLastCheckTimestamps`
- [ ] On each trigger check, also checks for stuck "running" schedules and recovers them
- [ ] Existing tests still pass

**Files to modify**:
- `src/modules/schedule-executor-v2/viis-schedule-trigger-v2/viis-schedule-trigger-v2.ts`
- `src/modules/schedule-executor-v2/viis-schedule-trigger-v2/schedule-trigger-service.ts`

---

### TASK 5: Create Function Node Templates for Flow Wiring
**Priority**: High | **Points**: 5 | **Depends On**: Tasks 1-2

**Description**: Create reusable function node templates that handle message transformation between schedule nodes and existing nodes (viis-modbus-flex, viis-mqtt-client, http out). These templates encode the business logic that was previously inside the monolithic executor.

**Subtasks**:
| # | Subtask | Points |
|---|---------|--------|
| 5.1 | Create "Build Modbus Write Msg" function — converts logic-v2 output to viis-modbus-flex input format with START/FINISH sequencing (power→valve→pump or pump→valve→power) | 1.5 |
| 5.2 | Create "Build MQTT Telemetry Msg" function — converts execution result to MQTT publish format with dedup cache, dual broker topics | 1 |
| 5.3 | Create "Build MQTT Audit Msg" function — builds audit log payload with requestId, changed keys, success/fail status | 0.5 |
| 5.4 | Create "Build HTTP Notification Msg" function — converts status change to `/api/v2/alarm/notification-by-token` payload with i18n support | 1 |
| 5.5 | Create "Build Schedule Log Msg" function — builds schedule log payload for backend API | 0.5 |
| 5.6 | Create "Build Modbus Reset Msg" function — builds reset commands for active commands + time_valve_*/set_flow* | 0.5 |

**Acceptance Criteria**:
- [ ] Modbus write function sends commands sequentially (not parallel) with 100ms delay
- [ ] Modbus write function handles START sequence: power→valve→other→5s delay→pump
- [ ] Modbus write function handles FINISH sequence: pump→other→5s delay→valve→power
- [ ] MQTT telemetry function builds payload matching V1 format (`_schedule_action`, `_schedule_id`, `_schedule_label`)
- [ ] MQTT telemetry function includes dedup cache (skip if same data published within 5s)
- [ ] MQTT audit function builds payload with `from: "DEVICE_EXE_SCHEDULE"`, `requestId`, `metadata`
- [ ] HTTP notification function builds payload with `alarm_name`, `msg`, `severity`, `alarm_status`, `message_key`, `message_params`, `message_locale: 'vi-VN'`
- [ ] HTTP notification function skips error notifications when debug disabled
- [ ] All function nodes include error handling and debug logging

**Files to create**:
- `src/modules/schedule-executor-v2/templates/build-modbus-write-msg.js`
- `src/modules/schedule-executor-v2/templates/build-mqtt-telemetry-msg.js`
- `src/modules/schedule-executor-v2/templates/build-mqtt-audit-msg.js`
- `src/modules/schedule-executor-v2/templates/build-http-notification-msg.js`
- `src/modules/schedule-executor-v2/templates/build-schedule-log-msg.js`
- `src/modules/schedule-executor-v2/templates/build-modbus-reset-msg.js`

---

### TASK 6: Update README and Migration Guide
**Priority**: Low | **Points**: 1 | **Depends On**: Tasks 1-5

**Description**: Update the V2 README with new architecture, wiring examples, and migration steps from V1.

**Subtasks**:
| # | Subtask | Points |
|---|---------|--------|
| 6.1 | Update architecture diagram and node descriptions | 0.5 |
| 6.2 | Add wiring examples for common patterns | 0.5 |

**Acceptance Criteria**:
- [ ] README reflects new composable architecture
- [ ] At least 3 wiring examples provided
- [ ] Migration steps from V1 documented

**Files to modify**:
- `src/modules/schedule-executor-v2/README.md`

---

### TASK 7: Integration Testing
**Priority**: High | **Points**: 5 | **Depends On**: Tasks 1-5

**Description**: End-to-end testing of the full V2 flow with all nodes wired together.

**Subtasks**:
| # | Subtask | Points |
|---|---------|--------|
| 7.1 | Create test flow JSON with all V2 nodes wired | 1 |
| 7.2 | Test basic schedule execution (start → run → finish) | 1 |
| 7.3 | Test RPC commands (disable, confirm-off, control) | 1 |
| 7.4 | Test recovery scenarios (power outage, stuck schedules) | 1 |
| 7.5 | Test edge cases (cross-midnight, luoi mapping, multi-board) | 1 |

**Acceptance Criteria**:
- [ ] All test flows execute without errors
- [ ] Modbus commands are written via viis-modbus-flex
- [ ] MQTT telemetry is published via viis-mqtt-client
- [ ] HTTP notifications are sent via http out node
- [ ] Recovery logic works after simulated restart

---

## Dependency Graph

```
TASK 1 (Mapper enhancements) ─────────────┐
                                           │
TASK 2 (Slim executor-v2) ────────────────┤
                                           │
TASK 3 (RPC node) ──► depends on Task 2 ──┤
                                           │
TASK 4 (Trigger recovery) ─► depends on T2 ┤
                                           │
TASK 5 (Function templates) ─► depends T1-2┤
                                           │
TASK 6 (README) ──► depends on Tasks 1-5 ──┤
                                           │
TASK 7 (Integration tests) ─► T1-5 ───────┘
```

**Execution order**: Task 1 + Task 2 (parallel) → Task 3 + Task 4 + Task 5 (parallel) → Task 6 + Task 7 (parallel)

---

## Files Summary

### New Files
| File | Description |
|------|-------------|
| `src/modules/viis-schedule-rpc/viis-schedule-rpc.ts` | RPC handler node |
| `src/modules/viis-schedule-rpc/viis-schedule-rpc.html` | RPC handler editor UI |
| `src/modules/viis-schedule-rpc/schedule-rpc-service.ts` | RPC routing service |
| `src/modules/viis-schedule-rpc/tests/schedule-rpc.service.test.ts` | Tests |
| `src/modules/schedule-executor-v2/templates/build-modbus-write-msg.js` | Modbus write message builder (with sequencing) |
| `src/modules/schedule-executor-v2/templates/build-modbus-reset-msg.js` | Modbus reset message builder |
| `src/modules/schedule-executor-v2/templates/build-mqtt-telemetry-msg.js` | MQTT telemetry payload builder |
| `src/modules/schedule-executor-v2/templates/build-mqtt-audit-msg.js` | MQTT audit log payload builder |
| `src/modules/schedule-executor-v2/templates/build-http-notification-msg.js` | HTTP notification payload builder |
| `src/modules/schedule-executor-v2/templates/build-schedule-log-msg.js` | Schedule log payload builder |

### Modified Files
| File | Changes |
|------|---------|
| `schedule-executor-v2/viis-schedule-logic-v2/schedule-mapper-service.ts` | Add luoi mapping, config clear, time_valve reset |
| `schedule-executor-v2/viis-schedule-executor-v2/viis-schedule-executor-v2.ts` | Slim to ~150 lines, state manager only |
| `schedule-executor-v2/viis-schedule-executor-v2/schedule-status-service.ts` | Add recovery methods |
| `schedule-executor-v2/viis-schedule-trigger-v2/schedule-trigger-service.ts` | Add startup recovery |
| `schedule-executor-v2/README.md` | Update architecture docs |
| `package.json` | Register new node types |
