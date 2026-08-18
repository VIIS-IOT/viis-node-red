# VIIS Schedule Executor — Logic Summary

> **Node:** `viis-schedule-executor`
> **Files:** `viis-schedule-executor.ts` (entry, 986 lines) + `viis-schedule-executor-service.ts` (business logic, 2525 lines)

---

## 1. Overview

`viis-schedule-executor` là Node-RED custom node điều phối lịch tưới tự động (schedule). Nó thực hiện 2 việc chính khi schedule chạy/kết thúc:

1. **Modbus mapping** — chuyển `schedule.action` JSON → Modbus coil/holding register commands → gửi lệnh đến thiết bị vật lý
2. **Config key-value** — các key không có trong Modbus mapping được lưu vào `globalContext.configKeyValues` và publish qua MQTT

---

## 2. Modbus Mapping Flow

### 2.1 Parse action JSON

`mapScheduleToModbus(schedule)` tại `service:544-665`:

```
schedule.action (JSON string) → parse → actionObj
```

- Tự tính `iri_time` nếu chưa có (dựa trên `start_time` / `end_time`, đơn vị giây)
- Normalize string numbers (vd `"1,800.00"` → `1800`)

### 2.2 Luoi Expansion (Abstract Keys)

Trước khi map Modbus, các key `luoi_1`, `luoi_2`, `luoi_3` được mở rộng thành coil pair cụ thể (`service:236-261`):

| Action Key | Mode | Kết quả |
|---|---|---|
| `luoi_1 = 0` | Thu (ngắn) | `luoi_1_thu = true`, `luoi_1_dai = false` |
| `luoi_1 = 1` | Dài | `luoi_1_thu = false`, `luoi_1_dai = true` |

Luoi mapping table:
```typescript
luoiMapping = {
  luoi_1: { thu: "luoi_1_thu", dai: "luoi_1_dai" },
  luoi_2: { thu: "luoi_2_thu", dai: "luoi_2_dai" },
  luoi_3: { thu: "luoi_3_thu", dai: "luoi_3_dai" },
}
```

### 2.3 Classify Keys → Modbus or Config

Load mappings từ env vars (`MODBUS_COILS`, `MODBUS_HOLDING_REGISTERS`, multi-board variants):

| Key nằm trong | Phân loại | Function Code |
|---|---|---|
| `modbusHolding[key]` | Holding Register | FC = 6 (write single register) |
| `modbusCoils[key]` | Coil | FC = 5 (write single coil) |
| Không nằm trong cả 2 | **Config Parameter** | Lưu vào `configKeyValues` |

Quy tắc bỏ qua giá trị falsy:
- **Holding register**: giữ `0` / `false` (cho phép reset về 0)
- **Coil**: bỏ qua giá trị `0` / `false` / falsy (chỉ ghi coil khi ON)
- **Config parameter**: bỏ qua tất cả falsy sau khi type coercion

### 2.4 Scale Value

Nếu có config `scaleConfigs` trong global context, giá trị sẽ được scale trước khi ghi:

```typescript
writeValue = this.scaleValue(cmd.key, cmd.value, 'write');
```

---

## 3. Config Key-Value Flow

### 3.1 Storage (`service:1786-1822`)

Khi key không có trong Modbus mapping:

```
key, value, scheduleId
  ↓ coerceToDeclaredType (theo configKeys global)
  ↓ validateAndConvertValue
  ↓ store vào globalContext.configKeyValues[key] = value
  ↓ track key trong globalContext.scheduleConfigKeys[scheduleId].push(key)
```

Config keys đã biết (được exclued từ overlap check):
```
iri_time, set_ec, set_ph, control_mode, iri_sensor_mode, water_only_time,
cycle_ec, cycle_ph, time_on_valve_01-05, set_flow, set_flow_1-5,
volume_factor_01-05, volume_factor_main, flow_factor_01-05, flow_factor_main,
pressure_div_factor, pressure_sub_factor, min_pressure_limit, max_pressure_limit,
EC_max, EC_min
```

### 3.2 Publishing

Config parameters được publish qua MQTT ngay khi store:
```typescript
await scheduleService.publishConfigUpdate(thingsboardClient, emqxClient, configParam);
```

Dedup cache bị clear trước mỗi lần publish để đảm bảo giá trị mới luôn được gửi.

### 3.3 Cleanup on Finish (`service:1858-1892`)

```typescript
clearScheduleConfigValues(scheduleId) → Record<string, any>
```

Reset mỗi key về giá trị mặc định theo type:
| Type | Default khi finish |
|---|---|
| `number` | `0` |
| `boolean` | `false` |
| `string` | `''` |

Giá trị reset được trả về để publish telemetry (gửi về ThingsBoard/EMQX).

---

## 4. Schedule STARTS Running

### 4.1 Trigger Condition (`executor.ts:689`)

```typescript
if (isDue && (schedule.status !== "running" || isStaleRunningStatus))
```

Schedule bắt đầu khi:
- `isDue = true` (đến giờ chạy) **VÀ**
- Status chưa phải `running` (hoặc đang `running` nhưng không có active commands — power recovery)

### 4.2 Step-by-Step Flow

```
┌──────────────────────────────────────────────────────────────┐
│ 1. RESET UNUSED KEYS                                         │
│    - time_valve_*, set_flow* KHÔNG có trong action → ghi 0  │
│    - Gọi resetModbusCommands() với các reset keys           │
├──────────────────────────────────────────────────────────────┤
│ 2. MAP SCHEDULE → MODBUS                                     │
│    - mapScheduleToModbus(schedule)                           │
│    - Kết quả: holdingCommands, coilCommands, configParameters│
├──────────────────────────────────────────────────────────────┤
│ 3. PUBLISH CONFIG PARAMETERS (MQTT)                          │
│    - Clear dedup cache                                       │
│    - publishConfigUpdate() cho mỗi config param              │
├──────────────────────────────────────────────────────────────┤
│ 4. UPDATE STATUS → "running" (DB + sync server)              │
├──────────────────────────────────────────────────────────────┤
│ 5. EXECUTE MODBUS (per-key write → optional read → retry 3) │
│    a. valve_program (HR) then other holdings                │
│    b. Coils: valve → other → WATER_HAMMER_DELAY_MS          │
│       → pump + power_A* → power                             │
│    c. Always storeActiveCommands (incl. valve_program)      │
├──────────────────────────────────────────────────────────────┤
│ 6. VERIFY FAIL does NOT change status                       │
│    - one HTTP noti per failed key                           │
│    - schedule stays running                                 │
├──────────────────────────────────────────────────────────────┤
│ 7. ON TRANSITION (statusChanged = true)                      │
│    - sendNotificationToBackend('start', true)               │
│    - syncScheduleLog / telemetry                            │
│    - publishAuditLog with metadata.steps[] + run_id         │
└──────────────────────────────────────────────────────────────┘
```

### 4.3 Coil Execution Order — START

```
Step 1: valve coils          ← Mở van tưới trước
Step 2: other coils          ← Các thiết bị khác
  ──── 10 second delay ────
Step 3: pump + power_A*      ← Bơm nước + kênh châm phân
Step 4: power (exact key)    ← Bật iri.power / coil 30 sau cùng
```

`power` (coil 30) tách khỏi `power_A*`/`power_B*`. Firmware `IDLE && power==true` sẽ `setMainPump(ON)` ngay, nên không bật `power` trước van.

Mỗi lệnh coil: delay 100ms giữa các lệnh.

---

## 5. Schedule FINISHES

### 5.1 Trigger Condition (`executor.ts:812`)

```typescript
} else if (schedule.status === "running" && !isDue) {
```

Schedule kết thúc khi: đang `running` nhưng không còn `isDue` (đã quá giờ kết thúc).

### 5.2 Step-by-Step Flow

```
┌──────────────────────────────────────────────────────────────┐
│ 1. COMPUTE EXTRA RESET KEYS                                  │
│    - time_valve_*, set_flow* (tất cả, không chỉ trong action)│
│    - Merge với activeCommands (deduplicate)                  │
├──────────────────────────────────────────────────────────────┤
│ 2. RESET MODBUS COMMANDS                                     │
│    - resetModbusCommands(allResetCommands, schedule)         │
│    - Thứ tự RESET (ngược với START):                        │
│      ┌─────────────────────────────────────────┐            │
│      │ Holding registers → ghi 0               │            │
│      │ pump + power_A* → other → power         │            │
│      │ ────── delay 10 seconds ──────          │            │
│      │ valve coils                             │            │
│      └─────────────────────────────────────────┘            │
├──────────────────────────────────────────────────────────────┤
│ 3. CLEAR STATE                                               │
│    - clearActiveCommands(schedule.name)                      │
│    - clearScheduleConfigValues(schedule.name) → resetValues  │
│    - updateScheduleStatus("finished")                        │
│    - clearStatusHistory(schedule.name)                       │
├──────────────────────────────────────────────────────────────┤
│ 4. ON RESET SUCCESS                                          │
│    - sendNotificationToBackend('end', true)                  │
│    - syncScheduleLog(schedule, true)                         │
│    - publishScheduleTelemetry('end', resetCmds, resetValues) │
│    - publishAuditLog('end', resetCmds, true)                 │
├──────────────────────────────────────────────────────────────┤
│ 5. ON RESET FAILURE                                          │
│    - sendNotificationToBackend('end', false)                 │
│    - syncScheduleLog(schedule, false)                        │
│    - publishAuditLog('end', resetCmds, false, errorMsg)      │
│    - Log CRITICAL: "MANUAL INTERVENTION MAY BE REQUIRED"     │
└──────────────────────────────────────────────────────────────┘
```

### 5.3 Coil Execution Order — FINISH (ngược Start)

```
Step 1: pump + power_A*      ← Tắt bơm + kênh châm phân
Step 2: other coils          ← Tắt thiết bị khác
Step 3: power (exact key)    ← Cắt iri.power trước delay (tránh IDLE && power → bơm tự bật)
  ──── 10 second delay ────
Step 4: valve coils          ← Đóng van tưới sau cùng
```

### 5.4 resetModbusCommands Detail (`service:1402-1451`)

Khi `schedule.status === 'finished'`, thứ tự reset luôn là:
1. Holding registers → ghi `0`
2. Pump + `power_A*` coils → ghi `false`
3. Other coils → ghi `false`
4. `power` (coil 30) → ghi `false`
5. **Delay 10 seconds**
6. Valve coils → ghi `false`

Mỗi lệnh: delay 100ms. Nếu có lỗi → `allSuccessful = false`.

---

## 6. Comparison: START vs FINISH

| Aspect | START | FINISH |
|---|---|---|
| **Holding registers** | Ghi giá trị từ action (FC=6, scaled) | Ghi **0** (FC=6) |
| **Coil order** | valve → other → 10s → **pump+power_A*** → **power** | pump+power_A* → other → **power** → 10s → valve |
| **Coil values** | Giá trị từ action (ON) | **false** (OFF) |
| **Config keys** | Store + publish MQTT | Reset về falsy defaults + publish |
| **Reset unused keys** | `time_valve_*`, `set_flow*` không trong action → 0 | `time_valve_*`, `set_flow*` tất cả → 0 |
| **Telemetry** | `start` event + config values | `end` event + reset values |
| **Retries** | Per-key max 3; status stays running | Per-key max 3; status still finished |
| **Verification** | Immediate per-key read-back; does not gate status | Same flags; failed OFF keys still finish |

---

## 7. Auto-Recovery (`service:1295-1397`)

Chạy trên mỗi input trigger, kiểm tra schedule bị stuck "running":

1. Nếu schedule `running` và đã quá end time **≥ 2 phút**:
   - Đọc Modbus verify thiết bị có thực sự OFF chưa
   - Nếu **OFF confirm** → tự set `finished`, clear state, gửi notification
   - Nếu **vẫn ON** và đã **≥ 3 phút** → thử `resetModbusCommands()` lần nữa
   - Nếu reset fail → giữ nguyên `running`, log CRITICAL

2. Startup recovery (`executor.ts:20-91`):
   - Mỗi lần Node-RED deploy, generate `startupId` mới
   - Clear stale state: `activeModbusCommands`, `scheduleStatusHistory`, `scheduleLastCheckTimestamps`
   - **Giữ**: `configKeyValues` và `scheduleConfigKeys` (không reset cấu hình)

---

## 8. Verification (per-key)

| Config | Coil Verify | Holding Verify |
|---|---|---|
| Default | **Bỏ qua** (`skipCoilVerify = true`) | **Bật** (`verifyAfterWrite = true`) |

- Verify is per-key immediately after that key's write (not a batch after the sequence)
- Retry is that key only (max 3). Status `running`/`finished` is never gated by verify
- Audit MQTT envelopes include `metadata.steps[]` and `metadata.run_id`
- START writes derived `valve_program` (valve_0…15 bitmask) before coil `power` when address 20 is free

---

## 9. Data Flow Diagram

```
Schedule DB
    │
    ▼
schedule.action (JSON string)
    │
    ├──► parse JSON → actionObj
    │
    ├──► expandLuoiActionParams() → luoi_1/thu, luoi_1/dai, ...
    │
    ├──► normalizeNumbers() → string "1,800" → number 1800
    │
    ├──► mapScheduleToModbus()
    │       │
    │       ├── Key trong modbusHolding? → holdingCommands[FC=6]
    │       │
    │       ├── Key trong modbusCoils? → coilCommands[FC=5]
    │       │
    │       └── Không nằm ở cả 2? → configParameters
    │               │
    │               ├── storeConfigParameter() → globalContext.configKeyValues
    │               │
    │               └── publishConfigUpdate() → MQTT (ThingsBoard/EMQX)
    │
    └──► executeModbusCommands(modbusClient, commands, schedule)
            │
            ├── START:  valve→other→10s→pump+power_A*→power
            │
            └── FINISH: pump+power_A*→other→power→10s→valve
                    │
                    └── resetModbusCommands() → ghi 0/false
```

---

## 10. Key Global Context Variables

| Variable | Type | Purpose |
|---|---|---|
| `activeModbusCommands` | `Record<string, ModbusCmd[]>` | Lệnh Modbus đang active theo schedule name |
| `configKeyValues` | `Record<string, any>` | Config key-value hiện tại (cho MQTT/telemetry) |
| `scheduleConfigKeys` | `Record<string, string[]>` | Track key nào thuộc schedule nào (cho cleanup) |
| `scheduleStatusHistory` | `Record<string, string>` | Track status cuối cùng (cho notification dedup) |
| `scheduleLastCheckTimestamps` | `Record<string, number>` | Timestamp check cuối (cho auto-recovery interval) |
| `scaleConfigs` | `Record<string, ScaleConfig>` | Config scale cho holding registers |
| `configKeys` | `Record<string, string>` | Khai báo type cho config keys (number/boolean/string) |
| `modbusCoils` / `modbusHoldingRegisters` | Env vars | Mapping key → Modbus address |
| `MODBUS_BOARDS` | Env var | Multi-board config (nếu có nhiều board Modbus) |
