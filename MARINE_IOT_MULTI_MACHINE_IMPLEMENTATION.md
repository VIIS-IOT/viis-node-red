# Marine IoT Multi-Machine Support

> **🎯 Mục tiêu**: Hỗ trợ 3 loại máy độc lập (Generator, Main Engine, Boiler) với 6 flow sensors, mỗi máy có oil profile riêng.

## 📋 Quick Reference

| Component | Status | Location |
|-----------|--------|----------|
| **Database** | ✅ DONE | Migration `1760934388511-migrate.ts` |
| **Backend Services** | ✅ DONE | OilProfileService, MarineTelemetryProcessor |
| **REST API** | ✅ DONE | MarineTelemetryController (`/marine/telemetry`) |
| **Tests** | ✅ 97% | 31/32 passed |
| **Frontend** | ❌ TODO | React app với MQTT real-time |

### ⚡ Sensor → Machine Mapping

```
GENERATOR:    fs01 (in) + fs02 (return) → DO (850 kg/m³)
MAIN_ENGINE:  fs03 (in) + fs04 (return) → BO (950 kg/m³)
BOILER:       fs05 (in) + fs06 (return) → HFO (980 kg/m³)
```

### 🚫 Migration Commands

```bash
npm run migration:run      # Apply changes
npm run migration:revert   # Rollback (dev only)
```

**⚠️ QUAN TRỌNG**: Chỉ dùng TypeORM migration, KHÔNG edit SQL thủ công.

---

## ✅ Implementation Complete

### 1. Database Schema
**File**: `src/orm/entities/oil-profile/TabiotOilProfile.ts`
- Thêm `machine_type` ENUM: GENERATOR | MAIN_ENGINE | BOILER
- Thêm `oil_type`: HFO (ngoài BO, DO)
- Index: `(device_id, machine_type, is_active)`

### 2. OilProfileService
**File**: `src/services/MarineIoT/OilProfileService.ts`

**Key methods**:
- `getMachineTypeBySensor(sensorKey)` - Map sensor → machine type
- `getActiveProfileForMachine(deviceId, machineType)` - Get profile theo máy
- `setActiveProfile()` - Chỉ deactivate profiles cùng machine

**Sensor mapping**:
```typescript
{
  'fs01': 'GENERATOR', 'fs02': 'GENERATOR',
  'fs03': 'MAIN_ENGINE', 'fs04': 'MAIN_ENGINE',
  'fs05': 'BOILER', 'fs06': 'BOILER'
}
```

### 3. MarineTelemetryProcessor
**File**: `src/modules/viis-marine-telemetry/viis-marine-telemetry-processor.ts`
- Cache riêng cho từng machine type
- `getProfileForSensor(sensorKey)` - Query profile theo sensor
- `processFlowSensorData()` - Áp dụng profile đúng cho từng sensor

### 4. REST API Endpoints
**File**: `src/modules/viis-rest-api/controllers/marine-telemetry.controller.ts`

**3 endpoints** với prefix `/api/v2/marine/telemetry`:

1. **GET** `/latest/:device_id` - Real-time data + machine aggregation
2. **GET** `/history/:device_id` - Historical time-series  
3. **GET** `/machines/:device_id` - Machine summary & status

**Chi tiết**: Xem `docs/MARINE_API_SUMMARY.md`

### 5. DTOs & Controller
- **OilProfile DTOs**: `src/modules/viis-rest-api/dto/oil-profile.dto.ts`
- **Marine Telemetry DTOs**: `src/modules/viis-rest-api/dto/marine-telemetry.dto.ts`
- **Controller**: `src/modules/viis-rest-api/controllers/marine-telemetry.controller.ts`

---

## ⏳ Next: Frontend Implementation

### Tech Stack (Proposed)
- React + TypeScript
- MQTT.js (real-time)
- TailwindCSS + shadcn/ui
- Recharts (historical charts)

### MQTT Topic
```
Topic: v1/devices/me/telemetry
Payload: { timestamp, fs01, fs02, fs03, fs04, fs05, fs06 }
```

### UI Requirements
3 machine cards hiển thị:
- Flow In / Flow Return (m³/h và T/h)
- Consumption Rate
- Status: 🟢 OPERATIONAL | 🟡 WARNING | 🔴 ERROR

---

## 🔑 Key Benefits

1. **Accurate Calculations**: Mỗi máy có density riêng → tính tons chính xác
2. **Flexible Management**: Mỗi máy dùng loại dầu phù hợp (DO/BO/HFO)
3. **Historical Integrity**: Density snapshot lưu cùng data
4. **Independent Monitoring**: Phát hiện vấn đề nhanh per-machine

---

**Date**: 2025-01-20  
**Status**: ✅ **Backend Complete** (100%) | ❌ **Frontend Pending** (0%)  
**Tests**: 31/32 passed (97%)
