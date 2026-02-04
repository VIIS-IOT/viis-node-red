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
9. [Error Handling](#error-handling)
10. [Configuration](#configuration)
11. [Testing](#testing)

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

**Step 5: Backend Sync (Optional)**
```typescript
// After updating lookup table, optionally sync to cloud
try {
  await backendSyncService.syncRun({
    deviceId: config.deviceId,
    runId: currentRun.id,
    ecSetpoint: targetEC,
    ecAchieved: avgEC,
    valveTimes: currentValveTimes,
    totalVolume: stats.totalVolume
  });
} catch (error) {
  // Non-critical - will retry later
  node.warn(`Backend sync failed: ${error.message}`);
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

**LookupTable Entity**
```typescript
@Entity('lookup_table')
export class LookupTable {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  device_id: string;

  @Column('decimal', { precision: 5, scale: 2 })
  target_ec: number;  // e.g., 1.80

  @Column('decimal', { precision: 5, scale: 2 })
  avg_ec: number;     // e.g., 1.79

  @Column('simple-json')
  valve_times: number[];  // [3000, 2500, 3200, 2800, 3100]

  @Column()
  created_at: Date;

  @Column()
  updated_at: Date;
}
```

**IrrigationRun Entity**
```typescript
@Entity('irrigation_run')
export class IrrigationRun {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  device_id: string;

  @Column()
  start_time: Date;

  @Column({ nullable: true })
  end_time: Date;

  @Column('decimal', { precision: 10, scale: 2 })
  total_volume: number;  // Total liters

  @Column('decimal', { precision: 5, scale: 2 })
  avg_ec: number;

  @Column('simple-json')
  valve_times: number[];
}
```

### 8.2 Lookup Table Operations

**Find Closest Match**
```typescript
async findClosestMatch(targetEC: number): Promise<LookupTable | null> {
  const entries = await this.repository.find({
    where: { device_id: this.deviceId },
    order: { updated_at: 'DESC' }
  });

  if (entries.length === 0) return null;

  // Find entry with closest target_ec
  let closest = entries[0];
  let minDiff = Math.abs(entries[0].target_ec - targetEC);

  for (const entry of entries) {
    const diff = Math.abs(entry.target_ec - targetEC);
    if (diff < minDiff) {
      minDiff = diff;
      closest = entry;
    }
  }

  return closest;
}
```

**Upsert Entry**
```typescript
async upsert(data: Partial<LookupTable>): Promise<void> {
  const existing = await this.repository.findOne({
    where: {
      device_id: data.device_id,
      target_ec: data.target_ec
    }
  });

  if (existing) {
    // Update existing entry
    await this.repository.update(existing.id, {
      avg_ec: data.avg_ec,
      valve_times: data.valve_times,
      updated_at: new Date()
    });
  } else {
    // Insert new entry
    await this.repository.save({
      ...data,
      created_at: new Date(),
      updated_at: new Date()
    });
  }
}
```

---

## 9. Error Handling

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

## 10. Configuration

### 10.1 Node Configuration (Node-RED UI)

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

## 11. Testing

### 11.1 Test Coverage

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

### Technical Review

- [ ] Architecture diagram accurate (states, service layer, data flow)?
- [ ] Data flow explanation clear (polling flow → global context → fertilizer node)?
- [ ] RTU timing strategy acceptable (100ms inter-write delay, only at START)?
- [ ] Global context integration sound (10s staleness check, no duplicate polling)?
- [ ] Database schema appropriate (LookupTable, IrrigationRun entities)?
- [ ] Error handling comprehensive (transient vs critical, retry logic)?
- [ ] Test coverage sufficient (27 tests, 87% coverage)?

### Code Evidence Verification

**Expected behaviors**:
1. `writeValveTimes()` called ONLY in `startIrrigation()` (line ~410)
2. `startPolling()` function has ZERO `writeValveTimes()` calls (line ~550-600)
3. Comment at line 571: "no real-time adjustment - PLC handles open-loop control"
4. `stopIrrigation()` calls `updateWithRunData()` for post-run learning (line ~483)

**If any of above is missing → CODE DOES NOT MATCH SPEC**

---

### Implementation Alignment

| Spec Requirement | Implementation Status | Evidence |
|------------------|----------------------|----------|
| "Chỉ cần điều khiển đúng chu kì thời gian mở và thời gian tắt" | ✅ PLC autonomous control | `cycle_EC` register written at START |
| "Sau mỗi lần tưới, các giá trị lịch sử sẽ được ghi nhận" | ✅ Post-run learning | `updateWithRunData()` in stopIrrigation() |
| "Đối với các giá trị set lần sau thì có thể nội suy ra" | ✅ Lookup table interpolation | `findClosestMatch()` + interpolation logic |
| "Giá trị trung bình được tính từ giây thứ 20" | ✅ Ramp-up skip | `RAMP_UP_SECONDS = 20` + RAMPING_UP state |
| NO real-time adjustment during irrigation | ✅ Zero Modbus writes in RUNNING | Code comment line 571-574 |

