# Fan Control Logic Improvements

## Vấn đề đã được giải quyết

### 1. **Vấn đề bật-tắt quạt không cần thiết**
- **Vấn đề cũ**: Logic `createFanGroupActions` tắt tất cả quạt trước, rồi mới bật nhóm mục tiêu
- **Kết quả**: Gây ra hiện tượng bật-tắt quạt 1 và quạt 2 như trong log bạn cung cấp
- **Giải pháp**: Tạo hàm `createOptimizedFanGroupActions` chỉ thay đổi trạng thái khi cần thiết

### 2. **Logic ngưỡng K4 không chính xác**
- **Vấn đề cũ**: Ở ngưỡng K4 (temp ≥ 33°C), quạt không được bật đúng cách
- **Giải pháp**: Cải thiện logic để đảm bảo tất cả 6 quạt được bật khi đạt ngưỡng K4

## Thay đổi chi tiết

### 1. **Cập nhật `utils/groupUtils.ts`**

#### Thêm hàm `createOptimizedFanGroupActions`:
```typescript
export function createOptimizedFanGroupActions(
    targetGroup: string[],
    turnOn: boolean,
    reason: string,
    coilMapping: Record<string, number>,
    currentDeviceStatus: Record<string, boolean>
): Array<{ deviceKey: string, value: boolean, address: number, fc: number, reason: string }>
```

**Ưu điểm**:
- Chỉ tạo actions cho quạt cần thay đổi trạng thái
- Tránh bật-tắt không cần thiết
- Hiệu quả hơn về mặt Modbus communication

#### Cải thiện hàm `createFanGroupActions`:
- Tối ưu hóa logic để tránh tắt tất cả quạt trước khi bật
- Giữ tương thích ngược với code hiện tại

### 2. **Cập nhật `services/fanControlService.ts`**

#### Cải thiện `processThresholdMode`:
- Thêm parameter `deviceStatus` để sử dụng optimized function
- Logic xử lý ngưỡng K3/K4: Sử dụng tất cả 6 quạt
- Logic xử lý ngưỡng K1/K2: Sử dụng rotation logic

#### Thêm hàm `getRotationTargetGroup`:
- Xử lý rotation logic cho ngưỡng K1 và K2
- Tách biệt rotation state cho từng group size
- Interval mặc định 15 phút cho threshold rotation

### 3. **Logic ngưỡng nhiệt độ/độ ẩm được cải thiện**

#### Ngưỡng K4 (Ưu tiên cao nhất):
- **Điều kiện**: `temp ≥ K4_threshold` HOẶC `humidity < 75%`
- **Hành động**: Bật tường nước + Bật tất cả 6 quạt
- **Ưu tiên**: K4 override có priority cao nhất

#### Ngưỡng K3:
- **Điều kiện**: `temp ≥ K3_threshold` HOẶC `humidity < 55%`
- **Hành động**: Bật tất cả 6 quạt

#### Ngưỡng K2:
- **Điều kiện**: `temp ≥ K2_threshold` HOẶC `humidity < 65%`
- **Hành động**: Bật 4 quạt với rotation logic

#### Ngưỡng K1:
- **Điều kiện**: `temp ≥ K1_threshold`
- **Hành động**: Bật 2 quạt với rotation logic

## Kết quả test

### Test Case 1: K4 Scenario
- **Input**: temp=33.2°C (≥33°C), humidity=94%
- **Expected**: Tất cả 6 quạt bật
- **Result**: ✅ PASS - Tất cả 6 quạt được bật đúng cách

### Test Case 2: No Unnecessary Actions
- **Input**: Tất cả quạt đã bật, yêu cầu bật tất cả quạt
- **Expected**: Không có action nào
- **Result**: ✅ PASS - Không có action không cần thiết

### Test Case 3: K2 Scenario
- **Input**: temp=30°C, humidity=60% (<65%)
- **Expected**: 4 quạt bật
- **Result**: ✅ PASS - 4 quạt được bật đúng cách

### Test Case 4: Turn Off All
- **Input**: Dưới ngưỡng K1
- **Expected**: Chỉ tắt quạt đang bật
- **Result**: ✅ PASS - Chỉ quạt đang bật được tắt

## Tuân thủ Clean Code Principles

### 1. **Single Responsibility Principle**
- Mỗi hàm có một nhiệm vụ rõ ràng
- `createOptimizedFanGroupActions`: Tối ưu hóa actions
- `getRotationTargetGroup`: Xử lý rotation logic

### 2. **DRY (Don't Repeat Yourself)**
- Tái sử dụng logic chung
- Tách biệt concerns rõ ràng

### 3. **KISS (Keep It Simple, Stupid)**
- Logic đơn giản, dễ hiểu
- Tránh over-engineering

### 4. **Meaningful Naming**
- Tên hàm và biến có ý nghĩa rõ ràng
- Comments giải thích logic phức tạp

## Tương thích ngược

- Tất cả interface hiện tại được giữ nguyên
- Code cũ vẫn hoạt động bình thường
- Chỉ thêm tính năng tối ưu hóa mới

## Khuyến nghị tiếp theo

1. **Viết unit tests** cho tất cả scenarios
2. **Monitor** hiệu suất trong production
3. **Logging** chi tiết để debug nếu cần
4. **Documentation** cho team members khác
