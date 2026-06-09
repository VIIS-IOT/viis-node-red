# Protection Gate Service — Implementation Plan

> Created: 2026-06-05
> Feature: Centralized protection logic for all coil control sources

## Problem

Current `viis-device-protection` node runs independently on a 30s timer, **not in the path** of coil writes from 3 control sources:

| Source | Current write path | Protection check |
|--------|-------------------|------------------|
| Schedule (V1/V2) | `modbusClient.writeCoil()` | None (V1 `canExecuteCommands` disabled) |
| RPC (mobile) | `modbusService.writeToModbus()` | None |
| Device Intent Logic | `device_actions` → downstream Modbus write | None |

**Race condition**: Coil gets ON → protection detects 30s later → writes OFF. During 30s window, Min OFF Time and sensor limits are not enforced.

## Proposed Solution

### Architecture

```
                         ┌─────────────────────────┐
                         │   ProtectionGateService   │
                         │   (global context shared) │
                         └────────────┬──────────────┘
                                      │
    ┌─────────────────┐               │           ┌──────────────────┐
    │   Schedule       │──checkGate()──┤           │  Device Intent   │
    │   Executor       │               │           │  Logic           │
    └────────┬────────┘               │           └────────┬─────────┘
             │                        │                    │
             ▼                        ▼                    ▼
    ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │  allowed?        │  │  allowed?         │  │  allowed?        │
    │  → writeCoil     │  │  → writeCoil      │  │  → filter output │
    │  → updateState   │  │  → updateState    │  │  → updateState   │
    └─────────────────┘  └──────────────────┘  └──────────────────┘

    ┌──────────────────────────────────────────────────────────────────┐
    │  viis-device-protection (timer 1s)                               │
    │  - enforce Max Time ON → auto OFF + update gate state            │
    │  - enforce sensor limits → auto OFF + update gate state          │
    │  - sync coil states from Modbus read                             │
    └──────────────────────────────────────────────────────────────────┘
```

### Key Format

Production functions in `tabiot_production_function`:

```
── Per-coil protection (highest priority) ──
  lamp_control_1_protect_max_time_on    (Value, seconds)
  lamp_control_1_protect_min_off_time   (Value, seconds)
  lamp_control_1_protect_upper_limit    (Value, °C)
  lamp_control_1_protect_lower_limit    (Value, °C)
  lamp_control_1_protect_sensor_id      (String, sensor identifier)
  lamp_control_1_protect_bypass         (Bool)
  lamp_control_1_protect_force_on       (Bool)
  lamp_control_1_protect_force_off      (Bool)

── All-coil protection (medium priority) ──
  lamp_protect_all_max_time_on          (Value, seconds)
  lamp_protect_all_min_off_time         (Value, seconds)
  lamp_protect_all_upper_limit          (Value, °C)
  lamp_protect_all_lower_limit          (Value, °C)
  lamp_protect_all_sensor_id            (String, sensor identifier)
  lamp_protect_all_bypass               (Bool)
  lamp_protect_all_force_on             (Bool)
  lamp_protect_all_force_off            (Bool)

── Device type fallback (lowest priority) ──
  lamp_protect_max_time_on              (Value, seconds) — legacy compat
  lamp_protect_sensor_id                (String) — legacy compat
```

### Sensor Binding Convention

Coil và sensor là 2 production function riêng biệt. Link bằng `sensor_id` naming convention:

```
── Sensor binding examples ──
  lamp_protect_all_sensor_id = "temperature_1"     → tất cả lamp check temperature_1
  fan_protect_all_sensor_id  = "temperature_2"     → tất cả fan check temperature_2
  humid_protect_all_sensor_id = "humidity_1"       → tất cả humid check humidity_1
  cool_protect_all_sensor_id = "temperature_1"     → tất cả cool check temperature_1
  co2_protect_all_sensor_id  = "co2_1"             → tất cả co2 check co2_1

── Per-coil override ──
  lamp_control_1_protect_sensor_id = "temperature_3"  → coil 1 dùng sensor riêng
```

Lookup chain cho sensor_id (giống các field khác):
```
lamp_control_1 cần check upper_limit:
  1. lamp_control_1_protect_sensor_id  → "temperature_3"  (specific)
  2. lamp_protect_all_sensor_id        → "temperature_1"  (all)
  3. lamp_protect_sensor_id            → "temperature_1"  (device type fallback)

→ sensorValue = sensorData["temperature_3"]
→ compare với upper_limit
```

### Config Lookup Chain

```
For coil "lamp_control_1", field "max_time_on":

Priority 1: lamp_control_1_protect_max_time_on   (specific coil)
Priority 2: lamp_protect_all_max_time_on          (all lamps)
Priority 3: lamp_protect_max_time_on              (device type fallback)

For coil "lamp_control_1", field "sensor_id":

Priority 1: lamp_control_1_protect_sensor_id      (specific coil)
Priority 2: lamp_protect_all_sensor_id            (all lamps)
Priority 3: lamp_protect_sensor_id                (device type fallback)
```

### Gate Logic

```
checkGate(coilKey, requestedState):
├── requestedState = OFF → ALWAYS allow
├── bypass = true → allow
├── forceOn → allow (still check maxTime)
├── forceOff → block ON
├── requestedState = ON:
│   ├── maxTimeOn > 0 && elapsedOnTime > maxTimeOn → BLOCK
│   ├── minOffTime > 0 && elapsedOffTime < minOffTime → BLOCK
│   ├── upperLimit > 0:
│   │   ├── resolve sensor_id (3-level lookup)
│   │   ├── sensorValue = sensorData[sensor_id]
│   │   └── sensorValue > upperLimit → BLOCK ON
│   ├── lowerLimit > 0:
│   │   ├── resolve sensor_id (3-level lookup)
│   │   ├── sensorValue = sensorData[sensor_id]
│   │   └── sensorValue < lowerLimit → BLOCK ON (cho đèn/quạt)
│   │                                  hoặc AUTO ON (cho cooling/humid)
│   └── all clear → ALLOW
```

---

## Tasks

### TASK 1: Create ProtectionGateService (Critical)

**File**: `src/modules/viis-device-protection/services/protection-gate-service.ts`

**What**: Singleton service shared across all nodes via global context.

```typescript
export class ProtectionGateService {
  // State tracking
  private coilStates: Map<string, CoilState>;  // { on: boolean, since: number }
  private lastOffTime: Map<string, number>;
  private configCache: Map<string, ProtectionConfig>;
  private sensorValues: Map<string, number>;  // sensor_id → value

  // Core methods
  checkGate(coilKey: string, requestedValue: boolean, source: string): GateResult;
  updateState(coilKey: string, newState: boolean): void;
  syncCoilState(coilKey: string, currentState: boolean): void;
  updateSensorValue(sensorKey: string, value: number): void;
  refreshConfig(): void;  // reload from configKeyValues
  getProtectionConfigForCoil(coilKey: string): ProtectionConfig;  // 3-level lookup
  getSensorIdForCoil(coilKey: string): string | null;  // resolve sensor_id
}
```

**GateResult interface**:
```typescript
interface GateResult {
  allowed: boolean;
  reason: string;
  action: 'allow' | 'block' | 'force_on' | 'force_off' | 'auto_off';
  metadata?: {
    elapsedOnTime?: number;
    elapsedOffTime?: number;
    sensorValue?: number;
    sensorId?: string;
    violation?: string;
  };
}
```

**Lookup logic** (`getProtectionConfigForCoil`):
```typescript
const deviceType = coilKey.split('_control_')[0]; // "lamp" from "lamp_control_1"
const resolveField = (field: string) => {
  // Priority 1: specific coil
  const specific = configKeyValues[`${coilKey}_protect_${field}`];
  if (specific !== undefined) return specific;
  // Priority 2: all rule
  const all = configKeyValues[`${deviceType}_protect_all_${field}`];
  if (all !== undefined) return all;
  // Priority 3: device type fallback
  return configKeyValues[`${deviceType}_protect_${field}`];
};
```

**Sensor resolution** (`getSensorIdForCoil`):
```typescript
// Same 3-level lookup for sensor_id
const sensorId = resolveField('sensor_id'); // e.g., "temperature_1"
return sensorId || null;
```

**Gate check for sensor-based limits**:
```typescript
// In checkGate(), when checking upperLimit:
if (config.upperLimit > 0) {
  const sensorId = this.getSensorIdForCoil(coilKey);
  if (sensorId) {
    const sensorValue = this.sensorValues.get(sensorId);
    if (sensorValue !== undefined && sensorValue > config.upperLimit) {
      return { allowed: false, reason: `Sensor ${sensorId}=${sensorValue} > limit ${config.upperLimit}`, ... };
    }
  }
}
```

**Points**: 5

**Acceptance Criteria**:
- [ ] Service loads config from `configKeyValues` global context
- [ ] 3-level lookup: specific coil → all → device type
- [ ] 3-level lookup for `sensor_id`: specific coil → all → device type
- [ ] `checkGate(OFF)` always returns `allowed: true`
- [ ] `checkGate(ON)` checks maxTimeOn, minOffTime, upperLimit, lowerLimit
- [ ] upperLimit/lowerLimit use resolved `sensor_id` to get sensor value
- [ ] No `sensor_id` configured → skip sensor check (allow)
- [ ] Sensor value not found → skip sensor check (allow)
- [ ] `updateState()` tracks ON/OFF timing
- [ ] Sensor values update and affect gate decisions
- [ ] Unit tests pass for all gate scenarios

---

### TASK 2: Write Unit Tests for ProtectionGateService (Critical)

**File**: `src/modules/viis-device-protection/tests/protection-gate-service.test.ts`

**Scenarios to test**:

| # | Scenario | Expected |
|---|----------|----------|
| 1 | OFF always allowed | `allowed: true` |
| 2 | ON with no config | `allowed: true` |
| 3 | ON within maxTimeOn | `allowed: true` |
| 4 | ON exceeding maxTimeOn | `allowed: false, action: 'block'` |
| 5 | ON during minOffTime | `allowed: false, action: 'block'` |
| 6 | ON after minOffTime elapsed | `allowed: true` |
| 7 | ON when upperLimit exceeded (sensor from config) | `allowed: false, action: 'block'` |
| 8 | ON when lowerLimit exceeded (sensor from config) | `allowed: false, action: 'block'` |
| 9 | Bypass = true | `allowed: true` (all checks skipped) |
| 10 | Force ON | `allowed: true` |
| 11 | Force OFF + request ON | `allowed: false` |
| 12 | Specific coil overrides all rule | `maxTimeOn` from specific |
| 13 | All rule overrides device type | `maxTimeOn` from all |
| 14 | Device type fallback | `maxTimeOn` from device type |
| 15 | Multiple coils independent | Different states per coil |
| 16 | Sensor update affects gate | upperLimit check uses latest sensor |
| 17 | sensor_id resolved via 3-level lookup | specific → all → device type |
| 18 | No sensor_id configured → skip sensor check | `allowed: true` |
| 19 | Sensor value not found → skip sensor check | `allowed: true` |

**Points**: 3

**Acceptance Criteria**:
- [ ] All 15 scenarios pass
- [ ] `jest.useFakeTimers()` for time-dependent tests
- [ ] Mock global context for configKeyValues

---

### TASK 3: Integrate Gate into viis-rpc-control (High)

**File**: `src/modules/viis-rpc-control/handlers/rpcHandler.ts`

**What**: Add protection gate check before coil writes in `handleModbusMappedParameter()`.

**Change** (line ~522, before `writeToModbusWithRetry`):
```typescript
// NEW: Protection gate check for coils
if (mapping.fc === 5) { // Write Single Coil
  const gate = protectionGate.checkGate(key, Boolean(value), 'rpc');
  if (!gate.allowed) {
    this.logger.warn(`[PROTECTION] Blocked ${key}=${value}: ${gate.reason}`);
    await this.mqttService.publishConfigUpdate(`_blocked_${key}`, {
      requested: value,
      reason: gate.reason,
      source: 'rpc',
    });
    throw new Error(`Protection blocked: ${gate.reason}`);
  }
}

// Existing write logic
await this.writeToModbusWithRetry(key, mapping, value);

// NEW: Update gate state after successful write
if (mapping.fc === 5) {
  protectionGate.updateState(key, Boolean(value));
}
```

**Also update**: `handleConfigOnlyParameter()` — when protection config keys change, call `protectionGate.refreshConfig()`.

**Points**: 3

**Acceptance Criteria**:
- [ ] RPC coil write checks gate before Modbus write
- [ ] Blocked RPC returns error via MQTT telemetry
- [ ] Successful write updates gate state
- [ ] Config key changes trigger gate config refresh
- [ ] Existing tests still pass

---

### TASK 4: Integrate Gate into Schedule Executor V2 (High)

**File**: `src/modules/schedule-executor-v2/viis-schedule-logic-v2/logic-control-service.ts`

**What**: Add protection gate check in `checkBeforeExecute()` alongside existing safety checks.

**Change** (in `checkBeforeExecute()`, after emergency/flow checks):
```typescript
// NEW: Protection gate check for coil commands
for (const cmd of coilCommands) {
  const gate = protectionGate.checkGate(cmd.key, Boolean(cmd.value), 'schedule');
  if (!gate.allowed) {
    blockedCommands.push({
      key: cmd.key,
      reason: gate.reason,
      source: 'schedule',
    });
  }
}

// Remove blocked commands from allowed list
const allowedCommands = coilCommands.filter(cmd => 
  !blockedCommands.find(b => b.key === cmd.key)
);
```

**Also**: Update gate state after successful Modbus execution in `modbus-executor-service.ts`.

**Points**: 3

**Acceptance Criteria**:
- [ ] Schedule coil commands check gate before execution
- [ ] Blocked commands logged with reason
- [ ] Non-blocked commands still execute
- [ ] Gate state updates after successful write
- [ ] Existing V2 safety checks still work

---

### TASK 5: Integrate Gate into Device Intent Output (Medium)

**File**: `src/modules/viis-automation-node/services/processingService.ts`

**What**: Filter `device_actions` through gate before outputting results.

**Change** (in `processIntents()`, after `intentService.processDeviceIntents()`):
```typescript
// NEW: Filter actions through protection gate
const filteredResults = results.map(result => ({
  ...result,
  device_actions: result.device_actions.filter(action => {
    const gate = protectionGate.checkGate(action.key, action.value, 'intent');
    if (!gate.allowed) {
      this.logger.warn(`Intent action blocked: ${action.key}=${action.value}: ${gate.reason}`);
    }
    return gate.allowed;
  }),
}));
```

**Also**: Update gate state when actions are executed downstream.

**Points**: 2

**Acceptance Criteria**:
- [ ] Intent actions filtered through gate
- [ ] Blocked actions logged
- [ ] Output only contains allowed actions
- [ ] Existing intent logic unchanged

---

### TASK 6: Update viis-device-protection Node (Medium)

**File**: `src/modules/viis-device-protection/viis-device-protection.ts`

**What**: Refactor to use ProtectionGateService for state sync and auto-enforcement.

**Changes**:
1. Import and use `ProtectionGateService` instead of local `ProtectionManager`
2. Change timer interval from 30s to 1s (or configurable)
3. Sync coil states to gate service on each tick
4. Auto-OFF when maxTimeOn exceeded (write coil + update gate)
5. Auto-OFF when sensor limit exceeded (write coil + update gate)
6. Remove blocking logic (now handled by gate in each source)

**Points**: 3

**Acceptance Criteria**:
- [ ] Uses shared ProtectionGateService
- [ ] 1s check interval (configurable)
- [ ] Auto-OFF on maxTimeOn violation
- [ ] Auto-OFF on sensor limit violation
- [ ] Updates gate state after auto-OFF
- [ ] Existing protection tests updated

---

### TASK 7: Update ConfigService Lookup (Medium)

**File**: `src/modules/viis-device-protection/services/configService.ts`

**What**: Add 3-level lookup with `_protect_all_` support.

**Change** (`getProtectionConfigByLabel` method):
```typescript
// Add "all" prefix to lookup chain
const buildLookupLabels = (label: string): string[] => {
  const labels: string[] = [label];
  const parts = label.split('_');
  const deviceType = parts[0]; // "lamp", "fan", "cool", etc.

  // Priority 1: specific coil (e.g., lamp_control_1)
  // Already in labels[0]

  // Priority 2: all rule (e.g., lamp_protect_all)
  labels.push(`${deviceType}_protect_all`);

  // Priority 3: device type fallback (e.g., lamp_protect)
  for (let i = parts.length - 1; i >= 1; i--) {
    labels.push(parts.slice(0, i).join('_'));
  }
  labels.push(`${deviceType}_protect`);

  return labels;
};
```

**Points**: 2

**Acceptance Criteria**:
- [ ] `lamp_control_1` → checks `lamp_control_1_protect_*`, then `lamp_protect_all_*`, then `lamp_protect_*`
- [ ] Backward compatible with existing key format
- [ ] Existing ConfigService tests pass
- [ ] New tests for `_protect_all_` lookup

---

### TASK 8: Comprehensive Integration Tests (High)

**File**: `src/modules/viis-device-protection/tests/protection-gate-integration.test.ts`

**Scenarios**:

| # | Scenario | Source | Expected |
|---|----------|--------|----------|
| 1 | Schedule ON, no protection | schedule | allowed |
| 2 | Schedule ON, maxTime exceeded | schedule | blocked |
| 3 | RPC ON during minOffTime | rpc | blocked |
| 4 | Intent ON, sensor limit exceeded | intent | blocked |
| 5 | Auto-OFF triggers, then minOffTime blocks ON | protection → any | blocked during cooldown |
| 6 | Bypass overrides all blocks | any | allowed |
| 7 | Per-coil config overrides all rule | any | uses specific value |
| 8 | Multiple sources, same coil | schedule + rpc | consistent state |
| 9 | Config change mid-operation | rpc config update | new limits apply |
| 10 | Coil OFF always allowed | any | allowed |

**Points**: 3

**Acceptance Criteria**:
- [ ] All 10 scenarios pass
- [ ] Tests use mock Modbus client
- [ ] Tests use mock global context
- [ ] Time simulation with `jest.useFakeTimers()`

---

## Dependency Graph

```
TASK 1 (ProtectionGateService)
│
├──► TASK 2 (Unit Tests) ──► verify TASK 1
│
├──► TASK 7 (ConfigService Lookup) ──► used by TASK 1
│
├──► TASK 3 (RPC Integration)
│
├──► TASK 4 (Schedule Integration)
│
├──► TASK 5 (Intent Integration)
│
└──► TASK 6 (Protection Node Update)
│
└──► TASK 8 (Integration Tests) ──► after TASK 3,4,5,6
```

**Execution order**: TASK 1 → TASK 2 + TASK 7 (parallel) → TASK 3 + TASK 4 + TASK 5 + TASK 6 (parallel) → TASK 8

## Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/modules/viis-device-protection/services/protection-gate-service.ts` | Core gate service |
| CREATE | `src/modules/viis-device-protection/tests/protection-gate-service.test.ts` | Unit tests |
| CREATE | `src/modules/viis-device-protection/tests/protection-gate-integration.test.ts` | Integration tests |
| MODIFY | `src/modules/viis-device-protection/services/configService.ts` | 3-level lookup |
| MODIFY | `src/modules/viis-rpc-control/handlers/rpcHandler.ts` | Gate check before coil write |
| MODIFY | `src/modules/schedule-executor-v2/viis-schedule-logic-v2/logic-control-service.ts` | Gate check in safety |
| MODIFY | `src/modules/schedule-executor-v2/viis-schedule-executor-v2/modbus-executor-service.ts` | Gate state update |
| MODIFY | `src/modules/viis-automation-node/services/processingService.ts` | Filter intent actions |
| MODIFY | `src/modules/viis-device-protection/viis-device-protection.ts` | Use shared gate service |

## Total Story Points: 24

| Task | Points | Priority |
|------|--------|----------|
| TASK 1: ProtectionGateService | 5 | Critical |
| TASK 2: Unit Tests | 3 | Critical |
| TASK 3: RPC Integration | 3 | High |
| TASK 4: Schedule Integration | 3 | High |
| TASK 5: Intent Integration | 2 | Medium |
| TASK 6: Protection Node Update | 3 | Medium |
| TASK 7: ConfigService Lookup | 2 | Medium |
| TASK 8: Integration Tests | 3 | High |
