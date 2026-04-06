# VIIS Config Loader - Setup Guide

## 🎯 Mục tiêu

Chỉ cần edit `device1.json` → build → import flow → deploy → **CHẠY NGAY** (KHÔNG cần edit Config Loader function node)

---

## 📋 Setup Steps

### Step 1: Edit `device1.json`

File: `/services/env/configs/device1.json`

**Required fields:**

```json
{
  "deviceIdentity": { ... },
  "modbusBoards": [ ... ],
  "modbusMappings": {
    "board1": {
      "coils": {
        "power": 30,
        "main_pump": 31,
        "valve_0": 40
      },
      "holdingRegisters": {
        "current_ec": 100,
        "current_ph": 101
      }
    }
  }
}
```

**Optional fields (auto-generated if missing):**

```json
{
  "modbusPollGroups": {
    "realtime": {
      "interval": 2000,
      "coils": ["power", "main_pump"],
      "holding": ["current_ec", "current_ph"]
    },
    "sensors": {
      "interval": 5000,
      "coils": [],
      "holding": ["volume_1", "volume_2"]
    },
    "config": {
      "interval": 300000,
      "coils": [],
      "holding": ["set_ec", "set_ph"]
    }
  },
  "modbusPublishThresholds": {
    "power": 0,
    "main_pump": 0,
    "current_ec": 0.1,
    "current_ph": 0.1
  }
}
```

---

### Step 2: Build Custom Nodes

```bash
# Build env-loader (updated with auto-generate logic)
cd /home/phuongtung0801/viis/fe-be/viis-local-docker/services/nodered/custom-nodes/env-loader
npm run build

# Build viis-config-loader (new custom node)
cd /home/phuongtung0801/viis/fe-be/viis-local-docker/services/nodered/custom-nodes/viis-node-red
npm run build
```

---

### Step 3: Import Flow vào Node-RED

1. Mở Node-RED UI: `http://localhost:1881`
2. Import flow JSON (đã có `viis-config-loader` node)
3. Deploy

---

### Step 4: Verify Config Loaded

Kiểm tra status của `viis-config-loader` node:

- ✅ **Green**: "X groups, Y thresholds (full coverage)" → OK
- ⚠️ **Yellow**: "X groups, Y thresholds | ⚠️ Z warnings" → Check debug panel
- 🔴 **Red**: "Missing modbusPollGroups" hoặc "Missing modbusPublishThresholds" → Check device1.json

---

## 🔍 Auto-Generate Logic

Nếu bạn **KHÔNG** define `modbusPollGroups` và `modbusPublishThresholds`, system sẽ **auto-generate** từ `modbusMappings`:

### Auto-generated Poll Groups:

```javascript
// Nếu chỉ có modbusMappings.coils và modbusMappings.holdingRegisters
// System sẽ tạo:

{
  "realtime": {
    "interval": 2000,
    "coils": [tất cả coils],
    "holding": []
  },
  "sensors": {
    "interval": 5000,
    "coils": [],
    "holding": [holdings không phải config]
  },
  "config": {
    "interval": 300000,
    "coils": [],
    "holding": [holdings có "set_", "time_", "mode", "factor"]
  }
}
```

### Auto-generated Thresholds:

```javascript
// Coils: threshold = 0 (binary, publish on any change)
"power": 0,
"valve_0": 0

// Holdings: threshold dựa trên key pattern
"current_temp": 0.3,      // Temperature: 0.3°C
"current_ec": 0.1,        // EC/pH: 0.1
"volume_1": 0.5,          // Flow/Volume: 0.5
"set_ec": 0.1,            // Set values: 0.1
"EC_max": 0,              // Safety limits: any change
"control_mode": 0         // Mode/status: any change
```

---

## 📝 Example device1.json

### Minimal (chỉ cần modbusMappings):

```json
{
  "deviceIdentity": {
    "DEVICE_ID": "my-device",
    "DEVICE_ACCESS_TOKEN": "token-123"
  },
  "modbusBoards": [
    {
      "id": "board1",
      "host": "192.168.1.100",
      "tcpPort": 502,
      "type": "TCP",
      "unitId": 1
    }
  ],
  "modbusMappings": {
    "board1": {
      "coils": {
        "power": 0,
        "pump": 1
      },
      "holdingRegisters": {
        "temp": 100,
        "ec": 101
      }
    }
  }
  // modbusPollGroups và modbusPublishThresholds sẽ auto-generate
}
```

### Full Control (define custom groups):

```json
{
  "deviceIdentity": { ... },
  "modbusBoards": [ ... ],
  "modbusMappings": { ... },
  
  "modbusPollGroups": {
    "realtime": {
      "interval": 1000,  // 1s cho critical controls
      "coils": ["power", "emergency_stop"],
      "holding": ["current_temp", "current_ph"]
    },
    "environment": {
      "interval": 5000,  // 5s cho environmental sensors
      "coils": ["fan_1", "fan_2", "heater"],
      "holding": ["ambient_temp", "ambient_humid", "co2_level"]
    },
    "irrigation": {
      "interval": 10000,  // 10s cho irrigation (không cần nhanh)
      "coils": ["valve_1", "valve_2", "water_pump"],
      "holding": ["flow_rate", "pressure", "volume_total"]
    },
    "settings": {
      "interval": 600000,  // 10 phút cho settings (hiếm thay đổi)
      "coils": [],
      "holding": ["set_temp", "set_ph", "schedule_mode"]
    }
  },
  
  "modbusPublishThresholds": {
    "power": 0,
    "emergency_stop": 0,
    "current_temp": 0.5,  // Publish if temp changes > 0.5°C
    "current_ph": 0.05,   // Publish if pH changes > 0.05
    "flow_rate": 1.0,     // Publish if flow changes > 1.0 L/min
    "set_temp": 0.1       // Publish if setpoint changes > 0.1°C
  }
}
```

---

## ⚠️ Troubleshooting

### Lỗi: "Missing modbusPollGroups"

**Nguyên nhân:** `device1.json` không có `modbusMappings`

**Fix:** Thêm `modbusMappings` với ít nhất 1 coil hoặc holding register:

```json
{
  "modbusMappings": {
    "board1": {
      "coils": { "power": 0 }
    }
  }
}
```

---

### Lỗi: "coil 'xyz' NOT FOUND in modbus_board1_coils"

**Nguyên nhân:** `modbusPollGroups` reference key không có trong `modbusMappings`

**Fix:** Hoặc thêm key vào mappings, hoặc xóa khỏi pollGroups:

```json
// Option 1: Thêm vào mappings
"modbusMappings": {
  "board1": {
    "coils": {
      "power": 0,
      "xyz": 1  // ← Thêm key này
    }
  }
}

// Option 2: Xóa khỏi pollGroups
"modbusPollGroups": {
  "realtime": {
    "coils": ["power"]  // ← Xóa "xyz"
  }
}
```

---

### Lỗi: "Missing threshold for coil 'xyz'"

**Nguyên nhân:** Key có trong pollGroups nhưng không có threshold

**Fix:** Thêm threshold vào `modbusPublishThresholds`:

```json
"modbusPublishThresholds": {
  "power": 0,
  "xyz": 0  // ← Thêm threshold này
}
```

---

## 📊 Best Practices

1. **Đặt interval hợp lý:**
   - Critical controls (emergency stop, power): 1-2s
   - Environmental sensors (temp, humid): 5-10s
   - Irrigation (valves, flow): 5-10s
   - Settings (setpoints, modes): 5-10 minutes

2. **Đặt threshold hợp lý:**
   - Binary coils (on/off): 0 (publish mọi change)
   - Temperature: 0.3-0.5°C
   - pH: 0.05-0.1
   - Flow/Volume: 0.5-1.0
   - Safety limits: 0 (publish mọi change)

3. **Group keys theo mục đích:**
   - Tách riêng control coils và sensor holdings
   - Nhóm settings riêng để poll ít thường xuyên
   - Tránh poll tất cả cùng 1 interval

---

## 🎉 Result

Sau khi setup xong:

1. ✅ Chỉ cần edit `device1.json`
2. ✅ Build custom nodes
3. ✅ Import flow
4. ✅ Deploy
5. ✅ **TỰ ĐỘNG load config** - KHÔNG cần edit function node!

---

## 📁 Files liên quan

- `/services/env/configs/device1.json` - Device configuration
- `/services/nodered/custom-nodes/env-loader/lib/json-config-parser.js` - Auto-generate logic
- `/services/nodered/custom-nodes/viis-node-red/src/modules/viis-config-loader/` - Config loader node
- Flow JSON (import vào Node-RED)
