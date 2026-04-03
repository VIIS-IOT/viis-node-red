# Backend Learning & Lookup Table Sync

**Date**: February 4, 2026
**Status**: ✅ Implemented
**Type**: Feature Enhancement - Connect Gateway to Backend Learning Algorithm

---

## 📋 Overview

**Problem**: Backend CÓ learning algorithm (weighted average + adaptive adjustment ±50ms + linear interpolation), nhưng Gateway KHÔNG nhận được optimized lookup table. Gateway vẫn chỉ dùng local lookup table, không share knowledge với Backend.

**Solution**: Implement lookup table sync mechanism - Gateway tự động fetch updated lookup table từ Backend sau khi report irrigation completion.

---

## 🔄 Implementation: Two-Stage Learning Loop

### **Stage 1: Local Learning (Gateway)**
- Weighted average of own irrigation runs
- Store in local MySQL
- Fast (offline-capable)
- **Interval**: After every irrigation

### **Stage 2: Global Learning (Backend)**
- Receive irrigation completion from Gateway
- Process telemetry from ThingsBoard (skip 20s ramp-up)
- Apply algorithms:
  - Weighted average update
  - Adaptive adjustment (±50ms based on EC deviation)
  - Linear interpolation for intermediate EC points
  - Aggregate data from multiple devices (fleet learning)
- Store optimized lookup table in PostgreSQL

### **Stage 1.5 (NEW): Feedback Loop (Gateway)**
- Fetch updated lookup table from Backend
- Merge with local (prefer server's learned values)
- Use in next irrigation
- **Interval**: After successful Backend sync

---

## 💻 Code Changes

### **1. viis-fertilizer-ec-control.ts** (Main Node)

**Location**: Line 500-530 in `stopIrrigation()` handler

**Change**: After POST `/api/fertilizer/irrigation-finished`, now also:
```typescript
// NEW: Fetch updated lookup table from backend
const updatedLookupTable = await syncService.fetchLookupTable();
if (updatedLookupTable && updatedLookupTable.length > 0) {
  // Merge with local lookup table
  for (const point of updatedLookupTable) {
    await lookupService.updateOrCreateFromServer(point);
  }
  node.log(`✅ Synced ${updatedLookupTable.length} lookup points from backend`);
}
```

**Why after POST?**
- Backend needs `irrigation-finished` data to calculate optimizations
- No race condition (POST is awaited)
- GET happens immediately after learning is done
- Non-blocking: if GET fails, Gateway continues with local table

---

### **2. LookupTableService.ts**

**New Method**: `updateOrCreateFromServer(serverPoint: LookupPoint)`

**Location**: Line 370+ (added before logging methods)

**Logic**:
```typescript
async updateOrCreateFromServer(serverPoint: LookupPoint): Promise<void> {
  // If point exists locally:
  //   - Update valve times (server's optimized values)
  //   - Update achieved averages
  //   - Keep local sample_count if higher (local learning might be more recent)
  //   - Set last_server_sync = now
  //
  // If point is NEW from server:
  //   - Create it locally
  //   - Mark with last_server_sync = now
}
```

**Why merge carefully?**
- Server has global optimization (many devices)
- Local might have more recent runs (higher sample_count)
- Prefer server's valve times (they're optimized)
- Keep local meta-information

---

### **3. BackendSyncService.ts** (No changes)

**Existing Method**: `fetchLookupTable()` - Line 84-99

Already implemented, now being used:
```typescript
async fetchLookupTable(): Promise<LookupPoint[]> {
  const endpoint = API_ENDPOINTS.GET_LOOKUP_TABLE
    .replace(':deviceId', this.deviceId);

  try {
    const response = await this.httpClient.get(endpoint);
    if (Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  } catch (error) {
    this.error(`Failed to fetch lookup table: ${error.message}`);
    return [];
  }
}
```

---

### **4. constants/index.ts** (API Endpoints)

**Fix Applied**: `/api/v2/` → `/api/`

Already defined:
```typescript
export const API_ENDPOINTS = {
  IRRIGATION_FINISHED: '/api/fertilizer/irrigation-finished',
  GET_LOOKUP_TABLE: '/api/fertilizer/:deviceId/lookup-table',  // ← Now used!
  UPDATE_LOOKUP_POINT: '/api/fertilizer/:deviceId/lookup-table-point',  // Future
  GET_HISTORY: '/api/fertilizer/:deviceId/history',  // Future
  SYNC: '/api/fertilizer/:deviceId/sync',  // Future
} as const;
```

---

## 🔌 API Usage

### **Currently Active**:

| API | Method | When | Purpose |
|-----|--------|------|---------|
| `/api/fertilizer/irrigation-finished` | POST | After irrigation completes | Report to Backend for learning |
| `/api/fertilizer/:deviceId/lookup-table` | GET | Right after successful POST | Fetch optimized lookup table |

### **For Future Enhancement**:

| API | Method | Purpose |
|-----|--------|---------|
| `/api/fertilizer/:deviceId/lookup-table-point` | PUT/POST | Update specific point |
| `/api/fertilizer/:deviceId/history` | GET | Query historical data |
| `/api/fertilizer/:deviceId/sync` | POST | Full sync |

---

## 📊 Data Flow Example

```
Time T=0: Irrigation starts
  EC target: 1.8 mS/cm
  Local lookup: [EC 1.7 → 2900ms, EC 1.9 → 3100ms]
  Interpolated: EC 1.8 → 3000ms

Time T=15: Irrigation ends
  EC achieved: 1.75 mS/cm
  Gateway local learning:
    ├─ Weighted average: (old_avg × n + 1.75) / (n+1)
    ├─ Sample count: n → n+1
    └─ Store in local lookup_table

Time T=16: POST /api/fertilizer/irrigation-finished
  Backend receives:
    - device_id: "device1"
    - start_time, end_time
    - ec_setpoint: 1.8

  Backend processes:
    ├─ Fetch telemetry from ThingsBoard (skip 20s ramp-up)
    ├─ Calculate achieved EC = 1.75
    ├─ Delta = 1.75 - 1.8 = -0.05 (too low)
    ├─ Action: Increase valve times +50ms
    │  (because EC achieved < target)
    ├─ Sample count update (fleet aggregation)
    └─ Update PostgreSQL lookup table

Time T=17: GET /api/fertilizer/device1/lookup-table
  Gateway receives updated table from Backend:
    [{
      ec_setpoint: 1.8,
      time_on_valve_01: 3050,  // ← Changed from 3000 to 3050 (+50ms)
      time_on_valve_02: ...,
      actual_ec_avg: 1.76,     // ← Updated from server's runs too
      sample_count: 42,        // ← Aggregated from fleet
      data_type: "Actual"
    }, ...]

  Gateway merges:
    - Prefer server's valve times (optimized)
    - Keep local newer data if applicable
    - Mark last_server_sync = now

Time T=18+: Next irrigation uses improved prediction
  EC target: 1.8 mS/cm
  Local lookup (after sync): [EC 1.8 → 3050ms] ← Better!
  → More accurate prediction
```

---

## 🎯 Benefits

### **For Single Device**:
- ✅ Learns from own runs (local)
- ✅ Gets Backend's optimization (global)
- ✅ Converges to optimal valve times faster
- ✅ Works offline (local fallback)

### **For Device Fleet**:
- ✅ Each device shares learning with Backend
- ✅ Backend aggregates patterns (e.g., "high salinity water needs 5% more dosing")
- ✅ New devices inherit fleet's knowledge
- ✅ Continuous improvement across fleet

---

## ⚙️ Configuration

**No new config needed** - uses existing:
- `VIIS_BACKEND` (iot.viis.tech)
- Device authentication (from header)
- API credentials (if required)

---

## 🧪 Testing Checklist

- [ ] POST `/api/fertilizer/irrigation-finished` succeeds
- [ ] GET `/api/fertilizer/:deviceId/lookup-table` returns data
- [ ] Local lookup table is merged correctly
- [ ] Valve times are updated to server's values
- [ ] Next irrigation uses updated times
- [ ] Graceful fallback if GET fails (use local table)
- [ ] Offline operation still works (local learning only)
- [ ] Multi-device fleet: all devices converge

---

## 📝 Documentation

Updated in [OPERATIONAL_FLOW.md](OPERATIONAL_FLOW.md):

- Section 5 (Core Algorithms): Explains two-stage learning
- Section 9 (Backend Synchronization):
  - New subsection 9.1 (updated architecture diagram)
  - New subsection 9.2 (two-stage learning table)
  - New subsection 9.5 (lookup table fetch & merge)
  - New subsection 9.7 (offline operation)

---

## 🔮 Future Enhancements

**Option 2: Backend returns updated table in POST response**
```typescript
@Post('/irrigation-finished')
async irrigationFinished(@Body() body) {
  await this.processCompletedIrrigation(...);

  const updatedTable = await this.getLookupTable(body.device_id);
  return {
    success: true,
    updated_lookup_table: updatedTable  // ← NEW
  };
}
```

**Benefits**:
- Reduce to 1 API call instead of 2
- Atomic operation
- More efficient

**Phase**: After current implementation is tested

---

## 📌 Notes

- **Sync is NON-BLOCKING**: If GET fails, irrigation completes normally
- **Retry**: Failed syncs are retried on next irrigation via `syncPendingRuns()`
- **Merge strategy**: Server values preferred for valve times, local metadata kept
- **No data loss**: Everything is persisted locally first
- **Backwards compatible**: Works with current Backend (no Backend changes needed)

---

**Author**: AI Agent
**Testing**: Ready for integration test
