# Migration Guide: 3 Machines → 4 Machines Configuration

## 📝 Summary of Changes

This migration updates the Marine IoT system from **3 machines** to **4 machines** with a new sensor mapping configuration.

### Previous Configuration (3 Machines)
- **Machine 1 - MAIN_ENGINE**: fs01 (in) - fs02 (return)
- **Machine 2 - GENERATOR**: fs03 (in) - fs04 (return)  
- **Machine 3 - BOILER**: fs05 (in) - fs06 (return)

### New Configuration (4 Machines)
- **Machine 1 - BOILER**: fs01 (direct consumption, **no return flow**)
- **Machine 2 - MAIN_ENGINE**: fs02 (in) - fs03 (return)
- **Machine 3 - GENERATOR_HFO**: fs03 (in) - fs04 (return)
- **Machine 4 - GENERATOR_DO**: fs05 (in) - fs06 (return)

### Key Changes
1. **BOILER** now uses only fs01 for **direct consumption** (no return flow calculation)
2. **fs03 is shared** between MAIN_ENGINE (as return) and GENERATOR_HFO (as input)
3. GENERATOR split into **GENERATOR_HFO** and **GENERATOR_DO** for different fuel types

---

## 🗂️ Files Modified

### 1. Core Type Definitions
- ✅ **`src/services/MarineIoT/OilProfileService.ts`**
  - Updated `MachineType` from 3 to 4 types
  - Updated `SENSOR_MACHINE_MAP` with new sensor assignments

- ✅ **`src/orm/entities/oil-profile/TabiotOilProfile.ts`**
  - Updated entity enum to support 4 machine types

### 2. Services & Controllers
- ✅ **`src/modules/viis-rest-api/services/marine-telemetry.service.ts`**
  - Updated `MACHINE_SENSORS` mapping
  - Added logic for BOILER direct consumption (no flow_return)
  - Updated all machine type arrays to 4 machines

- ✅ **`src/modules/viis-rest-api/controllers/flow-accumulation.controller.ts`**
  - Updated `machineMap` for accumulation calculations

### 3. Node-RED Nodes
- ✅ **`src/modules/viis-trip-realtime-telemetry/viis-trip-realtime-telemetry.ts`**
  - Updated machine consumption calculations
  - Added support for BOILER direct consumption
  - Updated to 4 machines (BOILER, MAIN_ENGINE, GENERATOR_HFO, GENERATOR_DO)

### 4. DTOs & Interfaces
- ✅ **`src/modules/viis-rest-api/dto/marine-telemetry.dto.ts`**
  - Updated `MachineType` enum
  - Made `flow_return` optional in interfaces (for BOILER)
  - Updated machine mappings in response DTOs

---

## 📊 Database Migration Required

### SQL Migration Script

```sql
-- Step 1: Add new machine types to enum
ALTER TABLE tabiot_oil_profile 
MODIFY COLUMN machine_type ENUM('BOILER', 'MAIN_ENGINE', 'GENERATOR_HFO', 'GENERATOR_DO', 'GENERATOR') 
COMMENT 'Machine type: BOILER (fs01), MAIN_ENGINE (fs02-fs03), GENERATOR_HFO (fs03-fs04), GENERATOR_DO (fs05-fs06)';

-- Step 2: Update existing GENERATOR profiles (choose based on your fuel type)
-- Option A: Update to GENERATOR_HFO (Heavy Fuel Oil)
UPDATE tabiot_oil_profile 
SET machine_type = 'GENERATOR_HFO' 
WHERE machine_type = 'GENERATOR' AND oil_type = 'FO';

-- Option B: Update to GENERATOR_DO (Diesel Oil)
UPDATE tabiot_oil_profile 
SET machine_type = 'GENERATOR_DO' 
WHERE machine_type = 'GENERATOR' AND oil_type = 'DO';

-- Step 3: Remove old GENERATOR from enum (after migration)
ALTER TABLE tabiot_oil_profile 
MODIFY COLUMN machine_type ENUM('BOILER', 'MAIN_ENGINE', 'GENERATOR_HFO', 'GENERATOR_DO') 
COMMENT 'Machine type: BOILER (fs01), MAIN_ENGINE (fs02-fs03), GENERATOR_HFO (fs03-fs04), GENERATOR_DO (fs05-fs06)';

-- Step 4: Verify migration
SELECT machine_type, COUNT(*) as count 
FROM tabiot_oil_profile 
WHERE deleted_at IS NULL 
GROUP BY machine_type;
```

---

## ⚙️ Configuration Changes

### Environment Variables (No Changes Required)
The existing `SCALE_CONFIGS` and sensor mappings remain the same:
```bash
SCALE_CONFIGS=[
  {"key":"fs01","operation":"divide","factor":10,"direction":"read"},
  {"key":"fs02","operation":"divide","factor":10,"direction":"read"},
  {"key":"fs03","operation":"divide","factor":10,"direction":"read"},
  {"key":"fs04","operation":"divide","factor":10,"direction":"read"},
  {"key":"fs05","operation":"divide","factor":10,"direction":"read"},
  {"key":"fs06","operation":"divide","factor":10,"direction":"read"}
]
```

### Oil Profile Setup
You need to create/update oil profiles for the 4 machines:

```bash
# Example: Create profiles for each machine
POST /api/v2/marine/oil-profile
{
  "name": "boiler_hfo_profile",
  "device_id": "your_device_id",
  "machine_type": "BOILER",
  "oil_type": "FO",
  "density": 980,
  "operating_temperature": 50,
  "is_active": true
}

POST /api/v2/marine/oil-profile
{
  "name": "main_engine_profile",
  "device_id": "your_device_id",
  "machine_type": "MAIN_ENGINE",
  "oil_type": "FO",
  "density": 950,
  "operating_temperature": 40,
  "is_active": true
}

POST /api/v2/marine/oil-profile
{
  "name": "generator_hfo_profile",
  "device_id": "your_device_id",
  "machine_type": "GENERATOR_HFO",
  "oil_type": "FO",
  "density": 960,
  "operating_temperature": 40,
  "is_active": true
}

POST /api/v2/marine/oil-profile
{
  "name": "generator_do_profile",
  "device_id": "your_device_id",
  "machine_type": "GENERATOR_DO",
  "oil_type": "DO",
  "density": 850,
  "operating_temperature": 25,
  "is_active": true
}
```

---

## 🧪 Testing Checklist

### 1. Unit Tests
- [ ] Update test files to use 4 machine types
- [ ] Test BOILER direct consumption (no return flow)
- [ ] Test fs03 shared between MAIN_ENGINE and GENERATOR_HFO

### 2. Integration Tests
- [ ] Verify oil profile assignment for all 4 machines
- [ ] Test flow accumulation calculations
- [ ] Test trip accumulation with 4 machines
- [ ] Verify API responses match new structure

### 3. Manual Testing
- [ ] Deploy and verify Node-RED flows
- [ ] Check dashboard displays 4 machines correctly
- [ ] Verify consumption calculations:
  - BOILER: direct = fs01
  - MAIN_ENGINE: consumption = fs02 - fs03
  - GENERATOR_HFO: consumption = fs03 - fs04
  - GENERATOR_DO: consumption = fs05 - fs06

---

## 🚀 Deployment Steps

1. **Backup Database**
   ```bash
   mysqldump -u root -p viis_local > backup_before_4machines_$(date +%Y%m%d).sql
   ```

2. **Run Database Migration**
   ```bash
   mysql -u root -p viis_local < migration_4machines.sql
   ```

3. **Build and Deploy Code**
   ```bash
   cd /home/phuongtung0801/VIIS/viis-local-docker/services/nodered/custom-nodes/viis-node-red
   npm run build
   docker-compose restart nodered1
   ```

4. **Verify Deployment**
   - Check Node-RED logs for errors
   - Test API endpoints
   - Monitor MQTT telemetry

5. **Create/Update Oil Profiles**
   - Use API or database to create profiles for each machine
   - Activate appropriate profiles

---

## 📈 Benefits of This Change

1. **More Accurate Modeling**: Separate tracking for different fuel types (HFO vs DO)
2. **Simplified BOILER Logic**: Direct consumption without return flow calculation
3. **Better Reporting**: Clearer distinction between generator types
4. **Flexible Configuration**: Each machine can have independent oil profiles

---

## 🆘 Troubleshooting

### Issue: Old "GENERATOR" enum values in database
**Solution**: Run the migration script Step 2 to convert old GENERATOR profiles

### Issue: Missing oil profiles after migration
**Solution**: Create new profiles for GENERATOR_HFO and GENERATOR_DO using the API

### Issue: BOILER showing calculation errors
**Solution**: Verify code properly handles optional `flow_return` for BOILER

---

## 📞 Support
For issues or questions, check:
- Node-RED logs: `docker logs nodered1`
- Database enum values: `SHOW COLUMNS FROM tabiot_oil_profile LIKE 'machine_type'`
- Active profiles: `SELECT * FROM tabiot_oil_profile WHERE is_active = 1`
