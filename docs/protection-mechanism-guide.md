# VIIS Protection Mechanism — Node-RED Configuration Guide

> Created: 2026-06-09
> For: Device profile configuration on ThingsBoard

## Tổng quan

Protection mechanism bảo vệ thiết bị khỏi các tình huống nguy hiểm:

- **Quá thời gian ON** → tự động tắt (tránh cháy nổ, quá nhiệt)
- **Thời gian OFF chưa đủ** → chặn bật lại (tránh rapid cycling)
- **Sensor vượt ngưỡng** → chặn hoặc tự động điều khiển
- **Force ON/OFF** → ghi đè thủ công
- **Bypass** → bỏ qua tất cả protection

Protection hoạt động ở **3 nguồn ghi coil**:

| Nguồn | Kiểm tra protection? | File |
|-------|---------------------|------|
| Schedule (V1 + V2) | ✅ `checkGate()` trước khi ghi | `viis-schedule-executor-service.ts` |
| RPC (mobile app) | ✅ `checkGate()` trước khi ghi | `rpcHandler.ts` |
| Device Intent | ✅ `checkGate()` trước khi output | `processingService.ts` |
| Protection Node (timer) | ✅ Tự enforce + auto-OFF | `viis-device-protection.ts` |

---

## Cấu hình Production Functions

### Quy tắc đặt tên

Mọi protection setting là một **production function** trong ThingsBoard (`tabiot_production_function`).

Format: `{deviceType}_protect_all_{field}` hoặc `{coilKey}_protect_{field}`

- `{deviceType}_protect_all_{field}`: Áp dụng cho tất cả coil thuộc device type (ví dụ: tất cả đèn, tất cả quạt intake)
- `{coilKey}_protect_{field}`: Áp dụng cho 1 coil cụ thể (ví dụ: chỉ lamp_control_1)

### Coil keys (thiết bị control được)

```
modbus_board1_coils = {
  "lamp_control_1":       1,
  "lamp_control_2":       2,
  "co2_control_valve":    3,
  "humid_control_on":     4,
  "fan_control_intake":   5,
  "cool_control_freezer_1": 6,
  "fan_control_circ":     7,
  "fan_control_dc":       8,
  "dehumid_control_1":    9,
  "dehumid_control_2":    10,
  "cool_control_ac1":     11,
  "cool_control_ac2":     12,
  "cool_control_freezer_2": 13,
  "backup_control_2":     14,
  "backup_control_3":     15,
  "backup_control_4":     16
}
```

### Danh sách field được nhận diện

Code nhận diện các field sau trong identifier (regex pattern):

| Field | Description | Type | Unit |
|-------|-------------|------|------|
| `bypass` | Bỏ qua tất cả protection | Bool | - | - |
| `force_on` | Ghi đè bật liên tục | Bool | - | - |
| `force_off` | Ghi đè tắt liên tục | Bool | - | - |
| `max_time_on` | Thời gian ON tối đa trước khi auto-OFF | Value | giây (s) hoặc phút (m) | - |
| `min_time_on` | Thời gian ON tối thiểu (chặn tắt sớm) | Value | s hoặc m | - |
| `min_off_time` | Thời gian OFF tối thiểu (chặn bật lại quá nhanh) | Value | s hoặc m | |
| `upper_temp` | Ngưỡng trên (sensor) → chặn/auto | Value | ℃ / % / ppm | |
| `lower_temp` | Ngưỡng dưới (sensor) → chặn/auto | Value | ℃ / % / ppm | |
| `pulse_time_on` | Thời gian ON mỗi chu kỳ (pulse mode) | Value | phút (m) | - |
| `pulse_time_off` | Thời gian OFF mỗi chu kỳ (pulse mode) | Value | phút (m) | - |
| `sensor_id` | ID của sensor để check ngưỡng | String | - | - |

### 2-Level Config Lookup

Khi protection node check coil `lamp_control_1`, nó tìm config theo thứ tự ưu tiên:

```
Priority 1 (Specific coil):   lamp_control_1_protect_max_time_on = 3600
Priority 2 (All same type):    lamp_protect_all_max_time_on = 7200
```

→ Nếu `lamp_control_1` có config riêng → dùng. Nếu không → dùng config `_all_`.

**Sub-type lookup** (chỉ áp dụng cho FAN và COOLING):

```
fan_control_intake → fan_protect_all → fan_protect_intake
fan_control_circ   → fan_protect_all → fan_protect_circ
fan_control_dc     → fan_protect_all → fan_protect_dc
cool_control_ac1   → cool_protect_all → cool_protect_1
cool_control_ac2   → cool_protect_all → cool_protect_2
cool_control_freezer → cool_protect_all → cool_protect_freezer
```

---

## Mapping Device Profile → Production Functions

### ⚠️ CẦN ĐIỀU CHỈNH (Naming Mismatch)

Device profile hiện tại dùng **tên khác** với code. Bảng sau mapping lại:

| Device Profile Identifier | → Production Function Identifier | Ghi chú |
|--------------------------|----------------------------------|---------|
| `lamp_protect_min_time_off` | `lamp_protect_all_min_off_time` | Đổi `min_time_off` → `min_off_time`, thêm `_all_` |
| `lamp_protect_max_temp_on` | `lamp_protect_all_upper_temp` | Đổi `max_temp_on` → `upper_temp`, thêm `_all_` |
| `fan_protect_intake_min_time_off` | `fan_protect_intake_min_off_time` | Đổi `min_time_off` → `min_off_time` |
| `fan_protect_circ_min_time_off` | `fan_protect_circ_min_off_time` | Đổi tên |
| `fan_protect_dc_min_time_off` | `fan_protect_dc_min_off_time` | Đổi tên |
| `cool_protect_min_time_off` | `cool_protect_all_min_off_time` | Đổi tên, thêm `_all_` |

### ✅ ĐÃ ĐÚNG (không cần đổi)

| Device Profile Identifier | Production Function Identifier | Status |
|--------------------------|-------------------------------|--------|
| `lamp_protect_bypass` | `lamp_protect_all_bypass` | ✅ (thêm `_all_`) |
| `lamp_protect_force_on` | `lamp_protect_all_force_on` | ✅ (thêm `_all_`) |
| `lamp_protect_force_off` | `lamp_protect_all_force_off` | ✅ (thêm `_all_`) |
| `lamp_protect_max_time_on` | `lamp_protect_all_max_time_on` | ✅ (thêm `_all_`) |
| `fan_protect_intake_bypass` | `fan_protect_intake_bypass` | ✅ |
| `fan_protect_intake_force_on` | `fan_protect_intake_force_on` | ✅ |
| `fan_protect_intake_force_off` | `fan_protect_intake_force_off` | ✅ |
| `fan_protect_intake_max_time_on` | `fan_protect_intake_max_time_on` | ✅ |
| `cool_protect_bypass` | `cool_protect_all_bypass` | ✅ (thêm `_all_`) |
| `cool_protect_force_on` | `cool_protect_all_force_on` | ✅ (thêm `_all_`) |
| `cool_protect_force_off` | `cool_protect_all_force_off` | ✅ (thêm `_all_`) |
| `cool_protect_max_time_on` | `cool_protect_all_max_time_on` | ✅ (thêm `_all_`) |
| `cool_protect_upper_temp` | `cool_protect_all_upper_temp` | ✅ (thêm `_all_`) |
| `cool_protect_lower_temp` | `cool_protect_all_lower_temp` | ✅ (thêm `_all_`) |
| `humid_protect_bypass` | `humid_protect_all_bypass` | ✅ (thêm `_all_`) |
| `humid_protect_force_on` | `humid_protect_all_force_on` | ✅ (thêm `_all_`) |
| `humid_protect_force_off` | `humid_protect_all_force_off` | ✅ (thêm `_all_`) |
| `humid_protect_max_time_on` | `humid_protect_all_max_time_on` | ✅ (thêm `_all_`) |
| `humid_protect_min_time_off` | `humid_protect_all_min_off_time` | ⚠️ Đổi tên + thêm `_all_` |
| `humid_protect_upper_limit` | `humid_protect_all_upper_limit` | ✅ (thêm `_all_`) |
| `dehumid_protect_bypass` | `dehumid_protect_all_bypass` | ✅ (thêm `_all_`) |
| `dehumid_protect_force_on` | `dehumid_protect_all_force_on` | ✅ (thêm `_all_`) |
| `dehumid_protect_force_off` | `dehumid_protect_all_force_off` | ✅ (thêm `_all_`) |
| `dehumid_protect_max_time_on` | `dehumid_protect_all_max_time_on` | ✅ (thêm `_all_`) |
| `dehumid_protect_min_time_off` | `dehumid_protect_all_min_off_time` | ⚠️ Đổi tên + thêm `_all_` |
| `dehumid_protect_lower_limit` | `dehumid_protect_all_lower_limit` | ✅ (thêm `_all_`) |
| `co2_protect_bypass` | `co2_protect_all_bypass` | ✅ (thêm `_all_`) |
| `co2_protect_force_on` | `co2_protect_all_force_on` | ✅ (thêm `_all_`) |
| `co2_protect_force_off` | `co2_protect_all_force_off` | ✅ (thêm `_all_`) |
| `co2_protect_max_time_on` | `co2_protect_all_max_time_on` | ✅ (thêm `_all_`) |
| `co2_protect_min_time_off` | `co2_protect_all_min_off_time` | ⚠️ Đổi tên + thêm `_all_` |
| `co2_protect_upper_limit` | `co2_protect_all_upper_limit` | ✅ (thêm `_all_`) |
| `co2_protect_lower_limit` | `co2_protect_all_lower_limit` | ✅ (thêm `_all_`) |

### FAN Protection — Mapping chi tiết

FAN có 3 loại con, mỗi loại cần **protection group riêng**:

| Coil Key | Protection Group (profile) | Config Lookup |
|----------|---------------------------|---------------|
| `fan_control_intake` | `fan_protect_intake_*` | `fan_control_intake_protect_*` → `fan_protect_all_*` → `fan_protect_intake_*` |
| `fan_control_circ` | `fan_protect_circ_*` | `fan_control_circ_protect_*` → `fan_protect_all_*` → `fan_protect_circ_*` |
| `fan_control_dc` | `fan_protect_dc_*` | `fan_control_dc_protect_*` → `fan_protect_all_*` → `fan_protect_dc_*` |

**Lưu ý**: Code `configService.ts` đã xử lý mapping này (lines 119-127):
- `fan_control_intake` → lookup `fan_protect_intake`
- `fan_control_circ` → lookup `fan_protect_circ`
- `fan_control_dc` → lookup `fan_protect_dc`

---

## Sensor Binding

### Cách hoạt động

Protection cần biết **giá trị sensor** để check `upper_temp`/`lower_temp`/`upper_limit`/`lower_limit`.

Sensor binding qua field `sensor_id` — giá trị là **identifier của sensor** trong device profile.

### Sensor identifiers có sẵn

| Identifier | Unit | Description |
|-----------|------|-------------|
| `temp_monitor_sensor_1` | ℃ | Temperature sensor 1 |
| `humid_monitor_sensor_1` | % | Humidity sensor 1 |
| `co2_monitor_sensor_1` | ppm | CO2 sensor 1 |
| `lamp_monitor_sensor_1` | lx | Light sensor 1 |
| `temp_monitor_sensor_2` | ℃ | Temperature sensor 2 |
| `humid_monitor_sensor_2` | % | Humidity sensor 2 |
| `co2_monitor_sensor_2` | ppm | CO2 sensor 2 |
| `cool_monitor_Aquara_temp_1` | ℃ | Aquara temp 1 |
| `cool_monitor_Aquara_temp_2` | ℃ | Aquara temp 2 |
| `humid_monitor_Aquara_humid_1` | % | Aquara humidity 1 |
| `humid_monitor_Aquara_humid_2` | % | Aquara humidity 2 |

### Cách cấu hình sensor_id

**Option A: Per-device-type (khuyên dùng)**

```
cool_protect_all_sensor_id = "cool_monitor_Aquara_temp_1"
→ Tất cả thiết bị cool (ac1, ac2, freezer) check Aquara temp 1
```

**Option B: Per-coil (ghi đè riêng)**

```
cool_control_ac1_protect_sensor_id = "cool_monitor_Aquara_temp_1"
cool_control_ac2_protect_sensor_id = "cool_monitor_Aquara_temp_2"
→ AC1 check sensor 1, AC2 check sensor 2
```

**Option C: All rule** (tương đương Option A cho sensor_id)

```
cool_protect_all_sensor_id = "cool_monitor_Aquara_temp_1"
→ Tất cả cool_control_* check cùng 1 sensor
```

→ Option A và Option C giống nhau cho sensor_id. Chọn 1 trong 2.

### Sensor auto-mapping (trong protection node timer)

Nếu **không set sensor_id**, protection node tự map theo tên coil:

| Coil chứa | Auto-map sensor |
|-----------|----------------|
| `cool`, `ac` | `cool_monitor_Aquara_temp_1` → `cool_Aquara_temp_1` |
| `humid` | `humid_sensor_1` → `humid_monitor_Aquara_humid_1` |
| `dehumid` | `humid_sensor_1` → `humid_monitor_Aquara_humid_1` |
| `co2` | `co2_sensor_1` |

**Khuyến nghị**: Luôn set `sensor_id` rõ ràng, không dựa vào auto-mapping.

---

## Cấu hình theo thiết bị

### LAMP (đèn)

```
── All lamp protection (áp dụng cho tất cả lamp) ──
lamp_protect_all_bypass        = false    (Bool)
lamp_protect_all_force_on      = false    (Bool)
lamp_protect_all_force_off     = false    (Bool)
lamp_protect_all_max_time_on   = 14400    (Value, giây — 4 giờ)
lamp_protect_all_min_off_time  = 300      (Value, giây — 5 phút)

── Per-coil override (tuỳ chọn) ──
lamp_control_1_protect_max_time_on = 7200   (Value, giây — 2 giờ)
lamp_control_1_protect_sensor_id   = "temp_monitor_sensor_1"
lamp_control_1_protect_upper_temp  = 35     (Value, ℃)
```

**Giải thích**:
- `max_time_on = 14400`: Đèn không được sáng liên tục quá 4 giờ → auto-OFF
- `min_off_time = 300`: Sau khi tắt, phải chờ ít nhất 5 phút mới được bật lại
- `upper_temp = 35`: Nếu nhiệt độ > 35℃ → chặn bật đèn (tránh quá nhiệt)

### FAN (quạt)

```
── FAN Intake ──
fan_protect_intake_bypass        = false
fan_protect_intake_force_on      = false
fan_protect_intake_force_off     = false
fan_protect_intake_max_time_on   = 7200    (2 giờ)
fan_protect_intake_min_off_time  = 120     (2 phút)

── FAN Circulation ──
fan_protect_circ_bypass        = false
fan_protect_circ_force_on      = false
fan_protect_circ_force_off     = false
fan_protect_circ_max_time_on   = 7200
fan_protect_circ_min_off_time  = 120

── FAN DC ──
fan_protect_dc_bypass        = false
fan_protect_dc_force_on      = false
fan_protect_dc_force_off     = false
fan_protect_dc_max_time_on   = 7200
fan_protect_dc_min_off_time  = 120
```

### COOLING (máy lạnh / freezer)

```
── All cooling protection ──
cool_protect_all_bypass        = false
cool_protect_all_force_on      = false
cool_protect_all_force_off     = false
cool_protect_all_max_time_on   = 180      (Value, PHÚT — 3 giờ)
cool_protect_all_min_off_time  = 10       (Value, PHÚT — 10 phút)
cool_protect_all_upper_temp    = 30       (Value, ℃ — trên 30℃ → auto ON)
cool_protect_all_lower_temp    = 18       (Value, ℃ — dưới 18℃ → auto OFF)
cool_protect_all_sensor_id     = "cool_monitor_Aquara_temp_1"

── Per-coil override ──
cool_control_ac1_protect_max_time_on = 120
cool_control_ac1_protect_sensor_id   = "cool_monitor_Aquara_temp_1"
cool_control_ac2_protect_sensor_id   = "cool_monitor_Aquara_temp_2"
```

**Lưu ý**: `max_time_on` và `min_off_time` cho COOLING tính bằng **phút** (không phải giây).

### HUMIDITY (máy tạo ẩm)

```
humid_protect_all_bypass        = false
humid_protect_all_force_on      = false
humid_protect_all_force_off     = false
humid_protect_all_max_time_on   = 3600     (giây — 1 giờ)
humid_protect_all_min_off_time  = 300      (giây — 5 phút)
humid_protect_all_upper_limit   = 85       (% — trên 85% → chặn bật)
humid_protect_all_sensor_id     = "humid_monitor_Aquara_humid_1"
```

### DE-HUMIDITY (máy hút ẩm)

```
dehumid_protect_all_bypass        = false
dehumid_protect_all_force_on      = false
dehumid_protect_all_force_off     = false
dehumid_protect_all_max_time_on   = 3600
dehumid_protect_all_min_off_time  = 300
dehumid_protect_all_lower_limit   = 40      (% — dưới 40% → chặn bật)
dehumid_protect_all_sensor_id     = "humid_monitor_Aquara_humid_1"
```

### CO2

```
co2_protect_all_bypass        = false
co2_protect_all_force_on      = false
co2_protect_all_force_off     = false
co2_protect_all_max_time_on   = 600       (giây — 10 phút)
co2_protect_all_min_off_time  = 120       (giây — 2 phút)
co2_protect_all_upper_limit   = 1500      (ppm — trên 1500 → auto ON)
co2_protect_all_lower_limit   = 400       (ppm — dưới 400 → chặn bật)
co2_protect_all_sensor_id     = "co2_monitor_sensor_1"
```

---

## Priority Flow

```
checkGate(coilKey, requestedValue)
│
├── requestedValue = OFF → ALWAYS ALLOW ✅
│
├── bypass = true → ALLOW ✅ (skip all checks)
│
├── forceOn + forceOff → BLOCK ❌ (safety: ưu tiên OFF)
│
├── forceOff → BLOCK ON ❌
│
├── requestedValue = ON:
│   ├── maxTimeOn exceeded? → BLOCK ❌
│   ├── minOffTime not met? → BLOCK ❌
│   ├── sensor > upperLimit? → BLOCK ❌
│   ├── sensor < lowerLimit? → BLOCK ❌ (cooling: auto OFF)
│   └── All clear → ALLOW ✅
│
└── forceOn → ALLOW ✅ (vẫn check maxTimeOn cho safety)
```

---

## Pulse Mode (Config)

Pulse mode cho phép thiết bị chạy theo chu kỳ ON/OFF lặp lại:

```
lamp_config_pulse_time_on  = 30   (phút — ON 30 phút)
lamp_config_pulse_time_off = 10   (phút — OFF 10 phút)
```

**Lưu ý**: Pulse config là **config**, không phải protection. Nằm trong tab "Config" của device profile.

---

## Checklist triển khai

### Bước 1: Sửa naming mismatch

- [ ] Đổi `min_time_off` → `min_off_time` cho tất cả device types
- [ ] Đổi `lamp_protect_max_temp_on` → `lamp_protect_upper_temp`

### Bước 2: Thêm sensor_id (nếu chưa có)

- [ ] `cool_protect_all_sensor_id` = `"cool_monitor_Aquara_temp_1"`
- [ ] `humid_protect_all_sensor_id` = `"humid_monitor_Aquara_humid_1"`
- [ ] `dehumid_protect_all_sensor_id` = `"humid_monitor_Aquara_humid_1"`
- [ ] `co2_protect_all_sensor_id` = `"co2_monitor_sensor_1"`

### Bước 3: Set giá trị hợp lý

- [ ] `max_time_on`: Giá trị dương, > 0 để enable
- [ ] `min_off_time`: Giá trị dương, > 0 để enable
- [ ] `upper_temp`/`lower_temp`: Phải set cả `sensor_id` nếu dùng sensor limits
- [ ] `bypass`: Chỉ bật khi debug/test

### Bước 4: Verify trên Node-RED

- [ ] Deploy `viis-device-protection` node (khởi tạo ProtectionGateService)
- [ ] Check debug log: `ProtectionGateService initialized and stored in global context`
- [ ] Trigger schedule → check log: `[PROTECTION] Schedule coil blocked: ...` nếu bị block
- [ ] Check MQTT telemetry: protection events được publish

---

## Troubleshooting

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|------------|-----------|
| Protection không hoạt động | `viis-device-protection` node chưa deploy | Deploy node, check global context |
| Config không nhận | Sai identifier format | Đảm bảo `{type}_protect_all_{field}` đúng |
| Sensor không check được | Chưa set `sensor_id` | Thêm `{type}_protect_sensor_id` |
| FAN chung config | Dùng `fan_protect_*` thay vì `fan_protect_intake_*` | Set riêng cho từng loại fan |
| Thời gian sai unit | Phút vs Giây | COOLING dùng phút, các loại khác dùng giây |
| Block mãi không ON | `min_off_time` quá lớn | Giảm giá trị hoặc bypass |
