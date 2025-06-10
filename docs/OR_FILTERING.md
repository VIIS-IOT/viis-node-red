# OR Filtering Support for IoT Notification API

## Overview

The IoT Notification API now supports OR filtering functionality through the `or_filters` parameter. This allows you to retrieve notifications that match any of the specified filter conditions, providing more flexible querying capabilities.

## Usage

### Basic Syntax

The `or_filters` parameter accepts a JSON string containing an array of filter tuples. Each filter tuple follows the format:

```
[table_name, field_name, operator, value]
```

or

```
[field_name, operator, value]  // Uses default table alias
```

### Example Request

```bash
GET /api/v2/notification?or_filters=[["iot_notification","customer_id","=","c08d3dd4-9786-4e94-b3bb-10d01b499ce9"],["iot_notification","customer_user","=","a08abc5c-039b-44a3-afa3-c1fc6ab28675"]]&order_by=created_at desc
```

This request will return notifications where:
- `customer_id` equals "c08d3dd4-9786-4e94-b3bb-10d01b499ce9" **OR**
- `customer_user` equals "a08abc5c-039b-44a3-afa3-c1fc6ab28675"

### Supported Operators

The OR filtering supports the same operators as regular filtering:

- `=` or `eq` - Equality
- `like` - Pattern matching (adds % wildcards automatically)
- `in` - Value in array
- `>` or `gt` - Greater than
- `<` or `lt` - Less than
- `>=` or `gte` - Greater than or equal
- `<=` or `lte` - Less than or equal
- `between` - Between two values (requires array with 2 elements)
- `isnull` - Field is null
- `notnull` - Field is not null

### Examples

#### Example 1: Customer-based OR filtering
```json
{
  "or_filters": "[
    [\"iot_notification\", \"customer_id\", \"=\", \"customer-123\"],
    [\"iot_notification\", \"customer_user\", \"=\", \"user-456\"]
  ]"
}
```

#### Example 2: Type and severity OR filtering
```json
{
  "or_filters": "[
    [\"iot_notification\", \"type\", \"=\", \"alert\"],
    [\"iot_notification\", \"severity\", \"=\", \"critical\"]
  ]"
}
```

#### Example 3: Mixed operators
```json
{
  "or_filters": "[
    [\"iot_notification\", \"message\", \"like\", \"error\"],
    [\"iot_notification\", \"created_at\", \">\", \"2023-01-01\"],
    [\"iot_notification\", \"is_read\", \"=\", 0]
  ]"
}
```

## Combining with Regular Filters

You can use both `filters` (AND logic) and `or_filters` (OR logic) in the same request:

```bash
GET /api/v2/notification?filters=[["iot_notification","type","=","alert"]]&or_filters=[["iot_notification","customer_id","=","customer-123"],["iot_notification","customer_user","=","user-456"]]
```

This will return notifications where:
- `type` equals "alert" **AND**
- (`customer_id` equals "customer-123" **OR** `customer_user` equals "user-456")

## Implementation Details

### Database Query Generation

The OR filters are implemented using TypeORM's query builder. Multiple OR conditions are grouped together with parentheses:

```sql
SELECT * FROM iot_notification 
WHERE (customer_id = ? OR customer_user = ?)
ORDER BY created_at DESC
```

### Parameter Naming

OR filter parameters use the prefix `orParam` followed by the filter index to avoid conflicts with regular filter parameters:
- `orParam0`, `orParam1`, `orParam2`, etc.

### Error Handling

Invalid OR filter formats will return a validation error:

```json
{
  "success": false,
  "error": {
    "type": "ValidationError",
    "message": "Invalid OR filters format",
    "timestamp": "2025-06-10T04:10:36.804Z"
  }
}
```

## Testing

### Unit Tests

Run the OR filtering unit tests:

```bash
npm test -- or-filters.test.ts
```

### Manual Testing

Use the provided test script:

```bash
node test-or-filters.js
```

Make sure to update the authorization token and test data in the script before running.

## Performance Considerations

- OR filters are applied as a single WHERE clause with OR conditions grouped in parentheses
- Database indexes on filtered fields will improve query performance
- Consider the number of OR conditions to avoid overly complex queries
- OR filters are applied after regular filters, so use regular filters to narrow down the dataset first when possible

## Migration Notes

- The `or_filters` parameter is optional and backward compatible
- Existing API calls will continue to work without modification
- The feature follows the same validation and security patterns as existing filtering
