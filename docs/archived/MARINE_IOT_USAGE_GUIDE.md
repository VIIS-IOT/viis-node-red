# Marine IoT System - Hướng Dẫn Sử Dụng Thực Tế

## 📋 Tổng Quan

Hệ thống Marine IoT cho phép quản lý profile dầu độc lập cho 3 loại máy:
- **Main Engine (Máy chính)**: fs01, fs02
- **Generator (Máy phát)**: fs03, fs04  
- **Boiler (Nồi hơi)**: fs05, fs06

Mỗi máy có thể sử dụng loại dầu khác nhau (DO, FO) với density riêng.

---

## 🚀 Quick Start

### Bước 1: Setup Initial Profiles

```bash
# Token authentication
export TOKEN="your_jwt_token_here"
export BASE_URL="http://localhost:1880/api/v2"

# Tạo profile cho Generator (DO - Diesel Oil)
curl -X POST $BASE_URL/oil-profiles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "ship_001",
    "machine_type": "GENERATOR",
    "oil_type": "DO",
    "operating_temperature": 40,
    "density": 850,
    "label": "Generator DO Standard",
    "is_active": true
  }'

# Tạo profile cho Main Engine (FO - Fuel Oil)
curl -X POST $BASE_URL/oil-profiles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "ship_001",
    "machine_type": "MAIN_ENGINE",
    "oil_type": "FO",
    "operating_temperature": 150,
    "density": 950,
    "label": "Main Engine FO Standard",
    "is_active": true
  }'

# Tạo profile cho Boiler (FO - Fuel Oil)
curl -X POST $BASE_URL/oil-profiles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "ship_001",
    "machine_type": "BOILER",
    "oil_type": "FO",
    "operating_temperature": 100,
    "density": 940,
    "label": "Boiler FO Standard",
    "is_active": true
  }'
```

### Bước 2: Verify Setup

```bash
# Kiểm tra profile của từng máy
curl -X GET "$BASE_URL/oil-profiles/active/ship_001/GENERATOR" \
  -H "Authorization: Bearer $TOKEN"

curl -X GET "$BASE_URL/oil-profiles/active/ship_001/MAIN_ENGINE" \
  -H "Authorization: Bearer $TOKEN"

curl -X GET "$BASE_URL/oil-profiles/active/ship_001/BOILER" \
  -H "Authorization: Bearer $TOKEN"
```

### Bước 3: Xem Telemetry Data

```bash
# Lấy dữ liệu real-time với profile tracking
curl -X GET "$BASE_URL/marine/telemetry/latest/ship_001?keys=fs01,fs02,fs03,fs04,fs05,fs06" \
  -H "Authorization: Bearer $TOKEN"
```

**Response Example:**
```json
{
  "device_id": "ship_001",
  "timestamp": 1737369180000,
  "data": [
    {
      "key_name": "fs01",
      "value": 1000,
      "value_tons": 850.0,
      "oil_profile_id": "generator_do_001",
      "density_snapshot": 850,
      "machine_type": "GENERATOR"
    },
    {
      "key_name": "fs03",
      "value": 1200,
      "value_tons": 1140.0,
      "oil_profile_id": "main_engine_hfo_001",
      "density_snapshot": 950,
      "machine_type": "MAIN_ENGINE"
    }
  ],
  "machines": {
    "GENERATOR": {
      "flow_in": { "key": "fs01", "m3h": 1000, "th": 850.0 },
      "flow_return": { "key": "fs02", "m3h": 980, "th": 833.0 },
      "consumption_rate": { "m3h": 20, "th": 17.0 },
      "oil_profile": "generator_do_001",
      "density": 850
    },
    "MAIN_ENGINE": {
      "flow_in": { "key": "fs03", "m3h": 1200, "th": 1140.0 },
      "flow_return": { "key": "fs04", "m3h": 1150, "th": 1092.5 },
      "consumption_rate": { "m3h": 50, "th": 47.5 },
      "oil_profile": "main_engine_hfo_001",
      "density": 950
    },
    "BOILER": {
      "flow_in": { "key": "fs05", "m3h": 800, "th": 752.0 },
      "flow_return": { "key": "fs06", "m3h": 750, "th": 705.0 },
      "consumption_rate": { "m3h": 50, "th": 47.0 },
      "oil_profile": "boiler_bo_001",
      "density": 940
    }
  }
}
```

---

## 📊 Use Cases

### Case 1: Đổi Loại Dầu Cho Generator (Main Engine Không Đổi)

**Scenario:** Generator đang dùng DO, cần chuyển sang HFO

```bash
# 1. Tạo profile HFO mới cho Generator
curl -X POST $BASE_URL/oil-profiles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "ship_001",
    "machine_type": "GENERATOR",
    "oil_type": "HFO",
    "operating_temperature": 150,
    "density": 950,
    "label": "Generator HFO"
  }'
# Response: { "name": "profile_hfo_1737369180", ... }

# 2. Activate profile mới
curl -X POST $BASE_URL/oil-profiles/activate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"profile_name": "profile_hfo_1737369180"}'

# 3. Verify
curl -X GET "$BASE_URL/oil-profiles/active/ship_001/GENERATOR" \
  -H "Authorization: Bearer $TOKEN"
# Returns: HFO profile (950 kg/m³)

curl -X GET "$BASE_URL/oil-profiles/active/ship_001/MAIN_ENGINE" \
  -H "Authorization: Bearer $TOKEN"
# Returns: Vẫn là HFO profile cũ (không đổi)
```

**Kết quả:**
- ✅ Generator: DO (850) → HFO (950) 
- ✅ Main Engine: HFO (950) - không thay đổi
- ✅ Boiler: BO (940) - không thay đổi
- ✅ Telemetry data từ bây giờ sẽ lưu profile mới
- ✅ Historical data giữ nguyên profile cũ

### Case 2: Update Density Sau Lab Test

**Scenario:** Lab test cho thấy density thực tế của DO là 855 kg/m³ (không phải 850)

```bash
# 1. Tìm profile name
curl -X GET "$BASE_URL/oil-profiles?device_id=ship_001&machine_type=GENERATOR&is_active=true" \
  -H "Authorization: Bearer $TOKEN"
# Returns: { "profiles": [{ "name": "generator_do_001", ... }] }

# 2. Update density
curl -X PUT $BASE_URL/oil-profiles/generator_do_001 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "density": 855,
    "description": "Updated after lab test on 2025-01-20"
  }'

# 3. Verify
curl -X GET "$BASE_URL/oil-profiles/active/ship_001/GENERATOR" \
  -H "Authorization: Bearer $TOKEN"
# Returns: density: 855
```

**Lưu ý:**
- ⚠️ Telemetry data mới sẽ dùng 855 kg/m³
- ⚠️ Historical data vẫn giữ density cũ (850 kg/m³) trong snapshot
- ✅ Đúng behavior: Historical data integrity được bảo toàn

### Case 3: Query Lưu Lượng Tích Luỹ Theo Giờ

**Scenario:** Xem consumption của Generator ngày 2025-01-20

```sql
-- Query từ database
SELECT 
    sensor_key,
    hour_start,
    hour_end,
    avg_flow_m3h,
    accumulated_m3,
    accumulated_tons,
    oil_profile_id,
    density_used,
    sample_count
FROM tabiot_flow_accumulation
WHERE device_id = 'ship_001'
  AND sensor_key IN ('fs01', 'fs02')  -- Main Engine sensors
  AND hour_start >= '2025-01-20 00:00:00'
  AND hour_start < '2025-01-21 00:00:00'
ORDER BY sensor_key, hour_start;
```

**Sample Result:**
```
sensor_key | hour_start          | avg_flow_m3h | accumulated_m3 | accumulated_tons | oil_profile_id   | density_used
-----------+---------------------+--------------+----------------+------------------+------------------+-------------
fs01       | 2025-01-20 00:00:00 | 1000         | 1000           | 850.0            | generator_do_001 | 850
fs01       | 2025-01-20 01:00:00 | 1050         | 1050           | 892.5            | generator_do_001 | 850
fs01       | 2025-01-20 02:00:00 | 1020         | 1020           | 969.0            | generator_hfo_001| 950  <- Đổi profile
fs02       | 2025-01-20 00:00:00 | 980          | 980            | 833.0            | generator_do_001 | 850
```

**Insight:**
- Giờ 02:00 đổi từ DO (850) sang HFO (950)
- Giờ 00:00-01:00: Tính với density 850
- Giờ 02:00+: Tính với density 950
- Không recalculate historical data

### Case 4: Tạo Alternative Profiles (Không Active)

**Scenario:** Tạo sẵn profiles cho mùa đông/hè

```bash
# Profile mùa hè cho Generator (DO với temp cao hơn)
curl -X POST $BASE_URL/oil-profiles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "ship_001",
    "machine_type": "GENERATOR",
    "oil_type": "DO",
    "operating_temperature": 50,
    "density": 845,
    "label": "Generator DO Summer",
    "is_active": false
  }'

# Profile mùa đông cho Generator (DO với temp thấp hơn)
curl -X POST $BASE_URL/oil-profiles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "ship_001",
    "machine_type": "GENERATOR",
    "oil_type": "DO",
    "operating_temperature": 30,
    "density": 855,
    "label": "Generator DO Winter",
    "is_active": false
  }'

# Khi cần, activate profile phù hợp
curl -X POST $BASE_URL/oil-profiles/activate \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"profile_name": "generator_do_summer_001"}'
```

---

## 🔍 Monitoring & Verification

### Check All Profiles

```bash
# List tất cả profiles của device
curl -X GET "$BASE_URL/oil-profiles?device_id=ship_001" \
  -H "Authorization: Bearer $TOKEN"

# Filter by machine
curl -X GET "$BASE_URL/oil-profiles?device_id=ship_001&machine_type=GENERATOR" \
  -H "Authorization: Bearer $TOKEN"

# Filter by oil type
curl -X GET "$BASE_URL/oil-profiles?device_id=ship_001&oil_type=HFO" \
  -H "Authorization: Bearer $TOKEN"

# Only active profiles
curl -X GET "$BASE_URL/oil-profiles?device_id=ship_001&is_active=true" \
  -H "Authorization: Bearer $TOKEN"
```

### Verify Telemetry Tracking

```sql
-- Check recent telemetry có profile tracking không
SELECT 
    key_name,
    float_value,
    oil_profile_id,
    density_snapshot,
    FROM_UNIXTIME(timestamp/1000) as time
FROM tabiot_device_telemetry
WHERE device_id = 'ship_001'
  AND key_name IN ('fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06')
ORDER BY timestamp DESC
LIMIT 10;
```

**Expected Output:**
```
key_name | float_value | oil_profile_id     | density_snapshot | time
---------+-------------+--------------------+------------------+---------------------
fs01     | 1000        | generator_do_001   | 850              | 2025-01-20 03:00:00
fs02     | 980         | generator_do_001   | 850              | 2025-01-20 03:00:00
fs03     | 1200        | main_engine_hfo_001| 950              | 2025-01-20 03:00:00
fs04     | 1150        | main_engine_hfo_001| 950              | 2025-01-20 03:00:00
fs05     | 800         | boiler_bo_001      | 940              | 2025-01-20 03:00:00
fs06     | 750         | boiler_bo_001      | 940              | 2025-01-20 03:00:00
```

---

## 🛠️ Troubleshooting

### Issue 1: Telemetry không có oil_profile_id

**Triệu chứng:**
```sql
SELECT * FROM tabiot_device_telemetry WHERE key_name = 'fs01' LIMIT 1;
-- oil_profile_id = NULL, density_snapshot = NULL
```

**Nguyên nhân:**
- Không có active profile cho machine đó
- viis-marine-telemetry node chưa deploy
- Profile cache chưa refresh (chờ 5 phút)

**Giải pháp:**
```bash
# 1. Check có active profile không
curl -X GET "$BASE_URL/oil-profiles/active/ship_001/GENERATOR" \
  -H "Authorization: Bearer $TOKEN"

# 2. Nếu null, tạo và activate profile
curl -X POST $BASE_URL/oil-profiles \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "device_id": "ship_001",
    "machine_type": "GENERATOR",
    "oil_type": "DO",
    "operating_temperature": 40,
    "density": 850,
    "is_active": true
  }'

# 3. Chờ 5 phút hoặc restart Node-RED flow
```

### Issue 2: Không thể delete profile

**Error:**
```json
{
  "success": false,
  "error": {
    "type": "BadRequestError",
    "message": "Cannot delete active profile. Please activate another profile first."
  }
}
```

**Giải pháp:**
```bash
# 1. Tạo profile mới
curl -X POST $BASE_URL/oil-profiles \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "device_id": "ship_001",
    "machine_type": "GENERATOR",
    "oil_type": "DO",
    "operating_temperature": 40,
    "density": 850,
    "is_active": true
  }'

# 2. Delete profile cũ
curl -X DELETE $BASE_URL/oil-profiles/old_profile_name \
  -H "Authorization: Bearer $TOKEN"
```

### Issue 3: Hourly accumulation không chạy

**Triệu chứng:**
```sql
SELECT COUNT(*) FROM tabiot_flow_accumulation WHERE hour_start >= NOW() - INTERVAL 24 HOUR;
-- Returns: 0
```

**Nguyên nhân:**
- Chưa setup scheduled job

**Giải pháp:**
```bash
# Option 1: Manual trigger (test)
# Call service từ Node-RED function node:
const FlowAccumulationService = require('./services/MarineIoT/FlowAccumulationService');
const service = new FlowAccumulationService(dataSource);
await service.calculatePreviousHour('ship_001');

# Option 2: Setup cron job trong Node-RED
# Tạo inject node:
# - Repeat: every 1 hour
# - At: 5 minutes past the hour
# - Connect to function node gọi service
```

---

## 📈 Best Practices

### 1. Profile Naming Convention

```bash
# Good naming:
generator_do_standard      # Máy + loại dầu + mục đích
main_engine_hfo_winter     # Máy + loại dầu + mùa
boiler_bo_backup           # Máy + loại dầu + role

# Bad naming:
profile_001                # Không rõ ràng
my_profile                 # Không có context
test                       # Không descriptive
```

### 2. Profile Management

```bash
# ✅ DO: Tạo profile với label descriptive
{
  "label": "Generator DO Standard - 40°C",
  "description": "Standard diesel oil profile for generator operation at normal temperature"
}

# ❌ DON'T: Tạo quá nhiều profiles không dùng
# Nên có max 2-3 profiles per machine type
# Delete profiles cũ không dùng
```

### 3. Monitoring

```bash
# Setup monitoring dashboard để track:
# 1. Active profiles cho mỗi máy
# 2. Consumption rate (m³/h và tons/h)
# 3. Profile switch events
# 4. Telemetry data completeness (có profile tracking không)
```

### 4. Data Integrity

```bash
# ✅ Luôn verify sau khi đổi profile:
# 1. Check active profile API
curl -X GET "$BASE_URL/oil-profiles/active/ship_001/GENERATOR"

# 2. Check telemetry có density mới
curl -X GET "$BASE_URL/marine/telemetry/latest/ship_001"

# 3. Check historical data giữ nguyên
SELECT oil_profile_id, density_used FROM tabiot_flow_accumulation 
WHERE hour_start < NOW() LIMIT 5;
```

---

## 🎯 Summary

### ✅ Hệ Thống Đã Có

1. **Multi-machine profile management**
   - Generator, Main Engine, Boiler độc lập
   - Mỗi máy dùng dầu riêng

2. **Profile tracking trong telemetry**
   - oil_profile_id: Biết data dùng profile nào
   - density_snapshot: Snapshot để conversion

3. **Hourly accumulation**
   - m³/h → tons/h tự động
   - Tích luỹ theo giờ
   - Không recalculate khi đổi profile

4. **REST API đầy đủ**
   - CRUD profiles
   - Machine-specific queries
   - Telemetry with profile info

### 🎬 Next Actions

```bash
# 1. Setup initial profiles (15 phút)
./setup_initial_profiles.sh

# 2. Verify telemetry tracking (5 phút)
# Check dashboard hoặc query database

# 3. (Optional) Setup hourly job (10 phút)
# Deploy Node-RED scheduled flow

# 4. Start monitoring (ongoing)
# Track consumption, verify data quality
```

### 📞 Support

**Documentation:**
- `MARINE_IOT_SYSTEM_ANALYSIS.md` - Phân tích chi tiết hệ thống
- `OIL_PROFILE_API.md` - API reference đầy đủ
- Test cases: `oil-profile.controller.test.ts`

**Common Queries:**
```bash
# Check system status
curl -X GET "$BASE_URL/oil-profiles?device_id=ship_001&is_active=true"

# View real-time data
curl -X GET "$BASE_URL/marine/telemetry/latest/ship_001"

# Troubleshoot
tail -f /var/log/nodered/console.log | grep Marine
```

---

**Version:** 1.0.0  
**Last Updated:** 2025-01-20  
**Status:** ✅ Production Ready
