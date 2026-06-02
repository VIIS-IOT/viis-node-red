# Feature: TCP Modbus Connection Limit Protection (ESP32 4-Client)

> Generated: 2026-06-02
> Source: TCP Modbus QC — ESP32 board max 4 concurrent TCP clients
> Scope: Connection management hardening — NO behavior changes to polling logic

## Feature Summary

Harden the TCP Modbus connection management to guarantee the gateway never exceeds 4 concurrent TCP connections to the ESP32 board. The root cause is two independent Modbus systems (native `modbus-client` + custom `viis-modbus-flex`) running in parallel with no coordination, combined with aggressive reconnection settings that create connection storms during failures.

**Out of Scope:**
- Changing polling intervals or register mappings
- Modifying Modbus read/write logic
- Adding new features to the flow
- Changing board firmware

---

## Dependency Graph & Execution Order

```
VIIS-MODBUS-001 (Disable duplicate native modbus-client)    ← P0, no deps
VIIS-MODBUS-002 (Connection limiter in ClientRegistry)       ← P0, no deps
VIIS-MODBUS-003 (Increase reconnect intervals)               ← P1, no deps
VIIS-MODBUS-004 (connectionCheckTimer guard)                 ← P1, no deps
VIIS-MODBUS-005 (Circuit breaker reconnect delay)            ← P1, no deps
VIIS-MODBUS-006 (Tests)                                      ← P1, after 001-005
```

Tasks 001-005 are independent (parallel). Task 006 runs after fixes.

---

## Task 1: Disable Duplicate Native modbus-client Nodes (Critical)

| Field | Value |
|-------|-------|
| Type | Configuration Fix |
| Key | VIIS-MODBUS-001 |
| Summary | Remove or disable duplicate native `modbus-client` config nodes that create extra TCP connections |
| Priority | Critical |
| Story Points | 1 |
| Parent | tcp-modbus-connection-limit |
| Depends On | none |

### Description

The TCP flow has **3 native `modbus-client` config nodes** defined:
- `0666fc121cb8c370` — "Slave 1" TCP to `192.168.1.199:502` (ENABLED)
- `494512ee39e2e195` — "Modbus RTU" serial (DISABLED, `d: true`)
- `934499d2478e940b` — "Slave 1" TCP to `192.168.1.199:502` (ENABLED)

Nodes 1 and 3 are duplicates — both create TCP connections to the same board. Combined with the custom `viis-modbus-flex` system, this creates 3 baseline connections. During failures, this easily exceeds the 4-client limit.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 1.1 | Disable duplicate native `modbus-client` node `934499d2478e940b` (set `"d": true`) | 0.25 |
| 1.2 | Verify which native `modbus-flex-getter` nodes reference which config — ensure only 1 active native config per board | 0.5 |
| 1.3 | Document: if native modbus nodes are no longer needed, recommend full removal in future cleanup | 0.25 |

### Acceptance Criteria

- [ ] Only 1 native `modbus-client` config node active per board IP
- [ ] Native `modbus-flex-getter` nodes reference the correct (non-duplicate) config
- [ ] Total baseline TCP connections to board = 2 (1 native + 1 custom)

### Technical Notes

- Modified: `services/flows/standard_flows_tcp.json`
  - Line 489: Set `"d": true` on modbus-client `934499d2478e940b`
  - Verify lines referencing this config ID in `modbus-flex-getter` nodes

---

## Task 2: Add Connection Limiter in ClientRegistry (Critical)

| Field | Value |
|-------|-------|
| Type | Safety Feature |
| Key | VIIS-MODBUS-002 |
| Summary | Add global connection counter that refuses new TCP connections if ≥ 3 already open to same host:port |
| Priority | Critical |
| Story Points | 3 |
| Parent | tcp-modbus-connection-limit |
| Depends On | none |

### Description

Currently, `ClientRegistry` tracks connections per board ID but has no global limit on TCP connections to a given host:port. The native `modbus-client` system is completely untracked. A connection limiter acts as a hard safety net — even if the native system creates extra connections, the custom system will refuse to open more.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 2.1 | Add `connectionCount: Map<string, number>` to `ClientRegistry` — key is `host:port` | 0.5 |
| 2.2 | Add `MAX_CONNECTIONS_PER_HOST = 3` constant (leave 1 slot for native system) | 0.5 |
| 2.3 | In `getModbusBoardClient()`, check count before creating new `ModbusClientCore` | 1 |
| 2.4 | Increment count on connection open, decrement on disconnect/release | 0.5 |
| 2.5 | Add `getConnectionCount(host:port)` diagnostic method | 0.5 |

### Acceptance Criteria

- [ ] `ClientRegistry` tracks total TCP connections per `host:port`
- [ ] If count ≥ 3, `getModbusBoardClient()` throws descriptive error instead of creating connection
- [ ] Count decrements when `releaseClientV2` is called or connection drops
- [ ] Diagnostic method returns current count for monitoring

### Technical Notes

- Modified: `src/core/client-registry.ts`
  - Add `private static hostConnectionCount: Map<string, number> = new Map()` near line 38
  - Add `private static readonly MAX_CONNECTIONS_PER_HOST = 3` constant
  - In `getModbusBoardClient()` (around line 352), before creating `new ModbusClientCore()`:
    ```typescript
    const hostKey = `${boardConfig.host}:${boardConfig.tcpPort}`;
    const currentCount = this.hostConnectionCount.get(hostKey) || 0;
    if (currentCount >= this.MAX_CONNECTIONS_PER_HOST) {
      throw new Error(`[MODBUS-CONNECTION-LIMIT] Max ${this.MAX_CONNECTIONS_PER_HOST} connections to ${hostKey}. Current: ${currentCount}`);
    }
    ```
  - Increment in `getModbusBoardClient()` after connection creation
  - Decrement in `releaseClientV2()` and on `modbus-status: disconnected` event
- Pattern reference: `boardReferenceCount` tracking at line 38

---

## Task 3: Increase Reconnect Intervals (High)

| Field | Value |
|-------|-------|
| Type | Configuration |
| Key | VIIS-MODBUS-003 |
| Summary | Increase `MIN_RECONNECT_INTERVAL` and native `reconnectTimeout` to prevent connection storms |
| Priority | High |
| Story Points | 1 |
| Parent | tcp-modbus-connection-limit |
| Depends On | none |

### Description

Current reconnect intervals are too aggressive for an ESP32 board:
- Custom: `MIN_RECONNECT_INTERVAL = 5000ms` (line 65) — too fast for TCP TIME_WAIT
- Native: `reconnectTimeout: 2000ms` (flow config) — dangerously fast

TCP TIME_WAIT is typically 60 seconds on Linux. The board's TCP stack may not handle rapid reconnection.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 3.1 | Increase `MIN_RECONNECT_INTERVAL` from 5000 → 15000 in `modbus-client.ts` | 0.25 |
| 3.2 | Increase `quickReconnectTime` from 5000 → 15000 in `scheduleReconnect()` | 0.25 |
| 3.3 | Update native `reconnectTimeout` from 2000 → 15000 in flow config | 0.25 |
| 3.4 | Update native `clientTimeout` from 1000 → 3000 in flow config | 0.25 |

### Acceptance Criteria

- [ ] `MIN_RECONNECT_INTERVAL` = 15000ms
- [ ] `quickReconnectTime` = 15000ms
- [ ] Native `reconnectTimeout` = 15000ms
- [ ] Native `clientTimeout` = 3000ms
- [ ] No connection storm during board restart (manual test)

### Technical Notes

- Modified: `src/core/modbus-client.ts`
  - Line 65: `MIN_RECONNECT_INTERVAL = 5000` → `15000`
  - Line 881: `quickReconnectTime = 5000` → `15000`
- Modified: `services/flows/standard_flows_tcp.json`
  - Lines 409-410: `reconnectTimeout: "2000"` → `"15000"`, `clientTimeout: "1000"` → `"3000"`
  - Lines 509-510: Same for duplicate config

---

## Task 4: Add connectionCheckTimer Guard (Medium)

| Field | Value |
|-------|-------|
| Type | Race Condition Fix |
| Key | VIIS-MODBUS-004 |
| Summary | Skip `connectionCheckTimer` if `handleError()` is currently executing |
| Priority | Medium |
| Story Points | 1 |
| Parent | tcp-modbus-connection-limit |
| Depends On | none |

### Description

The `connectionCheckTimer` (every 15s) can independently call `initializeClient()` while `handleError()` is still cleaning up the old connection. This creates concurrent connection attempts. The timer already skips `CONNECTING` and `RECONNECTING` states but doesn't skip the `ERROR` state.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 4.1 | Add `ConnectionState.ERROR` check to `connectionCheckTimer` guard | 0.5 |
| 4.2 | Add `ConnectionState.CIRCUIT_BREAKER_OPEN` check | 0.5 |

### Acceptance Criteria

- [ ] `connectionCheckTimer` skips when `connectionState === ConnectionState.ERROR`
- [ ] `connectionCheckTimer` skips when `connectionState === ConnectionState.CIRCUIT_BREAKER_OPEN`
- [ ] No concurrent `initializeClient()` calls during error recovery

### Technical Notes

- Modified: `src/core/modbus-client.ts`
  - Lines 1012-1016: Add to the guard:
    ```typescript
    if (this.isInitializing ||
        this.connectionState === ConnectionState.CONNECTING ||
        this.connectionState === ConnectionState.RECONNECTING ||
        this.connectionState === ConnectionState.ERROR ||
        this.connectionState === ConnectionState.CIRCUIT_BREAKER_OPEN) {
      return;
    }
    ```

---

## Task 5: Add Delay After Circuit Breaker Reset (Medium)

| Field | Value |
|-------|-------|
| Type | Safety Feature |
| Key | VIIS-MODBUS-005 |
| Summary | Add random jitter delay before reconnecting after circuit breaker reset |
| Priority | Medium |
| Story Points | 1 |
| Parent | tcp-modbus-connection-limit |
| Depends On | none |

### Description

When the circuit breaker resets (60s timeout), it calls `scheduleReconnect()` which immediately attempts a 5s quick reconnect. If the native system also reconnects at the same time, both hit the board simultaneously. Adding a random jitter (0-10s) spreads the reconnection attempts.

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 5.1 | Add jitter delay (0-10s random) before `scheduleReconnect()` in circuit breaker reset | 0.5 |
| 5.2 | Log the jitter delay for debugging | 0.5 |

### Acceptance Criteria

- [ ] Circuit breaker reset adds random 0-10s delay before reconnecting
- [ ] Delay is logged: `"[MODBUS] Circuit breaker reset, reconnecting in Xms (jitter)"`
- [ ] Native and custom systems don't reconnect simultaneously

### Technical Notes

- Modified: `src/core/modbus-client.ts`
  - Around line 968 (circuit breaker reset):
    ```typescript
    const jitter = Math.floor(Math.random() * 10000);
    this.node.log(`[MODBUS] Circuit breaker reset, reconnecting in ${jitter}ms (jitter)`);
    setTimeout(() => {
      this.scheduleReconnect();
    }, jitter);
    ```

---

## Task 6: Regression Tests

| Field | Value |
|-------|-------|
| Type | Testing |
| Key | VIIS-MODBUS-006 |
| Summary | Verify connection limit protection with focused tests |
| Priority | High |
| Story Points | 3 |
| Parent | tcp-modbus-connection-limit |
| Depends On | VIIS-MODBUS-001, 002, 003, 004, 005 |

### Subtasks

| # | Subtask | Points |
|---|---------|--------|
| 6.1 | Test: ClientRegistry refuses connection when count ≥ 3 | 1 |
| 6.2 | Test: connection count decrements on release | 1 |
| 6.3 | Test: connectionCheckTimer skips during ERROR state | 1 |

### Acceptance Criteria

- [ ] Test: 4th connection attempt to same host:port throws error
- [ ] Test: release decrements count, allows new connection
- [ ] Test: timer skips when state is ERROR
- [ ] `npm test` passes

### Technical Notes

- New file: `src/tests/tcp-connection-limit.test.ts`
- Mock `ModbusClientCore` for isolated testing

---

## Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| Modify | `services/flows/standard_flows_tcp.json` | Disable duplicate modbus-client, increase timeouts |
| Modify | `src/core/modbus-client.ts` | Increase reconnect intervals, add timer guard, circuit breaker jitter |
| Modify | `src/core/client-registry.ts` | Add connection limiter |
| Create | `src/tests/tcp-connection-limit.test.ts` | Connection limit tests |

## Verification

After all tasks complete:
1. `npx tsc --noEmit` — zero type errors
2. `npm test` — no new failures
3. Manual: deploy to local, verify only 2 TCP connections to board (native + custom)
4. Manual: simulate board disconnect → verify no connection storm (check board serial log)
5. Manual: check `ClientRegistry.getConnectionCount()` returns ≤ 2
