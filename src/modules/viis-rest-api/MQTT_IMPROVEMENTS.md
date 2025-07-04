# MQTT Circuit Breaker Implementation

Đây là tài liệu mô tả các cải tiến đã được triển khai cho hệ thống MQTT trong ThingsBoard RPC Service để giải quyết các vấn đề về khởi tạo MQTT client và thiếu Circuit Breaker pattern.

## Vấn đề đã được giải quyết

### 1. Khởi tạo MQTT Client có thể thất bại nhưng service vẫn tiếp tục

**Vấn đề ban đầu:**
- Comment trong code nói "Don't throw error - let service continue without MQTT"
- Nhưng code lại `throw error`, gây crash service khi MQTT broker không khả dụng
- Mâu thuẫn giữa ý định thiết kế và implementation thực tế

**Giải pháp đã triển khai:**
- Sửa hàm `initializeMqttClient()` để không throw error
- Thêm flag `mqttAvailable` để theo dõi trạng thái MQTT
- Service có thể hoạt động ở chế độ "degraded mode" khi MQTT không khả dụng
- Logging rõ ràng về trạng thái MQTT và chế độ hoạt động

### 2. Thiếu Circuit Breaker cho các lỗi MQTT

**Vấn đề ban đầu:**
- Hàm `publishWithRetry()` không học từ các lỗi trước đó
- Mỗi lần publish đều thử lại từ đầu, gây lãng phí tài nguyên
- Không có cơ chế fast-fail khi MQTT broker gặp sự cố
- Tăng độ trễ và tiêu tốn CPU không cần thiết

**Giải pháp đã triển khai:**
- Tạo `MqttCircuitBreaker` class với đầy đủ Circuit Breaker pattern
- Tích hợp Circuit Breaker vào tất cả MQTT operations
- Cung cấp fast-fail behavior khi MQTT broker không khả dụng
- Tự động recovery testing khi service có thể đã phục hồi

## Kiến trúc Circuit Breaker

### States (Trạng thái)

1. **CLOSED** - Hoạt động bình thường, requests được xử lý
2. **OPEN** - Circuit mở, requests bị từ chối ngay lập tức
3. **HALF_OPEN** - Đang test xem service đã phục hồi chưa

### Configuration (Cấu hình)

```typescript
{
    failureThreshold: 5,        // Số lỗi trước khi mở circuit
    timeout: 60000,             // Thời gian chờ trước khi thử recovery (1 phút)
    monitoringPeriod: 300000,   // Cửa sổ thời gian theo dõi (5 phút)
    halfOpenMaxCalls: 3         // Số calls tối đa trong HALF_OPEN state
}
```

### Metrics (Thống kê)

Circuit Breaker cung cấp các metrics chi tiết:
- Trạng thái hiện tại
- Số lượng thành công/thất bại
- Thời gian lỗi/thành công cuối cùng
- Tổng số calls và số lần circuit mở

## Các file đã được cập nhật

### 1. `/utils/circuit-breaker.ts` (Mới)
- Implementation đầy đủ của Circuit Breaker pattern
- Support cho MQTT operations
- Comprehensive logging và metrics
- Error handling và recovery logic

### 2. `/services/thingsboard.service.ts` (Cập nhật)
- Tích hợp `MqttCircuitBreaker`
- Thêm flag `mqttAvailable`
- Sửa `initializeMqttClient()` để không throw error
- Cập nhật `publishToMqtt()` với Circuit Breaker protection
- Enhanced health check với Circuit Breaker status

## Lợi ích của việc cải tiến

### 1. Reliability (Độ tin cậy)
- Service không crash khi MQTT broker không khả dụng
- Graceful degradation khi MQTT gặp sự cố
- Automatic recovery khi MQTT broker phục hồi

### 2. Performance (Hiệu suất)
- Fast-fail behavior giảm độ trễ
- Giảm CPU usage khi MQTT broker down
- Intelligent retry logic

### 3. Observability (Khả năng quan sát)
- Chi tiết logging về trạng thái MQTT
- Circuit Breaker metrics trong health check
- Clear indication về degraded mode

### 4. Maintainability (Khả năng bảo trì)
- Separation of concerns với Circuit Breaker class
- Configurable thresholds và timeouts
- Comprehensive error handling

## Cách sử dụng

### Health Check

Endpoint `/health` giờ đây bao gồm thông tin về:
```json
{
  "service": "ThingsBoard RPC",
  "status": "healthy",
  "details": {
    "mqtt": {
      "available": true,
      "clientConnected": true,
      "circuitBreaker": {
        "state": "CLOSED",
        "healthy": true,
        "metrics": {
          "totalCalls": 150,
          "totalSuccesses": 148,
          "totalFailures": 2
        }
      }
    }
  }
}
```

### Monitoring

Các log messages quan trọng để monitor:
- `Circuit breaker transitioned to OPEN` - MQTT broker có vấn đề
- `Circuit breaker transitioned to HALF_OPEN` - Đang test recovery
- `Circuit breaker transitioned to CLOSED` - MQTT đã phục hồi
- `Service will continue in degraded mode` - MQTT không khả dụng

### Configuration

Có thể điều chỉnh Circuit Breaker config trong constructor:
```typescript
this.mqttCircuitBreaker = createMqttCircuitBreaker(this.node, {
    failureThreshold: 10,    // Tăng threshold
    timeout: 120000,         // Tăng timeout lên 2 phút
    monitoringPeriod: 600000 // Tăng monitoring period lên 10 phút
});
```

## Testing

### Test Scenarios

1. **MQTT Broker Down**
   - Service khởi động bình thường
   - MQTT operations fail gracefully
   - Circuit breaker mở sau 5 lỗi
   - Subsequent calls fail fast

2. **MQTT Broker Recovery**
   - Circuit breaker tự động test recovery sau timeout
   - Transition qua HALF_OPEN state
   - Successful calls đưa circuit về CLOSED

3. **Intermittent Failures**
   - Circuit breaker handle sporadic failures
   - Monitoring window reset định kỳ
   - Metrics tracking chính xác

## Future Enhancements

1. **Configurable Circuit Breaker**
   - Load config từ environment variables
   - Runtime configuration updates

2. **Advanced Metrics**
   - Prometheus metrics export
   - Grafana dashboard integration

3. **Multiple Circuit Breakers**
   - Separate circuits cho different MQTT topics
   - Per-device circuit breakers

4. **Adaptive Thresholds**
   - Dynamic adjustment based on traffic patterns
   - Machine learning-based failure prediction