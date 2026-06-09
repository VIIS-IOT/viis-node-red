# Protection Gate Integration — Schedule Executor V1

> Created: 2026-06-09
> Feature: Integrate ProtectionGateService into viis-schedule-executor v1

## Problem

V1 `viis-schedule-executor` ghi coil trực tiếp qua `modbusClient.writeCoil()` mà **không check protection gate**.

| Source | Current write path | Protection check |
|--------|-------------------|------------------|
| Schedule V2 | `logic-control-service.checkBeforeExecute()` | ✅ (code exists, wiring incomplete) |
| RPC (mobile) | `rpcHandler.handleModbusMappedParameter()` | ✅ (fully integrated) |
| Device Intent | `processingService.processIntents()` | ✅ (fully integrated) |
| **Schedule V1** | `scheduleService.executeModbusCommands()` | ❌ **None** |

**Race condition**: Coil gets ON → protection node detects 30s later → writes OFF. During 30s window, Min OFF Time and sensor limits are not enforced.

## Decisions

1. **Blocked commands**: Skip (remove from list), continue with remaining commands (same as V2 pattern)
2. **Reset coils**: OFF always allowed (`checkGate(OFF) = always allowed`), no gate check needed for reset
3. **canExecuteCommands()**: Keep disabled (`return true`), only add gate check

## Architecture

```
[viis-device-protection node]
  │  Creates ProtectionGateService(configKeyValues)
  │  Stores in global context: 'protectionGateService'
  │
  ▼
[viis-schedule-executor node]
  │  Gets gate from global context
  │  Injects into ScheduleService via setProtectionGate()
  │
  ▼
[ScheduleService.executeModbusCommands()]
  │  For each coil command (fc=5):
  │    1. checkGate(key, value, 'schedule')
  │    2. If blocked → skip, log, continue
  │    3. If allowed → writeCoil()
  │    4. After success → updateState()
  │
  ▼
[ScheduleService.resetModbusCommands()]
  │  Reset coils to OFF → checkGate always allows OFF
  │  No gate check needed (decision #2)
```

## Tasks

### TASK 1: Add ProtectionGateService Property + Setter to ScheduleService (Critical)

**File**: `src/modules/viis-schedule-executor/viis-schedule-executor-service.ts`

**What**: Add gate property and setter method to `ScheduleService` class, following the same pattern as `rpcHandler.ts:32,62-63`.

**Changes**:

1. **Import** (top of file):
```typescript
import { ProtectionGateService } from "../viis-device-protection/services/protection-gate-service";
```

2. **Property** (add near other class properties):
```typescript
private protectionGate: ProtectionGateService | null = null;
```

3. **Setter method** (add after constructor or near other public methods):
```typescript
setProtectionGate(gate: ProtectionGateService): void {
    this.protectionGate = gate;
}
```

**Points**: 1

**Acceptance Criteria**:
- [ ] `ProtectionGateService` imported
- [ ] `protectionGate` property declared (nullable)
- [ ] `setProtectionGate()` method exists
- [ ] No existing tests broken

---

### TASK 2: Add Gate Check in executeModbusCommands() (Critical)

**File**: `src/modules/viis-schedule-executor/viis-schedule-executor-service.ts`

**What**: Add `checkGate()` before each `writeCoil()` call and `updateState()` after successful write. Only check for coil commands (fc=5); holding register commands (fc=6) pass through unconditionally.

**Changes** — Apply to ALL 5 coil write locations in `executeModbusCommands()`:

**Pattern to apply** (before each `modbusClient.writeCoil()`):
```typescript
// Protection gate check
if (this.protectionGate && cmd.fc === 5) {
    const gate = this.protectionGate.checkGate(cmd.key, Boolean(cmd.value), 'schedule');
    if (!gate.allowed) {
        this.debugLog(`🛡️ Protection BLOCKED: ${cmd.key}=${cmd.value} - ${gate.reason}`);
        this.node.warn(`[PROTECTION] Schedule coil blocked: ${cmd.key} - ${gate.reason}`);
        continue; // Skip this command, move to next
    }
}
```

**Pattern to apply** (after each successful `writeCoil()`):
```typescript
// Update protection gate state
if (this.protectionGate && cmd.fc === 5) {
    this.protectionGate.updateState(cmd.key, Boolean(cmd.value));
}
```

**Locations to modify** (all inside `executeModbusCommands()`, lines 671-853):

| Location | Lines | Context | Coil type |
|----------|-------|---------|-----------|
| 1 | ~714-726 | Power coils (start sequence) | `powerCoils` |
| 2 | ~729-741 | Valve coils (start sequence) | `valveCoils` |
| 3 | ~744-752 | Other coils (start sequence) | `otherCoils` |
| 4 | ~760-769 | Pump coils (start sequence) | `pumpCoils` |
| 5 | ~837-852 | Default order (fallback) | all coils |

**Note**: The finish/reset sequence (lines 770-836) turns coils OFF. OFF is always allowed by gate, so no check needed there (decision #2).

**Helper approach** — To avoid repeating the gate check pattern 5 times, extract a helper method:

```typescript
private async writeCoilWithGate(
    modbusClient: ModbusClientCore,
    cmd: ModbusCmd,
    source: string = 'schedule'
): Promise<boolean> {
    // Protection gate check
    if (this.protectionGate && cmd.fc === 5) {
        const gate = this.protectionGate.checkGate(cmd.key, Boolean(cmd.value), source);
        if (!gate.allowed) {
            this.debugLog(`🛡️ Protection BLOCKED: ${cmd.key}=${cmd.value} - ${gate.reason}`);
            this.node.warn(`[PROTECTION] Schedule coil blocked: ${cmd.key} - ${gate.reason}`);
            return false; // Skipped
        }
    }

    // Write coil
    await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));

    // Update gate state after successful write
    if (this.protectionGate && cmd.fc === 5) {
        this.protectionGate.updateState(cmd.key, Boolean(cmd.value));
    }

    return true; // Written
}
```

Then replace each `modbusClient.writeCoil()` call with `await this.writeCoilWithGate(modbusClient, cmd)`.

**Points**: 3

**Acceptance Criteria**:
- [ ] All 5 coil write locations use gate check
- [ ] Blocked coils are skipped (not written to Modbus)
- [ ] Blocked coils logged via `node.warn()` with `[PROTECTION]` prefix
- [ ] `updateState()` called after successful coil write
- [ ] Holding register commands (fc=6) NOT checked by gate
- [ ] Finish/reset sequence (OFF commands) NOT checked (always allowed)
- [ ] Existing retry logic still works (3 attempts)
- [ ] Existing tests still pass

---

### TASK 3: Wire Gate in Node Constructor (Critical)

**File**: `src/modules/viis-schedule-executor/viis-schedule-executor.ts`

**What**: After creating `ScheduleService`, retrieve `ProtectionGateService` from global context and inject it.

**Change** — After line ~187 (after `scheduleService = new ScheduleService(...)`):

```typescript
// Connect to ProtectionGateService if available
const protectionGate = globalContext.get('protectionGateService') as ProtectionGateService | undefined;
if (protectionGate) {
    scheduleService.setProtectionGate(protectionGate);
    debugLog("ProtectionGateService connected to ScheduleService");
} else {
    debugLog("ProtectionGateService not found in global context — protection disabled");
}
```

**Also add import** (top of file):
```typescript
import { ProtectionGateService } from "../viis-device-protection/services/protection-gate-service";
```

**Points**: 1

**Acceptance Criteria**:
- [ ] Gate retrieved from `globalContext.get('protectionGateService')`
- [ ] `scheduleService.setProtectionGate()` called if gate exists
- [ ] Graceful fallback if gate not found (debug log, no error)
- [ ] No crash if `viis-device-protection` node not deployed

---

### TASK 4: Unit Tests (High)

**File**: `src/modules/viis-schedule-executor/tests/protection-gate-v1.test.ts`

**What**: Test gate integration in `executeModbusCommands()`.

**Scenarios**:

| # | Scenario | Expected |
|---|----------|----------|
| 1 | No gate set → writeCoil called normally | `writeCoil()` called, no gate check |
| 2 | Gate allows ON → writeCoil called | `writeCoil()` called, `updateState()` called |
| 3 | Gate blocks ON → writeCoil skipped | `writeCoil()` NOT called, `node.warn()` called |
| 4 | Mixed: 2 coils, 1 blocked, 1 allowed | Only allowed coil written |
| 5 | OFF command → always allowed (no gate check) | `writeCoil()` called |
| 6 | Holding register (fc=6) → no gate check | `writeRegister()` called, gate not consulted |
| 7 | `updateState()` called after successful write | Gate state updated with correct key/value |
| 8 | Gate not set → resetModbusCommands works normally | All coils reset to OFF |

**Mock setup**:
```typescript
const mockGate = {
    checkGate: jest.fn(),
    updateState: jest.fn(),
    refreshConfig: jest.fn(),
    syncCoilState: jest.fn(),
    updateSensorValue: jest.fn(),
    getProtectionConfigForCoil: jest.fn(),
    getSensorIdForCoil: jest.fn(),
    getCoilState: jest.fn(),
};

// In beforeEach:
scheduleService.setProtectionGate(mockGate as any);
```

**Points**: 2

**Acceptance Criteria**:
- [ ] All 8 scenarios pass
- [ ] Mock gate properly (jest.fn())
- [ ] Test both `executeModbusCommands()` and `writeCoilWithGate()` helper
- [ ] Test `setProtectionGate()` with null (gate not available)

---

## Dependency Graph

```
TASK 1 (Property + Setter)
│
├──► TASK 2 (Gate check in executeModbusCommands) ── depends on TASK 1
│
├──► TASK 3 (Wire in node constructor) ── depends on TASK 1
│
└──► TASK 4 (Unit tests) ── depends on TASK 1 + TASK 2
```

**Execution order**: TASK 1 → TASK 2 + TASK 3 (parallel) → TASK 4

## Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `src/modules/viis-schedule-executor/viis-schedule-executor-service.ts` | Add import, property, setter, gate check in `executeModbusCommands()` |
| MODIFY | `src/modules/viis-schedule-executor/viis-schedule-executor.ts` | Add import, retrieve gate from global context, inject into service |
| CREATE | `src/modules/viis-schedule-executor/tests/protection-gate-v1.test.ts` | Unit tests for gate integration |

## Total Story Points: 7

| Task | Points | Priority |
|------|--------|----------|
| TASK 1: Property + Setter | 1 | Critical |
| TASK 2: Gate check in executeModbusCommands | 3 | Critical |
| TASK 3: Wire in node constructor | 1 | Critical |
| TASK 4: Unit tests | 2 | High |

## Verification

```bash
# Run all tests
cd /home/phuongtung0801/viis/fe-be/viis-local-docker/services/nodered/custom-nodes/viis-node-red
npm test

# Run specific test
npm test -- --testPathPattern=protection-gate-v1

# Build check
npm run build
```
