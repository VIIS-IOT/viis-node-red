# Marine IoT System - Documentation Index

## 📚 Essential Documentation

### **⭐ Start Here**
1. 👉 **[MARINE_IOT_KG_M3_STANDARD.md](./MARINE_IOT_KG_M3_STANDARD.md)** - ⭐ **kg/m³ Standard** (SI Unit)
2. 👉 **[VIIS_MARINE_TELEMETRY_NODE.md](./VIIS_MARINE_TELEMETRY_NODE.md)** - ⭐ **Custom Node Guide**

### **Reference**
- **[MARINE_IOT_TESTING.md](./MARINE_IOT_TESTING.md)** - Testing guide & SQL examples
- **[src/modules/viis-rest-api/docs/OIL_PROFILE_API.md](./src/modules/viis-rest-api/docs/OIL_PROFILE_API.md)** - REST API documentation

---

## 🎯 Quick Start

### 1. **Understand the System**
Read **[MARINE_IOT_KG_M3_STANDARD.md](./MARINE_IOT_KG_M3_STANDARD.md)** to understand:
- ✅ All data in **kg/m³** (no conversion)
- ✅ Database schema
- ✅ API examples
- ✅ Calculation formulas

### 2. **Use viis-marine-telemetry Node**
Read **[VIIS_MARINE_TELEMETRY_NODE.md](./VIIS_MARINE_TELEMETRY_NODE.md)** for:
- ✅ Node configuration
- ✅ Flow sensor tracking
- ✅ Profile caching
- ✅ Input messages

### 3. **Create Oil Profiles**
Use REST API (see **[OIL_PROFILE_API.md](./src/modules/viis-rest-api/docs/OIL_PROFILE_API.md)**):

```bash
curl -X POST http://localhost:1880/api/v2/oil-profiles \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "device_001",
    "oil_type": "BO",
    "density": 950,
    "operating_temperature": 85,
    "is_active": true
  }'
```

### 4. **Run Tests**
```bash
npm run test:marine          # All Marine IoT tests
npm run test:marine-telemetry # viis-marine-telemetry tests
```

---

## ✅ System Status

| Component | Status | Details |
|-----------|--------|---------|
| **Database** | ✅ Ready | All tables migrated |
| **Services** | ✅ Complete | OilProfile + FlowAccumulation |
| **Custom Node** | ✅ Deployed | viis-marine-telemetry |
| **Tests** | ✅ Passing | 18/18 (node) + 29/29 (services) + 20/20 (API) |
| **API** | ✅ Available | `/api/v2/oil-profiles` |
| **Unit** | ✅ **kg/m³** | SI Standard (500-2000 range) |

---

## 📦 File Structure

```
Marine IoT System/
│
├── MARINE_IOT_README.md (this file)
├── MARINE_IOT_KG_M3_STANDARD.md ⭐ kg/m³ Standard
├── VIIS_MARINE_TELEMETRY_NODE.md ⭐ Custom Node Guide
├── MARINE_IOT_TESTING.md
│
├── src/
│   ├── orm/entities/
│   │   ├── oil-profile/TabiotOilProfile.ts
│   │   ├── flow-accumulation/TabiotFlowAccumulation.ts
│   │   └── device-telemetry/ (enhanced with oil_profile_id)
│   │
│   ├── services/MarineIoT/
│   │   ├── OilProfileService.ts
│   │   ├── FlowAccumulationService.ts
│   │   └── __tests__/ (29 test cases)
│   │
│   ├── modules/
│   │   ├── viis-marine-telemetry/ ⭐ Custom Node
│   │   │   ├── viis-marine-telemetry.ts
│   │   │   ├── viis-marine-telemetry-processor.ts
│   │   │   ├── viis-marine-telemetry.html
│   │   │   └── __tests__/ (18 test cases)
│   │   │
│   │   └── viis-rest-api/
│   │       ├── dto/oil-profile.dto.ts
│   │       ├── controllers/oil-profile.controller.ts
│   │       ├── tests/oil-profile.controller.test.ts (20 tests)
│   │       └── docs/OIL_PROFILE_API.md
│   │
└── run-marine-tests.sh
```

---

## 🔑 Key Concepts

### **kg/m³ Standard (SI Unit)**
- **All data** uses kg/m³ (not tons/m³)
- **No conversion** between frontend/backend
- **Range**: 500-2000 kg/m³
- **Examples**: BO = 950, DO = 850

### **Oil Profile Tracking**
- Each telemetry record includes `oil_profile_id`
- Density snapshot saved with data
- Historical data integrity preserved

### **Hourly Accumulation**
- Automatic calculation every hour
- Formula: `tons = m³ × (kg/m³ ÷ 1000)`
- Stored in `tabiot_flow_accumulation`

---

## 🆘 Troubleshooting

See **[MARINE_IOT_TESTING.md](./MARINE_IOT_TESTING.md)** for:
- SQL query examples
- Common issues
- Testing procedures

See **[VIIS_MARINE_TELEMETRY_NODE.md](./VIIS_MARINE_TELEMETRY_NODE.md)** for:
- Node configuration issues
- Profile cache problems
- Input message examples

---

**Status**: ✅ **Production Ready**  
**Standard**: **kg/m³** (SI Unit)  
**Last Updated**: 20/01/2025
