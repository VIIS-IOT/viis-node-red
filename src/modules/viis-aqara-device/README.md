# VIIS Aqara Device Node

Custom Node-RED node for controlling Aqara devices via Aqara Open API.

## Version

**v2.0.0** (2026-03-24) - Updated with standard API format

---

## Quick Start

### Step 1: Initialize Credentials

In a Function node (run once at startup):

```javascript
global.set("aqaraCredentials", {
    appid: "your-app-id",
    keyid: "your-key-id",
    appkey: "your-app-key",
    accesstoken: "your-access-token"
});
```

### Step 2: Use Standard Aqara API Format

```
[Function: Set Payload] → [viis-aqara-device] → [Debug]
```

**Function Code:**
```javascript
msg.payload = {
  "intent": "query.device.info",
  "data": {
    "dids": ["lumi1.54ef44509e39"],
    "positionId": "",
    "pageNum": 1,
    "pageSize": 50
  }
};
return msg;
```

**Output (Exact Aqara Response):**
```json
{
  "code": 0,
  "message": "Success",
  "requestId": "...",
  "result": {
    "data": [...],
    "totalCount": 1
  }
}
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Auto Authentication** | Handles Sign, Nonce, Time headers automatically |
| **Standard API Format** | Accepts `msg.payload = { intent, data }` |
| **Exact Response** | Returns raw Aqara API response |
| **Rate Limiting** | Built-in 2s delay between requests |
| **Retry Logic** | Configurable exponential backoff |
| **Multi-Region** | Support for Singapore and China regions |

---

## Input Message Format

### Standard Aqara API Format

```javascript
msg.payload = {
  "intent": "intent.name",      // Required
  "data": {                     // Intent-specific data
    // ...
  },
  "url": "https://..."          // Optional, defaults to Singapore
};
```

### Common Intents

#### 1. Query Device Info
```javascript
msg.payload = {
  "intent": "query.device.info",
  "data": {
    "dids": ["lumi1.54ef44509e39"],
    "pageNum": 1,
    "pageSize": 50
  }
};
```

#### 2. Send IR Command
```javascript
msg.payload = {
  "intent": "write.ir.click",
  "data": {
    "did": "lumi1.54ef44509e39",
    "acKey": "P0_M0_T25_S2"
  }
};
```

#### 3. Query AC State
```javascript
msg.payload = {
  "intent": "query.ir.acState",
  "data": {
    "did": "lumi1.54ef44509e39"
  }
};
```

---

## Output Format

### Success Response
```javascript
{
  payload: {
    code: 0,
    message: "Success",
    requestId: "...",
    result: { ... }
  },
  topic: "aqara/api"
}
```

### Error Response
```javascript
{
  payload: {
    code: 1001,
    message: "Invalid signature",
    requestId: "..."
  },
  topic: "aqara/error"
}
```

---

## AC Key Format

For IR commands: `P{power}_M{mode}_T{temp}_S{fan}`

| Segment | Values |
|---------|--------|
| **P** (Power) | 0=ON, 1=OFF |
| **M** (Mode) | 0=Cool, 1=Heat, 2=Auto, 3=Fan, 4=Dry |
| **T** (Temp) | 16-30 (°C) |
| **S** (Fan) | 0=Auto, 1=Low, 2=Medium, 3=High |

**Example:** `P0_M0_T25_S2` = ON, Auto mode, 25°C, Medium fan

---

## Error Codes

| Code | Message | Solution |
|------|---------|----------|
| 0 | Success | - |
| 1001 | Invalid signature | Check appkey |
| 1002 | Expired timestamp | Sync system clock |
| 1003 | Invalid credentials | Verify appid/keyid |
| 2001 | Device not found | Check device ID |
| 2002 | Device offline | Check connection |
| 3001 | Invalid IR command | Check acKey format |
| 3002 | No AC state data | Device is stateless |

---

## Configuration

### Node Properties

| Property | Description | Default |
|----------|-------------|---------|
| **Name** | Node label | - |
| **Device Type** | AC / IR Generic / Custom | AC |
| **Operation Mode** | Auto / Manual | Auto |
| **Default Temperature** | Default temp for AC | 25°C |
| **Default Fan Speed** | Default fan speed | Medium |
| **Request Delay** | Delay between requests | 2000ms |
| **Enable Retry** | Retry on failure | Yes |
| **Max Retries** | Maximum retry attempts | 3 |

---

## Example Flows

### Flow 1: Query Device List

```json
[
  {
    "id": "function1",
    "type": "function",
    "wires": [["aqaraNode"]],
    "func": "msg.payload = {\n  intent: 'query.device.info',\n  data: {\n    dids: ['lumi1.54ef44509e39']\n  }\n};\nreturn msg;"
  },
  {
    "id": "aqaraNode",
    "type": "viis-aqara-device",
    "wires": [["debug1"]]
  }
]
```

### Flow 2: AC Control Automation

```
[Timer] → [Function: Check Temp] → [viis-aqara-device] → [Debug]
```

**Function Code:**
```javascript
const currentTemp = global.get('roomTemperature') || 28;
const targetTemp = 25;

if (currentTemp > targetTemp) {
  msg.payload = {
    intent: 'write.ir.click',
    data: {
      did: 'lumi1.54ef44509e39',
      acKey: 'P0_M1_T22_S3'
    }
  };
} else {
  msg.payload = {
    intent: 'write.ir.click',
    data: {
      did: 'lumi1.54ef44509e39',
      acKey: 'P0_M0_T25_S1'
    }
  };
}

return msg;
```

---

## Troubleshooting

### Invalid Signature (1001)

1. Check credentials in global context
2. Verify sign format: `accesstoken=...&appid=...&keyid=...&nonce=...&time=...{appkey}`
3. Ensure MD5 hash is lowercase

### Expired Timestamp (1002)

1. Sync system clock with NTP
2. Check timezone configuration

### Device Not Found (2001)

1. Verify device ID is correct
2. Check device is registered to your account

---

## API Reference

- **Aqara Open Platform:** https://open.aqara.com/
- **API Documentation:** https://open-sg.aqara.com/api/document
- **Base URL (Singapore):** https://open-sg.aqara.com/v3.0/open/api
- **Base URL (China):** https://open-cn.aqara.com/v3.0/open/api

---

## Version History

- **v2.0.0** (2026-03-24): 
  - ✅ Standard API format (`msg.payload = { intent, data }`)
  - ✅ Fixed sign calculation to match Aqara spec
  - ✅ Returns exact Aqara response
  
- **v1.1.0**: Added READ support (query.ir.acState)
- **v1.0.0**: Initial release

---

**Last Updated:** 2026-03-24  
**Status:** ✅ Production Ready
