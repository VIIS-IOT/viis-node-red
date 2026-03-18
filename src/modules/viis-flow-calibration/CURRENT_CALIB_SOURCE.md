# 📊 Nguồn Gốc Dữ Liệu Calibration

## `currentCalibBoard1` Đến Từ Đâu?

---

## 🔍 Trace Data Flow

### **Step 1: UI/Backend Đọc Modbus**

**Node-RED Flow:**
```
[inject: every 2s] → [Read Holding Board1] → [viis-modbus-flex] → [Map Holding Data] → [Publish MQTT]
```

**Function "Read Holding Board1":**
```javascript
// Đọc holding registers từ Board1
msg.payload = { 
    'fc': 3,              // Function Code 3: Read Holding Registers
    'unitid': 1,          // Unit ID
    'address': 0,         // Start address
    'quantity': 55        // Number of registers
};
return msg;
```

**Modbus Request:**
```
Destination: 192.168.110.77:502
Function Code: 3
Address: 0
Quantity: 55
```

---

### **Step 2: Board1 Response**

**Board1 Holding Registers:**
```
Address 0: (reserved)
Address 1: HOLDING_SETML_BOM_1 = 1000
Address 2: HOLDING_SETML_BOM_2 = ...
...
Address 17: HOLDING_CALIB_BOM_1 = 1000  ← currentCalibBoard1
Address 18: HOLDING_CALIB_BOM_2 = ...
...
Address 55: HOLDING_AUTO_SO_LAN_CHIET_ROT = ...
```

**Modbus Response:**
```
[55 registers data]
Register 17 = 1000  ← Đây là currentCalibBoard1 (đã scale ×100)
```

---

### **Step 3: Node-RED Map Holding Data**

**Function "Map Holding Data" (Board1):**
```javascript
const deviceId = global.get("device_id");
msg.topic = `v1/devices/me/telemetry/${deviceId}`;

let previousStateHolding1 = flow.get('previous_state_holding_1') || {};
const currentState = {};
const changedKeys = {};

const modbusHoldingRegisters = global.get("modbus_board1_holding_registers");

// Scale configs
const keysToDivideBy100 = [
    'HOLDING_CALIB_BOM_1','HOLDING_CALIB_BOM_2',...,'HOLDING_CALIB_BOM_16'
];

const timestamp = Date.now();

msg.payload.forEach((value, index) => {
    const key = Object.keys(modbusHoldingRegisters)
        .find(k => modbusHoldingRegisters[k] === index);
    
    if (key) {
        if (keysToDivideBy100.includes(key) && typeof value === 'number') {
            currentState[key] = value / 100;  // ❌ SAI: ĐANG CHIA 100
        } else {
            currentState[key] = value;
        }
    }
});

// So sánh và publish nếu có thay đổi
if (Object.keys(changedKeys).length > 0) {
    flow.set('previous_state_holding_1', currentState);
    const mqttPayload = { ts: timestamp, ...changedKeys };
    msg.payload = mqttPayload;
    global.set('holding_register_data_1', { ts: timestamp, ...currentState });  // ✅ LƯU VÀO GLOBAL
    return msg;
}
return null;
```

**⚠️ PHÁT HIỆN QUAN TRỌNG:**

Function node này đang **CHIA 100** khi đọc `HOLDING_CALIB_BOM_*`:
```javascript
if (keysToDivideBy100.includes(key)) {
    currentState[key] = value / 100;  // 1000 / 100 = 10.00
}
```

Nhưng sau đó lưu vào global context:
```javascript
global.set('holding_register_data_1', { ts: timestamp, ...currentState });
// holding_register_data_1.HOLDING_CALIB_BOM_1 = 10.00 (UNS CALED)
```

---

### **Step 4: viis-flow-calibration Đọc Global Context**

**File:** `viis-flow-calibration.ts` line 138-140

```typescript
const holdingRegisterData1 = globalHelper.getGlobalVar('holding_register_data_1') || {};
const holdingRegisterData2 = globalHelper.getGlobalVar('holding_register_data_2') || {};
const holdingRegisterData = { ...holdingRegisterData1, ...holdingRegisterData2 };
```

**File:** `viis-flow-calibration.ts` line 283

```typescript
const currentCalibBoard1 = holdingRegisterData[calibKey];
// currentCalibBoard1 = 10.00 (UNS CALED) ❌
```

---

### **Step 5: CalibrationService Tính Toán**

**File:** `calibrationService.ts` line 63-65

```typescript
// Note: currentCalibBoard1 is stored as value * 100 in Modbus
const currentCalibUnscaled = currentCalibBoard1 / DEFAULTS.SCALE_FACTOR;
// = 10.00 / 100 = 0.1 ml/s ❌ SAI!

const runTime = setMl / currentCalibUnscaled;
// = 1000 / 0.1 = 10000s ❌ SAI NGHIÊM TRỌNG!
```

---

## 🚨 BUG PHÁT HIỆN!

### **Vấn Đề:**

1. **Node-RED "Map Holding Data"** CHIA 100 khi đọc từ Modbus:
   ```javascript
   currentState['HOLDING_CALIB_BOM_1'] = 1000 / 100 = 10.00  // Unscaled
   ```

2. **Lưu vào global context** giá trị unscaled:
   ```javascript
   global.set('holding_register_data_1', { HOLDING_CALIB_BOM_1: 10.00 });
   ```

3. **viis-flow-calibration** đọc từ global:
   ```typescript
   currentCalibBoard1 = 10.00  // Unscaled!
   ```

4. **CalibrationService** lại CHIA 100 lần nữa:
   ```typescript
   currentCalibUnscaled = 10.00 / 100 = 0.1  // ❌ SAI!
   ```

### **Hậu Quả:**

```
Expected:
- currentCalibBoard1 = 1000 (scaled)
- currentCalibUnscaled = 1000 / 100 = 10.00 ml/s ✅
- runTime = 1000 / 10 = 100s ✅

Actual (bug):
- currentCalibBoard1 = 10.00 (unscaled từ Node-RED)
- currentCalibUnscaled = 10.00 / 100 = 0.1 ml/s ❌
- runTime = 1000 / 0.1 = 10000s ❌ (2.77 giờ!)
```

---

## ✅ GIẢI PHÁP

### **Option 1: Sửa Node-RED "Map Holding Data" (KHÔNG NÊN)**

Không scale khi đọc, lưu raw value vào global:

```javascript
// ❌ KHÔNG LÀM VÌ SẼ ẢNH HƯỞNG UI
if (keysToDivideBy100.includes(key)) {
    currentState[key] = value;  // Giữ nguyên 1000
}
```

**Vấn đề:** UI đang hiển thị giá trị unscaled (10.00 ml/s), nếu sửa sẽ phá UI.

---

### **Option 2: Sửa calibrationService.ts (NÊN LÀM)**

Không chia 100 nữa, vì giá trị từ global context đã unscaled:

**File:** `calibrationService.ts` line 63-65

```typescript
// OLD (sai):
const currentCalibUnscaled = currentCalibBoard1 / DEFAULTS.SCALE_FACTOR;
const runTime = setMl / currentCalibUnscaled;

// NEW (đúng):
// currentCalibBoard1 từ global context đã là unscaled value (10.00 ml/s)
const currentCalibUnscaled = currentCalibBoard1;  // Không chia 100 nữa
const runTime = setMl / currentCalibUnscaled;     // = 1000 / 10 = 100s ✅
```

---

### **Option 3: Thêm comment giải thích (TẠM THỜI)**

Nếu muốn giữ logic hiện tại và sửa Node-RED flow:

```typescript
// IMPORTANT: currentCalibBoard1 is read from global context
// Node-RED "Map Holding Data" already unscaled the value (divided by 100)
// So currentCalibBoard1 = 10.00 (ml/s), NOT 1000 (scaled)
const currentCalibUnscaled = currentCalibBoard1;  // Already unscaled!
const runTime = setMl / currentCalibUnscaled;
```

---

## 🔍 KIỂM TRA THỰC TẾ

Để verify, cần kiểm tra Node-RED flow function "Map Holding Data" của Board1:

**Tìm trong flow JSON:**
```bash
grep -A 20 "Map Holding Data.*Board1" flows.json
```

**Hoặc check trong Node-RED UI:**
1. Mở Node-RED
2. Tìm function node "Map Holding Data" cho Board1
3. Xem code có dòng này không:
   ```javascript
   if (keysToDivideBy100.includes(key)) {
       currentState[key] = value / 100;
   }
   ```

---

## 📋 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Board1 Holding Register[17] = 1000 (scaled ×100)            │
└─────────────────────────────────────────────────────────────────┘
                              ↓ Modbus Read
┌─────────────────────────────────────────────────────────────────┐
│ 2. Node-RED "Map Holding Data"                                 │
│    value = 1000 (raw from Modbus)                              │
│    currentState['HOLDING_CALIB_BOM_1'] = 1000 / 100 = 10.00   │
│    global.set('holding_register_data_1', { HOLDING_CALIB_BOM_1: 10.00 }) │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. viis-flow-calibration reads global                          │
│    currentCalibBoard1 = 10.00 (from global)                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. calibrationService.calculate()                              │
│    ❌ OLD: currentCalibUnscaled = 10.00 / 100 = 0.1           │
│    ✅ NEW: currentCalibUnscaled = 10.00 (already unscaled)    │
│    runTime = 1000 / 10.00 = 100s ✅                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## ✅ KẾT LUẬN

**Bug đã tìm thấy!** 

`currentCalibBoard1` bị double-unscaled:
1. Node-RED chia 100 khi đọc từ Modbus
2. CalibrationService chia 100 lần nữa

**Fix:** Sửa `calibrationService.ts` line 63:
```typescript
const currentCalibUnscaled = currentCalibBoard1;  // Bỏ chia 100
```

---

## Document Version

| Version | Date | Author | Status |
|---------|------|--------|--------|
| 1.0 | 2026-03-18 | VIIS Team | 🔴 Bug Found |
