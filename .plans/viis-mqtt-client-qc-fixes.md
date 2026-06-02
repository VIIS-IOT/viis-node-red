# Feature: viis-mqtt-client QC Fixes

> Generated: 2026-06-02
> Source: QC Report on `viis-mqtt-client` custom node
> Scope: Code quality improvements — NO logic changes, NO behavior changes

## Feature Summary

Fix all code quality issues found in `viis-mqtt-client` custom node identified during QC review. All fixes are safe, non-breaking improvements: memory leak patches, dead code removal, test coverage, and config enforcement. Zero changes to existing business logic or MQTT communication behavior.

**Out of Scope:**
- Changing MQTT connection/reconnection logic
- Modifying publish/subscribe behavior
- Altering message format or topic structure
- Refactoring MqttClientCore architecture
- Touching any other custom nodes

---

## Dependency Graph & Execution Order

```
VIIS-MQTT-QC-001 (Memory leak fix)          ← P0, no dependencies
VIIS-MQTT-QC-002 (Pending messages cap)      ← P0, no dependencies
VIIS-MQTT-QC-003 (Dead code cleanup)         ← P1, no dependencies
VIIS-MQTT-QC-004 (Backup limit enforcement)  ← P1, no dependencies
VIIS-MQTT-QC-005 (Hardcoded color + comments)← P2, no dependencies
VIIS-MQTT-QC-006 (Unit tests)                ← P0, depends on 001-004
```

All tasks 001-005 can be executed in parallel. Task 006 (tests) should come after fixes.

---

## Task 1: Fix Memory Leak — Remove `handleMessage` Listener on Close

| Field | Value |
|-------|-------|
| Type | Bug Fix |
| Key | VIIS-MQTT-QC-001 |
| Summary | `handleMessage` listener registered in subscribe mode is never removed on node close |
| Priority | Critical |
| Story Points | 2 |
| Parent | viis-mqtt-client-qc-fixes |
| Depends On | none |

### Description

In `viis-mqtt-client.ts`, subscribe mode registers `mqttClient.on("mqtt-message", handleMessage)` at line 151, but the close handler (lines 334-357) only removes `statusHandler`. The `handleMessage` listener persists after node redeploy → duplicate message processing + memory leak.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 1.1 | Store `handleMessage` reference in module-scoped variable (like `statusHandler`) | 0.5 |
| 1.2 | Remove `handleMessage` listener in `node.on("close")` before calling `unsubscribe` | 0.5 |
| 1.3 | Verify cleanup order: remove listener → unsubscribe → release client | 1 |

### Acceptance Criteria

- [ ] `handleMessage` is stored in a variable accessible to the close handler
- [ ] Close handler calls `mqttClient.removeListener("mqtt-message", handleMessage)` before unsubscribe
- [ ] No duplicate message handlers after node redeploy (manual test with 2 rapid redeploy cycles)
- [ ] Existing publish mode behavior unchanged

### Technical Notes

- Modified: `src/viis-mqtt-client.ts`
  - Add `let messageHandler: ((event: any) => void) | null = null;` alongside `statusHandler` (line ~73)
  - Assign `messageHandler = handleMessage;` after function definition (line ~149)
  - In close handler (line ~337), add: `if (messageHandler && mqttClient) { mqttClient.removeListener("mqtt-message", messageHandler); messageHandler = null; }`
- Pattern reference: `statusHandler` cleanup at lines 337-339 follows same pattern

---

## Task 2: Cap `pendingMessages` Queue Size

| Field | Value |
|-------|-------|
| Type | Bug Fix |
| Key | VIIS-MQTT-QC-002 |
| Summary | `pendingMessages` array grows unbounded during MQTT initialization |
| Priority | Critical |
| Story Points | 1 |
| Parent | viis-mqtt-client-qc-fixes |
| Depends On | none |

### Description

`pendingMessages: any[]` at line 74 has no size limit. If MQTT initialization takes long (ThingsBoard down, network issues), messages accumulate without bound. The `MqttClientCore` already has a `messageQueueSize` config (default 100) — the node-level queue should follow the same pattern.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 2.1 | Add `MAX_PENDING_MESSAGES = 100` constant | 0.5 |
| 2.2 | In `node.on("input")` queue branch, check length before push; drop oldest if full | 0.5 |

### Acceptance Criteria

- [ ] `pendingMessages` never exceeds 100 entries
- [ ] When queue is full, oldest message is dropped (with `node.warn`)
- [ ] No behavior change for normal operation (queue rarely exceeds 5-10 messages)

### Technical Notes

- Modified: `src/viis-mqtt-client.ts`
  - Add constant: `const MAX_PENDING_MESSAGES = 100;` near `MQTT_CONFIG` (line ~29)
  - In `node.on("input")` queue branch (line ~248), add cap check:
    ```typescript
    if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
      pendingMessages.shift();
      node.warn("Pending message queue full, dropping oldest message");
    }
    pendingMessages.push(msg);
    ```
- Pattern reference: `MqttClientCore.queueMessage()` at `mqtt-client.ts:383-390` uses same oldest-drop pattern

---

## Task 3: Remove Dead Code

| Field | Value |
|-------|-------|
| Type | Cleanup |
| Key | VIIS-MQTT-QC-003 |
| Summary | Remove unreachable code and commented-out blocks |
| Priority | Medium |
| Story Points | 1 |
| Parent | viis-mqtt-client-qc-fixes |
| Depends On | none |

### Description

Multiple dead code blocks found:
1. `viis-mqtt-client.ts:650-654` — state reset after `if (this.client)` block in `disconnect()` is unreachable
2. `mqtt-client.ts:686-702` — commented-out `registerMqttConfigNode` function
3. `mqtt-client.ts:577` — commented-out `this.node.log` in publish success

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 3.1 | Remove unreachable lines 650-654 in `mqtt-client.ts` disconnect() | 0.5 |
| 3.2 | Remove commented-out `registerMqttConfigNode` block (lines 686-702) | 0.25 |
| 3.3 | Remove commented-out log line 577 | 0.25 |

### Acceptance Criteria

- [ ] No unreachable code in `disconnect()` method
- [ ] No commented-out function blocks in `mqtt-client.ts`
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] No functional change — only dead code removal

### Technical Notes

- Modified: `src/core/mqtt-client.ts`
  - Lines 650-654: Delete the block (state reset that never executes after the `if (this.client)` promise)
  - Lines 686-702: Delete entire commented-out `registerMqttConfigNode` function
  - Line 577: Delete `// this.node.log(...)` comment
- These are pure deletions — no logic impact

---

## Task 4: Enforce `backupLimit` Config

| Field | Value |
|-------|-------|
| Type | Bug Fix |
| Key | VIIS-MQTT-QC-004 |
| Summary | `backupLimit` config field exists in HTML but is never enforced in code |
| Priority | Medium |
| Story Points | 2 |
| Parent | viis-mqtt-client-qc-fixes |
| Depends On | none |

### Description

The HTML editor defines `backupLimit` (line 12) and renders an input field (line 108-112), but the TypeScript code never reads or enforces it. Backups stored via `node.context().set(backupKey, ...)` grow without limit.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 4.1 | Read `config.backupLimit` in the node constructor | 0.5 |
| 4.2 | In backup logic (lines 268-275 and 310-317), enforce limit: count existing backups, prune oldest if exceeded | 1 |
| 4.3 | Add helper function `pruneBackups()` to avoid code duplication between MQTT and HTTP backup paths | 0.5 |

### Acceptance Criteria

- [ ] When `backupLimit > 0`, node.context() never stores more than `backupLimit` backup entries
- [ ] When `backupLimit === -1` (default), no limit is enforced (backward compatible)
- [ ] When `backupLimit === 0`, backups are disabled
- [ ] Oldest backups are pruned first (by timestamp in key name)
- [ ] Existing flows with `backupLimit: -1` behave exactly as before

### Technical Notes

- Modified: `src/viis-mqtt-client.ts`
  - Add `const backupLimit = config.backupLimit;` in constructor (after line ~61)
  - Add helper function:
    ```typescript
    function pruneBackups(): void {
      if (backupLimit < 0) return; // unlimited
      const keys = node.context().keys().filter(k => k.startsWith('backup_')).sort();
      while (keys.length >= backupLimit) {
        node.context().delete(keys.shift()!);
      }
    }
    ```
  - Call `pruneBackups()` before each `node.context().set(backupKey, ...)` (lines ~270 and ~313)
- Pattern reference: `MqttClientCore` message queue cap at `mqtt-client.ts:384`

---

## Task 5: Fix Hardcoded Color + Vietnamese Comments

| Field | Value |
|-------|-------|
| Type | Cleanup |
| Key | VIIS-MQTT-QC-005 |
| Summary | Replace hardcoded `#44C4A1` with token, convert Vietnamese comments to English |
| Priority | Low |
| Story Points | 0.5 |
| Parent | viis-mqtt-client-qc-fixes |
| Depends On | none |

### Description

1. `viis-mqtt-client.html:4` uses `color: "#44C4A1"` — should use CSS variable per design token migration
2. Several comments in `mqtt-client.ts` are in Vietnamese — project standard requires English

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 5.1 | Replace `#44C4A1` with `var(--color-primary, #44C4A1)` in HTML | 0.25 |
| 5.2 | Translate Vietnamese comments to English in `mqtt-client.ts` | 0.25 |

### Acceptance Criteria

- [ ] No hardcoded `#44C4A1` in `viis-mqtt-client.html`
- [ ] All comments in English across `mqtt-client.ts` and `viis-mqtt-client.ts`
- [ ] Visual appearance unchanged (fallback color preserved)

### Technical Notes

- Modified: `src/viis-mqtt-client.html` — line 4: `color: "#44C4A1"` → `color: "var(--color-primary, #44C4A1)"`
- Modified: `src/core/mqtt-client.ts` — translate these comments:
  - Line 548: `// Publish message, chỉ khi đã kết nối` → `// Publish message only when connected`
  - Line 586: `// Resubscribe tất cả các topic khi reconnect` → `// Resubscribe all topics on reconnect`
  - Line 680: `// Kiểm tra trạng thái kết nối` → `// Check connection status`

---

## Task 6: Add Unit Tests for viis-mqtt-client

| Field | Value |
|-------|-------|
| Type | Testing |
| Key | VIIS-MQTT-QC-006 |
| Summary | Write unit tests for viis-mqtt-client covering topic matching, message queuing, and lifecycle |
| Priority | Critical |
| Story Points | 5 |
| Parent | viis-mqtt-client-qc-fixes |
| Depends On | VIIS-MQTT-QC-001, 002, 003, 004 |

### Description

Zero tests exist for `viis-mqtt-client`. This is the most-used communication node (7 instances in standard flow). Tests should cover the pure logic functions and node lifecycle without requiring a real MQTT broker.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 6.1 | Create test file `src/tests/viis-mqtt-client.test.ts` | 0.5 |
| 6.2 | Test `matchTopic()` — exact match, `+` wildcard, `#` wildcard, no match, edge cases | 1 |
| 6.3 | Test message queuing — queue before ready, cap at MAX_PENDING_MESSAGES, flush on ready | 1 |
| 6.4 | Test node lifecycle — initialize with credentials, initialize without credentials (retry), close cleanup | 1 |
| 6.5 | Test backup feature — enable/disable, limit enforcement with `backupLimit` | 1 |
| 6.6 | Run full test suite: `npm test` — ensure no regressions | 0.5 |

### Acceptance Criteria

- [ ] Test file exists at `src/tests/viis-mqtt-client.test.ts`
- [ ] `matchTopic()` tests: 10+ cases covering all wildcard patterns
- [ ] Message queue tests: verify cap, oldest-drop, flush behavior
- [ ] Lifecycle tests: verify cleanup removes all listeners
- [ ] `npm test` passes with no failures
- [ ] Test coverage for `viis-mqtt-client.ts` > 70% line coverage

### Technical Notes

- New file: `src/tests/viis-mqtt-client.test.ts`
- Test helper: Use `node-red-node-test-helper` (already in devDependencies)
- Mock strategy:
  - Mock `ClientRegistry.getThingsboardMqttClient()` to return a fake `MqttClientCore` (EventEmitter-based)
  - Mock `viis-config-node` to return test credentials
  - No real MQTT broker needed
- Pattern reference: `src/modules/viis-schedule-executor/tests/mqtt-retry.test.ts` for MQTT mocking patterns
- Extract `matchTopic()` to a separate exportable utility so it can be tested independently

---

## Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| Modify | `src/viis-mqtt-client.ts` | Memory leak fix, pending queue cap, backup enforcement |
| Modify | `src/core/mqtt-client.ts` | Dead code removal, Vietnamese→English comments |
| Modify | `src/viis-mqtt-client.html` | Hardcoded color → CSS variable |
| Create | `src/tests/viis-mqtt-client.test.ts` | Unit tests |

## Verification

After all tasks complete:
1. `npx tsc --noEmit` — zero type errors
2. `npm test` — all tests pass
3. Manual: deploy to local Node-RED, verify publish/subscribe works as before
4. Manual: rapid redeploy (3x) — verify no duplicate message handlers in debug sidebar
