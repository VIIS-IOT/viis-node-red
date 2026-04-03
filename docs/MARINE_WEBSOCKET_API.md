# 🌐 Marine IoT WebSocket API

## Tổng quan

WebSocket API cung cấp kết nối real-time hai chiều để streaming dữ liệu telemetry từ hệ thống Marine IoT. Thay vì client phải polling liên tục, server sẽ tự động push dữ liệu mới đến client khi có update.

### Ưu điểm so với REST API polling:
- ✅ **Hiệu quả hơn**: Giảm tải server và network bandwidth
- ✅ **Real-time thực sự**: Latency thấp hơn, dữ liệu được push ngay lập tức
- ✅ **Tối ưu battery**: Client không cần request liên tục
- ✅ **Scalable**: Có thể handle nhiều connections đồng thời

---

## 🔌 Kết nối

### Endpoint
```
ws://localhost:1881/socket.io/
```

### Authentication
Sử dụng JWT token để authenticate:

**Cách 1: Qua handshake auth**
```javascript
const socket = io('http://localhost:1881', {
    auth: {
        token: 'your-jwt-token-here'
    }
});
```

**Cách 2: Qua query parameter**
```javascript
const socket = io('http://localhost:1881', {
    query: {
        token: 'your-jwt-token-here'
    }
});
```

---

## 📡 Events

### Client → Server Events

#### 1. `marine:subscribe`
Subscribe để nhận telemetry updates từ một device.

**Payload:**
```javascript
{
    deviceId: string,      // Required: Device UUID
    keys?: string[]        // Optional: Array sensor keys (default: all)
}
```

**Example:**
```javascript
// Subscribe to all sensors
socket.emit('marine:subscribe', {
    deviceId: '4abebfd0-ab00-11f0-8b6a-ef2499d33d22'
});

// Subscribe to specific sensors only
socket.emit('marine:subscribe', {
    deviceId: '4abebfd0-ab00-11f0-8b6a-ef2499d33d22',
    keys: ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06']
});
```

---

#### 2. `marine:unsubscribe`
Unsubscribe khỏi device telemetry updates.

**Payload:**
```javascript
{
    deviceId: string       // Device UUID to unsubscribe from
}
```

**Example:**
```javascript
socket.emit('marine:unsubscribe', {
    deviceId: '4abebfd0-ab00-11f0-8b6a-ef2499d33d22'
});
```

---

#### 3. `marine:get_latest`
Request immediate telemetry data (không cần subscribe).

**Payload:**
```javascript
{
    deviceId: string,      // Required: Device UUID
    keys?: string[]        // Optional: Sensor keys filter
}
```

**Example:**
```javascript
socket.emit('marine:get_latest', {
    deviceId: '4abebfd0-ab00-11f0-8b6a-ef2499d33d22',
    keys: ['fs01', 'fs02']
});
```

---

### Server → Client Events

#### 1. `marine:connected`
Được emit khi client kết nối thành công.

**Payload:**
```javascript
{
    socketId: string,
    message: string,
    timestamp: number
}
```

---

#### 2. `marine:subscribed`
Confirmation khi subscribe thành công.

**Payload:**
```javascript
{
    deviceId: string,
    keys: string[] | 'all',
    timestamp: number
}
```

---

#### 3. `marine:unsubscribed`
Confirmation khi unsubscribe thành công.

**Payload:**
```javascript
{
    deviceId: string,
    timestamp: number
}
```

---

#### 4. `marine:telemetry`
Telemetry data update (được push tự động mỗi 2 giây khi có subscription).

**Payload:**
```javascript
{
    deviceId: string,
    data: {
        device_id: string,
        timestamp: number,
        data: [
            {
                key_name: string,           // Sensor key (fs01, fs02, etc.)
                value: number,              // Raw value in m³/h
                value_tons: number,         // Converted value in tons/h
                oil_profile_id: string | null,
                density_snapshot: number,   // Density in kg/m³
                machine_type: string        // GENERATOR | MAIN_ENGINE | BOILER
            }
        ],
        machines: {
            GENERATOR: {
                flow_in: {
                    key: string,
                    m3h: number,
                    th: number              // tons/hour
                },
                flow_return: {
                    key: string,
                    m3h: number,
                    th: number
                },
                consumption_rate: {
                    m3h: number,            // Flow difference
                    th: number
                },
                oil_profile: string | null,
                density: number
            },
            MAIN_ENGINE: { /* same structure */ },
            BOILER: { /* same structure */ }
        }
    },
    timestamp: number
}
```

---

#### 5. `marine:error`
Error notification từ server.

**Payload:**
```javascript
{
    message: string,
    timestamp: number
}
```

---

## 📝 Usage Examples

### Complete Example - JavaScript/TypeScript

```javascript
import io from 'socket.io-client';

// 1. Kết nối với authentication
const socket = io('http://localhost:1881', {
    auth: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
    },
    transports: ['websocket', 'polling']
});

// 2. Handle connection events
socket.on('connect', () => {
    console.log('✅ Connected to Marine IoT WebSocket');
    
    // Subscribe to device
    socket.emit('marine:subscribe', {
        deviceId: '4abebfd0-ab00-11f0-8b6a-ef2499d33d22',
        keys: ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06']
    });
});

socket.on('marine:connected', (data) => {
    console.log('Server says:', data.message);
});

socket.on('marine:subscribed', (data) => {
    console.log(`📡 Subscribed to ${data.deviceId}`);
});

// 3. Receive real-time telemetry updates
socket.on('marine:telemetry', (payload) => {
    const { deviceId, data, timestamp } = payload;
    
    console.log('📊 New telemetry data:', {
        deviceId,
        timestamp: new Date(timestamp),
        dataPoints: data.data.length,
        machines: Object.keys(data.machines)
    });
    
    // Process machine data
    Object.entries(data.machines).forEach(([machineType, machineData]) => {
        console.log(`⚙️ ${machineType}:`, {
            flowIn: `${machineData.flow_in.m3h} m³/h (${machineData.flow_in.th} t/h)`,
            flowReturn: `${machineData.flow_return.m3h} m³/h (${machineData.flow_return.th} t/h)`,
            consumption: `${machineData.consumption_rate.th} t/h`,
            density: `${machineData.density} kg/m³`
        });
    });
});

// 4. Handle errors
socket.on('marine:error', (error) => {
    console.error('❌ Error:', error.message);
});

socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error.message);
});

socket.on('disconnect', () => {
    console.log('⚠️ Disconnected from server');
});

// 5. Cleanup on app shutdown
process.on('SIGINT', () => {
    socket.emit('marine:unsubscribe', {
        deviceId: '4abebfd0-ab00-11f0-8b6a-ef2499d33d22'
    });
    socket.disconnect();
    process.exit(0);
});
```

---

### React Hook Example

```typescript
import { useEffect, useState } from 'react';
import io, { Socket } from 'socket.io-client';

interface MarineTelemetry {
    deviceId: string;
    timestamp: number;
    machines: {
        [key: string]: {
            flow_in: { key: string; m3h: number; th: number };
            flow_return: { key: string; m3h: number; th: number };
            consumption_rate: { m3h: number; th: number };
            density: number;
        };
    };
}

export function useMarineWebSocket(
    serverUrl: string,
    token: string,
    deviceId: string
) {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [connected, setConnected] = useState(false);
    const [telemetry, setTelemetry] = useState<MarineTelemetry | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!token || !deviceId) return;

        // Connect
        const newSocket = io(serverUrl, {
            auth: { token },
            transports: ['websocket', 'polling']
        });

        newSocket.on('connect', () => {
            setConnected(true);
            setError(null);
            
            // Subscribe
            newSocket.emit('marine:subscribe', { deviceId });
        });

        newSocket.on('marine:telemetry', (payload) => {
            setTelemetry({
                deviceId: payload.deviceId,
                timestamp: payload.timestamp,
                machines: payload.data.machines
            });
        });

        newSocket.on('marine:error', (err) => {
            setError(err.message);
        });

        newSocket.on('disconnect', () => {
            setConnected(false);
        });

        setSocket(newSocket);

        // Cleanup
        return () => {
            newSocket.emit('marine:unsubscribe', { deviceId });
            newSocket.disconnect();
        };
    }, [serverUrl, token, deviceId]);

    return { socket, connected, telemetry, error };
}

// Usage in component
function MarineDashboard() {
    const { connected, telemetry, error } = useMarineWebSocket(
        'http://localhost:1881',
        'your-jwt-token',
        '4abebfd0-ab00-11f0-8b6a-ef2499d33d22'
    );

    if (error) return <div>Error: {error}</div>;
    if (!connected) return <div>Connecting...</div>;
    if (!telemetry) return <div>Waiting for data...</div>;

    return (
        <div>
            <h2>Real-time Telemetry</h2>
            {Object.entries(telemetry.machines).map(([type, data]) => (
                <div key={type}>
                    <h3>{type}</h3>
                    <p>Consumption: {data.consumption_rate.th} t/h</p>
                    <p>Density: {data.density} kg/m³</p>
                </div>
            ))}
        </div>
    );
}
```

---

## 🧪 Testing

### 1. Sử dụng HTML test client
Open file: `examples/marine-websocket-client.html` trong browser

### 2. Sử dụng curl để lấy token
```bash
curl -X POST http://localhost:1881/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "usr": "admin",
    "pwd": "admin@123"
  }'
```

Copy token từ response và paste vào HTML test client.

### 3. Monitor connection trong Node-RED logs
```bash
docker logs -f nodered1 | grep MARINE-WS
```

---

## ⚙️ Configuration

### Update Interval
Hiện tại: **2 seconds** (có thể thay đổi trong source code)

File: `src/modules/viis-rest-api/services/marine-websocket.service.ts`
```typescript
this.updateInterval = setInterval(async () => {
    await this.broadcastTelemetryUpdates();
}, 2000); // Change this value
```

### CORS Settings
Hiện tại: Accept tất cả origins (`*`)

**Production:** Nên restrict to specific origins:
```typescript
this.io = new SocketIOServer(httpServer, {
    cors: {
        origin: ['https://your-dashboard.com', 'https://app.yourcompany.com'],
        methods: ['GET', 'POST'],
        credentials: true
    }
});
```

---

## 🔒 Security

### Authentication
- ✅ JWT token required cho mọi connections
- ✅ Token được verify trước khi accept connection
- ✅ User info được attach vào socket context

### Authorization
- ✅ Mỗi socket chỉ có thể subscribe vào devices mà user có quyền truy cập
- ⚠️ **TODO**: Implement device-level permission checking

### Best Practices
1. **Luôn dùng HTTPS/WSS trong production**
2. **Set token expiration time hợp lý**
3. **Implement rate limiting nếu cần**
4. **Monitor số lượng concurrent connections**

---

## 📊 Monitoring

### Get Statistics
```javascript
// Trong Node-RED flow hoặc custom node
const wsService = Container.get(MarineWebSocketService);
const stats = wsService.getStats();

console.log(stats);
// {
//     activeConnections: 5,
//     devicesMonitored: 2,
//     deviceSubscriptions: [
//         { deviceId: 'device-1', subscriberCount: 3 },
//         { deviceId: 'device-2', subscriberCount: 2 }
//     ]
// }
```

---

## 🐛 Troubleshooting

### Connection fails
- ✅ Check token validity
- ✅ Check server logs: `docker logs nodered1`
- ✅ Verify WebSocket port is accessible

### No telemetry updates
- ✅ Verify subscription was successful (`marine:subscribed` event)
- ✅ Check device has data in database
- ✅ Check Node-RED logs for errors

### High latency
- ✅ Check network connection
- ✅ Monitor server CPU/memory usage
- ✅ Consider increasing update interval if many connections

---

## 📚 Related Documentation
- [Marine Telemetry REST API](./MARINE_TELEMETRY_API.md)
- [Authentication API](./AUTH_API.md)
- [Socket.IO Client Docs](https://socket.io/docs/v4/client-api/)
