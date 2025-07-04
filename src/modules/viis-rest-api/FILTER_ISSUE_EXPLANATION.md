# Vấn đề với Filter API /api/v2/scheduleLog

## Vấn đề đã được phát hiện

### 1. Kiểu dữ liệu không khớp
Trong entity `TabiotScheduleLog`, các cột `start_time` và `end_time` được định nghĩa với kiểu `time` (chỉ lưu giờ:phút:giây), không phải `datetime`:

```typescript
@Column({ type: 'time', nullable: true })
start_time?: string;

@Column({ type: 'time', nullable: true })
end_time?: string;
```

Nhưng trong filter request, user đang cố gắng filter với datetime đầy đủ:
```
["iot_schedule_log","start_time",">=","2020-06-27 00:00:00"]
["iot_schedule_log","end_time","<=","2025-07-04 14:59:03"]
```

### 2. Logic filter sai
Trong code cũ, có những dòng filter sai:
```typescript
// SAI - cố gắng áp dụng DATE() lên cột time
if (queryParams.start_date) {
    qb.andWhere('DATE(iot_schedule_log.start_time) >= :start_date', { start_date: queryParams.start_date });
}
```

## Giải pháp đã áp dụng

### 1. Sửa logic filter theo ngày
Thay vì filter theo `start_time`/`end_time` (chỉ là time), filter theo `creation` (datetime):

```typescript
// ĐÚNG - filter theo creation date
if (queryParams.start_date) {
    qb.andWhere('DATE(iot_schedule_log.creation) >= :start_date', { start_date: queryParams.start_date });
}

if (queryParams.end_date) {
    qb.andWhere('DATE(iot_schedule_log.creation) <= :end_date', { end_date: queryParams.end_date });
}
```

### 2. Thêm filter theo time riêng biệt
```typescript
// Filter theo time nếu cần
if (queryParams.start_time) {
    qb.andWhere('iot_schedule_log.start_time >= :start_time', { start_time: queryParams.start_time });
}

if (queryParams.end_time) {
    qb.andWhere('iot_schedule_log.end_time <= :end_time', { end_time: queryParams.end_time });
}
```

## Cách sử dụng API đúng

### 1. Filter theo ngày tạo log
```
{{serverURL}}/api/v2/scheduleLog?start_date=2020-06-27&end_date=2025-07-04&page=1&size=10
```

### 2. Filter theo time cụ thể
```
{{serverURL}}/api/v2/scheduleLog?start_time=08:00:00&end_time=18:00:00&page=1&size=10
```

### 3. Filter với filters parameter (sử dụng creation date)
```
{{serverURL}}/api/v2/scheduleLog?filters=[["iot_schedule_log","creation",">=","2020-06-27 00:00:00"],["iot_schedule_log","creation","<=","2025-07-04 14:59:03"]]&page=1&size=10
```

## Lưu ý quan trọng

1. **start_time và end_time chỉ lưu time (HH:mm:ss)**, không phải datetime đầy đủ
2. **creation và modified** là các cột datetime từ `CustomBaseEntity` có thể dùng để filter theo ngày tháng
3. **Nếu muốn filter theo datetime đầy đủ**, nên sử dụng cột `creation` thay vì `start_time`/`end_time`

## Kiểm tra kết quả

Sau khi áp dụng fix này, API sẽ hoạt động đúng với:
- Filter theo ngày tạo log
- Filter theo time range
- Kết hợp cả hai loại filter