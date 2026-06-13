# viis-modbus-flex — Hướng dẫn truyền Payload

## 1. READ — Đọc dữ liệu (FC 1, 2, 3, 4)

```js
msg.payload = {
    fc: 3,           // Function code (bắt buộc)
    unitid: 1,       // Unit ID (bắt buộc)
    address: 0,      // Địa chỉ bắt đầu (bắt buộc)
    quantity: 10     // Số lượng register/coil đọc (bắt buộc)
}
return msg;
```

| FC | Ý nghĩa | Giới hạn quantity |
|----|----------|-------------------|
| 1 | Read Coils | tối đa 2000 |
| 2 | Read Discrete Inputs | tối đa 2000 |
| 3 | Read Holding Registers | tối đa 125 |
| 4 | Read Input Registers | tối đa 125 |

**Output** khi thành công: mảng giá trị trực tiếp (ví dụ `[100, 200, 300]`)

---

## 2. WRITE — Ghi dữ liệu (FC 5, 6, 15, 16)

### FC 5 — Ghi 1 Coil (boolean)

```js
msg.payload = {
    fc: 5,
    unitid: 1,
    address: 100,
    value: true       // boolean: true hoặc false
}
```

### FC 6 — Ghi 1 Register (number)

```js
msg.payload = {
    fc: 6,
    unitid: 1,
    address: 100,
    value: 1234       // number: 0–65535
}
```

### FC 15 — Ghi nhiều Coils (boolean[])

```js
msg.payload = {
    fc: 15,
    unitid: 1,
    address: 100,
    value: [true, false, true, true]   // boolean[], tối đa 1968 phần tử
}
```

### FC 16 — Ghi nhiều Registers (number[])

```js
msg.payload = {
    fc: 16,
    unitid: 1,
    address: 100,
    value: [100, 200, 300]   // number[], mỗi phần tử 0–65535, tối đa 123 phần tử
}
```

---

## 3. Multi-board — Chỉ định board cụ thể

Thêm `boardId` vào payload để override board config trên node:

```js
msg.payload = {
    fc: 3,
    unitid: 1,
    address: 0,
    quantity: 10,
    boardId: "board2"    // optional: override board trên node config
}
```

---

## 4. Output format

### Thành công (READ)

Trả về mảng giá trị trực tiếp:

```
[100, 200, 300, ...]
```

### Thành công (WRITE)

```js
{
    success: true,
    address: 100,
    functionCode: 6,
    value: 1234,
    timestamp: 1718123456789
}
```

### Lỗi

```js
{
    error: "Modbus client not connected",
    timestamp: 1718123456789
}
```

---

## 5. Lưu ý kỹ thuật

- **Phân biệt READ/WRITE**: FC `[5, 6, 15, 16]` → write, còn lại → read (`modbusGetterService.ts:134`)
- **FC 2** (Discrete Inputs): hiện fallback sang `readCoils` do `ModbusClientCore` chưa có method riêng
- **FC 15/16** (write multiple): hiện ghi từng cái một trong loop, không dùng native `writeMultiple`
- **Retry logic**: 3 lần với exponential backoff + jitter cho lỗi serial port
- **Địa chỉ hợp lệ**: `0–65535`
- **Giá trị register hợp lệ**: `0–65535`

---

## 6. Source code tham khảo

| File | Nội dung |
|------|----------|
| `viis-modbus-flex.ts` | Node chính, xử lý input/output |
| `services/modbusGetterService.ts` | Service xử lý read/write, validation, retry |
| `interfaces/types.ts` | TypeScript interfaces cho payload |
| `constants.ts` | Function codes, validation limits, error messages |
| `templates/build-modbus-write-msg.js` | Template build write message từ schedule executor |
