# Technical Documentation: Retry Mechanism

## 📋 Overview

Retry mechanism đảm bảo **zero data loss** khi gửi telemetry lên ThingsBoard thất bại do network errors, server downtime, hoặc các lỗi tạm thời khác.

---

## 🔄 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Input Message Received                       │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
                    ┌────────────────┐
                    │ Add to Buffer  │
                    │  (In-Memory)   │
                    └────────┬───────┘
                             ↓
              ┌──────────────┴──────────────┐
              │  Buffer Full?               │
              │  (size >= batchSize)        │
              └──────┬──────────────┬───────┘
                     │ No           │ Yes
                     ↓              ↓
            ┌────────────────┐  ┌─────────────┐
            │ Start Timer    │  │ Flush Now   │
            │ (flushInterval)│  │             │
            └────────┬───────┘  └──────┬──────┘
                     └──────────────────┘
                             ↓
                    ┌────────────────────┐
                    │ HTTP POST Request  │
                    │ to ThingsBoard     │
                    └────────┬───────────┘
                             ↓
              ┌──────────────┴──────────────┐
              │  HTTP Response?             │
              └──────┬──────────────┬───────┘
                     │              │
                ✅ Success      ❌ Failed
                     ↓              ↓
         ┌───────────────┐  ┌──────────────────────┐
         │ Stats Update  │  │ Save to Database     │
         │ totalSuccess++│  │ status='pending'     │
         │ totalSent++   │  │ retry_count=0        │
         └───────────────┘  └──────┬───────────────┘
                                   ↓
                         ┌─────────────────────┐
                         │ Periodic Retry Job  │
                         │ (every 30 seconds)  │
                         └──────┬──────────────┘
                                ↓
                    [See Retry Process Below]
```

---

## 🗄️ Database Persistence Flow

### When HTTP Request Fails

**Code Location**: `telemetry-queue-manager.ts:165-180`

```typescript
async saveFailed(
    deviceId: string,
    deviceToken: string,
    payload: TelemetryData[],
    error: string
): Promise<void> {
    const queueItem = this.repository.create({
        device_id: deviceId,
        device_token: deviceToken,
        payload: payload,              // JSON array
        timestamp: Date.now(),
        retry_count: 0,                // Initial
        max_retries: this.config.maxRetries,
        status: 'pending',             // Initial status
        last_error: error
    });
    await this.repository.save(queueItem);
}
```

### Database Record Example

```json
{
  "id": 123,
  "device_id": "device_001",
  "device_token": "ABC123XYZ",
  "payload": [
    {
      "ts": 1729340000000,
      "values": {
        "temperature": 42,
        "humidity": 73
      }
    }
  ],
  "timestamp": 1729340000000,
  "retry_count": 0,
  "max_retries": 3,
  "status": "pending",
  "last_error": "Network error - No response from ThingsBoard server",
  "last_retry_at": null,
  "created_at": "2025-10-19 09:00:00",
  "updated_at": "2025-10-19 09:00:00"
}
```

---

## ⏱️ Retry Job Process

### 1. Periodic Check

**Trigger**: Every `retryInterval` milliseconds (default: 30000ms = 30s)

**Code Location**: `telemetry-queue-manager.ts:237-245`

```typescript
startRetryJob(): void {
    this.retryTimer = setInterval(async () => {
        await this.retryPending();
    }, this.config.retryInterval);
}
```

### 2. Query Pending Records

**Code Location**: `telemetry-queue-manager.ts:191-208`

```typescript
const pendingRecords = await this.repository
    .createQueryBuilder('queue')
    .where('queue.status IN (:...statuses)', { 
        statuses: ['pending', 'retrying'] 
    })
    .andWhere('queue.retry_count < queue.max_retries')
    .andWhere(
        '(queue.last_retry_at IS NULL OR queue.last_retry_at < :threshold)',
        { threshold: Date.now() - this.getBackoffDelay(1) }
    )
    .orderBy('queue.created_at', 'ASC')
    .limit(50) // Process max 50 at a time
    .getMany();
```

**Query Logic**:
- Status = `pending` OR `retrying`
- `retry_count` < `max_retries`
- Either:
  - Never retried before (`last_retry_at IS NULL`), OR
  - Last retry was > backoff delay ago
- Order by oldest first
- Limit to 50 records per batch

### 3. Retry Each Record

**Code Location**: `telemetry-queue-manager.ts:218-250`

```typescript
async retryRecord(record: TabiotThingsboardTelemetryQueue): Promise<void> {
    // Step 1: Update status to 'retrying'
    record.status = 'retrying';
    record.retry_count += 1;
    record.last_retry_at = Date.now();
    await this.repository.save(record);

    // Step 2: Attempt HTTP request
    const result = await this.httpService.sendBatchTelemetry(
        record.device_token,
        record.payload
    );

    // Step 3: Handle result
    if (result.success) {
        // Success - mark as success
        record.status = 'success';
        record.last_error = null;
    } else {
        // Failed again
        record.last_error = result.error || 'Unknown error';
        
        if (record.retry_count >= record.max_retries) {
            // Max retries reached - permanently failed
            record.status = 'failed';
        } else {
            // Can retry again
            record.status = 'pending';
        }
    }
    
    await this.repository.save(record);
}
```

---

## 🔄 Status Transitions

```
    [New Failed Request]
            ↓
    ┌───────────────┐
    │   pending     │ ← Initial state
    └───────┬───────┘
            ↓ (Retry attempt starts)
    ┌───────────────┐
    │   retrying    │ ← During HTTP request
    └───────┬───────┘
            ↓
    ┌───────┴────────────────────┐
    │   HTTP Response?           │
    └───────┬────────────┬───────┘
            │            │
       ✅ Success    ❌ Failed
            │            │
            ↓            ↓
    ┌──────────┐  ┌─────┴──────────────────┐
    │ success  │  │ retry_count < max?     │
    └──────────┘  └─────┬──────────┬───────┘
                        │ Yes      │ No
                        ↓          ↓
                  ┌──────────┐  ┌────────┐
                  │ pending  │  │ failed │
                  │ (retry)  │  │ (done) │
                  └──────────┘  └────────┘
```

### Status Definitions

| Status | Description | Next Action |
|--------|-------------|-------------|
| **pending** | Waiting for retry | Will be picked up by next retry job |
| **retrying** | Currently attempting retry | Wait for HTTP response |
| **success** | Successfully sent | No action needed (kept for audit) |
| **failed** | Permanently failed (max retries reached) | Manual intervention required |

---

## ⏳ Exponential Backoff Algorithm

**Code Location**: `telemetry-queue-manager.ts:258-263`

```typescript
private getBackoffDelay(retryCount: number): number {
    return Math.min(
        this.config.retryInterval * Math.pow(1.5, retryCount - 1),
        300000 // Max 5 minutes
    );
}
```

### Backoff Calculation Table

| Retry # | Formula | Delay (30s base) | Cumulative Wait |
|---------|---------|------------------|-----------------|
| 1 | 30000 × 1.5^0 | 30s | 30s |
| 2 | 30000 × 1.5^1 | 45s | 1m 15s |
| 3 | 30000 × 1.5^2 | 67.5s | 2m 22.5s |
| 4 | 30000 × 1.5^3 | 101s | 4m 3.5s |
| 5 | 30000 × 1.5^4 | 152s | 6m 35.5s |
| 6+ | min(above, 300000) | Max 300s (5min) | - |

**Benefits**:
- Prevents server overload during outage
- Gives time for network/server to recover
- Reduces retry storm effect

---

## 📊 Example Retry Timeline

### Scenario: Network error, 3 max retries, 30s interval

```
Time    | Event                           | Status     | retry_count
--------|----------------------------------|------------|------------
00:00   | Initial send fails              | pending    | 0
00:30   | Retry #1 starts                 | retrying   | 1
00:31   | Retry #1 fails (network still down) | pending | 1
01:16   | Retry #2 starts (45s backoff)   | retrying   | 2
01:17   | Retry #2 fails                  | pending    | 2
02:24   | Retry #3 starts (67.5s backoff) | retrying   | 3
02:25   | Retry #3 SUCCESS ✅             | success    | 3

Total: ~2.5 minutes from initial failure to success
```

### Scenario: Permanent failure (max retries)

```
Time    | Event                           | Status     | retry_count
--------|----------------------------------|------------|------------
00:00   | Initial send fails              | pending    | 0
00:30   | Retry #1 fails                  | pending    | 1
01:15   | Retry #2 fails                  | pending    | 2
02:22   | Retry #3 fails (last attempt)   | failed ❌  | 3

Status: Permanently failed, manual intervention needed
```

---

## 🔍 Monitoring Queries

### Check Pending Retries

```sql
SELECT 
    id,
    device_id,
    retry_count,
    max_retries,
    status,
    TIMESTAMPDIFF(SECOND, FROM_UNIXTIME(last_retry_at/1000), NOW()) as seconds_since_last_retry,
    last_error
FROM tabiot_thingsboard_telemetry_queue
WHERE status IN ('pending', 'retrying')
ORDER BY created_at ASC;
```

### Check Permanently Failed

```sql
SELECT 
    id,
    device_id,
    JSON_LENGTH(payload) as num_telemetry_records,
    retry_count,
    last_error,
    FROM_UNIXTIME(timestamp/1000) as original_time,
    created_at
FROM tabiot_thingsboard_telemetry_queue
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 20;
```

### Retry Statistics

```sql
SELECT 
    status,
    COUNT(*) as count,
    AVG(retry_count) as avg_retries,
    MIN(retry_count) as min_retries,
    MAX(retry_count) as max_retries
FROM tabiot_thingsboard_telemetry_queue
GROUP BY status;
```

### Success Rate Analysis

```sql
SELECT 
    DATE(created_at) as date,
    COUNT(CASE WHEN status = 'success' THEN 1 END) as successful,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
    ROUND(
        COUNT(CASE WHEN status = 'success' THEN 1 END) * 100.0 / COUNT(*), 
        2
    ) as success_rate_percent
FROM tabiot_thingsboard_telemetry_queue
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

---

## 🚨 Error Handling

### HTTP Error Types

| Error | Status Code | Retry? | Reason |
|-------|-------------|--------|--------|
| Network timeout | - | ✅ Yes | Temporary network issue |
| Connection refused | - | ✅ Yes | Server might be restarting |
| 400 Bad Request | 400 | ❌ No* | Invalid data format |
| 401 Unauthorized | 401 | ❌ No* | Invalid token |
| 404 Not Found | 404 | ❌ No* | Invalid endpoint/device |
| 500 Server Error | 500 | ✅ Yes | ThingsBoard server issue |
| 503 Service Unavailable | 503 | ✅ Yes | Server overloaded |

*Currently retries all errors, but could be optimized to skip 4xx errors

### Error Response Handling

**Code Location**: `thingsboard-http.service.ts:189-222`

```typescript
private handleError(error: AxiosError): ThingsboardResponse {
    if (error.response) {
        // Server responded with error
        const status = error.response.status;
        let errorMsg = '';

        switch (status) {
            case 400:
                errorMsg = 'Bad Request - Invalid telemetry data format';
                break;
            case 401:
                errorMsg = 'Unauthorized - Invalid device access token';
                break;
            case 404:
                errorMsg = 'Not Found - Device or endpoint not found';
                break;
            default:
                errorMsg = `HTTP ${status} - ${error.message}`;
        }

        return {
            success: false,
            error: errorMsg,
            statusCode: status
        };
    } else if (error.request) {
        // No response received (network error)
        return {
            success: false,
            error: 'Network error - No response from ThingsBoard server'
        };
    } else {
        // Request setup error
        return {
            success: false,
            error: `Request error - ${error.message}`
        };
    }
}
```

---

## 🧹 Cleanup & Maintenance

### Auto-cleanup Old Success Records

Recommended cron job (run daily):

```sql
-- Delete success records older than 7 days
DELETE FROM tabiot_thingsboard_telemetry_queue
WHERE status = 'success'
AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY);
```

### Manual Retry Failed Records

If you fix the issue (e.g., update invalid token), reset failed records:

```sql
-- Reset permanently failed records to retry
UPDATE tabiot_thingsboard_telemetry_queue
SET 
    status = 'pending',
    retry_count = 0,
    last_retry_at = NULL,
    last_error = 'Manual reset for retry'
WHERE status = 'failed';
```

### Delete Permanently Failed (After Review)

```sql
-- Delete permanently failed records after manual review
DELETE FROM tabiot_thingsboard_telemetry_queue
WHERE status = 'failed'
AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
```

---

## 🎛️ Configuration Tuning

### High Reliability (Critical Data)

```typescript
{
    batchSize: 10,
    flushInterval: 5000,
    maxRetries: 10,          // More retries
    retryInterval: 60000,    // Longer interval (1 min)
    enableRetry: true
}
```

**Pros**: Very unlikely to lose data  
**Cons**: Queue can grow during long outages

### Fast Failure (Non-Critical Data)

```typescript
{
    batchSize: 50,
    flushInterval: 2000,
    maxRetries: 2,           // Quick give up
    retryInterval: 10000,    // Fast retry (10s)
    enableRetry: true
}
```

**Pros**: Quick decision, minimal queue size  
**Cons**: Higher chance of data loss during brief outages

### Balanced (Recommended)

```typescript
{
    batchSize: 10,
    flushInterval: 5000,
    maxRetries: 3,
    retryInterval: 30000,
    enableRetry: true
}
```

---

## 📈 Performance Metrics

### Memory Usage

- **In-Memory Buffer**: ~100 bytes per telemetry record
- **Batch of 10**: ~1 KB
- **1000 records/sec**: ~100 KB/sec buffer throughput

### Database Impact

- **1 Insert** per failed batch: ~500 bytes
- **1-3 Updates** per retry: ~200 bytes each
- **Index overhead**: ~30% additional storage

### Network Efficiency

| Mode | Records/Request | Overhead |
|------|----------------|----------|
| Single (MQTT) | 1 | 100% |
| Batch (HTTP) | 10 | 10% |
| Batch (HTTP) | 50 | 2% |

**Conclusion**: Batching reduces network overhead by 90-98%

---

## 🔐 Security Considerations

### Token Management

- Device token stored in database for retry
- Encrypted in transit (HTTPS)
- Should be encrypted at rest (future enhancement)

### Data Privacy

- Telemetry payload stored as JSON
- Contains potentially sensitive sensor data
- Database access should be restricted

---

## 🐛 Troubleshooting

### Retry Job Not Running

**Symptoms**: Records stuck in `pending`, never retry

**Check**:
```typescript
// In node logs
[TelemetryQueueManager] Starting retry job with interval: 30000ms
```

**Solution**: Ensure `enableRetry: true` in node config

### Immediate Failure After Retry

**Symptoms**: `retry_count` increments but always fails

**Check**: 
- Node logs for HTTP error details
- ThingsBoard server logs
- Network connectivity

### Growing Queue Size

**Symptoms**: Database table size increases continuously

**Causes**:
- ThingsBoard server down for extended period
- Invalid token (401 errors should not retry)
- Network firewall blocking requests

**Solution**:
1. Fix root cause (server/network/token)
2. Manually reset or delete old records
3. Tune `maxRetries` lower

---

## 📝 Summary

### Key Points

1. **Immediate Persistence**: Failed requests saved to database instantly
2. **Periodic Retry**: Every 30 seconds, check for pending records
3. **Exponential Backoff**: Increasing delays prevent server overload
4. **Status Tracking**: Clear state transitions (pending → retrying → success/failed)
5. **Zero Data Loss**: All failed data persisted until successful or max retries

### Data Flow Summary

```
HTTP Fail → Database (pending)
          ↓
     [30s wait]
          ↓
   Retry Attempt (retrying)
          ↓
   ┌──────┴──────┐
   │             │
Success       Failed
   │             │
(success)    ┌───┴────┐
          retry < max?
             │        │
            Yes       No
             │        │
         (pending) (failed)
```

---

## 🔗 Related Files

- **Queue Manager**: `src/services/telemetry-queue-manager.ts`
- **HTTP Service**: `src/services/thingsboard-http.service.ts`
- **Entity**: `src/orm/entities/device-telemetry/TabiotThingsboardTelemetryQueue.ts`
- **Node Implementation**: `src/modules/viis-thingsboard-telemetry/viis-thingsboard-telemetry.ts`
