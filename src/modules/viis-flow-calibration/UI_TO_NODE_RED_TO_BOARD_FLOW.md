# 📘 UI to Node-RED to Board Flow Documentation

## Calibration Flow - Step by Step

**System Configuration:**
- **Device ID:** `3691dba0-309e-11f0-98dc-bf024c096c4a`
- **Board1 (Pump Control):** `192.168.110.77:502` - Unit ID: 1
- **Board2 (Flow Sensor):** `192.168.110.98:502` - Unit ID: 1
- **Pump Index:** 1 (example, supports 1-16)

---

## Phase 1: Open Calibration Modal & Auto Reset Volume

### Step 1.1: User Clicks "Tiến hành hiệu chuẩn"

**File:** `CalibPump.tsx` line 536

```typescript
<Button
    style={{ width: "50%" }}
    onClick={() => {
        setOpenModal2(true);
        setActiveModal("calibration");
    }}
>
    <p style={{ color: "rgb(100,100,100)" }}>
        Tiến hành hiệu chuẩn
    </p>
</Button>
```

**Action:**
- User clicks button "Tiến hành hiệu chuẩn"
- Modal opens with title "Tiến hành hiệu chuẩn"

---

### Step 1.2: Modal Opens & Auto-Triggers Reset Volume

**File:** `CalibPump.tsx` line 1004-1013

```typescript
afterOpenChange={(open) => {
    if (open) {
        setActiveModal("calibration");
        setRefreshTrigger((prev) => prev + 1);
        // ✅ Auto-reset volume counter when opening calibration modal
        handleResetVolume();
    } else {
        setActiveModal(null);
        setVolumeResetDone(false);
    }
}}
```

**Action:**
- Modal is now open
- `handleResetVolume()` is called automatically

---

### Step 1.3: UI Sends Reset Volume Command

**File:** `CalibPump.tsx` line 167-190

```typescript
const handleResetVolume = async () => {
    setIsResettingVolume(true);

    try {
        const resetVolumeKey = `RESET_TOTAL_VOLUME_BOM_${indexOfPump + 1}`;
        // For pump 1: RESET_TOTAL_VOLUME_BOM_1

        console.log({
            device_id_thingsboard: deviceId,
            method: "set_state",
            params: {
                [resetVolumeKey]: true,
            },
        });

        await control({
            device_id_thingsboard: deviceId,
            method: "set_state",
            params: {
                [resetVolumeKey]: true,
            },
        });

        message.success("Đã reset bộ đếm lưu lượng");
        setVolumeResetDone(true);

    } catch (error) {
        message.error("Lỗi khi reset bộ đếm");
        console.error("Reset volume error:", error);
    } finally {
        setIsResettingVolume(false);
    }
};
```

**MQTT Message Sent:**
```json
{
    "device_id_thingsboard": "3691dba0-309e-11f0-98dc-bf024c096c4a",
    "method": "set_state",
    "params": {
        "RESET_TOTAL_VOLUME_BOM_1": true
    }
}
```

**Topic:** `v1/devices/me/telemetry/3691dba0-309e-11f0-98dc-bf024c096c4a`

---

### Step 1.4: Thingsboard Routes RPC Command

**Thingsboard Server:** `mqtt.viis.tech:1883`

**Action:**
- Thingsboard receives RPC request
- Routes to device's RPC topic: `v1/devices/me/rpc/request/+`

---

### Step 1.5: Node-RED Receives RPC Command

**Node:** `vietplants-rpc-control` (MQTT Subscribe)

**File:** `vietplant-rpc-control.ts` line 350-365

```typescript
// Subscribe to RPC requests
const subscribeTopic = config.mqttBroker === "thingsboard"
    ? "v1/devices/me/rpc/request/+"
    : "v1/devices/me/rpc/request/+";

mqttClient.subscribe(subscribeTopic);
```

**Action:**
- Node-RED subscribed to `v1/devices/me/rpc/request/+`
- Receives message with payload:
  ```json
  {
      "method": "set_state",
      "params": {
          "RESET_TOTAL_VOLUME_BOM_1": true
      }
  }
  ```

---

### Step 1.6: RpcHandler Processes Command

**File:** `handlers/rpcHandler.ts`

**Action:**
```typescript
// Check if method is "set_state"
if (msg.method === "set_state") {
    // Process each key in params
    for (const [key, value] of Object.entries(msg.params)) {
        await processKey(key, value);
    }
}
```

---

### Step 1.7: ModbusService Finds Mapping

**File:** `services/modbusService.ts` line 140-160

```typescript
findModbusMapping(key: string): ModbusMappingResult | null {
    const { modbusCoils } = this.environmentConfig;
    
    // Check coils
    if (modbusCoils[key] !== undefined) {
        return {
            address: modbusCoils[key],      // 201
            fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,  // 5
            value: false,
            boardId: "board2"  // Auto-detected from mapping
        };
    }
    
    return null;
}
```

**Mapping Found:**
```json
{
    "address": 201,
    "fc": 5,
    "boardId": "board2"
}
```

---

### Step 1.8: ModbusService Writes to Board2

**File:** `services/modbusService.ts` line 270-300

```typescript
async writeToModbus(key: string, mapping: ModbusMappingResult, value: any): Promise<void> {
    // Get appropriate Modbus client for board2
    const modbusClient = await this.getModbusClient(mapping.boardId);
    
    // Perform write operation
    if (mapping.fc === 5) { // WRITE_SINGLE_COIL
        await modbusClient.writeCoil(mapping.address, value);
        // writeCoil(201, 1)
    }
}
```

**Modbus TCP Packet:**
```
Transaction ID: 0x0001
Protocol ID: 0x0000
Length: 6
Unit ID: 1
Function Code: 5 (Write Single Coil)
Address: 201 (0x00C9)
Value: 0xFF00 (ON)
```

**Destination:** `192.168.110.98:502`

---

### Step 1.9: Board2 Resets Volume Counter

**Board2 Firmware Action:**
```cpp
// Arduino Mega 2560
if (coil[201] == HIGH) {
    totalVolume_BOM_1 = 0;  // Reset counter
    delay(500);             // Wait 500ms
    coil[201] = LOW;        // Auto-clear
}
```

**Response to Node-RED:**
```
Transaction ID: 0x0001
Protocol ID: 0x0000
Length: 6
Unit ID: 1
Function Code: 5
Address: 201
Value: 0xFF00 (Echo confirmation)
```

---

### Step 1.10: UI Updates Reset Status

**File:** `CalibPump.tsx` line 186

```typescript
message.success("Đã reset bộ đếm lưu lượng");
setVolumeResetDone(true);
```

**UI Display:**
```
┌─────────────────────────────────────────┐
│ ✅ Đã reset bộ đếm lưu lượng            │
│ [🔄 Reset lại]                          │
│ Bộ đếm đã được reset. Bạn có thể bắt   │
│ đầu hiệu chuẩn.                         │
└─────────────────────────────────────────┘
```

---

## Phase 2: Set Target Volume

### Step 2.1: User Adjusts Target Volume

**File:** `CalibPump.tsx` line 1076

```typescript
<DigitControl
    key={`holding-${refreshTrigger}`}
    functionItem={functionsForControl.digitCoil}
    setLatestDigitValue={setLatestHoldingValue}
/>
```

**DigitControl Component:**
- Displays current value of `HOLDING_SETML_BOM_1`
- User can input new value (e.g., 1000 ml)

---

### Step 2.2: UI Sends Target Volume

**MQTT Message Sent:**
```json
{
    "device_id_thingsboard": "3691dba0-309e-11f0-98dc-bf024c096c4a",
    "method": "set_state",
    "params": {
        "HOLDING_SETML_BOM_1": 1000
    }
}
```

---

### Step 2.3: Node-RED Writes to Board1

**ModbusService Mapping:**
```json
{
    "address": 1,
    "fc": 6,
    "boardId": "board1"
}
```

**Modbus TCP Packet:**
```
Destination: 192.168.110.77:502
Function Code: 6 (Write Single Register)
Address: 1
Value: 1000
```

---

### Step 2.4: Board1 Stores Target Volume

**Board1 Firmware:**
```cpp
holdingRegister[1] = 1000;  // HOLDING_SETML_BOM_1
```

---

## Phase 3: Start Pump

### Step 3.1: User Clicks Toggle ON

**File:** `CalibPump.tsx` line 1088

```typescript
<OnOffControl
    functionItem={functionsForControl.onOffCoil}
    setResponseStatusOfOnOffControl={setResponseForCalibration}
/>
```

**OnOffControl Component:**
- User toggles ON
- Sends MQTT command

---

### Step 3.2: UI Sends Pump ON Command

**MQTT Message Sent:**
```json
{
    "device_id_thingsboard": "3691dba0-309e-11f0-98dc-bf024c096c4a",
    "method": "set_state",
    "params": {
        "COIL_BOM_1": true
    }
}
```

---

### Step 3.3: Node-RED Writes Coil to Board1

**ModbusService Mapping:**
```json
{
    "address": 16,
    "fc": 5,
    "boardId": "board1"
}
```

**Modbus TCP Packet:**
```
Destination: 192.168.110.77:502
Function Code: 5 (Write Single Coil)
Address: 16
Value: 0xFF00 (ON)
```

---

### Step 3.4: Board1 Activates Pump Relay

**Board1 Firmware:**
```cpp
if (coil[16] == HIGH) {
    digitalWrite(PUMP_1_PIN, HIGH);  // Activate relay
    pumpRunning[0] = true;
}
```

---

### Step 3.5: UI Starts Timer

**File:** `CalibPump.tsx` line 89-100

```typescript
useEffect(() => {
    if (activeModal === "calibration") {
        const newCalibInfo = [...calibrationInformation];
        newCalibInfo[indexOfPump] = {
            ...newCalibInfo[indexOfPump],
            calibration: responseForCalibration,
            startTimestampCalibration: responseForCalibration ? dayjs() : null,
            totalTimeCalibration:
                oldCalibValue > 0 ? latestHoldingValue / oldCalibValue : 0,
        };
        setCalibrationInformation(newCalibInfo);
    }
}, [responseForCalibration, activeModal]);
```

**Calculation:**
```javascript
totalTimeCalibration = setMl / currentCalib
                     = 1000 / 10.00
                     = 100 seconds
```

---

## Phase 4: Pump Running & Volume Monitoring

### Step 4.1: Board2 Reads Flow Sensor

**Board2 Firmware (Every 1 second):**
```cpp
// Read flow sensor pulse count
pulses = readPulseCounter();

// Calculate volume: Volume(L) = Pulses / K-Factor
currentVolume = pulses / K_FACTOR_BOM_1;  // e.g., 450 pulses/L

// Store in input register
inputRegister[20] = currentVolume * 1000;  // Convert to mL
```

---

### Step 4.2: Node-RED Reads Input Registers

**Node-RED Flow:**
```
[inject: every 5s] → [Read Input Board2] → [viis-modbus-flex] → [Map Input Data]
```

**Function "Read Input" (line 1200):**
```javascript
node.send({
    payload: { fc: 4, unitid: 1, address: 20, quantity: 16 },
    startAddress: 20
});
```

**Modbus TCP Packet:**
```
Destination: 192.168.110.98:502
Function Code: 4 (Read Input Registers)
Address: 20
Quantity: 16
```

---

### Step 4.3: Node-RED Maps & Publishes Data

**File:** Node-RED Flow function "Map Input Data"

```javascript
const partialState = {};

msg.payload.forEach((value, index) => {
    const absoluteAddress = startAddress + index;
    const key = Object.keys(modbusInputRegisters)
        .find(k => modbusInputRegisters[k] === absoluteAddress);
    
    if (key === 'INPUT_TOTAL_FLOW_BOM_1') {
        partialState[key] = value;  // No scale for volume
    }
});

// Merge with previous state
let previousStateInput2 = flow.get('previous_state_input_2') || {};
const mergedState = { ...previousStateInput2, ...partialState };

flow.set('previous_state_input_2', mergedState);
global.set('input_register_data_2', mergedState);

// Publish to MQTT
msg.payload = mergedState;
return msg;
```

**MQTT Publish:**
```json
{
    "topic": "v1/devices/me/telemetry",
    "payload": {
        "INPUT_TOTAL_FLOW_BOM_1": 850
    }
}
```

---

### Step 4.4: UI Receives Volume Update

**File:** `CalibPump.tsx` line 317-360

```typescript
useEffect(() => {
    if (!deviceId || !board2Functions) return;

    const subscriptionIds = subscribe([genDeviceTopic(deviceId)], (msg) => {
        const data = JSON.parse(msg);
        if (Array.isArray(data)) {
            // Update Total Volume
            if (board2Functions.totalVolume) {
                const volumeData = data.find(
                    (item) => item.key === board2Functions.totalVolume.identifier
                );
                if (volumeData) {
                    setReportedVolume(Number(volumeData.value));
                }
            }
        }
    });
}, [deviceId, indexOfPump]);
```

**UI Display:**
```
┌─────────────────────────────────────────┐
│ 📊 Cảm biến Board2 đo được: 850 ml     │
└─────────────────────────────────────────┘
```

---

### Step 4.5: Timer Counts Down

**File:** `ModalPreventAction.tsx`

**Props:**
```typescript
<ModalPreventAction
    totalTime={Math.ceil(100)}  // 100 seconds
    startTimestamp={dayjs()}
    setIsCalibProgressFinished={setIsCalibProgressFinished}
/>
```

**Action:**
- Countdown from 100 to 0
- When reaches 0: `setIsCalibProgressFinished(true)`

---

## Phase 5: User Enters Actual Volume

### Step 5.1: Input Field Appears

**File:** `CalibPump.tsx` line 730-735

```typescript
{isCalibProgressFinished && !isCalibrationInProgress && (
    <div>
        <p>✅ Đã hoàn thành chạy bơm, hãy nhập kết quả đo được</p>
        ...
    </div>
)}
```

**Condition:**
- ✅ `isCalibProgressFinished = true` (timer ended)
- ✅ `!isCalibrationInProgress` (not calculating yet)

---

### Step 5.2: User Enters Measured Value

**File:** `CalibPump.tsx` line 808-820

```typescript
<InputNumberWithKeyboard
    placeholder="Nhập số liệu thực tế (ml)"
    style={{ width: "100%" }}
    onChange={(value) => setActualMlValue(value as number)}
    value={actualMlValue}
/>
<Button
    type="primary"
    onClick={handleSetActualMl}
    disabled={!actualMlValue}
>
    Lưu
</Button>
```

**User Input:**
- User measures actual volume: **950 ml**
- User enters: `950`
- User clicks "Lưu"

---

### Step 5.3: UI Sends Actual ML Value

**File:** `CalibPump.tsx` line 141-163

```typescript
const handleSetActualMl = async () => {
    if (!actualMlValue) return;

    const actualMlKey = `CALIB_ACTUAL_ML_BOM_${indexOfPump + 1}`;

    console.log({
        device_id_thingsboard: deviceId,
        method: "set_state",
        params: {
            [actualMlKey]: actualMlValue,
        },
    });

    await control({
        device_id_thingsboard: deviceId,
        method: "set_state",
        params: {
            [actualMlKey]: actualMlValue,
        },
    });
};
```

**MQTT Message Sent:**
```json
{
    "device_id_thingsboard": "3691dba0-309e-11f0-98dc-bf024c096c4a",
    "method": "set_state",
    "params": {
        "CALIB_ACTUAL_ML_BOM_1": 950
    }
}
```

---

### Step 5.4: Node-RED Stores in Global Context

**vietplants-rpc-control:**
- Receives message
- Updates `global.configKeyValues.CALIB_ACTUAL_ML_BOM_1 = 950`

**No Modbus write** - this is a configuration value stored in Node-RED

---

## Phase 6: Trigger Calibration Calculation

### Step 6.1: User Clicks "Tính toán và cập nhật"

**File:** `CalibPump.tsx` line 848-870

```typescript
const handleTriggerCalibration = async () => {
    const calculateKey = `CALCULATE_CALIB_BOM_${indexOfPump + 1}`;

    console.log({
        device_id_thingsboard: deviceId,
        method: "set_state",
        params: {
            [calculateKey]: true,
        },
    });

    try {
        await control({
            device_id_thingsboard: deviceId,
            method: "set_state",
            params: {
                [calculateKey]: true,
            },
        });

        setIsCalibrationInProgress(true);
        message.success("Đã gửi yêu cầu tính toán hiệu chuẩn");

        setTimeout(() => {
            setIsCalibrationInProgress(false);
        }, 30000); // 30s timeout
    } catch (error) {
        message.error("Lỗi khi gửi yêu cầu hiệu chuẩn");
        console.error("Calibration trigger error:", error);
    }
};
```

**MQTT Message Sent:**
```json
{
    "device_id_thingsboard": "3691dba0-309e-11f0-98dc-bf024c096c4a",
    "method": "set_state",
    "params": {
        "CALCULATE_CALIB_BOM_1": true
    }
}
```

---

### Step 6.2: UI Shows "Calculating" State

**File:** `CalibPump.tsx` line 872-890

```typescript
{isCalibrationInProgress && (
    <div
        style={{
            backgroundColor: "#f6ffed",
            border: "1px solid #b7eb8f",
        }}
    >
        <p>🔄 Đang tính toán hệ số hiệu chuẩn...</p>
        <p>Đang xử lý và cập nhật giá trị mới</p>
    </div>
)}
```

**UI Display:**
```
┌─────────────────────────────────────────┐
│ 🔄 Đang tính toán hệ số hiệu chuẩn...  │
│ Đang xử lý và cập nhật giá trị mới     │
└─────────────────────────────────────────┘
```

---

### Step 6.3: Node-RED Detects Calibration Flag

**File:** `viis-flow-calibration.ts` line 120-140

```typescript
async function checkCalibrationFlags(): Promise<void> {
    const configKeyValues = globalHelper.getGlobalConfigKeyValues();
    
    for (let i = 1; i <= 16; i++) {
        const calculateKey = `CALCULATE_CALIB_BOM_${i}`;
        
        if (!configKeyValues[calculateKey]) {
            continue;
        }
        
        log(`Calibration requested for pump ${i}`);
        
        // Gather calibration input
        const input = gatherCalibrationInput(i, ...);
    }
}
```

**Check Interval:** Every 2000ms

---

### Step 6.4: Gather Calibration Input

**File:** `viis-flow-calibration.ts` line 230-270

```typescript
function gatherCalibrationInput(pumpIndex: number) {
    const actualMlKey = `CALIB_ACTUAL_ML_BOM_${pumpIndex}`;
    const setMlKey = `HOLDING_SETML_BOM_${pumpIndex}`;
    const calibKey = `HOLDING_CALIB_BOM_${pumpIndex}`;
    
    return {
        pumpIndex: 1,
        actualMl: configKeyValues[actualMlKey],      // 950
        setMl: holdingRegisterData1[setMlKey],       // 1000
        currentCalibBoard1: holdingRegisterData1[calibKey],  // 1000 (10.00 ml/s)
        currentKFactor: holdingRegisterData2[kFactorKey],    // 450
        currentFlowrate: holdingRegisterData2[flowrateKey],  // 1000 (10.00 ml/s)
        reportedVolume: inputRegisterData2[totalFlowKey]     // 1000
    };
}
```

---

### Step 6.5: Calculate Calibration Values

**File:** `calibrationService.ts` line 60-110

```typescript
public calculate(input: CalibrationInput) {
    const { actualMl, setMl, currentCalibBoard1, currentKFactor, reportedVolume } = input;
    
    // Calculate run time
    const currentCalibUnscaled = currentCalibBoard1 / 100;  // 10.00 ml/s
    const runTime = setMl / currentCalibUnscaled;           // 1000 / 10 = 100s
    
    // Board1: newCalib = actualMl / runTime
    const newCalibValue = actualMl / runTime;               // 950 / 100 = 9.5 ml/s
    const scaledCalibValue = newCalibValue * 100;           // 950 (scaled)
    
    // Board2: K_new = K_old × (actualMl / reportedVolume)
    const newKFactor = currentKFactor * (actualMl / reportedVolume);
    // = 450 × (950 / 1000) = 427.5 ≈ 428
    
    // Board2: Q_new = actualMl / runTime
    const newFlowrate = (actualMl / runTime) * 100;
    // = (950 / 100) * 100 = 950 (scaled)
    
    return {
        board1: { newCalibValue: 950, address: 17 },
        board2: { newKFactor: 428, kFactorAddress: 0, newFlowrate: 950, flowrateAddress: 20 }
    };
}
```

---

### Step 6.6: Write Calibration Values to Modbus

**File:** `viis-flow-calibration.ts` line 275-305

```typescript
async function writeCalibrationValues(result: CalibrationResult) {
    // Board1: Write HOLDING_CALIB_BOM_1 (address 17)
    await modbusClientBoard1.writeRegister(17, 950);
    
    // Board2: Write HOLDING_K_FACTOR_BOM_1 (address 0)
    await modbusClientBoard2.writeRegister(0, 428);
    
    // Board2: Write HOLDING_FLOWRATE_BOM_1 (address 20)
    await modbusClientBoard2.writeRegister(20, 950);
}
```

**Modbus TCP Packets:**

**To Board1:**
```
Destination: 192.168.110.77:502
Function Code: 6 (Write Single Register)
Address: 17
Value: 950
```

**To Board2 (K-Factor):**
```
Destination: 192.168.110.98:502
Function Code: 6
Address: 0
Value: 428
```

**To Board2 (Flowrate):**
```
Destination: 192.168.110.98:502
Function Code: 6
Address: 20
Value: 950
```

---

### Step 6.7: Boards Store New Values

**Board1 Firmware:**
```cpp
holdingRegister[17] = 950;  // HOLDING_CALIB_BOM_1 = 9.50 ml/s
```

**Board2 Firmware:**
```cpp
holdingRegister[0] = 428;   // K_FACTOR_BOM_1 = 428 pulses/L
holdingRegister[20] = 950;  // FLOWRATE_BOM_1 = 9.50 ml/s
```

---

### Step 6.8: Reset Calibration Flag

**File:** `viis-flow-calibration.ts` line 310-320

```typescript
function updateGlobalConfigFlags(updates: CalibrationFlagResetPayload) {
    const configKeyValues = globalHelper.getGlobalConfigKeyValues();
    
    for (const [key, value] of Object.entries(updates)) {
        configKeyValues[key] = value;
    }
    
    globalHelper.setGlobalVar("configKeyValues", configKeyValues);
}

// Reset flag
updateGlobalConfigFlags({ CALCULATE_CALIB_BOM_1: false });
```

---

### Step 6.9: Publish Flag Reset to MQTT

**File:** `viis-flow-calibration.ts` line 190-200

```typescript
node.send({
    topic: "calibration_complete",
    payload: {
        flagUpdates: {
            CALCULATE_CALIB_BOM_1: false
        },
        stats: { ...stats }
    }
});
```

**MQTT Publish:**
```json
{
    "topic": "v1/devices/me/telemetry",
    "payload": [
        {
            "key": "CALCULATE_CALIB_BOM_1",
            "value": false
        }
    ]
}
```

---

## Phase 7: Calibration Complete

### Step 7.1: UI Receives Flag Reset

**File:** `CalibPump.tsx` line 221-245

```typescript
useEffect(() => {
    if (!deviceId || !isCalibrationInProgress) return;

    const calculateKey = `CALCULATE_CALIB_BOM_${indexOfPump + 1}`;

    const subscriptionIds = subscribe([genDeviceTopic(deviceId)], (msg) => {
        const data = JSON.parse(msg);
        if (Array.isArray(data)) {
            const calculateFlagData = data.find(
                (item) => item.key === calculateKey
            );
            if (calculateFlagData && calculateFlagData.value === false) {
                // Calibration completed
                setIsCalibrationInProgress(false);
                message.success(
                    "Hiệu chuẩn hoàn tất! " +
                    (board2Functions
                        ? "Board1 (Bơm) và Board2 (Cảm biến lưu lượng) đã được cập nhật."
                        : "Hệ số mới đã được cập nhật.")
                );
            }
        }
    });
}, [deviceId, isCalibrationInProgress, indexOfPump]);
```

---

### Step 7.2: UI Shows Success Message

**Message Display:**
```
✅ Hiệu chuẩn hoàn tất!
Board1 (Bơm) và Board2 (Cảm biến lưu lượng) đã được cập nhật.
```

---

### Step 7.3: UI Refreshes Data

**File:** `CalibPump.tsx` line 410-450

```typescript
useEffect(() => {
    if (refreshTrigger === 0) return;

    // Refresh calibration coefficient
    if (functionForOldCalibration?.identifier && deviceId) {
        getLatestDataDevices({
            deviceId: deviceId,
            keys: [functionForOldCalibration.identifier],
        }).then((res) => {
            const latestCalibData = res?.data?.[functionForOldCalibration.identifier];
            if (latestCalibData.length > 0) {
                const calibValue = Number(latestData?.value);
                setCurrentCalibCoeff(calibValue);  // Now shows 9.50
            }
        });
    }
}, [refreshTrigger]);
```

---

### Step 7.4: User Sees Updated Values

**UI Display:**
```
┌─────────────────────────────────────────┐
│ Board1: Điều khiển bơm                  │
│ Hệ số calib bơm 3: 9.50 ml/s  ✅       │
├─────────────────────────────────────────┤
│ Board2: Cảm biến lưu lượng              │
│ K-Factor: 428  ✅                       │
│ Lưu lượng kỳ vọng: 9.50 ml/s  ✅        │
└─────────────────────────────────────────┘
```

---

## Summary Table

| Step | Action | From | To | Key/Address | Value |
|------|--------|------|-----|-------------|-------|
| 1.1 | Click "Tiến hành hiệu chuẩn" | User | UI | - | - |
| 1.2 | Modal opens & triggers reset | UI | UI | - | - |
| 1.3 | Send reset command | UI | MQTT | `RESET_TOTAL_VOLUME_BOM_1` | `true` |
| 1.4 | Route RPC | Thingsboard | Node-RED | - | - |
| 1.5 | Receive RPC | Node-RED | RpcHandler | - | - |
| 1.6 | Process key | RpcHandler | ModbusService | - | - |
| 1.7 | Find mapping | ModbusService | ModbusClient | Coil 201 | Board2 |
| 1.8 | Write coil | ModbusClient | Board2 | 201 | 1 |
| 1.9 | Reset counter | Board2 | Board2 | - | 0 |
| 1.10 | Show success | UI | User | - | - |
| 2.1 | Adjust target | User | UI | - | 1000 |
| 2.2 | Send target | UI | MQTT | `HOLDING_SETML_BOM_1` | 1000 |
| 2.3 | Write register | Node-RED | Board1 | 1 | 1000 |
| 2.4 | Store target | Board1 | Board1 | - | - |
| 3.1 | Toggle ON | User | UI | - | - |
| 3.2 | Send pump ON | UI | MQTT | `COIL_BOM_1` | `true` |
| 3.3 | Write coil | Node-RED | Board1 | 16 | 1 |
| 3.4 | Activate relay | Board1 | Board1 | - | - |
| 3.5 | Start timer | UI | UI | - | 100s |
| 4.1 | Read sensor | Board2 | Board2 | - | - |
| 4.2 | Read input | Node-RED | Board2 | 20 | - |
| 4.3 | Publish volume | Node-RED | MQTT | `INPUT_TOTAL_FLOW_BOM_1` | 850 |
| 4.4 | Receive update | UI | MQTT | - | - |
| 4.5 | Timer ends | UI | UI | - | - |
| 5.1 | Show input | UI | User | - | - |
| 5.2 | Enter actual | User | UI | - | 950 |
| 5.3 | Send actual | UI | MQTT | `CALIB_ACTUAL_ML_BOM_1` | 950 |
| 5.4 | Store in global | Node-RED | Global | - | - |
| 6.1 | Click calculate | User | UI | - | - |
| 6.2 | Show calculating | UI | User | - | - |
| 6.3 | Detect flag | Node-RED | viis-flow-calibration | - | - |
| 6.4 | Gather input | Node-RED | Node-RED | - | - |
| 6.5 | Calculate | Node-RED | Node-RED | - | - |
| 6.6 | Write values | Node-RED | Board1/2 | 17, 0, 20 | 950, 428, 950 |
| 6.7 | Store values | Board1/2 | Board1/2 | - | - |
| 6.8 | Reset flag | Node-RED | Global | - | - |
| 6.9 | Publish reset | Node-RED | MQTT | `CALCULATE_CALIB_BOM_1` | `false` |
| 7.1 | Receive reset | UI | MQTT | - | - |
| 7.2 | Show success | UI | User | - | - |
| 7.3 | Refresh data | UI | Backend | - | - |
| 7.4 | Show updated | UI | User | - | - |

---

## Document Version

| Version | Date | Author | Status |
|---------|------|--------|--------|
| 1.0 | 2026-03-18 | VIIS Team | ✅ Verified from source code |
