# Fertilizer EC Control - Operational Flow Documentation

**Module**: `viis-fertilizer-ec-control`
**Version**: 2.0.0
**Last Updated**: February 4, 2026
**Author**: IoT Development Team

---

## ⚠️ CRITICAL DESIGN PRINCIPLE

**This system does NOT use real-time closed-loop control.**

**Control Strategy**: **Feedforward + Open-Loop + Post-Run Learning**

```
┌─────────────────────────────────────────────────────────────┐
│  START (Feedforward)                                        │
│  • Lookup table: predict valve times from history          │
│  • Write valve times ONCE to Modbus                        │
│  • PLC takes control autonomously                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  RUNNING (Open-Loop)                                        │
│  • PLC pulses valves per cycle_EC (e.g., 6s cycle)         │
│  • Node-RED ONLY reads sensors (NO Modbus writes)          │
│  • Context window collects EC data for analysis            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STOP (Post-Run Learning)                                   │
│  • Calculate avg EC achieved vs target                     │
│  • Update lookup table with results                        │
│  • Next run will have better prediction                    │
└─────────────────────────────────────────────────────────────┘
```

**Why No Real-Time Adjustment?**
1. ❌ RTU bus saturation (115200 baud)
2. ❌ Breaks PLC cyclic timing
3. ❌ EC sensor lag causes oscillation
4. ✅ Feedforward + learning converges in 2-3 runs

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Data Flow](#data-flow)
4. [State Machine](#state-machine)
5. [Core Algorithms](#core-algorithms)
6. [Global Context Integration](#global-context-integration)
7. [Modbus Communication](#modbus-communication)
8. [Database Operations](#database-operations)
9. [Backend Synchronization](#backend-synchronization)
10. [Error Handling](#error-handling)
11. [Configuration](#configuration)
12. [Testing](#testing)

---

## 1. Overview

### Purpose
Automatic fertilizer dosing control system using **feedforward prediction with post-run adaptive learning**. Valve times are predicted from historical data, executed **open-loop by PLC** during irrigation, then lookup table is updated after completion for future runs.

### Key Features
- **Feedforward control** - predicts valve times from lookup table
- **Open-loop execution** - PLC handles cyclic valve pulsing autonomously (no real-time adjustment)
- **Post-run learning** - updates lookup table after each run based on achieved EC
- **Multi-valve support** (up to 5 fertilizer channels)
- **Lookup table interpolation** for historical valve time patterns
- **Context window averaging** - noise-resistant EC measurement (used for post-run analysis)
- **Global context integration** - reads sensor data from centralized polling flow (no RTU bus contention)
- **RTU-optimized** - safe inter-write delays for Modbus RTU at 115200 baud (only during START command)

### Control Strategy
```
Run #1: Target EC = 1.8 mS/cm
│
├─ START: Feedforward (lookup table)
│   └─ Retrieve historical valve times for 1.8 EC → Write ONCE to PLC
│
├─ RUNNING: Open-loop execution (PLC autonomous)
│   ├─ PLC pulses valves per cycle_EC (e.g., 6s cycle)
│   └─ Node-RED ONLY reads sensors (no Modbus writes)
│
└─ STOP: Post-run learning
    ├─ Calculate avg EC achieved (e.g., 1.65 mS/cm)
    └─ Update lookup table: {ec_setpoint: 1.8, achieved: 1.65, valve_times: [...]}

Run #2: Same target EC = 1.8 mS/cm
│
└─ START: Improved prediction from updated lookup table
    └─ Interpolated valve times now closer to target
```

---

## 2. Architecture

### 2.1 Component Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                   viis-fertilizer-ec-control                 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┐        ┌─────────────────────┐     │
│  │  Finite State       │        │  Service Layer      │     │
│  │  Machine (FSM)      │◄──────►│                     │     │
│  │                     │        │  ├─ LookupTableSvc  │     │
│  │  States:            │        │  ├─ ContextWindowSvc│     │
│  │  - IDLE             │        │  ├─ IrrigationRunSvc│     │
│  │  - RAMPING_UP       │        │  └─ BackendSyncSvc  │     │
│  │  - RUNNING          │        │                     │     │
│  │  - STOPPING         │        │                     │     │
│  │  - ERROR            │        └─────────────────────┘     │
│  └─────────────────────┘                                    │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           Global Context Reader                     │    │
│  │  (Reads from polling flow - no duplicate Modbus)    │    │
│  └─────────────────────────────────────────────────────┘    │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │    Modbus Writer (RTU-safe delays, WRITE ONCE)     │    │
│  │  - Used ONLY at START command                      │    │
│  │  - 100ms inter-write delay for RTU                 │    │
│  │  - Valve time validation before write              │    │
│  │  - NO writes during RUNNING state                  │    │
│  └─────────────────────────────────────────────────────┘    │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           TypeORM Database Layer                    │    │
│  │  - LookupTable (EC → valve times mapping)           │    │
│  │  - IrrigationRun (historical run data)              │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Service Responsibilities

| Service | Responsibility |
|---------|---------------|
| **LookupTableService** | CRUD operations on lookup table, find best match for target EC |
| **ContextWindowService** | Sliding window for EC averaging, noise filtering |
| **IrrigationRunService** | Track irrigation sessions, calculate total volume/EC stats |
| **BackendSyncService** | Sync data to cloud backend via REST API |

---

## 3. Data Flow

### 3.1 High-Level Flow

```
┌─────────────────────┐
│  Polling Flow       │
│  (separate Node-RED │
│   flow)             │
│                     │
│  Polls Modbus every │
│  2s (realtime)      │
│  5s (volume)        │
└──────────┬──────────┘
           │
           │ Stores data in global context
           ▼
┌─────────────────────────────────────────┐
│  Global Context                         │
│  ┌───────────────────────────────────┐  │
│  │ holdingRegisterData: {            │  │
│  │   board1: {                       │  │
│  │     current_ec: 18,  (1.8 mS/cm)  │  │
│  │     current_flow_1: 500,          │  │
│  │     set_ec: 20,                   │  │
│  │     ...                           │  │
│  │     timestamp: 1706976123456      │  │
│  │   }                               │  │
│  │ }                                 │  │
│  └───────────────────────────────────┘  │
└──────────┬──────────────────────────────┘
           │
           │ Read every 1s (TCP) or 2s (RTU)
           ▼
┌─────────────────────────────────────────┐
│  Fertilizer EC Control Node             │
│                                         │
│  1. Read sensors from global context    │
│  2. Update context window (20 samples)  │
│  3. Calculate average EC                │
│  4. Compare with target EC              │
│  5. Adjust valve times if needed        │
│  6. Write valve times to Modbus         │
│  7. Update lookup table                 │
└──────────┬──────────────────────────────┘
           │
           │ Writes valve times (100ms delays)
           ▼
┌─────────────────────┐
│  Modbus RTU         │
│  (PLC at 115200)    │
│                     │
│  Registers:         │
│  - time_on_valve_01 │
│  - time_on_valve_02 │
│  - ...              │
└─────────────────────┘
```

### 3.2 Detailed Data Flow Steps

**Step 1: Initialization**
```typescript
// Node created → Load config from Node-RED
config = {
  boardId: 'board1',
  enableControl: true,
  targetEC: 1.8,
  valveCount: 5
}

// Initialize services
lookupTableService = new LookupTableService(dataSource);
contextWindowService = new ContextWindowService(CONTEXT_WINDOW_SIZE);
irrigationRunService = new IrrigationRunService(dataSource);
```

**Step 2: Start Irrigation (FSM: IDLE → RAMPING_UP)**
```typescript
// User triggers START via msg.payload.command = 'start'
msg = {
  payload: {
    command: 'start',
    targetEC: 1.8,
    boardId: 'board1'
  }
}

// 1. Validate state transition
// 2. Lookup historical valve times from database
// 3. Write valve times to Modbus (with RTU delays) - ⚠️ ONLY ONCE
// 4. Start polling interval (1s TCP / 2s RTU) - READ ONLY

// ⚠️ CRITICAL: Valve times written ONCE at start
// PLC then controls valves autonomously via cycle_EC
```

**Step 3: Monitoring Loop (every 1-2 seconds) - READ ONLY**
```typescript
// Read from global context (NOT direct Modbus)
const holdingData = global.get('holdingRegisterData');
const boardData = holdingData[boardId];

// Validate data freshness (< 30s old)
if (Date.now() - boardData.timestamp > 30000) {
  node.error('Stale global context data');
  return;
}

// Extract sensor values (already scaled by polling flow)
const currentEC = boardData.current_ec;
const currentFlow1 = boardData.current_flow_1;
const targetEC = boardData.set_ec;

// Add to context window (20 samples)
contextWindowService.addSample(currentEC);

// Calculate average EC (skip first 20s ramp-up)
if (elapsedTime > RAMP_UP_SECONDS) {
  const avgEC = contextWindowService.getAverage();
  const deviation = targetEC - avgEC;

  // Log deviation for monitoring (NO Modbus writes)
  if (Math.abs(deviation) > ADJUSTMENT_THRESHOLD) {
    node.log(`EC deviation: ${deviation.toFixed(3)} mS/cm`);
  }

  // ⚠️ CRITICAL: NO valve time adjustments during run
  // PLC handles open-loop control via cycle_EC
  // Adjustments will be applied to NEXT run via lookup table update
}
```

**Step 4: Post-Run Update (FSM: STOPPING → IDLE)**
```typescript
// User triggers STOP or irrigation completes
// Get final statistics from context window
const stats = contextWindowService.getStats();
const avgEC = stats.avgEc;  // e.g., 1.75 mS/cm (target was 1.8)

// Complete irrigation run in database
await irrigationRunService.completeRun({
  runId: currentRun.id,
  ecAchievedAvg: avgEC,
  flowAverages: stats.flowAverages
});

// ⚠️ CRITICAL: Update lookup table for FUTURE runs
// This is where learning happens - NOT during active irrigation
await lookupTableService.updateWithRunData(
  targetEC,        // What we wanted: 1.8 mS/cm
  avgEC,           // What we achieved: 1.75 mS/cm
  currentValveTimes, // What valve times we used
  stats.flowAverages
);

// Next time user starts irrigation with same target EC:
// → Lookup table will interpolate better valve times
// → Prediction will be: "To get 1.8, need slightly MORE than last time"

// FSM: STOPPING → IDLE
controlContext.state = 'IDLE';
```

**Step 5: Backend Sync + Lookup Table Update (Async, Non-Blocking)**
```typescript
// After updating local lookup table, sync to cloud backend
try {
  // Get updated run record from database
  const updatedRun = await runService.getRunById(currentRun.id);

  if (updatedRun) {
    // 1. POST to backend: /api/fertilizer/irrigation-finished
    // Backend receives: device_id, start_time, end_time, ec_setpoint
    const synced = await syncService.reportIrrigationFinished(updatedRun);

    if (synced) {
      // Mark run as synced in local database
      await runService.markAsSynced(currentRun.id);

      // ✅ 2. NEW: Fetch updated lookup table from backend
      // Backend has:
      //   - Learned from this irrigation (weighted average + adaptive adjustment)
      //   - Aggregated data from other devices (if multi-device farm)
      //   - Applied linear interpolation for missing EC points
      try {
        const updatedLookupTable = await syncService.fetchLookupTable();
        if (updatedLookupTable && updatedLookupTable.length > 0) {
          // Merge with local lookup table
          for (const point of updatedLookupTable) {
            await lookupService.updateOrCreateFromServer(point);
          }
          node.log(`✅ Synced ${updatedLookupTable.length} lookup points from backend`);
        }
      } catch (syncTableError) {
        // Lookup table sync failure is NOT critical
        // Gateway continues using local lookup table
        node.warn(`⚠️ Failed to sync lookup table: ${syncTableError.message}`);
      }
    }
  }
} catch (syncError) {
  // ⚠️ CRITICAL: Sync failure does NOT block irrigation completion
  // Data is safely stored in local MySQL
  // Will retry later via syncPendingRuns()
  debugLog(`Sync failed, will retry later: ${syncError.message}`);
}

// Irrigation completes normally regardless of sync status
```

**Lookup Table Sync Flow:**
```
┌─ Irrigation completes
│
├─ Gateway local update (weighted average)
│  └─ DB: lookup_table updated
│
├─ POST /api/fertilizer/irrigation-finished
│  └─ Server: learns + optimizes
│     ├─ Weighted average update
│     ├─ Adaptive adjustment (±50ms based on deviation)
│     ├─ Linear interpolation for intermediate EC points
│     └─ Aggregates from multiple devices (if fleet deployment)
│
├─ Gateway GET /api/fertilizer/:deviceId/lookup-table
│  └─ Fetch server's optimized lookup table
│
├─ Merge server data with local
│  ├─ Prefer server's learned valve times
│  ├─ Keep local sample_count if higher
│  └─ Mark as synced_at = now
│
└─ Next irrigation uses improved lookup table
   └─ Better predictions due to Backend's learning algorithm
```

**Why 2-stage learning?**

| Stage | Component | Algorithm |
|-------|-----------|-----------|
| **Stage 1 (Local - Offline)** | Gateway | Weighted average of local runs |
| **Stage 2 (Global - Learning)** | Backend | Adaptive adjustment + interpolation + multi-device aggregation |

Gateway learns quickly from its own data. Backend learns deeply from fleet patterns.


**Code Evidence** (viis-fertilizer-ec-control.ts, line 500-510):
```typescript
// Try to sync to backend
try {
    const updatedRun = await runService.getRunById(controlContext.currentRun.id);
    if (updatedRun) {
        const synced = await syncService.reportIrrigationFinished(updatedRun);
        if (synced) {
            await runService.markAsSynced(controlContext.currentRun.id);
        }
    }
} catch (syncError) {
    debugLog(`Sync failed, will retry later: ${(syncError as Error).message}`);
}
```

---

## 4. State Machine

### 4.1 States

```
┌────────────────────────────────────────────────────────────┐
│                     State Diagram                          │
└────────────────────────────────────────────────────────────┘

          ┌──────┐
   ┌─────►│ IDLE │◄─────┐
   │      └───┬──┘      │
   │          │         │
   │ STOP     │ START   │ ERROR / STOP
   │          ▼         │
   │   ┌──────────────┐ │
   │   │ RAMPING_UP   │ │
   │   │ (skip 20s)   │ │
   │   └──────┬───────┘ │
   │          │         │
   │ Ramp-up  │         │
   │ complete │         │
   │          ▼         │
   │   ┌──────────────┐ │
   └───┤   RUNNING    ├─┘
       │ (open-loop)  │
       └──────┬───────┘
              │
              │ CRITICAL ERROR
              ▼
       ┌──────────────┐
       │    ERROR     │
       └──────┬───────┘
              │
              │ Manual reset
              ▼
          ┌──────┐
          │ IDLE │
          └──────┘
```

### 4.2 State Transitions

| Current State | Trigger | Next State | Actions |
|---------------|---------|------------|---------|
| IDLE | `msg.command = 'start'` | RAMPING_UP | Lookup table → Write valve times **ONCE** → Start polling |
| RAMPING_UP | 20s elapsed | RUNNING | Skip ramp-up period → Begin EC averaging |
| RUNNING | `msg.command = 'stop'` | STOPPING | Stop polling → Calculate avg EC → Update lookup table |
| STOPPING | Cleanup complete | IDLE | Reset context window → Save irrigation run |
| ANY | Critical error | ERROR | Log error → Send notification → Require manual reset |
| ERROR | Manual reset | IDLE | Clear error state |

### 4.3 State Guards

```typescript
// Validate state transition before executing
function validateTransition(from: State, to: State, trigger: string): boolean {
  const validTransitions = {
    'IDLE': ['RAMPING_UP'],
    'RAMPING_UP': ['RUNNING', 'ERROR'],
    'RUNNING': ['STOPPING', 'ERROR'],
    'STOPPING': ['IDLE'],
    'ERROR': ['IDLE']  // Manual reset only
  };

  return validTransitions[from].includes(to);
}

// ⚠️ NOTE: No ADJUSTING or MONITORING states
// System uses feedforward + open-loop + post-run learning
// NOT closed-loop real-time control
```

---

## 5. Core Algorithms

### 5.1 Feedforward + Open-Loop + Post-Run Learning Strategy

**Problem**:
- Pure feedback control on RTU bus causes contention and breaks PLC timing
- Real-time adjustments conflict with PLC's autonomous cyclic control

**Solution**:
- **Feedforward prediction** from lookup table at START
- **Open-loop execution** by PLC during irrigation (no Node-RED interference)
- **Post-run learning** updates lookup table for next time

```typescript
// ========== PHASE 1: START (Feedforward) ==========
const lookupEntry = await lookupTableService.findClosestMatch(targetEC);
const predictedValveTimes = lookupEntry?.valveTimes || DEFAULT_VALVE_TIMES;

// Write valve times ONCE to PLC
await writeValveTimes(predictedValveTimes);

// Write control mode to enable PLC autonomous control
await writeControlMode(CONTROL_MODES.EC);

// ========== PHASE 2: RUNNING (Open-Loop) ==========
// PLC handles cyclic valve pulsing autonomously
// Example: cycle_EC = 10 (6 second cycle)
//   → PLC opens valve for time_on_valve_01 ms every 6 seconds
//   → Node-RED does NOT interfere

while (running) {
  // Read sensors from global context (NO Modbus writes)
  const readings = await readSensors();

  // Add to context window for post-run analysis
  contextWindowService.addSample(readings.current_ec);

  // ⚠️ NO valve time adjustments here
  // Log deviations for monitoring only
  const avgEC = contextWindowService.getAverage();
  const deviation = targetEC - avgEC;

  if (Math.abs(deviation) > ADJUSTMENT_THRESHOLD) {
    debugLog(`EC deviation: ${deviation.toFixed(3)} mS/cm (no action taken)`);
  }
}

// ========== PHASE 3: STOP (Post-Run Learning) ==========
const stats = contextWindowService.getStats();

// Update lookup table with actual results
await lookupTableService.updateWithRunData(
  targetEC,           // What we wanted: 1.8 mS/cm
  stats.avgEc,        // What we got: 1.75 mS/cm
  predictedValveTimes, // What valve times we used: [3000, 2500, ...]
  stats.flowAverages
);

// Next run with same target EC will use interpolated valve times
// based on this run's results → better prediction
```

### 5.2 Context Window Averaging

**Purpose**: Filter sensor noise, prevent over-aggressive adjustments.

```typescript
class ContextWindowService {
  private window: number[] = [];
  private maxSize: number = 20;  // 20 samples × 2s = 40s window

  addSample(value: number) {
    this.window.push(value);
    if (this.window.length > this.maxSize) {
      this.window.shift();  // Remove oldest
    }
  }

  getAverage(): number {
    if (this.window.length === 0) return 0;

    const sum = this.window.reduce((a, b) => a + b, 0);
    return sum / this.window.length;
  }
}
```

**Example**:
```
Raw EC readings: [1.72, 1.85, 1.74, 1.88, 1.76, ...]
                  └─────────────────┬────────────────┘
                              20 samples
                                  │
                                  ▼
                          Average = 1.79 mS/cm
```

### 5.3 Why No Real-Time Adjustment?

**Design Decision**: Originally considered proportional adjustment during irrigation, but **rejected** for these reasons:

1. **RTU Bus Contention**:
   - Multiple Modbus writes during run would saturate 115200 baud RTU bus
   - Conflicts with polling flow's scheduled reads
   - Risk of timeout errors and communication failures

2. **PLC Timing Interference**:
   - PLC relies on stable `time_on_valve_XX` registers for cyclic control
   - Changing these mid-run breaks PLC's internal state machine
   - Could cause valve actuation glitches

3. **EC Sensor Lag**:
   - EC sensor has ~10-20s response lag after valve adjustment
   - Real-time feedback would oscillate due to lag
   - Context window averaging (20s+) is incompatible with real-time control

4. **Better Alternative**:
   - Feedforward from lookup table gives good initial guess (± 0.1 mS/cm typical)
   - Post-run learning continuously improves predictions
   - Convergence after 2-3 runs for stable target EC

**Code Evidence** (line 571-574):
```typescript
// If running, monitor EC deviation for telemetry (no real-time adjustment)
// PLC handles open-loop control via cycle_EC - no Modbus writes during run
if (controlContext.state === 'RUNNING' && added) {
    const deviation = contextService.getEcDeviation(controlContext.targetEc);
    // Log only - no writeValveTimes() calls
}
```

---

## 6. Global Context Integration

### 6.1 Design Rationale

**Problem**: Multiple Node-RED nodes polling same Modbus PLC causes:
- RTU bus contention (only one master can read at a time)
- Increased latency and timeout errors
- Inefficient resource usage

**Solution**: Centralized polling flow + shared global context.

### 6.2 Architecture

```
┌──────────────────────────────────────────────────────────┐
│           Polling Flow (separate flow)                   │
│                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │  Realtime   │  │   Volume    │  │   Config    │      │
│  │  (2s poll)  │  │  (5s poll)  │  │ (5min poll) │      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │
│         │                │                │              │
│         └────────────────┴────────────────┘              │
│                         │                                │
│                         ▼                                │
│              ┌──────────────────────┐                    │
│              │  Modbus Read (RTU)   │                    │
│              └──────────┬───────────┘                    │
│                         │                                │
│                         ▼                                │
│              ┌──────────────────────┐                    │
│              │ Global Context Store │                    │
│              │                      │                    │
│              │ holdingRegisterData  │                    │
│              │ coilRegisterData     │                    │
│              └──────────────────────┘                    │
└───────────────────────┬──────────────────────────────────┘
                        │
                        │ Read-only access
                        ▼
┌───────────────────────────────────────────────────────────┐
│        Consumer Nodes (no Modbus polling)                 │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Fertilizer   │  │ Telemetry    │  │ RPC Control  │   │
│  │ EC Control   │  │ Collector    │  │              │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### 6.3 Data Structure

```typescript
// Global context format (stored by polling flow)
interface GlobalHoldingData {
  [boardId: string]: {
    // Raw sensor values
    current_ec: number;       // EC × 10 (18 = 1.8 mS/cm)
    current_flow_1: number;
    current_flow_2: number;
    set_ec: number;
    set_ph: number;
    // ... other registers

    // Metadata
    timestamp: number;        // Unix timestamp (ms)
  };
}

// Example
{
  "board1": {
    "current_ec": 18,
    "current_flow_1": 520,
    "set_ec": 20,
    "timestamp": 1706976123456
  }
}
```

### 6.4 Read Implementation

```typescript
function readSensors(node: Node, boardId: string): SensorData | null {
  // Get global context data
  const holdingData = node.context().global.get('holdingRegisterData');

  if (!holdingData || !holdingData[boardId]) {
    node.error(`No global data for board: ${boardId}`);
    return null;
  }

  const boardData = holdingData[boardId];

  // Validate data freshness (< 10s old)
  const age = Date.now() - boardData.timestamp;
  if (age > GLOBAL_DATA_MAX_AGE) {
    node.warn(`Stale data (age: ${age}ms)`);
    return null;
  }

  // Extract and scale values
  return {
    currentEC: boardData.current_ec / EC_SCALE_FACTOR,
    currentFlow1: boardData.current_flow_1,
    targetEC: boardData.set_ec / EC_SCALE_FACTOR,
    timestamp: boardData.timestamp
  };
}
```

### 6.5 Benefits

| Aspect | Before (Direct Polling) | After (Global Context) |
|--------|------------------------|------------------------|
| RTU Bus Load | 5+ nodes × 1s = 5 req/s | 1 polling flow = 0.5 req/s |
| Latency | Random timeouts | Predictable reads |
| Code Complexity | Each node implements Modbus | Read from shared context |
| Data Consistency | Stale/mismatched values | Single source of truth |

---

## 7. Modbus Communication

### 7.1 Register Mapping

**Holding Registers (Read/Write)**
```
Address | Key                | Type   | Scale | Description
--------|-------------------|--------|-------|---------------------------
0       | control_mode      | uint16 | 1     | 0=Manual, 1=Flow, 2=EC
1       | set_ec            | uint16 | 10    | Target EC (18 = 1.8 mS/cm)
10      | time_on_valve_01  | uint16 | 1     | Valve 1 ON time (ms)
11      | time_on_valve_02  | uint16 | 1     | Valve 2 ON time (ms)
12      | time_on_valve_03  | uint16 | 1     | Valve 3 ON time (ms)
13      | time_on_valve_04  | uint16 | 1     | Valve 4 ON time (ms)
14      | time_on_valve_05  | uint16 | 1     | Valve 5 ON time (ms)
20      | cycle_ec          | uint16 | 1     | Cycle period (10 = 6s)
```

**Input Registers (Read-only)**
```
Address | Key               | Type   | Scale | Description
--------|------------------|--------|-------|---------------------------
0       | current_flow_1    | uint16 | 1     | Flow sensor 1 (L/min)
14      | current_ec        | uint16 | 10    | Current EC (18 = 1.8)
15      | current_ph        | uint16 | 10    | Current pH (70 = 7.0)
```

### 7.2 RTU Write Safety

**Challenge**: Modbus RTU at 115200 baud needs inter-message delays.

**Implementation**:
```typescript
async function writeValveTimes(valveTimes: number[]): Promise<void> {
  const registers = [
    'time_on_valve_01',
    'time_on_valve_02',
    'time_on_valve_03',
    'time_on_valve_04',
    'time_on_valve_05'
  ];

  for (let i = 0; i < valveTimes.length; i++) {
    // Validate before write
    if (!validateValveTime(valveTimes[i])) {
      throw new Error(`Invalid valve time: ${valveTimes[i]}`);
    }

    // Write single register
    await modbusHelper.writeHoldingRegister(
      boardId,
      registers[i],
      valveTimes[i]
    );

    // RTU inter-write delay (100ms)
    await delay(EC_CONTROL_DEFAULTS.RTU_INTER_WRITE_DELAY);
  }

  // Final settle delay (50ms)
  await delay(EC_CONTROL_DEFAULTS.RTU_WRITE_SETTLE_DELAY);
}

function validateValveTime(value: number): boolean {
  return value >= MIN_VALVE_TIME && value <= MAX_VALVE_TIME;
}
```

**Timing Breakdown** (5 valves):
```
Write valve 1: 0ms
Delay: 100ms
Write valve 2: 100ms
Delay: 100ms
Write valve 3: 200ms
Delay: 100ms
Write valve 4: 300ms
Delay: 100ms
Write valve 5: 400ms
Settle delay: 50ms
─────────────────────
Total: 550ms
```

---

## 8. Database Operations

### 8.1 Schema

> **Note**: Entity definitions match backend `tabiot_fertilizer_*` tables exactly.

**TabiotFertilizerLookupPoint Entity** (see `src/orm/entities/fertilizer/TabiotFertilizerLookupPoint.ts`)
```typescript
@Entity('tabiot_fertilizer_lookup_point')
@Unique(['device_id', 'ec_setpoint'])
export class TabiotFertilizerLookupPoint {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  device_id: string;

  @Column({ type: 'decimal', precision: 4, scale: 2 })
  ec_setpoint: number;  // e.g., 1.80 mS/cm

  // ========================================
  // Valve ON times per cycle (milliseconds)
  // Maps to Modbus holding registers 23-27
  // NOTE: 5 separate columns, NOT a JSON array
  // ========================================
  @Column({ type: 'int', default: 0 })
  time_on_valve_01: number;  // Valve 1 - Modbus reg 23

  @Column({ type: 'int', default: 0 })
  time_on_valve_02: number;  // Valve 2 - Modbus reg 24

  @Column({ type: 'int', default: 0 })
  time_on_valve_03: number;  // Valve 3 - Modbus reg 25

  @Column({ type: 'int', default: 0 })
  time_on_valve_04: number;  // Valve 4 - Modbus reg 26

  @Column({ type: 'int', default: 0 })
  time_on_valve_05: number;  // Valve 5 - Modbus reg 27

  // ========================================
  // Achieved values (from actual runs)
  // ========================================
  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  actual_ec_avg?: number;  // Average EC achieved

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  actual_flow_01?: number;  // Flow rate valve 1 - Modbus reg 30

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  actual_flow_02?: number;  // Flow rate valve 2 - Modbus reg 31

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  actual_flow_03?: number;  // Flow rate valve 3 - Modbus reg 32

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  actual_flow_04?: number;  // Flow rate valve 4 - Modbus reg 33

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  actual_flow_05?: number;  // Flow rate valve 5 - Modbus reg 34

  // ========================================
  // Metadata
  // ========================================
  @Column({ type: 'int', default: 0 })
  sample_count: number;  // # of runs contributing to this point

  @Column({ type: 'enum', enum: ['Actual', 'Interpolated'], default: 'Interpolated' })
  data_type: 'Actual' | 'Interpolated';

  @Column({ type: 'datetime', nullable: true })
  last_server_sync?: Date;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  last_updated: Date;
}
```

**TabiotFertilizerIrrigationRun Entity** (see `src/orm/entities/fertilizer/TabiotFertilizerIrrigationRun.ts`)
```typescript
@Entity('tabiot_fertilizer_irrigation_run')
@Index(['device_id', 'start_time'])
@Index(['is_synced_to_server', 'status'])
export class TabiotFertilizerIrrigationRun {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  device_id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  schedule_name?: string;

  // ========================================
  // EC Setpoint and Achieved
  // ========================================
  @Column({ type: 'decimal', precision: 4, scale: 2 })
  ec_setpoint: number;  // e.g., 1.80 mS/cm

  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  ec_achieved_avg?: number;  // Average EC (after 20s ramp-up)

  // ========================================
  // Achieved Flow Rates (averages after ramp-up)
  // 5 separate columns, NOT a JSON array
  // ========================================
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  flow_achieved_01_avg?: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  flow_achieved_02_avg?: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  flow_achieved_03_avg?: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  flow_achieved_04_avg?: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  flow_achieved_05_avg?: number;

  // ========================================
  // Valve Times Used (5 separate columns)
  // ========================================
  @Column({ type: 'int', default: 0 })
  time_on_valve_01: number;

  @Column({ type: 'int', default: 0 })
  time_on_valve_02: number;

  @Column({ type: 'int', default: 0 })
  time_on_valve_03: number;

  @Column({ type: 'int', default: 0 })
  time_on_valve_04: number;

  @Column({ type: 'int', default: 0 })
  time_on_valve_05: number;

  // ========================================
  // Timing
  // ========================================
  @Column({ type: 'datetime' })
  start_time: Date;

  @Column({ type: 'datetime', nullable: true })
  end_time?: Date;

  @Column({ type: 'int', nullable: true })
  duration_seconds?: number;

  // ========================================
  // Status and Sync
  // ========================================
  @Column({ type: 'enum', enum: ['Running', 'Completed', 'Failed', 'Interrupted'] })
  status: 'Running' | 'Completed' | 'Failed' | 'Interrupted';

  @Column({ type: 'tinyint', default: 0 })
  is_synced_to_server: number;  // 1 = synced, 0 = pending

  @Column({ type: 'datetime', nullable: true })
  synced_at?: Date;
}
```

### 8.2 Lookup Table Operations

> **Note**: These are simplified examples. See `LookupTableService.ts` for actual implementation.

**Get Valve Times for EC (with Linear Interpolation)**
```typescript
// Actual implementation in LookupTableService.getValveTimesForEc()
async getValveTimesForEc(targetEc: number): Promise<InterpolationResult> {
  // Get all lookup points sorted by EC
  const points = await this.repository.find({
    where: { device_id: this.deviceId },
    order: { ec_setpoint: 'ASC' },
  });

  if (points.length === 0) {
    return { valveTimes: DEFAULT_VALVE_TIMES, confidence: 'default' };
  }

  // 1. Check for exact match first
  const exactMatch = points.find(p => Math.abs(p.ec_setpoint - targetEc) < 0.001);
  if (exactMatch) {
    return { valveTimes: this.extractValveTimes(exactMatch), confidence: 'exact' };
  }

  // 2. Find surrounding points for interpolation
  const lowerPoints = points.filter(p => p.ec_setpoint < targetEc);
  const upperPoints = points.filter(p => p.ec_setpoint > targetEc);
  const lower = lowerPoints[lowerPoints.length - 1];  // highest below target
  const upper = upperPoints[0];                        // lowest above target

  // 3. Linear interpolation between two points
  if (lower && upper) {
    const ratio = (targetEc - lower.ec_setpoint) / (upper.ec_setpoint - lower.ec_setpoint);

    const valveTimes = {
      time_on_valve_01: Math.round(lower.time_on_valve_01 + ratio * (upper.time_on_valve_01 - lower.time_on_valve_01)),
      time_on_valve_02: Math.round(lower.time_on_valve_02 + ratio * (upper.time_on_valve_02 - lower.time_on_valve_02)),
      time_on_valve_03: Math.round(lower.time_on_valve_03 + ratio * (upper.time_on_valve_03 - lower.time_on_valve_03)),
      time_on_valve_04: Math.round(lower.time_on_valve_04 + ratio * (upper.time_on_valve_04 - lower.time_on_valve_04)),
      time_on_valve_05: Math.round(lower.time_on_valve_05 + ratio * (upper.time_on_valve_05 - lower.time_on_valve_05)),
    };

    return { valveTimes, lowerPoint: lower, upperPoint: upper, confidence: 'interpolated' };
  }

  // 4. Extrapolate if only one bound available
  if (lower) return { valveTimes: this.extractValveTimes(lower), confidence: 'extrapolated' };
  if (upper) return { valveTimes: this.extractValveTimes(upper), confidence: 'extrapolated' };

  return { valveTimes: DEFAULT_VALVE_TIMES, confidence: 'default' };
}
```

**Update Lookup Point with Run Data (Weighted Average)**
```typescript
// Actual implementation in LookupTableService.updateWithRunData()
async updateWithRunData(
  ecSetpoint: number,
  achievedEc: number,
  valveTimes: ValveTimes,
  flowAverages: { [key: string]: number }
): Promise<void> {
  let point = await this.repository.findOne({
    where: { device_id: this.deviceId, ec_setpoint: ecSetpoint }
  });

  if (point) {
    // Weighted average update
    const oldCount = point.sample_count;
    const newCount = oldCount + 1;

    // Update achieved EC average
    point.actual_ec_avg = (point.actual_ec_avg * oldCount + achievedEc) / newCount;

    // Update flow averages
    for (let i = 1; i <= 5; i++) {
      const flowKey = `actual_flow_0${i}`;
      const oldFlow = point[flowKey];
      const newFlow = flowAverages[`flow_${i}`];
      if (newFlow !== undefined) {
        point[flowKey] = (oldFlow * oldCount + newFlow) / newCount;
      }
    }

    // Adaptive valve time adjustment based on EC deviation
    const ecDeviation = achievedEc - ecSetpoint;
    if (Math.abs(ecDeviation) > ADJUSTMENT_THRESHOLD) {
      const adjustment = ecDeviation > 0 ? -ADJUSTMENT_STEP : ADJUSTMENT_STEP;
      point.time_on_valve_01 += adjustment;
      point.time_on_valve_02 += adjustment;
      // ... etc for all valves
    }

    point.sample_count = newCount;
    point.data_type = 'Actual';
    point.last_updated = new Date();

  } else {
    // Create new point
    point = this.repository.create({
      device_id: this.deviceId,
      ec_setpoint: ecSetpoint,
      ...valveTimes,
      actual_ec_avg: achievedEc,
      ...flowAverages,
      sample_count: 1,
      data_type: 'Actual',
    });
  }

  await this.repository.save(point);
}
```

---

## 9. Backend Synchronization

### 9.1 Architecture Overview

**Design Pattern**: **Local-First with Async Cloud Sync + Learning Feedback Loop**

```
┌───────────────────────────────────────────────────────────────────┐
│  Edge Device (Offline-Capable, Real-Time Learning)               │
│                                                                   │
│  ┌────────────────┐         ┌────────────────┐                   │
│  │ Fertilizer EC  │────────►│  Local MySQL   │                   │
│  │ Control Node   │         │  Database      │ (Weighted avg)    │
│  └────────┬───────┘         └────────┬───────┘                   │
│           │                          │                           │
│           │ (1) POST /irrigation-    │ (3) GET /lookup-table     │
│           │     finished (async)     │ (updated from server)     │
│           └─────────┬────────────────┼─────────────────────┐    │
│                     │                │                     │    │
└─────────────────────┼────────────────┼─────────────────────┼────┘
                      │                │                     │
                      │                │                     │
                      ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloud Backend (iot.viis.tech) - Global Learning               │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ (1) Receive POST /api/fertilizer/irrigation-finished    │  │
│  │     device_id, start_time, end_time, ec_setpoint        │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         │                                     │
│                         ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ (2) Learning Algorithm (FertilizerMachineService)       │  │
│  │     ├─ Fetch telemetry from ThingsBoard (skip 20s)     │  │
│  │     ├─ Weighted average update                          │  │
│  │     ├─ Adaptive adjustment (±50ms based on EC delta)    │  │
│  │     ├─ Linear interpolation for intermediate EC points  │  │
│  │     └─ Aggregate multi-device data (fleet learning)     │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         │                                     │
│                         ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Updated lookup_table in PostgreSQL                       │  │
│  │ (Optimized valve times + achieved EC/flow averages)     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                         │                                     │
└─────────────────────────┼─────────────────────────────────────┘
                          │
                          │ Gateway polls periodically
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  (3) Edge Device receives updated lookup table                 │
│      ├─ Merge server-learned valve times (prefer server)       │
│      ├─ Update local lookup table (TabiotFertilizerLookupPoint)│
│      └─ next_irrigation uses improved predictions              │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 Two-Stage Learning System

| Learning Stage | Component | Algorithm | Data Source |
|----------------|-----------|-----------|-------------|
| **Stage 1: Local** | Gateway (Node-RED) | Weighted average | Current device only |
| **Stage 2: Global** | Backend Server | Adaptive + interpolation + aggregation | All devices in fleet |

**Benefits**:
- 🟢 Fast: Gateway learns from own data immediately (offline-capable)
- 🔵 Deep: Backend learns from fleet patterns (multi-device optimization)
- 🟣 Convergence: Combined learning improves predictions exponentially

### 9.3 Sync Trigger & Timing

**When**: After each irrigation run completes successfully

**Where**: In `stopIrrigation()` function (line 500-530)

**Sequence**:
```
1. Complete irrigation run in local DB      ✅ CRITICAL (persist first)
2. Update lookup table in local DB          ✅ CRITICAL (weighted average)
3. Try sync to backend (POST)               ⚠️ OPTIONAL (non-blocking)
   ├─ Success → Fetch updated lookup table (GET)
   │  ├─ Merge server-learned data
   │  └─ next_irrigation benefits from global learning
   └─ Failure → Use local lookup table, retry on next run
4. Reset state to IDLE                      ✅ ALWAYS
```

### 9.4 Backend Learning Algorithm (FertilizerMachineService)

**Source**: Backend repository `src/modules/fertilizer-machine/FertilizerMachineService.ts`

#### Stage 1: Weighted Average Update
```typescript
// Line 183-193
if (currentPoint) {
  const n = currentPoint.sample_count;

  // Weighted average: new_avg = (old_avg * n + new_value) / (n + 1)
  currentPoint.actual_ec_avg = (currentPoint.actual_ec_avg * n + achievedEC) / (n + 1);
  currentPoint.actual_flow_01 = (currentPoint.actual_flow_01 * n + flow_01) / (n + 1);
  // ... flow_02-05

  currentPoint.sample_count = n + 1;
}
```

#### Stage 2: Adaptive Adjustment (±50ms)
```typescript
// Line 196-212
const threshold = 0.05;     // 0.05 mS/cm
const adjustmentStep = 50;  // 50ms
const delta = achievedEC - ecSetpoint;

if (Math.abs(delta) > threshold) {
  const multiplier = delta > 0 ? -1 : 1;  // High EC → decrease, Low EC → increase

  currentPoint.time_on_valve_01 += adjustmentStep * multiplier;
  // ... valve_02-05

  Logger.info(`Adjusted valve times: ${adjustmentStep * multiplier}ms (EC delta: ${delta})`);
}
```

**Example:**
```
Target EC: 1.80 mS/cm
Achieved EC: 1.75 mS/cm (too low, delta = -0.05)
Action: Increase valve times by 50ms
Result: Next run will dose more fertilizer
```

#### Stage 3: Linear Interpolation
```typescript
// Line 73-125
// For each interpolated point between actual points:
const ratio = (targetEC - lower.ec_setpoint) / (upper.ec_setpoint - lower.ec_setpoint);
interpolatedPoint.time_on_valve_01 = Math.round(
  lower.time_on_valve_01 + ratio * (upper.time_on_valve_01 - lower.time_on_valve_01)
);
```

### 9.5 Lookup Table Fetch & Merge (NEW)

**Method**: `BackendSyncService.fetchLookupTable()`

```typescript
async fetchLookupTable(): Promise<LookupPoint[]> {
  const endpoint = API_ENDPOINTS.GET_LOOKUP_TABLE.replace(':deviceId', this.deviceId);

  try {
    const response = await this.httpClient.get(endpoint);

    if (Array.isArray(response.data)) {
      this.log(`Fetched ${response.data.length} lookup points from backend`);
      return response.data;
    }

    return [];
  } catch (error) {
    this.error(`Failed to fetch lookup table: ${error.message}`);
    return [];
  }
}
```

**Merge Strategy**: `LookupTableService.updateOrCreateFromServer()`

```typescript
async updateOrCreateFromServer(serverPoint: LookupPoint): Promise<void> {
  // 1. If point exists locally: MERGE (prefer server's learned valve times)
  if (existingPoint) {
    existingPoint.time_on_valve_01 = serverPoint.time_on_valve_01;  // ← Use server's optimized value
    existingPoint.actual_ec_avg = serverPoint.actual_ec_avg;
    // ... etc for all columns

    existingPoint.last_server_sync = new Date();
    await this.repository.save(existingPoint);
  }

  // 2. If point is NEW from server: CREATE it locally
  else {
    const newPoint = this.repository.create({
      ...serverPoint,
      device_id: this.deviceId,
      last_server_sync: new Date(),
    });
    await this.repository.save(newPoint);
  }
}
```

### 9.6 Request/Response Format

**API Endpoints**:

| Endpoint | Method | Purpose | Called After |
|----------|--------|---------|--------------|
| `/api/fertilizer/irrigation-finished` | POST | Report completion to Backend | Every irrigation completes |
| `/api/fertilizer/:deviceId/lookup-table` | GET | Fetch optimized lookup table | After successful POST |

**Payload - POST /irrigation-finished**:
```json
{
  "device_id": "device1",
  "start_time": "2026-02-04T10:30:00.000Z",
  "end_time": "2026-02-04T10:45:00.000Z",
  "ec_setpoint": 1.8
}
```

**Response - GET /lookup-table** (200 OK):
```json
[
  {
    "device_id": "device1",
    "ec_setpoint": 1.5,
    "time_on_valve_01": 2000,
    "time_on_valve_02": 1500,
    "time_on_valve_03": 1800,
    "time_on_valve_04": 1600,
    "time_on_valve_05": 1700,
    "actual_ec_avg": 1.48,
    "actual_flow_01": 520.5,
    "actual_flow_02": 480.3,
    "actual_flow_03": 510.2,
    "actual_flow_04": 490.1,
    "actual_flow_05": 505.0,
    "sample_count": 12,
    "data_type": "Actual",
    "last_updated": "2026-02-04T10:45:00.000Z"
  },
  {
    "ec_setpoint": 1.8,
    "time_on_valve_01": 2250,
    ...
  },
  {
    "ec_setpoint": 1.65,
    "time_on_valve_01": 2100,
    "data_type": "Interpolated"  // ← Generated by Backend
    ...
  }
]
```

### 9.7 Offline Operation

| Scenario | Action | Result |
|----------|--------|--------|
| Backend unreachable | Use local lookup table | ✅ Continues normally, learns locally |
| POST fails | Retry on next run via `syncPendingRuns()` | ✅ Data not lost |
| GET fails after POST | Keep local version | ⚠️ Misses 1 optimization cycle |
| Network recovers | Auto-retry pending syncs | ✅ Eventual consistency |

---

}
```

**Error Response** (4xx/5xx):
```json
{
  "success": false,
  "error": "Invalid device_id",
  "code": "DEVICE_NOT_FOUND"
}
```

### 9.5 Retry Mechanism

#### A. Failed Sync Handling

**Immediate failure** (in `stopIrrigation()`):
```typescript
try {
    const synced = await syncService.reportIrrigationFinished(updatedRun);
    if (synced) {
        await runService.markAsSynced(currentRun.id);
    }
} catch (syncError) {
    // ⚠️ Does NOT throw - irrigation completes normally
    debugLog(`Sync failed, will retry later: ${syncError.message}`);
}
```

**Database tracking**:
```sql
-- irrigation_run table
| id | device_id | start_time | end_time | synced_to_backend |
|----|-----------|------------|----------|-------------------|
| 1  | device1   | ...        | ...      | true              |
| 2  | device1   | ...        | ...      | false             | ← Failed sync
| 3  | device1   | ...        | ...      | false             | ← Offline
```

#### B. Batch Retry

**Method**: `syncPendingRuns(runs: IrrigationRun[])`

```typescript
async syncPendingRuns(runs: IrrigationRun[]): Promise<number[]> {
    const syncedIds: number[] = [];

    for (const run of runs) {
        if (run.status !== 'Completed') continue;
        if (!run.end_time) continue;

        const success = await this.reportIrrigationFinished(run);
        if (success && run.id) {
            syncedIds.push(run.id);
        }

        // Small delay between requests to avoid rate limiting
        await this.delay(500);
    }

    this.log(`Synced ${syncedIds.length}/${runs.length} pending runs`);
    return syncedIds;
}
```

**Trigger scenarios**:
1. **Scheduled job**: Cron job runs every 1 hour
2. **Network recovery**: When backend becomes reachable
3. **Manual trigger**: Admin command from Node-RED UI

**Example usage**:
```typescript
// Get all unsynced runs from last 7 days
const pendingRuns = await runService.getUnsyncedRuns(7);

// Retry sync
const syncedIds = await syncService.syncPendingRuns(pendingRuns);

// Mark as synced in database
for (const id of syncedIds) {
    await runService.markAsSynced(id);
}
```

### 9.6 Backend Data Processing

**What backend does** (server-side):

1. **Receive irrigation data** from edge device
2. **Fetch additional details** from edge database via API (optional)
   - Actual valve times used
   - Actual EC achieved (avg)
   - Flow rates for each valve
   - Sample count, ramp-up time, etc.
3. **Aggregate data** from multiple devices
   - Same crop type, same EC target
   - Different soil conditions, water quality
4. **Run learning algorithm**:
   - Weighted average of successful runs
   - Outlier detection and removal
   - Regression analysis for interpolation
5. **Update global lookup table**
6. **Optional: Push recommendations** back to edge
   - Updated valve times for common EC setpoints
   - Calibration adjustments

### 9.7 ThingsBoard Integration (Alternative/Supplementary)

**Purpose**: Real-time monitoring and manual configuration

#### A. Read Lookup Table from ThingsBoard

**API**: `GET http://mqtt.viis.tech:8080/api/plugins/telemetry/DEVICE/{deviceId}/values/attributes`

**Query Params**: `scope=SHARED_SCOPE`

**Headers**: `X-Authorization: Bearer {access_token}`

**Response**:
```json
[
  {
    "key": "fertilizer_lookup_table",
    "value": [
      {
        "ec_setpoint": 1.5,
        "time_on_valve_01": 2000,
        "time_on_valve_02": 1800,
        "time_on_valve_03": 2100,
        "time_on_valve_04": 1900,
        "time_on_valve_05": 2000,
        "actual_ec_avg": 1.48,
        "sample_count": 15,
        "data_type": "Actual"
      }
    ]
  }
]
```

**Implementation** (BackendSyncService):
```typescript
async readFromThingsBoard(): Promise<LookupPoint[]> {
    const tbHost = this.globalHelper.getEnvVar('THINGSBOARD_HOST', 'mqtt.viis.tech');
    const accessToken = this.globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '');

    const tbUrl = `http://${tbHost}:8080/api/plugins/telemetry/DEVICE/${tbDeviceId}/values/attributes?scope=SHARED_SCOPE`;

    const response = await axios.get(tbUrl, {
        headers: { 'X-Authorization': `Bearer ${accessToken}` }
    });

    const lookupAttr = response.data?.find(
        (attr: any) => attr.key === 'fertilizer_lookup_table'
    );

    if (lookupAttr?.value) {
        return parsed.map(this.tbToLookupPoint);
    }

    return [];
}
```

**Use cases**:
- Initial device setup (no local lookup table yet)
- Admin pushes updated lookup table from dashboard
- Fallback when backend API unavailable

#### B. Publish Telemetry to ThingsBoard

**Not implemented in BackendSyncService** - handled by separate telemetry node

Typical data published:
```json
{
  "current_ec": 1.75,
  "target_ec": 1.8,
  "current_flow_1": 520,
  "valve_1_status": "ON",
  "irrigation_state": "RUNNING"
}
```

Frequency: Every 1-2 seconds during irrigation

### 9.8 Offline Operation

**Critical Design Principle**: **System must work offline**

**Guarantees**:
- ✅ Irrigation runs normally without internet
- ✅ Lookup table stored locally (MySQL)
- ✅ Learning happens locally (updateWithRunData)
- ✅ Failed syncs queued for retry
- ✅ No data loss

**Network failure scenarios**:

| Scenario | Behavior |
|----------|----------|
| **No internet at START** | Uses local lookup table, starts irrigation normally |
| **Lost internet during RUN** | PLC continues autonomous control, no impact |
| **No internet at STOP** | Updates local DB, queues sync for retry |
| **Partial backend failure** | Some runs sync, others queued |
| **Long-term offline** | Accumulates unsynced runs, auto-syncs when reconnected |

### 9.9 Configuration

**Environment Variables** (env/common.env):
```bash
# Backend URL
VIIS_BACKEND=https://iot.viis.tech

# ThingsBoard (optional)
THINGSBOARD_HOST=mqtt.viis.tech
DEVICE_ID=device1
DEVICE_ACCESS_TOKEN=your_access_token_here

# Sync behavior
SYNC_RETRY_INTERVAL=3600000    # 1 hour in ms
SYNC_MAX_RETRIES=5
SYNC_TIMEOUT=30000             # 30 seconds
```

**API Endpoints** (constants/index.ts):
```typescript
// NOTE: Backend uses /api/ NOT /api/v2/
export const API_ENDPOINTS = {
    IRRIGATION_FINISHED: '/api/fertilizer/irrigation-finished',
    GET_LOOKUP_TABLE: '/api/fertilizer/:deviceId/lookup-table',
    UPDATE_LOOKUP_POINT: '/api/fertilizer/:deviceId/lookup-table-point',
    GET_HISTORY: '/api/fertilizer/:deviceId/history',
    SYNC: '/api/fertilizer/:deviceId/sync',
} as const;
```

### 9.10 Monitoring & Debugging

**Check sync status**:
```sql
-- Count unsynced runs
SELECT COUNT(*) FROM irrigation_run
WHERE synced_to_backend = false
AND status = 'Completed';

-- List recent sync failures
SELECT id, device_id, end_time, synced_to_backend
FROM irrigation_run
WHERE synced_to_backend = false
ORDER BY end_time DESC
LIMIT 10;
```

**Test backend connectivity**:
```typescript
// In BackendSyncService
async isBackendReachable(): Promise<boolean> {
    try {
        const response = await this.httpClient.get('/health', { timeout: 5000 });
        return response.status === 200;
    } catch {
        return false;
    }
}
```

**Logs to watch**:
```
[BackendSync] Reported irrigation run #123 to backend
[BackendSync] Backend returned unsuccessful response: {"success":false}
[BackendSync] Failed to report irrigation: Network timeout
[BackendSync] Synced 3/5 pending runs
```

---

## 10. Error Handling

### 9.1 Error Categories

| Category | Examples | Recovery Strategy |
|----------|----------|-------------------|
| **Transient** | Stale global data, network timeout | Retry 3x with backoff |
| **Configuration** | Invalid valve count, missing board ID | Log error, send notification |
| **Hardware** | Modbus write failure, sensor disconnected | Transition to ERROR state |
| **Database** | Query timeout, connection lost | Queue operations, retry later |

### 9.2 Error Handling Pattern

```typescript
try {
  // Read sensor data
  const sensorData = readSensors(node, boardId);

  if (!sensorData) {
    // Transient error - log warning, continue monitoring
    node.warn('Failed to read sensors, retrying...');
    return;
  }

  // Process data
  await adjustValveTimes(sensorData);

} catch (error) {
  if (isTransientError(error)) {
    // Retry with exponential backoff
    await retryWithBackoff(() => adjustValveTimes(sensorData), 3);
  } else {
    // Critical error - transition to ERROR state
    currentState = 'ERROR';
    node.error(`Critical error: ${error.message}`);

    // Send notification
    await sendErrorNotification(error);
  }
}
```

### 9.3 Validation Checks

```typescript
// Before writing to Modbus
function validateValveTimes(times: number[]): void {
  if (times.length !== expectedValveCount) {
    throw new Error(`Expected ${expectedValveCount} valves, got ${times.length}`);
  }

  for (let i = 0; i < times.length; i++) {
    if (times[i] < MIN_VALVE_TIME || times[i] > MAX_VALVE_TIME) {
      throw new Error(
        `Valve ${i+1} time out of range: ${times[i]} ` +
        `(expected ${MIN_VALVE_TIME}-${MAX_VALVE_TIME})`
      );
    }
  }
}
```

---

## 11. Configuration

### 11.1 Node Configuration (Node-RED UI)

```javascript
// viis-fertilizer-ec-control.html
defaults: {
  name: { value: "" },
  boardId: { value: "board1", required: true },
  deviceId: { value: "", required: true },
  enableControl: { value: true },
  valveCount: { value: 5, validate: RED.validators.number() },
  targetEC: { value: 1.8, validate: RED.validators.number() }
}
```

### 10.2 Environment Variables

```bash
# env/device1.env

# Modbus board configuration
MODBUS_BOARDS=[{"id":"board1","host":"192.168.1.8","tcpPort":502,"type":"RTU","unitId":1}]
MODBUS_DEFAULT_BOARD=board1

# Register mappings (device-specific keys)
MODBUS_BOARD1_HOLDING_REGISTERS={"control_mode":0,"set_ec":1,"time_on_valve_01":10,...}
MODBUS_BOARD1_INPUT_REGISTERS={"current_flow_1":0,"current_ec":14,...}

# Database connection
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_DATABASE=viis_local
MYSQL_USER=root
MYSQL_PASSWORD=admin@123
```

### 10.3 Runtime Constants

```typescript
// constants/index.ts
export const EC_CONTROL_DEFAULTS = {
  CYCLE_EC: 10,                    // 10 × 0.6s = 6s cycle
  RAMP_UP_SECONDS: 20,             // Skip first 20s for averaging
  ADJUSTMENT_STEP: 500,            // ±500ms adjustment
  ADJUSTMENT_THRESHOLD: 0.05,      // ±0.05 mS/cm tolerance
  MAX_VALVE_TIME: 10000,           // 10 seconds max
  MIN_VALVE_TIME: 0,
  POLLING_INTERVAL: 1000,          // 1s for TCP
  POLLING_INTERVAL_RTU: 2000,      // 2s for RTU
  RTU_INTER_WRITE_DELAY: 100,      // 100ms between writes
  RTU_WRITE_SETTLE_DELAY: 50,      // 50ms after writes
  CONTEXT_WINDOW_SIZE: 20,         // 20 samples
  EC_SCALE_FACTOR: 10,             // EC × 10
  GLOBAL_DATA_MAX_AGE: 10000,      // 10s max staleness
};
```

---

## 12. Testing

### 12.1 Test Coverage

```bash
npm run test:fertilizer-ec

# Results:
# ✓ 27 tests passing
# ✓ Coverage: 87.36%
```

### 11.2 Test Structure

**Unit Tests** (`__tests__/viis-fertilizer-ec-control.test.ts`)
- Initialization
- Configuration validation
- Valve time validation
- Global context data reading
- Error handling

**State Transition Tests** (`__tests__/state-transitions.test.ts`)
- IDLE → MONITORING
- MONITORING → ADJUSTING
- ADJUSTING → MONITORING
- Error state handling

### 11.3 Key Test Cases

```typescript
describe('Global Context Data Reading', () => {
  it('should read sensor data from global context', () => {
    // Mock global context
    const mockContext = {
      global: {
        get: jest.fn().mockReturnValue({
          board1: {
            current_ec: 18,
            current_flow_1: 520,
            set_ec: 20,
            timestamp: Date.now()
          }
        })
      }
    };

    const data = readSensors(mockNode, 'board1');

    expect(data.currentEC).toBe(1.8);
    expect(data.currentFlow1).toBe(520);
  });

  it('should reject stale data', () => {
    const mockContext = {
      global: {
        get: jest.fn().mockReturnValue({
          board1: {
            current_ec: 18,
            timestamp: Date.now() - 15000  // 15s old
          }
        })
      }
    };

    const data = readSensors(mockNode, 'board1');

    expect(data).toBeNull();
  });
});
```

---

## Appendix

### A. Glossary

| Term | Definition |
|------|------------|
| **EC** | Electrical Conductivity - measure of fertilizer concentration in water (mS/cm) |
| **Feedforward** | Control strategy using historical data to predict required valve times |
| **Context Window** | Sliding window of sensor samples for noise-resistant averaging |
| **Lookup Table** | Database table storing historical EC → valve time mappings |
| **RTU** | Remote Terminal Unit - Modbus serial communication protocol |
| **Holding Register** | Modbus read/write register (16-bit) |
| **Input Register** | Modbus read-only register (16-bit) |

### B. References

- [Node-RED Custom Node Documentation](https://nodered.org/docs/creating-nodes/)
- [Modbus RTU Protocol Specification](https://www.modbus.org/docs/Modbus_Application_Protocol_V1_1b3.pdf)
- [TypeORM Documentation](https://typeorm.io/)
- [VIIS Multi-Board Migration Guide](../../docs/MULTI_BOARD_MIGRATION_GUIDE.md)

### C. Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-04 | 2.0.0 | Global context integration, RTU optimization, comprehensive testing |
| 2026-01-15 | 1.5.0 | Multi-board support, state machine refactor |
| 2025-12-01 | 1.0.0 | Initial release |

---

**For Tech Lead Review**:

### Critical Verification Points

- [ ] **Control Strategy**: Confirms system uses **feedforward + open-loop + post-run learning**, NOT closed-loop real-time control?
- [ ] **Modbus Writes**: Valve times written ONCE at START, ZERO writes during RUNNING state?
- [ ] **State Machine**: States are IDLE, RAMPING_UP, RUNNING, STOPPING, ERROR (no ADJUSTING or MONITORING)?
- [ ] **RTU Bus Safety**: Only polling flow reads Modbus during irrigation (no bus contention)?
- [ ] **Learning Mechanism**: Lookup table updated AFTER run completion, not during run?
- [ ] **PLC Autonomy**: PLC handles cyclic valve pulsing independently via `cycle_EC` register?
- [ ] **Backend Sync**: Async, non-blocking, with retry mechanism for offline scenarios?

### Technical Review

- [ ] Architecture diagram accurate (states, service layer, data flow)?
- [ ] Data flow explanation clear (polling flow → global context → fertilizer node)?
- [ ] RTU timing strategy acceptable (100ms inter-write delay, only at START)?
- [ ] Global context integration sound (10s staleness check, no duplicate polling)?
- [ ] Database schema appropriate (LookupTable, IrrigationRun entities)?
- [ ] **Backend sync strategy**: Local-first, async retry, offline-capable?
- [ ] **API integration**: Correct endpoints, payload format, error handling?
- [ ] Error handling comprehensive (transient vs critical, retry logic)?
- [ ] Test coverage sufficient (27 tests, 87% coverage)?

### Code Evidence Verification

**Expected behaviors**:
1. `writeValveTimes()` called ONLY in `startIrrigation()` (line ~410)
2. `startPolling()` function has ZERO `writeValveTimes()` calls (line ~550-600)
3. Comment at line 571: "no real-time adjustment - PLC handles open-loop control"
4. `stopIrrigation()` calls `updateWithRunData()` for post-run learning (line ~483)
5. `reportIrrigationFinished()` wrapped in try-catch, does NOT throw (line ~500-510)
6. Unsynced runs queryable via `synced_to_backend = false` column

**If any of above is missing → CODE DOES NOT MATCH SPEC**

---

### Backend Sync Verification

| Requirement | Implementation | Evidence |
|-------------|----------------|----------|
| Sync does NOT block irrigation completion | ✅ Try-catch, no throw | Line 500-510 in viis-fertilizer-ec-control.ts |
| Failed syncs are retryable | ✅ `syncPendingRuns()` method | BackendSyncService.ts line 162-180 |
| Offline operation supported | ✅ Local DB always updated first | stopIrrigation() line 483-498 |
| API endpoint correct | ✅ `/api/fertilizer/irrigation-finished` | constants/index.ts line 255 |
| Request timeout configured | ✅ 30 seconds | BackendSyncService constructor |
| Sync status tracked in DB | ✅ `synced_to_backend` column | IrrigationRun entity |

---

### Implementation Alignment

| Spec Requirement | Implementation Status | Evidence |
|------------------|----------------------|----------|
| "Chỉ cần điều khiển đúng chu kì thời gian mở và thời gian tắt" | ✅ PLC autonomous control | `cycle_EC` register written at START |
| "Sau mỗi lần tưới, các giá trị lịch sử sẽ được ghi nhận" | ✅ Post-run learning | `updateWithRunData()` in stopIrrigation() |
| "Đối với các giá trị set lần sau thì có thể nội suy ra" | ✅ Lookup table interpolation | `findClosestMatch()` + interpolation logic |
| "Giá trị trung bình được tính từ giây thứ 20" | ✅ Ramp-up skip | `RAMP_UP_SECONDS = 20` + RAMPING_UP state |
| NO real-time adjustment during irrigation | ✅ Zero Modbus writes in RUNNING | Code comment line 571-574 |

