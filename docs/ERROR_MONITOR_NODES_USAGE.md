# 🔧 Error Monitor Nodes - Usage Guide

**Version**: 1.0
**Date**: 2025-10-17

---

## 📊 Node Comparison

| Node | Use Case | Modbus Integration | Input Required |
|------|----------|-------------------|----------------|
| **viis-modbus-error-monitor** | Standalone polling | ✅ Built-in | ❌ No (polls itself) |
| **viis-error-monitor** | Downstream from getter | ❌ No (data from input) | ✅ Yes (from viis-modbus-flex) |
| **viis-error-trigger** | Business logic errors | ❌ No | ✅ Yes (custom payload) |

---

## 🎯 Your Use Case: Separate Concerns

### Flow Architecture

```
[viis-modbus-flex] → [viis-error-monitor] → [debug/output]
   (poll coils only)     (check errors)        (result)
```

**✅ Advantages**:
- Clean separation of concerns
- Modbus getter reusable for other purposes
- Easy to test each component
- No viis-modbus-poller needed

---

## 🚀 Step-by-Step Setup

### Step 1: Create Error Code Mapping

File: `/services/env/error-codes/your-board.json`

```json
{
  "device_type": "Your_Board_Name",
  "mappings": [
    {
      "register_type": "coil",
      "address": 500,
      "description": "Fan error flag",
      "error_codes": [
        {
          "code": true,
          "err_code": "ERR_FAN_OVERRUN",
          "message": "Quạt chạy quá lâu",
          "severity": "medium",
          "auto_resolve": true
        }
      ]
    },
    {
      "register_type": "coil",
      "address": 501,
      "description": "Pump fault",
      "error_codes": [
        {
          "code": true,
          "err_code": "ERR_PUMP_FAULT",
          "message": "Máy bơm bị lỗi",
          "severity": "high",
          "auto_resolve": false
        }
      ]
    }
  ]
}
```

### Step 2: Build & Deploy

```bash
cd /services/nodered/custom-nodes/viis-node-red
npm run build
docker restart viis-local-nodered
```

### Step 3: Create Flow in Node-RED

#### Node 1: viis-modbus-flex

**Config**:
- Function Code: `1` (Read Coils)
- Start Address: `500`
- Quantity: `10` (số coils cần đọc)
- Board ID: (select your board)

**Output**:
```javascript
{
  success: true,
  data: [false, true, false, ...]  // Array of coil values
}
```

#### Node 2: viis-error-monitor

**Config**:
- Device Type: `Your_Board_Name` (match JSON file)
- Register Type: `coil`
- Start Address: `500`
- Name: (optional)

**Input**: From viis-modbus-flex
**Output**:
```javascript
{
  payload: {
    success: true,
    data: [false, true, false, ...]
  },
  errorMonitor: {
    checked: 10,
    notifications: {
      created: [
        {
          address: 501,
          value: true,
          err_code: "ERR_PUMP_FAULT",
          message: "Máy bơm bị lỗi",
          severity: "high"
        }
      ],
      resolved: [
        { address: 500, value: false }
      ]
    },
    stats: {
      totalChecked: 10,
      errorsDetected: 1,
      errorsResolved: 1,
      lastCheck: "2025-10-17T08:00:00.000Z"
    }
  }
}
```

#### Node 3: debug (or function for further processing)

---

## 💻 Complete Flow Example

### Flow 1: Simple Monitoring

```
┌─────────────────────┐
│ inject (interval)   │
│  - Repeat: 5 sec    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ viis-modbus-flex  │
│  - FC: 1 (Coils)    │
│  - Address: 500     │
│  - Quantity: 10     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ viis-error-monitor  │
│  - Device: Board1   │
│  - Type: coil       │
│  - Start: 500       │
└──────────┬──────────┘
           │
           ├──────────┐
           ▼          ▼
       [debug]   [dashboard]
```

### Flow 2: With Conditional Actions

```
[inject] → [viis-modbus-flex] → [viis-error-monitor] → [switch]
                                                              ├─ errors > 0 → [send alert]
                                                              ├─ critical   → [stop pump]
                                                              └─ ok         → [continue]
```

### Flow 3: Multiple Boards

```
[inject] → [viis-modbus-flex] → [viis-error-monitor] → [join]
              (board1, coils)         (Board1 errors)        │
                                                             │
[inject] → [viis-modbus-flex] → [viis-error-monitor] ────┤
              (board2, holding)       (Board2 errors)        │
                                                             ▼
                                                        [aggregate]
```

---

## 🎨 UI Configuration

### viis-modbus-flex Config

```
┌─────────────────────────────────────┐
│ Function Code: [1 - Read Coils   ▼]│
│ Start Address: [500              ] │
│ Quantity:      [10               ] │
│ Board:         [Board 1          ▼]│
│ Poll Interval: [5000            ]ms│
└─────────────────────────────────────┘
```

### viis-error-monitor Config

```
┌─────────────────────────────────────┐
│ Name:          [Monitor Board1    ] │
│ Device Type:   [Your_Board_Name   ] │
│ Register Type: [Coil             ▼]│
│ Start Address: [500               ] │
└─────────────────────────────────────┘
```

---

## 🔍 Override via msg Properties

You can override config via `msg`:

```javascript
// Override in function node before viis-error-monitor
msg.deviceType = "Another_Board";
msg.registerType = "holding";
msg.startAddress = 1000;
msg.entity = "greenhouse_002";

return msg;
```

---

## 📝 Advanced Examples

### Example 1: Filter Critical Errors Only

```javascript
// Function node after viis-error-monitor
const notifications = msg.errorMonitor?.notifications?.created || [];

const critical = notifications.filter(n => n.severity === 'critical');

if (critical.length > 0) {
    msg.payload = {
        alert: true,
        errors: critical
    };
    return msg;
}

return null; // Don't send if no critical errors
```

### Example 2: Send Email on Errors

```
[viis-error-monitor] → [function: filter critical] → [email node]
```

```javascript
// Filter function
const created = msg.errorMonitor?.notifications?.created || [];

if (created.length > 0) {
    msg.payload = {
        to: "admin@example.com",
        subject: `Alert: ${created.length} errors detected`,
        body: created.map(e =>
            `${e.err_code}: ${e.message} (address: ${e.address})`
        ).join('\n')
    };
    return msg;
}

return null;
```

### Example 3: Update Dashboard

```javascript
// Format for dashboard
const stats = msg.errorMonitor?.stats || {};
const notifications = msg.errorMonitor?.notifications || {};

msg.payload = {
    totalErrors: stats.errorsDetected,
    activeErrors: notifications.created.length,
    lastCheck: stats.lastCheck,
    details: notifications.created
};

return msg;
```

---

## 🧪 Testing

### Test 1: Verify Error Detection

1. Set coil 501 = true (manually or via Modbus simulator)
2. Trigger viis-modbus-flex
3. Check viis-error-monitor output
4. Expected: `msg.errorMonitor.notifications.created` has ERR_PUMP_FAULT

### Test 2: Verify Auto-resolve

1. Error exists in database (from Test 1)
2. Set coil 501 = false
3. Trigger viis-modbus-flex
4. Expected: `msg.errorMonitor.notifications.resolved` has address 501

### Test 3: Check Database

```bash
docker exec viis-local-mysql mysql -u root -p'admin@123' viis_local \
  -e "SELECT err_code, message, entity, is_read, created_at FROM tabiot_notification ORDER BY created_at DESC LIMIT 5;"
```

---

## ⚙️ Performance Tips

### 1. Polling Interval

```javascript
// viis-modbus-flex config
{
  pollInterval: 5000  // 5 seconds for normal monitoring
  pollInterval: 1000  // 1 second for critical systems
  pollInterval: 10000 // 10 seconds for low-priority
}
```

### 2. Batch Multiple Coils

```javascript
// Instead of:
//   - Coil 500-509 → error monitor
//   - Coil 510-519 → error monitor

// Better:
//   - Coil 500-519 → single error monitor
```

### 3. Filter Unchanged Data

```javascript
// Function before error monitor
if (JSON.stringify(msg.payload) === flow.get('lastPayload')) {
    return null; // Skip if data unchanged
}

flow.set('lastPayload', JSON.stringify(msg.payload));
return msg;
```

---

## 🚨 Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| No notifications created | No mapping found | Check deviceType matches JSON file |
| Node status "No mapping found" | env-loader not deployed | Deploy env-loader in Node-RED |
| Data not passing through | Wrong payload format | Ensure viis-modbus-flex output format |
| Errors not auto-resolving | auto_resolve: false | Check JSON mapping config |
| Node showing error | viis-error-monitor not built | Run `npm run build` |

---

## 📚 Related Docs

- [Error Notification README](./ERROR_NOTIFICATION_README.md)
- [Quick Reference](./ERROR_NOTIFICATION_QUICK_REFERENCE.md)
- [Usage Guide](./ERROR_NOTIFICATION_USAGE_GUIDE.md)

---

**Made with ❤️ by VIIS Team**
