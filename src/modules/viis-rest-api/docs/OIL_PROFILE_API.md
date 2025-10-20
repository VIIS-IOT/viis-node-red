# Oil Profile Management API

## Overview

REST API for managing oil profiles in the Marine IoT System. Allows operators to create, update, activate, and delete oil profiles (BO/DO) with different density and temperature configurations.

**Base URL**: `/api/v2/oil-profiles`

**Authentication**: All endpoints require JWT authentication via `Authorization: Bearer <token>` header.

## API Endpoints

### 1. Create Oil Profile

Create a new oil profile for a device.

**Endpoint**: `POST /api/v2/oil-profiles`

**Request Body**:
```json
{
  "name": "profile_bo_standard",  // Optional, auto-generated if not provided
  "device_id": "device_001",      // Required
  "oil_type": "BO",               // Required: "BO" or "DO"
  "operating_temperature": 85,    // Required: -50 to 200 °C
  "density": 950,                // Required: 0.5 to 2.0 kg/m³
  "label": "Bunker Oil Standard", // Optional
  "description": "Standard bunker oil profile",  // Optional
  "is_active": true               // Optional, default: false
}
```

**Response** (201 Created):
```json
{
  "name": "profile_bo_standard",
  "device_id": "device_001",
  "oil_type": "BO",
  "operating_temperature": 85,
  "density": 950,
  "label": "Bunker Oil Standard",
  "description": "Standard bunker oil profile",
  "is_active": true,
  "creation": "2025-01-20T03:00:00.000Z",
  "modified": "2025-01-20T03:00:00.000Z"
}
```

**Validation Rules**:
- `device_id`: Required, max 255 characters
- `oil_type`: Required, must be "BO" or "DO"
- `operating_temperature`: Required, number between -50 and 200
- `density`: Required, number between 0.5 and 2.0
- `label`: Optional, max 255 characters
- `name`: Optional, 3-255 characters, auto-generated if not provided

**Errors**:
- `404 Not Found`: Device not found
- `400 Bad Request`: Validation failed
- `500 Internal Server Error`: Server error

**Example**:
```bash
curl -X POST http://localhost:1880/api/v2/oil-profiles \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "device_001",
    "oil_type": "BO",
    "operating_temperature": 85,
    "density": 950,
    "label": "Bunker Oil Standard",
    "is_active": true
  }'
```

---

### 2. Get Profiles for Device

Retrieve all oil profiles for a specific device with optional filtering.

**Endpoint**: `GET /api/v2/oil-profiles`

**Query Parameters**:
- `device_id` (required): Device ID
- `oil_type` (optional): Filter by oil type ("BO" or "DO")
- `is_active` (optional): Filter by active status (true/false)
- `limit` (optional): Number of results (1-100, default: 20)
- `offset` (optional): Pagination offset (default: 0)

**Response** (200 OK):
```json
{
  "profiles": [
    {
      "name": "profile_bo_001",
      "device_id": "device_001",
      "oil_type": "BO",
      "operating_temperature": 85,
      "density": 950,
      "label": "Bunker Oil Standard",
      "is_active": true,
      "creation": "2025-01-20T03:00:00.000Z",
      "modified": "2025-01-20T03:00:00.000Z"
    },
    {
      "name": "profile_do_001",
      "device_id": "device_001",
      "oil_type": "DO",
      "operating_temperature": 40,
      "density": 850,
      "label": "Diesel Oil Standard",
      "is_active": false,
      "creation": "2025-01-20T03:00:00.000Z",
      "modified": "2025-01-20T03:00:00.000Z"
    }
  ],
  "total": 2,
  "limit": 20,
  "offset": 0
}
```

**Examples**:
```bash
# Get all profiles for a device
curl -X GET "http://localhost:1880/api/v2/oil-profiles?device_id=device_001" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Get only active BO profiles
curl -X GET "http://localhost:1880/api/v2/oil-profiles?device_id=device_001&oil_type=BO&is_active=true" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Get with pagination
curl -X GET "http://localhost:1880/api/v2/oil-profiles?device_id=device_001&limit=10&offset=0" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 3. Get Active Profile

Get the currently active oil profile for a device.

**Endpoint**: `GET /api/v2/oil-profiles/active/:device_id`

**Path Parameters**:
- `device_id`: Device ID

**Response** (200 OK):
```json
{
  "name": "profile_bo_001",
  "device_id": "device_001",
  "oil_type": "BO",
  "operating_temperature": 85,
  "density": 950,
  "label": "Bunker Oil Standard",
  "is_active": true,
  "creation": "2025-01-20T03:00:00.000Z",
  "modified": "2025-01-20T03:00:00.000Z"
}
```

**Response** (200 OK - No active profile):
```json
null
```

**Example**:
```bash
curl -X GET http://localhost:1880/api/v2/oil-profiles/active/device_001 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 4. Update Oil Profile

Update an existing oil profile.

**Endpoint**: `PUT /api/v2/oil-profiles/:name`

**Path Parameters**:
- `name`: Profile name

**Request Body** (all fields optional):
```json
{
  "oil_type": "DO",
  "operating_temperature": 40,
  "density": 850,
  "label": "Updated Label",
  "description": "Updated description",
  "is_active": true
}
```

**Response** (200 OK):
```json
{
  "name": "profile_bo_001",
  "device_id": "device_001",
  "oil_type": "DO",
  "operating_temperature": 40,
  "density": 850,
  "label": "Updated Label",
  "description": "Updated description",
  "is_active": true,
  "creation": "2025-01-20T03:00:00.000Z",
  "modified": "2025-01-20T03:05:00.000Z"
}
```

**Errors**:
- `404 Not Found`: Profile not found
- `400 Bad Request`: Validation failed

**Example**:
```bash
curl -X PUT http://localhost:1880/api/v2/oil-profiles/profile_bo_001 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "density": "density": 960,
    "label": "Updated BO Profile"
  }'
```

---

### 5. Activate Oil Profile

Set a profile as active (automatically deactivates other profiles for the same device).

**Endpoint**: `POST /api/v2/oil-profiles/activate`

**Request Body**:
```json
{
  "profile_name": "profile_do_001"
}
```

**Response** (200 OK):
```json
{
  "name": "profile_do_001",
  "device_id": "device_001",
  "oil_type": "DO",
  "operating_temperature": 40,
  "density": 850,
  "label": "Diesel Oil Standard",
  "is_active": true,
  "creation": "2025-01-20T03:00:00.000Z",
  "modified": "2025-01-20T03:10:00.000Z"
}
```

**Errors**:
- `404 Not Found`: Profile not found

**Example**:
```bash
curl -X POST http://localhost:1880/api/v2/oil-profiles/activate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "profile_name": "profile_do_001"
  }'
```

---

### 6. Delete Oil Profile

Delete an inactive oil profile. Cannot delete the active profile.

**Endpoint**: `DELETE /api/v2/oil-profiles/:name`

**Path Parameters**:
- `name`: Profile name

**Response** (204 No Content): Empty response

**Errors**:
- `404 Not Found`: Profile not found
- `400 Bad Request`: Cannot delete active profile

**Example**:
```bash
curl -X DELETE http://localhost:1880/api/v2/oil-profiles/profile_old_001 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Usage Scenarios

### Scenario 1: Initial Setup

```bash
# 1. Create BO profile and set as active
curl -X POST http://localhost:1880/api/v2/oil-profiles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "ship_001",
    "oil_type": "BO",
    "operating_temperature": 85,
    "density": 950,
    "label": "Bunker Oil Standard",
    "is_active": true
  }'

# 2. Create DO profile (inactive)
curl -X POST http://localhost:1880/api/v2/oil-profiles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "ship_001",
    "oil_type": "DO",
    "operating_temperature": 40,
    "density": 850,
    "label": "Diesel Oil Standard",
    "is_active": false
  }'

# 3. Verify active profile
curl -X GET http://localhost:1880/api/v2/oil-profiles/active/ship_001 \
  -H "Authorization: Bearer $TOKEN"
```

### Scenario 2: Switch from BO to DO

```bash
# Get active profile (BO)
curl -X GET http://localhost:1880/api/v2/oil-profiles/active/ship_001 \
  -H "Authorization: Bearer $TOKEN"

# Switch to DO profile
curl -X POST http://localhost:1880/api/v2/oil-profiles/activate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "profile_name": "profile_do_001"
  }'

# Verify switch
curl -X GET http://localhost:1880/api/v2/oil-profiles/active/ship_001 \
  -H "Authorization: Bearer $TOKEN"
```

### Scenario 3: Update Density

```bash
# Update profile density (e.g., after lab analysis)
curl -X PUT http://localhost:1880/api/v2/oil-profiles/profile_bo_001 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "density": "density": 960,
    "description": "Updated after lab test on 2025-01-20"
  }'
```

### Scenario 4: Clean Up Old Profiles

```bash
# List all inactive profiles
curl -X GET "http://localhost:1880/api/v2/oil-profiles?device_id=ship_001&is_active=false" \
  -H "Authorization: Bearer $TOKEN"

# Delete old profile
curl -X DELETE http://localhost:1880/api/v2/oil-profiles/profile_old_001 \
  -H "Authorization: Bearer $TOKEN"
```

---

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "error": {
    "type": "ValidationError",
    "message": "Validation failed",
    "details": [
      {
        "property": "density",
        "constraints": {
          "min": "density must be at least 0.5 kg/m³"
        }
      }
    ]
  },
  "timestamp": "2025-01-20T03:15:00.000Z"
}
```

### 404 Not Found
```json
{
  "success": false,
  "error": {
    "type": "NotFoundError",
    "message": "Profile profile_xyz not found"
  },
  "timestamp": "2025-01-20T03:15:00.000Z"
}
```

### 401 Unauthorized
```json
{
  "error": "UNAUTHORIZED",
  "message": "Invalid or missing authentication token",
  "timestamp": "2025-01-20T03:15:00.000Z"
}
```

---

## Integration with Marine IoT System

### Data Flow

```
User Action (UI) 
    ↓
REST API Call
    ↓
OilProfileController
    ↓
OilProfileService
    ↓
Database (tabiot_oil_profile)
    ↓
Node-RED Flow (reads active profile)
    ↓
Telemetry Collection (with profile tracking)
    ↓
Hourly Accumulation (uses density snapshot)
```

### Impact on Data Collection

When you activate a profile:

1. **Immediate**: Active profile is updated in database
2. **Within 5 minutes**: Node-RED flow cache refreshes
3. **Next telemetry read**: New data includes new profile ID and density
4. **Hourly job**: Uses density from telemetry snapshot (not current profile)

This ensures **data integrity** - historical data always reflects the profile that was active when it was collected.

---

## Frontend Integration Example

### React/Vue Component

```javascript
// API Service
class OilProfileAPI {
  constructor(baseURL, token) {
    this.baseURL = baseURL;
    this.token = token;
  }

  async getProfiles(deviceId) {
    const response = await fetch(
      `${this.baseURL}/oil-profiles?device_id=${deviceId}`,
      {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      }
    );
    return response.json();
  }

  async getActiveProfile(deviceId) {
    const response = await fetch(
      `${this.baseURL}/oil-profiles/active/${deviceId}`,
      {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      }
    );
    return response.json();
  }

  async createProfile(profileData) {
    const response = await fetch(
      `${this.baseURL}/oil-profiles`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(profileData)
      }
    );
    return response.json();
  }

  async activateProfile(profileName) {
    const response = await fetch(
      `${this.baseURL}/oil-profiles/activate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ profile_name: profileName })
      }
    );
    return response.json();
  }

  async deleteProfile(profileName) {
    const response = await fetch(
      `${this.baseURL}/oil-profiles/${profileName}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      }
    );
    return response.status === 204;
  }
}

// Usage
const api = new OilProfileAPI('http://localhost:1880/api/v2', yourToken);

// Get all profiles
const profiles = await api.getProfiles('device_001');

// Switch profile
await api.activateProfile('profile_do_001');
```

---

## Testing

### Unit Tests

Run unit tests:
```bash
npm test -- oil-profile.controller.test
```

**Coverage**: 20 test cases covering all endpoints and error scenarios.

### Manual API Testing

Use the provided Postman collection or cURL examples above.

---

## Security Considerations

1. **Authentication**: All endpoints require valid JWT token
2. **Authorization**: Currently all authenticated users can manage profiles
3. **Validation**: Input validation prevents invalid data
4. **Device Isolation**: Profiles are device-specific

**Future Enhancement**: Add role-based access control (e.g., only admin can delete profiles).

---

## Performance

- **Response Time**: < 100ms for most operations
- **Database**: Indexed by device_id for fast lookups
- **Caching**: Node-RED flows cache active profile for 5 minutes

---

## Troubleshooting

### Issue: Profile not reflecting in telemetry

**Solution**: Wait up to 5 minutes for cache refresh, or restart Node-RED flow.

### Issue: Cannot delete profile

**Error**: "Cannot delete active profile"

**Solution**: Activate another profile first, then delete.

### Issue: 404 on all endpoints

**Solution**: Check that viis-rest-api node is deployed and enabled in Node-RED.

---

## Version History

- **v1.0.0** (2025-01-20): Initial release
  - CRUD operations for oil profiles
  - Profile activation/deactivation
  - Pagination and filtering
  - Full test coverage

---

## Support

For issues or questions:
- Check Marine IoT documentation
- Review test cases for usage examples
- Contact VIIS support team
