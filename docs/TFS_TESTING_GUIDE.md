# TFS Delta-Based Accumulation System - Testing Guide

## Overview

Hệ thống tích luỹ dựa trên TFS (Total Flow Sensor) đọc từ Modbus PLC, sử dụng phương pháp delta để tính toán lưu lượng tích luỹ theo hành trình và theo giờ.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ MARINE TELEMETRY NODE                                     │
│ - Poll Modbus every 2s                                   │
│ - Read holding registers 10-21 (TFS data)               │
└────────────────┬─────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────┐
│ TFS PARSER                                               │
│ - Parse TFS from 2 registers:                           │
│   tfs_value = integer + (decimal / 1000)                │
│ - Example: Reg[10]=91, Reg[11]=458 → 91.458 m³         │
└────────────────┬─────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────┐
│ SAVE TO DATABASE                                         │
│ - Table: tabiot_device_telemetry                        │
│ - Fields: tfs_value, oil_profile_id, density_snapshot  │
└────────────────┬─────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────┐
│ CHECKPOINT SERVICE (FlowCheckpointService)               │
│ - Load last checkpoint from DB                          │
│ - Calculate delta: new_tfs - last_checkpoint           │
│ - If delta < 0: Reset detected → delta = null          │
│ - Update checkpoint in DB                               │
└────────────────┬─────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌──────────────┐  ┌──────────────────────┐
│ TRIP ACCUM   │  │ HOURLY ACCUM         │
│ (Real-time)  │  │ (Scheduled)          │
│              │  │                      │
│ Every 2s     │  │ Cron: "5 * * * *"   │
│ Delta-based  │  │ TFS first-last      │
└──────────────┘  └──────────────────────┘
```

## Register Mapping

**Formula**: `tfs_value = integer + ((decimal % 1000) / 1000)`

Only the **last 3 digits** of the decimal register are used.

| Sensor | Integer Addr | Decimal Addr | Example Registers | Calculation | Result |
|--------|-------------|--------------|-------------------|-------------|--------|
| tfs01  | 10          | 11           | int=91, dec=458   | 91 + (458%1000)/1000 = 91 + 0.458 | 91.458 m³ |
| tfs02  | 12          | 13           | int=200, dec=500  | 200 + (500%1000)/1000 = 200 + 0.500 | 200.500 m³ |
| tfs03  | 14          | 15           | int=91, dec=8979  | 91 + (8979%1000)/1000 = 91 + 0.979 | 91.979 m³ |
| tfs04  | 16          | 17           | int=100, dec=1234 | 100 + (1234%1000)/1000 = 100 + 0.234 | 100.234 m³ |
| tfs05  | 18          | 19           | int=500, dec=999  | 500 + (999%1000)/1000 = 500 + 0.999 | 500.999 m³ |
| tfs06  | 20          | 21           | int=600, dec=1    | 600 + (1%1000)/1000 = 600 + 0.001 | 600.001 m³ |

## Test Scenarios

### 1. TFS Parsing Tests (`tfs-parsing.test.ts`)

**Mục đích**: Kiểm tra logic parse TFS từ Modbus registers

**Test cases**:
- ✅ Parse 1 sensor đơn giản (user example: 91.458)
- ✅ Parse tất cả 6 sensors cùng lúc
- ✅ Handle zero values
- ✅ Handle large values (max 16-bit)
- ✅ Handle decimal-only values (integer = 0)
- ✅ Skip null/undefined registers
- ✅ Handle out-of-bounds addresses
- ✅ Delta calculation scenarios
- ✅ Counter rollover detection
- ✅ PLC reset detection (negative delta)
- ✅ Precision tests (3 decimal places)

**Chạy test**:
```bash
npm test -- tfs-parsing.test.ts
```

### 2. Integration Tests (`tfs-integration.test.ts`)

**Mục đích**: Kiểm tra toàn bộ flow từ Modbus đến accumulation

**Test scenarios**:
- ✅ **Scenario 1**: Normal operation - positive delta
  - Vessel chạy bình thường 1 giờ
  - TFS tăng dần, tính delta liên tục
  - Verify tổng tích luỹ = 25.5 m³

- ✅ **Scenario 2**: Counter reset detection
  - PLC counter bị reset về 0
  - Delta âm được phát hiện
  - Checkpoint được reset

- ✅ **Scenario 3**: Multi-sensor trip
  - 4 sensors hoạt động song song
  - Tính consumption = flow_in - flow_return
  - Main Engine + Generator

- ✅ **Scenario 4**: Hourly accumulation with reset
  - Reset xảy ra giữa giờ
  - Tính tổng với `calculateWithResets()`

- ✅ **Scenario 5**: Modbus register parsing
  - Parse thực tế từ holding registers

- ✅ **Scenario 6**: Complete flow simulation
  - Polling → Parse → Checkpoint → Accumulation

**Chạy test**:
```bash
npm test -- tfs-integration.test.ts
```

### 3. Checkpoint Service Tests (Đã có sẵn)

**File**: `FlowCheckpointService.test.ts`

**Test cases**:
- ✅ Calculate positive delta
- ✅ Detect reset (negative delta)
- ✅ Create new checkpoint
- ✅ Get checkpoint by device/sensor/type
- ✅ Reset checkpoint manually
- ✅ Calculate delta without updating

**Chạy test**:
```bash
npm test -- FlowCheckpointService.test.ts
```

### 4. Flow Accumulation Service Tests (Đã có sẵn)

**File**: `FlowAccumulationService.test.ts`

**Test cases**:
- ✅ Calculate hourly accumulation
- ✅ Multiple sensors
- ✅ Handle missing profile
- ✅ Idempotent calculations
- ✅ Get accumulation by date range
- ✅ Get total accumulation
- ✅ Backfill historical data

**Chạy test**:
```bash
npm test -- FlowAccumulationService.test.ts
```

## Run All Tests

```bash
# Run all TFS-related tests
npm test -- --testPathPattern="(tfs|FlowCheckpoint|FlowAccumulation)"

# Run with coverage
npm test -- --coverage --testPathPattern="(tfs|FlowCheckpoint|FlowAccumulation)"

# Run specific test file
npm test -- tfs-parsing.test.ts

# Run in watch mode
npm test -- --watch tfs-integration.test.ts
```

## Manual Testing with Node-RED

### Setup Test Flow

1. **Deploy env-loader node** (REQUIRED)
   - Loads env variables to global context
   - Check interval: 10 seconds

2. **Deploy marine-telemetry node**
   - Enable Marine IoT
   - Set polling interval: 2000ms
   - Flow sensors: fs01,fs02,fs03,fs04,fs05,fs06

3. **Configure Modbus registers** in env file:
   ```env
   MODBUS_BOARD1_HOLDING_REGISTERS={"fs01":0,"fs02":1,"fs03":2,"fs04":3,"fs05":4,"fs06":5,"tfs01":10,"tfs02":12,"tfs03":14,"tfs04":16,"tfs05":18,"tfs06":20}
   ```

### Test Case 1: Verify TFS Parsing

**Objective**: Confirm TFS values are parsed correctly

**Steps**:
1. Set Modbus PLC registers:
   ```
   Register 10 = 91
   Register 11 = 458
   ```

2. Check logs in marine-telemetry node:
   ```
   [Marine] Parsed tfs01: 91 + 458/1000 = 91.4580 m³
   ```

3. Query database:
   ```sql
   SELECT key_name, float_value, oil_profile_id, density_snapshot
   FROM tabiot_device_telemetry
   WHERE key_name = 'tfs01'
   ORDER BY timestamp DESC
   LIMIT 1;
   ```

**Expected**: `float_value = 91.458`

### Test Case 2: Verify Checkpoint Delta

**Objective**: Confirm delta calculation works

**Steps**:
1. First reading: TFS = 91.458 m³
2. Wait 2 seconds
3. Second reading: TFS = 91.698 m³

4. Check checkpoint in database:
   ```sql
   SELECT sensor_key, last_tfs_value, last_update_time
   FROM tabiot_flow_checkpoint
   WHERE sensor_key = 'tfs01' AND checkpoint_type = 'trip';
   ```

5. Check logs:
   ```
   [Marine] tfs01 delta: 0.2400 m³ (0.2280 tons)
   ```

**Expected delta**: 0.240 m³

### Test Case 3: Verify Reset Detection

**Objective**: Confirm reset handling

**Steps**:
1. Set TFS = 1000.500 m³
2. Wait for checkpoint update
3. Reset PLC: Set TFS = 5.250 m³
4. Check logs:
   ```
   [Marine] tfs01 was reset, checkpoint updated to 5.2500 m³
   ```

5. Next reading TFS = 6.000 m³
6. Delta should be: 6.000 - 5.250 = 0.750 m³

**Expected**: No accumulation on reset, but resumes after

### Test Case 4: Verify Trip Accumulation

**Objective**: Confirm trip totals are correct

**Steps**:
1. Start a new trip via API
2. Run vessel for 30 minutes
3. Query trip accumulation:
   ```sql
   SELECT sensor_key, total_volume_m3, total_volume_tons, sample_count
   FROM tabiot_trip_accumulation
   WHERE trip_id = 'your_trip_id';
   ```

**Expected**: Totals match sum of deltas

### Test Case 5: Verify Hourly Accumulation

**Objective**: Confirm hourly calculation

**Steps**:
1. Run for 1 full hour (e.g., 14:00 - 15:00)
2. Wait for cron job (scheduled at minute 5 of each hour)
3. Query hourly data:
   ```sql
   SELECT sensor_key, hour_start, accumulated_m3, accumulated_tons, sample_count
   FROM tabiot_flow_accumulation
   WHERE hour_start = '2025-01-21 14:00:00';
   ```

**Expected**: Accumulated m³ = last_tfs - first_tfs (within that hour)

## Debugging Tips

### 1. Enable Debug Logging

Send message to marine-telemetry node:
```javascript
msg.enableDebugLog = true;
```

### 2. Check Checkpoint Status

Query current checkpoints:
```sql
SELECT * FROM tabiot_flow_checkpoint
WHERE device_id = 'your_device'
ORDER BY last_update_time DESC;
```

### 3. Verify TFS Data in Telemetry

```sql
SELECT key_name, float_value, oil_profile_id, density_snapshot, FROM_UNIXTIME(timestamp/1000) as time
FROM tabiot_device_telemetry
WHERE key_name LIKE 'tfs%'
AND device_id = 'your_device'
ORDER BY timestamp DESC
LIMIT 100;
```

### 4. Check Trip Accumulation

```sql
SELECT 
    t.sensor_key,
    t.total_volume_m3,
    t.total_volume_tons,
    t.sample_count,
    FROM_UNIXTIME(t.last_update_time/1000) as last_update
FROM tabiot_trip_accumulation t
WHERE t.trip_id = 'your_trip_id';
```

### 5. Monitor Hourly Accumulation

```sql
SELECT 
    sensor_key,
    hour_start,
    hour_end,
    accumulated_m3,
    accumulated_tons,
    avg_flow_m3h,
    sample_count
FROM tabiot_flow_accumulation
WHERE device_id = 'your_device'
AND hour_start >= CURDATE()
ORDER BY hour_start DESC, sensor_key ASC;
```

## Common Issues

### Issue 1: TFS value seems wrong

**Problem**: Parsed TFS value không khớp với PLC  
**Check**: 
- Verify register mapping trong env file
- Confirm formula: `/1000` (3 decimals) hay `/10000` (4 decimals)?
- Check Modbus read response

### Issue 2: Delta always null

**Problem**: Checkpoint service luôn trả về delta = null  
**Check**:
- Checkpoint có tồn tại chưa? (First reading sẽ tạo checkpoint mới)
- TFS value có giảm không? (Negative delta = reset)
- Database connection OK?

### Issue 3: Trip accumulation not updating

**Problem**: Trip totals không tăng  
**Check**:
- Có active trip không?
- Checkpoint delta có positive không?
- Marine telemetry node có chạy không?
- Check logs for errors

### Issue 4: Hourly accumulation missing data

**Problem**: Không có data cho giờ vừa rồi  
**Check**:
- Cron job có chạy đúng giờ không? (minute 5)
- Có TFS telemetry data trong giờ đó không?
- FlowAccumulationService có errors không?

## Performance Benchmarks

**Expected performance**:
- TFS parsing: < 10ms for 6 sensors
- Checkpoint update: < 50ms per sensor
- Trip accumulation: < 100ms for 6 sensors
- Hourly calculation: < 5s for 6 sensors, 1 hour data

## Data Validation

### Validate TFS Delta

```sql
-- Check if deltas are reasonable (should be positive and small)
SELECT 
    t1.key_name,
    t1.float_value as tfs_old,
    t2.float_value as tfs_new,
    (t2.float_value - t1.float_value) as delta,
    FROM_UNIXTIME(t2.timestamp/1000) as time
FROM tabiot_device_telemetry t1
JOIN tabiot_device_telemetry t2 
    ON t1.key_name = t2.key_name 
    AND t1.device_id = t2.device_id
    AND t2.timestamp = (
        SELECT MIN(timestamp) 
        FROM tabiot_device_telemetry 
        WHERE key_name = t1.key_name 
        AND timestamp > t1.timestamp
    )
WHERE t1.key_name LIKE 'tfs%'
ORDER BY t2.timestamp DESC
LIMIT 20;
```

### Validate Trip vs Hourly Consistency

```sql
-- Trip accumulation during a specific hour should match hourly accumulation
SELECT 
    'Trip' as source,
    sensor_key,
    SUM(total_volume_m3) as total_m3
FROM tabiot_trip_accumulation
WHERE trip_id = 'your_trip'
GROUP BY sensor_key

UNION ALL

SELECT 
    'Hourly' as source,
    sensor_key,
    SUM(accumulated_m3) as total_m3
FROM tabiot_flow_accumulation
WHERE hour_start >= '2025-01-21 14:00:00'
AND hour_start < '2025-01-21 15:00:00'
GROUP BY sensor_key;
```

## Summary Checklist

Before deployment:
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] TFS parsing verified with real PLC data
- [ ] Checkpoint delta calculation tested
- [ ] Reset detection confirmed
- [ ] Trip accumulation working
- [ ] Hourly accumulation scheduled correctly
- [ ] Database schema validated
- [ ] Performance acceptable
- [ ] Error handling tested
- [ ] Logging comprehensive
- [ ] Documentation complete
