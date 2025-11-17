# Trip Accumulation via WebSocket - Hướng dẫn

## Tổng quan

WebSocket service **ĐÃ HỖ TRỢ** gửi lưu lượng tích lũy hành trình (trip accumulation) cho 4 máy theo logic mới:

- **BOILER**: fs01 (tiêu thụ trực tiếp, không có đầu hồi)
- **MAIN_ENGINE**: fs02 (vào) - fs03 (hồi)
- **GENERATOR_HFO**: fs03 (vào) - fs04 (hồi)
- **GENERATOR_DO**: fs05 (vào) - fs06 (hồi)

## Điều kiện để nhận trip accumulation

Trip accumulation **CHỈ XUẤT HIỆN** trong WebSocket response khi:

1. ✅ Có **active trip** đang chạy
2. ✅ Trip đã được tạo qua API `/api/v2/marine/trips`
3. ✅ Có dữ liệu accumulation được ghi vào database

Nếu **KHÔNG CÓ active trip**, response chỉ có:
```json
{
  "device_id": "...",
  "timestamp": 1763365012539,
  "data": [...],          // fs01-fs06 real-time data
  "machines": {...}       // Real-time flow rates
  // ❌ KHÔNG CÓ current_trip
  // ❌ KHÔNG CÓ trip_accumulation trong machines
}
```

## Format WebSocket Response (KHI CÓ ACTIVE TRIP)

```json
{
  "device_id": "4abebfd0-ab00-11f0-8b6a-ef2499d33d22",
  "timestamp": 1763365012539,

  // Real-time sensor data (fs01-fs06)
  "data": [
    {
      "key_name": "fs01",
      "value": 0,              // m³/h
      "value_tons": 0,         // T/h
      "oil_profile_id": "profile_fo_1761206912705",
      "density_snapshot": 990,
      "machine_type": "BOILER"
    },
    // ... fs02-fs06
  ],

  // Machines với real-time flow rates
  "machines": {
    "BOILER": {
      "flow_in": { "key": "fs01", "m3h": 0, "th": 0 },
      "consumption_rate": { "m3h": 0, "th": 0 },
      "oil_profile": "profile_fo_1761206912705",
      "density": 990,

      // ✅ TRIP ACCUMULATION (chỉ có khi active trip)
      "trip_accumulation": {
        "total_volume_in": { "m3": 125.5, "tons": 124.2 },
        "total_volume_return": { "m3": 0, "tons": 0 },      // BOILER không có hồi
        "total_consumption": { "m3": 125.5, "tons": 124.2 }
      }
    },

    "MAIN_ENGINE": {
      "flow_in": { "key": "fs02", "m3h": 0, "th": 0 },
      "flow_return": { "key": "fs03", "m3h": 1.63, "th": 1.34 },
      "consumption_rate": { "m3h": -1.63, "th": -1.34 },
      "oil_profile": "profile_do_1761206883984",
      "density": 820,

      // ✅ TRIP ACCUMULATION
      "trip_accumulation": {
        "total_volume_in": { "m3": 350.2, "tons": 287.2 },
        "total_volume_return": { "m3": 45.8, "tons": 37.6 },
        "total_consumption": { "m3": 304.4, "tons": 249.6 }
      }
    },

    "GENERATOR_HFO": {
      "flow_in": { "key": "fs03", "m3h": 1.63, "th": 1.34 },
      "flow_return": { "key": "fs04", "m3h": 1.505, "th": 1.5 },
      "consumption_rate": { "m3h": 0.13, "th": -0.16 },
      "oil_profile": "profile_do_1761206883984",
      "density": 820,

      // ✅ TRIP ACCUMULATION
      "trip_accumulation": {
        "total_volume_in": { "m3": 45.8, "tons": 37.6 },
        "total_volume_return": { "m3": 38.2, "tons": 31.5 },
        "total_consumption": { "m3": 7.6, "tons": 6.1 }
      }
    },

    "GENERATOR_DO": {
      "flow_in": { "key": "fs05", "m3h": 0, "th": 0 },
      "flow_return": { "key": "fs06", "m3h": 0, "th": 0 },
      "consumption_rate": { "m3h": 0, "th": 0 },
      "oil_profile": null,
      "density": 1000,

      // ✅ TRIP ACCUMULATION
      "trip_accumulation": {
        "total_volume_in": { "m3": 0, "tons": 0 },
        "total_volume_return": { "m3": 0, "tons": 0 },
        "total_consumption": { "m3": 0, "tons": 0 }
      }
    }
  },

  // ✅ CURRENT TRIP INFO
  "current_trip": {
    "id": "trip_abc123",
    "name": "Hành trình HCM - Vũng Tàu",
    "start_time": 1763300000000,
    "duration_hours": 18.5
  }
}
```

## Cách kiểm tra trên Dashboard

### Bước 1: Tạo Active Trip

```bash
POST /api/v2/marine/trips
{
  "device_id": "4abebfd0-ab00-11f0-8b6a-ef2499d33d22",
  "trip_name": "Test Trip",
  "start_time": <current_timestamp>
}
```

### Bước 2: Kết nối WebSocket

```javascript
const socket = io('http://localhost:5000', {
  auth: { token: 'YOUR_JWT_TOKEN' }
});

// Subscribe to device
socket.emit('marine:subscribe', {
  deviceId: '4abebfd0-ab00-11f0-8b6a-ef2499d33d22'
});

// Listen for updates
socket.on('marine:telemetry', (data) => {
  console.log('[Dashboard] 🔍 RAW wsData:', data);

  if (data.current_trip) {
    console.log('✅ Active Trip:', data.current_trip);
    console.log('✅ BOILER Accumulation:', data.machines.BOILER.trip_accumulation);
    console.log('✅ MAIN_ENGINE Accumulation:', data.machines.MAIN_ENGINE.trip_accumulation);
  } else {
    console.log('⚠️  No active trip');
  }
});
```

### Bước 3: Kiểm tra Response

Nếu bạn thấy response KHÔNG CÓ `trip_accumulation`, kiểm tra:

1. ❓ Có active trip không? Gọi `GET /api/v2/marine/trips/active/{deviceId}`
2. ❓ Trip accumulation có data không? Gọi `GET /api/v2/marine/trips/{tripId}/accumulation`

## Cách tính Trip Accumulation

### Logic tích lũy (mỗi 2 giây)

```typescript
// Công thức
incrementM3 = flowRate_m3h × (2 seconds / 3600 seconds)
incrementTons = flowRate_th × (2 seconds / 3600 seconds)

// Cập nhật
total_volume_m3 += incrementM3
total_volume_tons += incrementTons
```

### Tính Consumption theo máy

#### BOILER (fs01)
```
consumption = total_volume_in (fs01)
```

#### MAIN_ENGINE (fs02 - fs03)
```
consumption = total_volume_in (fs02) - total_volume_return (fs03)
```

#### GENERATOR_HFO (fs03 - fs04)
```
consumption = total_volume_in (fs03) - total_volume_return (fs04)
```

#### GENERATOR_DO (fs05 - fs06)
```
consumption = total_volume_in (fs05) - total_volume_return (fs06)
```

## Thay đổi mới (Fixed)

### Bug đã sửa trong `TripAccumulationService.getTotalConsumption()`

**Trước đây (SAI):**
```typescript
// Logic cũ cho 3 máy
const flowInSensors = ['fs01', 'fs03', 'fs05'];
const flowReturnSensors = ['fs02', 'fs04', 'fs06'];
```

**Bây giờ (ĐÚNG):**
```typescript
// Logic mới cho 4 máy
// BOILER: fs01 (direct)
// MAIN_ENGINE: fs02 - fs03
// GENERATOR_HFO: fs03 - fs04
// GENERATOR_DO: fs05 - fs06
```

### Method mới thêm vào

```typescript
// Get BOILER consumption (no return flow)
async getBoilerConsumption(tripId: string): Promise<{ m3: number; tons: number }>
```

## API Endpoints liên quan

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v2/marine/trips` | POST | Tạo trip mới |
| `/api/v2/marine/trips/active/{deviceId}` | GET | Lấy active trip |
| `/api/v2/marine/trips/{tripId}` | PUT | Kết thúc trip |
| `/api/v2/marine/trips/{tripId}/accumulation` | GET | Lấy trip accumulation |
| `/api/v2/marine/telemetry/latest/{deviceId}` | GET | Real-time + trip data |

## Troubleshooting

### ❌ Không thấy trip_accumulation

**Nguyên nhân:**
- Không có active trip
- Trip chưa được start
- Database connection issue

**Giải pháp:**
1. Kiểm tra active trip: `GET /api/v2/marine/trips/active/{deviceId}`
2. Tạo trip mới nếu cần
3. Kiểm tra logs của REST API node

### ❌ Accumulation = 0

**Nguyên nhân:**
- Flow sensors không có data
- Trip vừa mới tạo (chưa có thời gian tích lũy)
- TFS update service chưa chạy

**Giải pháp:**
1. Đợi ít nhất 1-2 phút sau khi tạo trip
2. Kiểm tra real-time flow data có giá trị > 0 không
3. Kiểm tra logs của marine-telemetry node

## Kết luận

✅ WebSocket **ĐÃ HỖ TRỢ** trip accumulation
✅ Logic **ĐÃ ĐÚNG** cho 4 máy mới
✅ Bug trong `getTotalConsumption()` **ĐÃ ĐƯỢC SỬA**
✅ Format response **ĐÃ CHUẨN**

**Lưu ý:** Nếu bạn không thấy trip_accumulation trong response, hãy đảm bảo đã tạo active trip trước!
