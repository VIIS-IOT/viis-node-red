# Fertilizer EC Control - Operational Flow Documentation

**Module**: `viis-fertilizer-ec-control`
**Version**: 2.0.0
**Last Updated**: February 4, 2026
**Author**: IoT Development Team

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
Automatic fertilizer dosing control system based on EC (Electrical Conductivity) feedback with adaptive learning capabilities. The node controls fertilizer injection valves to maintain target EC levels in irrigation water.

### Key Features
- **EC-based closed-loop control** with real-time feedback
- **Adaptive learning algorithm** using feedforward + open-loop + learning strategy
- **Multi-valve support** (up to 5 fertilizer channels)
- **Lookup table** for historical valve time patterns
- **Context window** for noise-resistant EC averaging
- **Global context integration** - reads sensor data from centralized polling flow
- **RTU-optimized** - safe inter-write delays for Modbus RTU at 115200 baud

### Control Strategy
```
Target EC = 1.8 mS/cm
│
├─ Feedforward (lookup table): Retrieve historical valve times for target EC
├─ Open-loop: Apply valve times from lookup table
└─ Learning: Measure actual EC → Adjust valve times → Update lookup table
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
│  │  - MONITORING       │        │  └─ BackendSyncSvc  │     │
│  │  - ADJUSTING        │        │                     │     │
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
│  │           Modbus Writer (RTU-safe delays)           │    │
│  │  - 100ms inter-write delay                          │    │
│  │  - Valve time validation                            │    │
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

**Step 2: Start Monitoring (FSM: IDLE → MONITORING)**
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
// 3. Write valve times to Modbus (with RTU delays)
// 4. Start polling interval (1s TCP / 2s RTU)
```

**Step 3: Monitoring Loop (every 1-2 seconds)**
```typescript
// Read from global context (NOT direct Modbus)
const holdingData = global.get('holdingRegisterData');
const boardData = holdingData[boardId];

// Validate data freshness (< 10s old)
if (Date.now() - boardData.timestamp > 10000) {
  node.error('Stale global context data');
  return;
}

// Extract sensor values
const currentEC = boardData.current_ec / 10;  // 18 → 1.8 mS/cm
const currentFlow1 = boardData.current_flow_1;
const targetEC = boardData.set_ec / 10;

// Add to context window (20 samples)
contextWindowService.addSample(currentEC);

// Calculate average EC (skip first 20s ramp-up)
if (elapsedTime > RAMP_UP_SECONDS) {
  const avgEC = contextWindowService.getAverage();

  // Compare with target
  if (Math.abs(avgEC - targetEC) > ADJUSTMENT_THRESHOLD) {
    // FSM: MONITORING → ADJUSTING
    adjustValveTimes(avgEC, targetEC);
  }
}
```

**Step 4: Adjustment Logic (FSM: ADJUSTING)**
```typescript
// Calculate EC deviation
const deviation = targetEC - avgEC;  // e.g., 1.8 - 1.75 = +0.05

// Determine adjustment direction
const adjustment = deviation > 0 ? ADJUSTMENT_STEP : -ADJUSTMENT_STEP;
// +0.05 > 0 → increase valve times by +500ms

// Apply to all valves proportionally
for (let i = 1; i <= valveCount; i++) {
  valveTimes[i] = currentValveTimes[i] + adjustment;

  // Validate boundaries
  valveTimes[i] = Math.max(MIN_VALVE_TIME,
                           Math.min(MAX_VALVE_TIME, valveTimes[i]));
}

// Write to Modbus (RTU-safe)
await writeValveTimes(valveTimes);

// Update lookup table
await lookupTableService.upsert({
  deviceId: config.deviceId,
  targetEC: targetEC,
  avgEC: avgEC,
  valveTimes: valveTimes
});

// FSM: ADJUSTING → MONITORING
```

**Step 5: Stop Irrigation**
```typescript
// User triggers STOP
msg = { payload: { command: 'stop' } }

// 1. Clear polling interval
// 2. Reset context window
// 3. Calculate total volume/stats
// 4. Save irrigation run to database
// 5. Sync to backend (optional)
// 6. FSM: MONITORING → IDLE
```

---

## 4. State Machine

### 4.1 States

```
┌────────────────────────────────────────────────────────────┐
│                     State Diagram                          │
└────────────────────────────────────────────────────────────┘

          ┌──────┐
   ┌─────►│ IDLE │◄────┐
   │      └───┬──┘     │
   │          │        │
   │ STOP     │ START  │ ERROR / STOP
   │          ▼        │
   │   ┌──────────────┐│
   └───┤  MONITORING  ├┘
       └──────┬───────┘
              │ ▲
   DEVIATION  │ │ ADJUSTED
   DETECTED   ▼ │
       ┌──────────────┐
       │  ADJUSTING   │
       └──────────────┘
              │
              │ CRITICAL ERROR
              ▼
       ┌──────────────┐
       │    ERROR     │
       └──────────────┘
```

### 4.2 State Transitions

| Current State | Trigger | Next State | Actions |
|---------------|---------|------------|---------|
| IDLE | `msg.command = 'start'` | MONITORING | Load lookup table → Write valve times → Start polling |
| MONITORING | EC deviation > threshold | ADJUSTING | Calculate adjustment → Write new valve times |
| ADJUSTING | Valve times written | MONITORING | Update lookup table → Continue monitoring |
| MONITORING | `msg.command = 'stop'` | IDLE | Stop polling → Save run data → Reset context |
| ANY | Critical error | ERROR | Log error → Send notification → Require manual reset |

### 4.3 State Guards

```typescript
// Validate state transition before executing
function validateTransition(from: State, to: State, trigger: string): boolean {
  const validTransitions = {
    'IDLE': ['MONITORING'],
    'MONITORING': ['ADJUSTING', 'IDLE', 'ERROR'],
    'ADJUSTING': ['MONITORING', 'ERROR'],
    'ERROR': ['IDLE']  // Manual reset only
  };

  return validTransitions[from].includes(to);
}
```

---

## 5. Core Algorithms

### 5.1 Feedforward + Learning Strategy

**Problem**: Pure feedback control is slow to respond and oscillates.

**Solution**: Hybrid approach using historical data + real-time adjustment.

```typescript
// Phase 1: Feedforward (lookup historical data)
const lookupEntry = await lookupTableService.findClosestMatch(targetEC);
const initialValveTimes = lookupEntry?.valveTimes || DEFAULT_VALVE_TIMES;

// Phase 2: Open-loop (apply initial guess)
await writeValveTimes(initialValveTimes);

// Phase 3: Feedback (measure & adjust)
while (monitoring) {
  const avgEC = contextWindowService.getAverage();
  const error = targetEC - avgEC;

  if (Math.abs(error) > ADJUSTMENT_THRESHOLD) {
    // Proportional adjustment
    const adjustment = error * ADJUSTMENT_GAIN;
    newValveTimes = currentValveTimes + adjustment;

    await writeValveTimes(newValveTimes);
  }
}

// Phase 4: Learning (update lookup table)
await lookupTableService.upsert({
  targetEC: targetEC,
  avgEC: avgEC,
  valveTimes: finalValveTimes
});
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

### 5.3 Proportional Adjustment

```typescript
// Deviation-based adjustment
const deviation = targetEC - avgEC;  // e.g., 1.8 - 1.75 = +0.05

// Apply proportional adjustment
const adjustment = deviation > ADJUSTMENT_THRESHOLD
  ? +ADJUSTMENT_STEP   // +500ms
  : -ADJUSTMENT_STEP;  // -500ms

// Update all valves equally
valveTimes = valveTimes.map(t => t + adjustment);
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
- [ ] Architecture diagram accurate?
- [ ] Data flow explanation clear?
- [ ] RTU timing strategy acceptable?
- [ ] Global context integration sound?
- [ ] Database schema appropriate?
- [ ] Error handling comprehensive?
- [ ] Test coverage sufficient (87%)?
