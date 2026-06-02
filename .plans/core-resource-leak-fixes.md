# Feature: Core Resource Leak & Bug Fixes

> Generated: 2026-06-02
> Source: Core files QC scan — 2 Critical, 5 High, 8 Medium, 4 Low issues
> Scope: Resource leak fixes, error handling, dead code cleanup — NO behavior changes

## Feature Summary

Fix all resource leaks, missing client releases, and logic bugs found in `src/core/` and consuming modules. The dominant pattern is nodes acquiring shared clients from `ClientRegistry` but never releasing them (or bypassing the registry on cleanup). This causes reference count leaks that accumulate with each Node-RED redeployment, eventually preventing proper connection cleanup.

**Out of Scope:**
- Changing ClientRegistry's singleton architecture
- Modifying MQTT/Modbus connection logic
- Adding new features or changing behavior
- Refactoring class hierarchies

---

## Dependency Graph & Execution Order

```
VIIS-CORE-001 (Missing releaseClient — Critical nodes)  ← P0, no deps
VIIS-CORE-002 (Direct disconnect bypass — TB MQTT)      ← P0, no deps
VIIS-CORE-003 (ConnectionMonitor unregister)             ← P0, no deps
VIIS-CORE-004 (deviceIntents error handling)             ← P1, no deps
VIIS-CORE-005 (modbus-client cleanup ordering)           ← P1, no deps
VIIS-CORE-006 (Dead code cleanup)                        ← P2, no deps
VIIS-CORE-007 (Regression tests)                         ← P1, after 001-005
```

Tasks 001-006 are independent (parallel). Task 007 (tests) runs after fixes.

---

## Task 1: Fix Missing `releaseClient` Calls (Critical)

| Field | Value |
|-------|-------|
| Type | Bug Fix |
| Key | VIIS-CORE-001 |
| Summary | 3 nodes acquire clients from ClientRegistry but never release them on close |
| Priority | Critical |
| Story Points | 3 |
| Parent | core-resource-leak-fixes |
| Depends On | none |

### Description

Three nodes acquire shared clients via `ClientRegistry.getXxxClient()` (incrementing reference counts) but their close handlers never call `releaseClient()`. Over N redeployments, ref counts grow to N and the shared connection is never cleaned up.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 1.1 | `viis-tfs-monitor.ts` — add `ClientRegistry.releaseClientV2('modbus-board', node, boardId)` in close handler | 0.5 |
| 1.2 | `scheduleHandler.ts` — track acquired clients, add `releaseClient` calls in a cleanup method | 1.5 |
| 1.3 | `notification.service.ts` — add `onCleanup()` override that calls `ClientRegistry.releaseClient('local', this.node)` | 1 |

### Acceptance Criteria

- [ ] `viis-tfs-monitor` close handler calls `releaseClientV2` for Modbus board
- [ ] `scheduleHandler` releases all 3 clients (Modbus, TB MQTT, local MQTT) after `updateSchedule` completes
- [ ] `notification.service` `onCleanup()` releases local MQTT client
- [ ] No ref count leak after node redeploy (verify with `ClientRegistry.logConnectionCounts`)

### Technical Notes

- Modified: `src/modules/viis-tfs-monitor/viis-tfs-monitor.ts`
  - Close handler (line 286-292): add `ClientRegistry.releaseClientV2('modbus-board', node, config.boardId || 'board1')` before `done()`
  - Store `config.boardId` in scope so close handler can reference it

- Modified: `src/modules/viis-crud-schedule/handlers/scheduleHandler.ts`
  - Lines 327, 340: `modbusClient` acquired but never released
  - Lines 378-379: `thingsboardClient` and `emqxClient` acquired but never released
  - Add a `finally` block after the MQTT publish try/catch (around line 389) that releases all 3 clients:
    ```typescript
    finally {
      if (modbusClient) ClientRegistry.releaseClientV2('modbus-board', this.node, defaultBoard);
      ClientRegistry.releaseClient('thingsboard', this.node);
      ClientRegistry.releaseClient('local', this.node);
    }
    ```
  - Need to store `defaultBoard` in scope for the release call

- Modified: `src/modules/viis-rest-api/services/notification.service.ts`
  - Add `onCleanup()` override (after line 240):
    ```typescript
    protected async onCleanup(): Promise<void> {
      if (this.mqttClient) {
        ClientRegistry.releaseClient('local', this.node);
        this.mqttClient = null;
      }
    }
    ```
  - Pattern reference: `thingsboard.service.ts:95-100` has the same pattern

---

## Task 2: Fix Direct `disconnect()` Bypassing Registry (High)

| Field | Value |
|-------|-------|
| Type | Bug Fix |
| Key | VIIS-CORE-002 |
| Summary | 2 nodes call `thingsboardMqttClient.disconnect()` directly instead of `ClientRegistry.releaseClient()` |
| Priority | High |
| Story Points | 2 |
| Parent | core-resource-leak-fixes |
| Depends On | none |

### Description

`viis-telemetry` and `viis-marine-telemetry` acquire ThingsBoard MQTT via `ClientRegistry.getThingsboardMqttClient()` but call `.disconnect()` directly on close. This bypasses the registry's reference counting — the registry still thinks the client is in use.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 2.1 | `viis-telemetry.ts` — replace `thingsboardMqttClient.disconnect()` with `ClientRegistry.releaseClient('thingsboard', node)` | 0.5 |
| 2.2 | `viis-marine-telemetry.ts` — same replacement | 0.5 |
| 2.3 | Verify no other nodes have the same pattern (grep for `.disconnect()` on registry-acquired clients) | 1 |

### Acceptance Criteria

- [ ] `viis-telemetry` close handler uses `ClientRegistry.releaseClient('thingsboard', node)` instead of direct `.disconnect()`
- [ ] `viis-marine-telemetry` close handler uses same pattern
- [ ] No other node calls `.disconnect()` on a registry-acquired client
- [ ] ThingsBoard ref count correctly reaches 0 when all nodes close

### Technical Notes

- Modified: `src/modules/viis-telemetry/viis-telemetry.ts`
  - Line 507: Replace `thingsboardMqttClient.disconnect();` with `ClientRegistry.releaseClient('thingsboard', node);`

- Modified: `src/modules/viis-marine-telemetry/viis-marine-telemetry.ts`
  - Line 416: Replace `thingsboardMqttClient.disconnect();` with `ClientRegistry.releaseClient('thingsboard', node);`

- Pattern reference: `viis-mqtt-client.ts` close handler already uses `ClientRegistry.releaseClient("thingsboard", node)` correctly

---

## Task 3: Fix ConnectionMonitor Memory Leak (High)

| Field | Value |
|-------|-------|
| Type | Bug Fix |
| Key | VIIS-CORE-003 |
| Summary | MqttClientCore registers with ConnectionMonitor but never unregisters on disconnect |
| Priority | High |
| Story Points | 2 |
| Parent | core-resource-leak-fixes |
| Depends On | none |

### Description

`MqttClientCore` constructor (line 104-106) calls `ConnectionMonitor.getInstance().registerClient(clientId, this, node)`. Neither `disconnect()` nor `forceDisconnect()` calls `unregisterClient()`. The ConnectionMonitor singleton holds a strong reference to every MqttClientCore forever, preventing garbage collection.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 3.1 | Store `clientId` as instance property in MqttClientCore constructor | 0.5 |
| 3.2 | Call `ConnectionMonitor.getInstance().unregisterClient(this.clientId)` in `disconnect()` | 0.5 |
| 3.3 | Call same in `forceDisconnect()` | 0.5 |
| 3.4 | Verify ConnectionMonitor stops its interval when no clients registered | 0.5 |

### Acceptance Criteria

- [ ] `disconnect()` calls `ConnectionMonitor.getInstance().unregisterClient(clientId)`
- [ ] `forceDisconnect()` calls same
- [ ] After all nodes close, ConnectionMonitor's monitoring interval stops (clients.size === 0)
- [ ] No strong reference leak to destroyed MqttClientCore instances

### Technical Notes

- Modified: `src/core/mqtt-client.ts`
  - Constructor (line 105): Add `this.monitoredClientId = clientId;` as instance property
  - `disconnect()` (around line 608): Add `ConnectionMonitor.getInstance().unregisterClient(this.monitoredClientId);` before `this.client.end()`
  - `forceDisconnect()` (around line 652): Add same call before `this.client.end(true)`
  - Add `private monitoredClientId: string = '';` to class properties

- ConnectionMonitor already has `unregisterClient()` at `connection-monitor.ts:52-63` which correctly stops monitoring when `clients.size === 0`

---

## Task 4: Fix deviceIntents Error Handling (High)

| Field | Value |
|-------|-------|
| Type | Bug Fix |
| Key | VIIS-CORE-004 |
| Summary | `processDeviceIntents()` returns Error object instead of throwing; missing `await` on recursive call |
| Priority | High |
| Story Points | 2 |
| Parent | core-resource-leak-fixes |
| Depends On | none |

### Description

Two bugs in `deviceIntents.ts`:
1. Line 260: `catch (error) { return error; }` — returns an Error object as if it were valid data. Callers that iterate over the result will get silent failures or TypeErrors.
2. Line 142: `this.traverseConditions(...)` is called without `await`. Since it's async, the recursive call's results may be incomplete when the parent returns, and errors become unhandled promise rejections.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 4.1 | Line 260: Change `return error` to `throw error` | 0.5 |
| 4.2 | Line 142: Add `await` before `this.traverseConditions(...)` | 0.5 |
| 4.3 | Verify callers handle the thrown error correctly | 1 |

### Acceptance Criteria

- [ ] `processDeviceIntents()` throws on error instead of returning Error object
- [ ] `traverseConditions()` recursive call is awaited
- [ ] Callers of `processDeviceIntents()` have try/catch or .catch() handling
- [ ] No unhandled promise rejections from recursive traversal

### Technical Notes

- Modified: `src/core/deviceIntents.ts`
  - Line 260: `return error;` → `throw error;`
  - Line 142: `this.traverseConditions(...)` → `await this.traverseConditions(...)`
  - Verify line 142's parent method `traverseConditions` is already `async` (it is)

---

## Task 5: Fix modbus-client Cleanup Ordering (Medium)

| Field | Value |
|-------|-------|
| Type | Bug Fix |
| Key | VIIS-CORE-005 |
| Summary | `cleanup()` calls `removeAllListeners()` before `close()` callback fires |
| Priority | Medium |
| Story Points | 1 |
| Parent | core-resource-leak-fixes |
| Depends On | none |

### Description

In `modbus-client.ts` `cleanup()` (lines 1396-1413), `this.client.close(callback)` is called, then `this.removeAllListeners()` is called immediately after — before the callback fires. The callback tries to emit events but all listeners are already removed.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 5.1 | Move `removeAllListeners()` inside the close callback, after state updates | 0.5 |
| 5.2 | Add `removeAllListeners()` to the catch block for the case where close throws | 0.5 |

### Acceptance Criteria

- [ ] `removeAllListeners()` is called AFTER `close()` callback completes
- [ ] Status events (`modbus-status: disconnected`) are emitted before listeners are removed
- [ ] No change to disconnect/reconnect behavior

### Technical Notes

- Modified: `src/core/modbus-client.ts`
  - Lines 1396-1413: Restructure to:
    ```typescript
    if (this.client && this.client.isOpen) {
      this.client.close(() => {
        this.wasConnected = this.isConnected;
        this.isConnected = false;
        if (this.wasConnected) {
          this.node.status({ fill: "grey", shape: "ring", text: "Disconnected" });
          this.emit("modbus-status", { status: "disconnected" });
        }
        this.node.log("[MODBUS-CLEANUP] Client connection closed");
        this.removeAllListeners(); // Move here
      });
    } else {
      this.removeAllListeners(); // No client to close, clean up immediately
    }
    ```

---

## Task 6: Dead Code Cleanup (Low)

| Field | Value |
|-------|-------|
| Type | Cleanup |
| Key | VIIS-CORE-006 |
| Summary | Remove empty files, unused functions, commented-out debug logs |
| Priority | Low |
| Story Points | 1 |
| Parent | core-resource-leak-fixes |
| Depends On | none |

### Description

- `src/core/viis-latest-device-data.ts` — empty file (0 lines)
- `src/core/viis-automation-core.ts` — empty file (0 lines)
- `src/core/deviceIntents.ts:188-194` — `stringifyAllValues()` defined but never called
- `src/core/client-registry.ts` — 40+ commented-out `//node.warn(...)` lines

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 6.1 | Delete empty files `viis-latest-device-data.ts` and `viis-automation-core.ts` | 0.25 |
| 6.2 | Remove unused `stringifyAllValues()` from deviceIntents.ts | 0.25 |
| 6.3 | Remove commented-out debug logs from client-registry.ts (keep the ones that are useful for debugging) | 0.5 |

### Acceptance Criteria

- [ ] Empty files deleted
- [ ] `stringifyAllValues()` removed
- [ ] Commented-out `//node.warn(...)` lines removed from client-registry.ts
- [ ] TypeScript compiles without errors

### Technical Notes

- Delete: `src/core/viis-latest-device-data.ts`, `src/core/viis-automation-core.ts`
- Modified: `src/core/deviceIntents.ts` — remove lines 188-194
- Modified: `src/core/client-registry.ts` — remove commented-out logging lines

---

## Task 7: Regression Tests

| Field | Value |
|-------|-------|
| Type | Testing |
| Key | VIIS-CORE-007 |
| Summary | Verify resource leak fixes with focused tests |
| Priority | High |
| Story Points | 3 |
| Parent | core-resource-leak-fixes |
| Depends On | VIIS-CORE-001, 002, 003, 004, 005 |

### Description

Write focused tests to verify the resource leak fixes don't regress. Focus on the ClientRegistry reference counting and ConnectionMonitor lifecycle.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 7.1 | Test: ClientRegistry ref count reaches 0 after all consumers release | 1 |
| 7.2 | Test: ConnectionMonitor unregisters clients on disconnect | 1 |
| 7.3 | Run full test suite, verify no regressions | 1 |

### Acceptance Criteria

- [ ] Test: acquire + release → ref count = 0
- [ ] Test: acquire + release → client disconnected
- [ ] Test: ConnectionMonitor stops monitoring when no clients
- [ ] `npm test` passes (no new failures)

### Technical Notes

- New file: `src/tests/core-resource-leak.test.ts`
- Mock MqttClientCore and ModbusClientCore for isolated testing
- Pattern reference: `src/tests/viis-mqtt-client.test.ts` for test structure

---

## Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| Modify | `src/modules/viis-tfs-monitor/viis-tfs-monitor.ts` | Add releaseClient in close handler |
| Modify | `src/modules/viis-crud-schedule/handlers/scheduleHandler.ts` | Add releaseClient for all 3 clients |
| Modify | `src/modules/viis-rest-api/services/notification.service.ts` | Add onCleanup() override |
| Modify | `src/modules/viis-telemetry/viis-telemetry.ts` | Replace direct disconnect with releaseClient |
| Modify | `src/modules/viis-marine-telemetry/viis-marine-telemetry.ts` | Replace direct disconnect with releaseClient |
| Modify | `src/core/mqtt-client.ts` | Add ConnectionMonitor unregister in disconnect/forceDisconnect |
| Modify | `src/core/deviceIntents.ts` | Fix error handling + missing await |
| Modify | `src/core/modbus-client.ts` | Fix cleanup ordering |
| Modify | `src/core/client-registry.ts` | Remove commented-out logs |
| Delete | `src/core/viis-latest-device-data.ts` | Empty file |
| Delete | `src/core/viis-automation-core.ts` | Empty file |
| Create | `src/tests/core-resource-leak.test.ts` | Regression tests |

## Verification

After all tasks complete:
1. `npx tsc --noEmit` — zero type errors
2. `npm test` — no new failures
3. Grep for `\.disconnect()` on registry-acquired clients — zero matches (all go through registry now)
4. Grep for `releaseClient` — verify all `getThingsboardMqttClient`/`getLocalMqttClient`/`getModbusClient` calls have matching releases
