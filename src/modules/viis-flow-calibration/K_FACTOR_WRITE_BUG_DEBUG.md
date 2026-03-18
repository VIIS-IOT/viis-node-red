# 🐛 K-Factor Write Bug Debug Guide

## Vấn Đề: K-Factor Bị Write Về 450 Hàng Loạt

---

## 🔍 Triệu Chứng

Khi hiệu chuẩn bơm, tất cả các K-Factor của 16 bơm đều bị write về **450**, thay vì chỉ update bơm được calib.

---

## 🎯 Nguyên Nhân Có Thể

### **1. holding_register_data_2 Không Có K-Factor Data**

**File:** `viis-flow-calibration.ts` line 295

```typescript
const currentKFactor = holdingRegisterData[kFactorKey] || 450;
// Nếu holdingRegisterData['HOLDING_K_FACTOR_BOM_1'] = undefined
// → currentKFactor = 450 (default)
```

**Sau đó tính toán:**
```typescript
let newKFactor = currentKFactor;  // = 450
if (reportedVolume > 0 && actualMl > 0 && currentKFactor > 0) {
    newKFactor = Math.round(currentKFactor * (actualMl / reportedVolume));
    // = 450 * (950 / 1000) = 428
}
```

**Nhưng nếu điều kiện không thỏa:**
```typescript
if (reportedVolume > 0 && actualMl > 0 && currentKFactor > 0) {
    // FALSE → không execute
}
// newKFactor = 450 (giữ nguyên!)
```

---

### **2. Node-RED "Map Holding Data" Board2 Không Lưu K-Factor**

**Kiểm tra flow Node-RED:**

```javascript
// Function "Map Holding Data" - Board2
const keysToDivideBy100 = [
    'HOLDING_FLOWRATE_BOM_1',
    'HOLDING_FLOWRATE_BOM_2',
    // ...
    // ❌ THIẾU: HOLDING_K_FACTOR_BOM_* không có trong list này
];

msg.payload.forEach((value, index) => {
    const key = Object.keys(modbusHoldingRegisters).find(...);
    
    if (keysToDivideBy100.includes(key)) {
        partialState[key] = value / 100;  // FLOWRATE được chia 100
    } else {
        partialState[key] = value;  // ✅ K_FACTOR nên ở đây (không scale)
    }
});

// Merge và lưu vào global
let previousStateHolding2 = flow.get('previous_state_holding_2') || {};
const mergedState = { ...previousStateHolding2, ...partialState };

if (JSON.stringify(mergedState) !== JSON.stringify(previousStateHolding2)) {
    flow.set('previous_state_holding_2', mergedState);
    global.set('holding_register_data_2', mergedState);  // ✅ LƯU
    return msg;
} else {
    return null;  // ❌ KHÔNG LƯU NẾU KHÔNG CÓ THAY ĐỔI!
}
```

**VẤN ĐỀ:** Nếu K-Factor không thay đổi (delta check), nó sẽ không được lưu!

---

### **3. Flow Đọc Holding Board2 Chưa Chạy**

**Kiểm tra inject node:**

```json
{
    "id": "f49b1bcf7f48c0fd",
    "type": "inject",
    "name": "",
    "repeat": "1",  // ✅ Đọc mỗi 1 giây
    "wires": [["1b342a9afcb849d4"]]
}
```

Nếu inject node bị disable hoặc chưa chạy, `holding_register_data_2` sẽ rỗng.

---

## 🛠️ Debug Steps

### **Step 1: Check Debug Logs**

Khi calibration chạy, check logs trong Node-RED:

```
Board2 data for pump 1:
  kFactorKey=HOLDING_K_FACTOR_BOM_1, value=undefined, exists=false
  flowrateKey=HOLDING_FLOWRATE_BOM_1, value=undefined, exists=false
  totalFlowKey=INPUT_TOTAL_FLOW_BOM_1, value=1000, exists=true

⚠️ K-Factor not found for pump 1, using default 450
⚠️ Flowrate not found for pump 1, using default 10
```

**Nếu thấy logs này → holding_register_data_2 không có data!**

---

### **Step 2: Check Global Context**

Trong Node-RED Debug tab, check:

```javascript
global.get('holding_register_data_2')
// Expected:
{
  HOLDING_K_FACTOR_BOM_1: 450,
  HOLDING_K_FACTOR_BOM_2: 450,
  ...
  HOLDING_FLOWRATE_BOM_1: 1000,  // 10.00 ml/s scaled
  ...
}

// Actual (bug):
{}  // RỖNG!
```

---

### **Step 3: Check Function Node Code**

Mở function node "Map Holding Data" của Board2, kiểm tra:

```javascript
// ✅ ĐÚNG: Không scale K-Factor
const keysToDivideBy100 = [
    'HOLDING_FLOWRATE_BOM_1',
    'HOLDING_FLOWRATE_BOM_2',
    // ... chỉ FLOWRATE, không có K_FACTOR
];

msg.payload.forEach((value, index) => {
    const absoluteAddress = startAddress + index;
    const key = Object.keys(modbusHoldingRegisters).find(k => modbusHoldingRegisters[k] === absoluteAddress);

    if (!key) return;

    if (keysToDivideBy100.includes(key) && typeof value === 'number') {
        partialState[key] = value / 100;  // FLOWRATE chia 100
    } else {
        partialState[key] = value;  // K_FACTOR giữ nguyên
    }
});
```

---

### **Step 4: Check Delta Logic**

**VẤN ĐỀ NGHIÊM TRỌNG:** Function "Map Holding Data" có delta check:

```javascript
if (JSON.stringify(mergedState) !== JSON.stringify(previousStateHolding2)) {
    flow.set('previous_state_holding_2', mergedState);
    global.set('holding_register_data_2', mqttPayload);
    return msg;
} else {
    return null;  // ❌ KHÔNG LƯU NẾU KHÔNG THAY ĐỔI!
}
```

**Hậu quả:**
- Lần đầu chạy: `previousStateHolding2 = {}`
- Đọc được: `{ HOLDING_K_FACTOR_BOM_1: 450 }`
- `mergedState = { HOLDING_K_FACTOR_BOM_1: 450 }`
- So sánh: `{450} !== {}` → TRUE → Lưu ✅
- Lần sau: `previousStateHolding2 = {450}`
- Đọc được: `{ HOLDING_K_FACTOR_BOM_1: 450 }` (không đổi)
- `mergedState = {450}` (giống previous)
- So sánh: `{450} === {450}` → FALSE → **KHÔNG LƯU!** ❌

**Fix:** Luôn lưu ít nhất 1 lần mỗi chu kỳ, hoặc lưu tất cả keys mỗi lần:

```javascript
// ✅ LUÔN LƯU TOÀN BỘ
flow.set('previous_state_holding_2', mergedState);
global.set('holding_register_data_2', mergedState);  // Luôn lưu
msg.payload = mergedState;
return msg;  // Luôn return
```

HOẶC:

```javascript
// ✅ SO SÁNH TỪNG KEY, CHỈ RETURN NEUS CÓ THAY ĐỔI
const changedKeys = {};
for (const key in mergedState) {
    if (mergedState[key] !== previousStateHolding2[key]) {
        changedKeys[key] = mergedState[key];
    }
}

if (Object.keys(changedKeys).length > 0) {
    flow.set('previous_state_holding_2', mergedState);
    global.set('holding_register_data_2', mergedState);  // Luôn lưu toàn bộ
    msg.payload = changedKeys;  // Chỉ publish keys thay đổi
    return msg;
}

// Vẫn lưu global, nhưng không publish
global.set('holding_register_data_2', mergedState);
return null;
```

---

## ✅ Solution

### **Option 1: Fix Function Node "Map Holding Data" Board2**

Sửa logic delta check để luôn lưu vào global context:

```javascript
// Cuối function
let previousStateHolding2 = flow.get('previous_state_holding_2') || {};
const mergedState = { ...previousStateHolding2, ...partialState };

// Luôn lưu vào global context
global.set('holding_register_data_2', mergedState);
flow.set('previous_state_holding_2', mergedState);

// Chỉ publish nếu có thay đổi
const changedKeys = {};
for (const key in mergedState) {
    if (mergedState[key] !== previousStateHolding2[key]) {
        changedKeys[key] = mergedState[key];
    }
}

if (Object.keys(changedKeys).length > 0) {
    msg.payload = changedKeys;
    return msg;
}

return null;  // Không publish nhưng đã lưu vào global
```

---

### **Option 2: Fix calibrationService.ts - Không Write Nếu Không Thay Đổi**

**File:** `calibrationService.ts` line 105-110

```typescript
// K-Factor calculation
let newKFactor = currentKFactor;
if (reportedVolume > 0 && actualMl > 0 && currentKFactor > 0) {
    newKFactor = Math.round(currentKFactor * (actualMl / reportedVolume));
}

// ✅ THÊM: Chỉ write nếu khác biệt
const K_FACTOR_THRESHOLD = 1;  // Chỉ write nếu thay đổi >= 1
if (Math.abs(newKFactor - currentKFactor) < K_FACTOR_THRESHOLD) {
    this.log(`  Board2: K-Factor unchanged (${currentKFactor} → ${newKFactor}), skipping write`);
    result.board2 = null;  // Không write
} else {
    result.board2 = {
        newKFactor,
        kFactorAddress,
        ...
    };
}
```

---

### **Option 3: Fix viis-flow-calibration.ts - Only Write Calibrated Pump**

Hiện tại code write cho tất cả pumps trong loop:

```typescript
for (let i = 1; i <= 16; i++) {
    const calculateKey = `CALCULATE_CALIB_BOM_${i}`;
    if (configKeyValues[calculateKey]) {
        // ✅ CHỈ CALIB PUMP NÀY
        const input = gatherCalibrationInput(i, ...);
        const result = calibrationService.calculate(input, ...);
        await writeCalibrationValues(result);  // ✅ CHỈ WRITE PUMP I
    }
}
```

Code đã đúng! Nếu chỉ `CALCULATE_CALIB_BOM_1 = true`, chỉ pump 1 được calib và write.

**Nhưng vấn đề là:** Nếu `currentKFactor = undefined` → fallback về 450 → write 450!

---

## 🎯 Kết Luận

**Vấn đề chính:** `holding_register_data_2` không có K-Factor data vì:

1. **Node-RED "Map Holding Data" Board2** không lưu đúng cách (delta check quá chặt)
2. **Flow đọc Holding Board2** chưa chạy hoặc bị disable

**Fix ưu tiên:**
1. ✅ Sửa function "Map Holding Data" Board2 để luôn lưu vào global
2. ✅ Thêm debug logging để theo dõi
3. ✅ Kiểm tra inject node có chạy không

---

## 📋 Checklist Debug

- [ ] Check Node-RED logs có warning "K-Factor not found" không
- [ ] Check global context: `global.get('holding_register_data_2')`
- [ ] Check function "Map Holding Data" Board2 code
- [ ] Check inject node "Read Holding Board2" có enable không
- [ ] Check Modbus client Board2 có kết nối không
- [ ] Test manual: Đọc holding register 0-15 của Board2

---

## Document Version

| Version | Date | Author | Status |
|---------|------|--------|--------|
| 1.0 | 2026-03-18 | VIIS Team | 🔴 Debugging |
