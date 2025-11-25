# AIS Gateway Test Tools

Bộ công cụ để test và debug AIS Gateway.

## Thông tin Gateway

- **IP**: 192.168.20.246
- **Port**: 8899
- **Protocol**: TCP/UDP
- **Data Format**: AIS NMEA sentences

## Available Tools

### 1. 🔍 `diagnose-ais.sh` - Diagnostic Tool (KHUYẾN NGHỊ CHẠY ĐẦU TIÊN)
```bash
./diagnose-ais.sh
```
Tự động kiểm tra connectivity, port status, và sample data.

### 2. 🚢 `test-ais-gateway.js` - TCP Test Script
```bash
node test-ais-gateway.js
```
Test kết nối TCP, nhận và parse NMEA data.

### 3. 📡 `test-ais-udp.js` - UDP Test Script
```bash
node test-ais-udp.js
```
Test nếu gateway đang gửi data qua UDP.

## Cách sử dụng

### Chạy script:

```bash
cd /home/fuel-iot/viis-local-docker/services/nodered/custom-nodes/viis-node-red
node test-ais-gateway.js
```

Hoặc:

```bash
./test-ais-gateway.js
```

### Dừng script:

Nhấn `Ctrl+C`

## Chức năng

Script sẽ:

1. ✅ Kết nối đến AIS Gateway qua TCP
2. 📡 Nhận và parse NMEA sentences
3. ✓ Validate checksum của mỗi message
4. 📊 Hiển thị thông tin chi tiết:
   - Raw NMEA sentence
   - Message type
   - Checksum validation
   - Parsed fields
   - AIS message details (nếu là AIVDM/AIVDO)
5. 🔄 Tự động kết nối lại nếu bị ngắt kết nối

## Output mẫu

```
🚢 AIS Gateway Test Script
================================================================================
Gateway: 192.168.20.246:8899
Press Ctrl+C to stop
================================================================================

🔌 Connecting to AIS Gateway at 192.168.20.246:8899...
✅ Connected to AIS Gateway successfully!
📡 Listening for NMEA data...

================================================================================
[2025-11-17T09:19:45.123Z] Message #1
================================================================================
Raw NMEA: !AIVDM,1,1,,A,13aEOK?P00PD2wVMdLDRgwq26L0,0*01
Checksum: 01 (✓ VALID)
Message Type: !AIVDM
AIS Message Detected:
  - Fragment Count: 1
  - Fragment Number: 1
  - Message ID:
  - Channel: A
  - Payload: 13aEOK?P00PD2wVMdLDRgwq26L0

All Fields:
  [0]: !AIVDM
  [1]: 1
  [2]: 1
  [3]:
  [4]: A
  [5]: 13aEOK?P00PD2wVMdLDRgwq26L0
  [6]: 0*01
```

## Troubleshooting

### Bước 1: Chạy Diagnostic Tool

```bash
./diagnose-ais.sh
```

Tool này sẽ tự động kiểm tra:
- ✅ Network connectivity
- ✅ TCP port status
- ✅ Sample data từ gateway
- ✅ Recommendations

### Kết nối được nhưng không nhận data

Script đã được cập nhật với các tính năng debug:

1. **Hiển thị raw bytes** - Xem có bytes nào được nhận không
2. **Tự động gửi commands** - Thử các commands phổ biến
3. **Timeout warning** - Cảnh báo sau 10 giây nếu không có data

Chạy lại script:
```bash
node test-ais-gateway.js
```

Nếu vẫn không có data, các nguyên nhân có thể:

**1. Gateway đang idle (không có tàu)**
- Đợi có tàu đi qua vùng phủ sóng
- Kiểm tra antenna và receiver

**2. Gateway dùng UDP thay vì TCP**
```bash
node test-ais-udp.js
```

**3. Gateway cần authentication hoặc protocol đặc biệt**
- Kiểm tra tài liệu của gateway model
- Có thể cần license key hoặc API token

**4. Data được multicast**
- Cần join multicast group
- Kiểm tra gateway config

### Không kết nối được

- Kiểm tra IP và port có đúng không
- Chạy diagnostic tool: `./diagnose-ais.sh`
- Kiểm tra firewall/port có mở không

### Checksum invalid

- Có thể do lỗi truyền dữ liệu
- Gateway có thể đang gửi format khác

## Notes

- Script tự động reconnect sau 5 giây nếu mất kết nối
- Hỗ trợ NMEA sentences với checksum (format: `....*XX`)
- Parse đặc biệt cho AIS messages (!AIVDM và !AIVDO)
