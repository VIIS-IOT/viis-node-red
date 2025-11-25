#!/usr/bin/env node

/**
 * AIS Gateway Test Script
 * Kết nối đến AIS gateway và đọc dữ liệu NMEA
 * IP: 192.168.20.246
 * Port: 8899
 */

const net = require('net');

/**
 * Decode 6-bit ASCII to binary (AIS armoring)
 * AIS uses 6-bit encoding where ASCII characters 48-87 (0-9, :;<=>?@A-W)
 * and 96-119 (`, a-w) are mapped to 0-63
 */
function payloadToBinary(payload) {
  let binary = '';
  for (let i = 0; i < payload.length; i++) {
    const char = payload[i];
    let charCode = char.charCodeAt(0);
    let value;
    
    // AIS armoring: subtract 48, if > 40 then subtract 8
    value = charCode - 48;
    if (value > 40) {
      value -= 8;
    }
    
    if (value < 0 || value > 63) {
      console.log(`Invalid character in payload: ${char} (code: ${charCode}, value: ${value})`);
      return null;
    }
    
    binary += value.toString(2).padStart(6, '0');
  }
  return binary;
}

/**
 * Extract bits from binary string
 */
function extractBits(binary, start, length) {
  return binary.substr(start, length);
}

/**
 * Convert binary string to unsigned integer
 */
function binaryToInt(binary) {
  return parseInt(binary, 2);
}

/**
 * Convert binary string to signed integer
 */
function binaryToSignedInt(binary) {
  const value = parseInt(binary, 2);
  const bits = binary.length;
  const max = Math.pow(2, bits - 1);
  return value >= max ? value - Math.pow(2, bits) : value;
}

/**
 * Decode 6-bit ASCII text
 */
function decode6BitText(binary) {
  const charset = '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !"#$%&\'()*+,-./0123456789:;<=>?';
  let text = '';
  for (let i = 0; i < binary.length; i += 6) {
    const sixBits = binary.substr(i, 6);
    const value = parseInt(sixBits, 2);
    text += charset[value];
  }
  return text.trim();
}

/**
 * Decode AIS payload and extract ship information
 */
function decodeAISPayload(payload, messageType) {
  const binary = payloadToBinary(payload);
  if (!binary) return null;

  const result = {};
  
  // Message Type (first 6 bits)
  const msgType = binaryToInt(extractBits(binary, 0, 6));
  result.messageType = msgType;

  // Type 1, 2, 3: Position Report Class A
  if (msgType === 1 || msgType === 2 || msgType === 3) {
    result.mmsi = binaryToInt(extractBits(binary, 8, 30));
    result.navigationStatus = binaryToInt(extractBits(binary, 38, 4));
    result.rateOfTurn = binaryToSignedInt(extractBits(binary, 42, 8));
    result.speedOverGround = binaryToInt(extractBits(binary, 50, 10)) / 10; // knots
    result.positionAccuracy = binaryToInt(extractBits(binary, 60, 1));
    result.longitude = binaryToSignedInt(extractBits(binary, 61, 28)) / 600000; // degrees
    result.latitude = binaryToSignedInt(extractBits(binary, 89, 27)) / 600000; // degrees
    result.courseOverGround = binaryToInt(extractBits(binary, 116, 12)) / 10; // degrees
    result.trueHeading = binaryToInt(extractBits(binary, 128, 9)); // degrees
    
    // Navigation status text
    const navStatusTexts = [
      'Under way using engine',
      'At anchor',
      'Not under command',
      'Restricted manoeuverability',
      'Constrained by her draught',
      'Moored',
      'Aground',
      'Engaged in Fishing',
      'Under way sailing',
      'Reserved for HSC',
      'Reserved for WIG',
      'Reserved',
      'Reserved',
      'Reserved',
      'AIS-SART',
      'Not defined'
    ];
    result.navigationStatusText = navStatusTexts[result.navigationStatus] || 'Unknown';
  }
  // Type 5: Static and Voyage Related Data
  else if (msgType === 5) {
    result.mmsi = binaryToInt(extractBits(binary, 8, 30));
    result.aisVersion = binaryToInt(extractBits(binary, 38, 2));
    result.imoNumber = binaryToInt(extractBits(binary, 40, 30));
    result.callsign = decode6BitText(extractBits(binary, 70, 42));
    result.shipName = decode6BitText(extractBits(binary, 112, 120));
    result.shipType = binaryToInt(extractBits(binary, 232, 8));
    result.dimensionToBow = binaryToInt(extractBits(binary, 240, 9));
    result.dimensionToStern = binaryToInt(extractBits(binary, 249, 9));
    result.dimensionToPort = binaryToInt(extractBits(binary, 258, 6));
    result.dimensionToStarboard = binaryToInt(extractBits(binary, 264, 6));
    result.etaMonth = binaryToInt(extractBits(binary, 274, 4));
    result.etaDay = binaryToInt(extractBits(binary, 278, 5));
    result.etaHour = binaryToInt(extractBits(binary, 283, 5));
    result.etaMinute = binaryToInt(extractBits(binary, 288, 6));
    result.draught = binaryToInt(extractBits(binary, 294, 8)) / 10; // meters
    result.destination = decode6BitText(extractBits(binary, 302, 120));
  }
  // Type 18: Standard Class B CS Position Report
  else if (msgType === 18) {
    result.mmsi = binaryToInt(extractBits(binary, 8, 30));
    result.speedOverGround = binaryToInt(extractBits(binary, 46, 10)) / 10; // knots
    result.positionAccuracy = binaryToInt(extractBits(binary, 56, 1));
    result.longitude = binaryToSignedInt(extractBits(binary, 57, 28)) / 600000; // degrees
    result.latitude = binaryToSignedInt(extractBits(binary, 85, 27)) / 600000; // degrees
    result.courseOverGround = binaryToInt(extractBits(binary, 112, 12)) / 10; // degrees
    result.trueHeading = binaryToInt(extractBits(binary, 124, 9)); // degrees
  }
  // Type 24: Static Data Report
  else if (msgType === 24) {
    result.mmsi = binaryToInt(extractBits(binary, 8, 30));
    const partNumber = binaryToInt(extractBits(binary, 38, 2));
    result.partNumber = partNumber;
    
    if (partNumber === 0) {
      // Part A: Ship Name
      result.shipName = decode6BitText(extractBits(binary, 40, 120));
    } else if (partNumber === 1) {
      // Part B: Static Data
      result.shipType = binaryToInt(extractBits(binary, 40, 8));
      result.vendorId = decode6BitText(extractBits(binary, 48, 18));
      result.callsign = decode6BitText(extractBits(binary, 90, 42));
      result.dimensionToBow = binaryToInt(extractBits(binary, 132, 9));
      result.dimensionToStern = binaryToInt(extractBits(binary, 141, 9));
      result.dimensionToPort = binaryToInt(extractBits(binary, 150, 6));
      result.dimensionToStarboard = binaryToInt(extractBits(binary, 156, 6));
    }
  }

  return result;
}

const AIS_HOST = '192.168.20.246';
const AIS_PORT = 8899;
const RECONNECT_DELAY = 5000; // 5 giây

let client = null;
let buffer = '';
let messageCount = 0;
let dataReceivedCount = 0;
let noDataTimer = null;

/**
 * Parse NMEA sentence và hiển thị thông tin
 */
function parseNMEA(sentence) {
  messageCount++;

  console.log('\n' + '='.repeat(80));
  console.log(`[${new Date().toISOString()}] Message #${messageCount}`);
  console.log('='.repeat(80));
  console.log('Raw NMEA:', sentence);

  // Kiểm tra checksum (nếu có)
  if (sentence.includes('*')) {
    const parts = sentence.split('*');
    const data = parts[0];
    const checksumProvided = parts[1];

    // Tính checksum (XOR tất cả các ký tự giữa ! hoặc $ và *)
    let checksumCalculated = 0;
    const startChar = data.indexOf('!') >= 0 ? '!' : '$';
    const startIdx = data.indexOf(startChar) + 1;

    for (let i = startIdx; i < data.length; i++) {
      checksumCalculated ^= data.charCodeAt(i);
    }

    const checksumHex = checksumCalculated.toString(16).toUpperCase().padStart(2, '0');
    const checksumValid = checksumHex === checksumProvided.toUpperCase();

    console.log(`Checksum: ${checksumProvided} (${checksumValid ? '✓ VALID' : '✗ INVALID - Expected: ' + checksumHex})`);
  }

  // Parse AIS NMEA sentence
  const fields = sentence.split(',');

  if (fields.length > 0) {
    const messageType = fields[0];
    console.log('Message Type:', messageType);

    // AIS messages thường bắt đầu với !AIVDM hoặc !AIVDO
    if (messageType.includes('AIVDM') || messageType.includes('AIVDO')) {
      console.log('AIS Message Detected:');
      if (fields.length >= 6) {
        console.log('  - Fragment Count:', fields[1]);
        console.log('  - Fragment Number:', fields[2]);
        console.log('  - Message ID:', fields[3]);
        console.log('  - Channel:', fields[4]);
        console.log('  - Payload:', fields[5]);
        
        // Decode AIS payload (chỉ decode single-fragment messages)
        const fragmentCount = parseInt(fields[1]);
        const payload = fields[5];
        
        if (fragmentCount === 1 && payload) {
          console.log('\n🔍 Decoded AIS Data:');
          const decoded = decodeAISPayload(payload, messageType);
          
          if (decoded) {
            console.log('  ├─ Message Type:', decoded.messageType);
            console.log('  ├─ MMSI:', decoded.mmsi);
            
            // Position report (Type 1, 2, 3, 18)
            if (decoded.latitude !== undefined && decoded.longitude !== undefined) {
              console.log('  ├─ Position:');
              console.log(`  │  ├─ Latitude: ${decoded.latitude.toFixed(6)}°`);
              console.log(`  │  └─ Longitude: ${decoded.longitude.toFixed(6)}°`);
            }
            
            if (decoded.speedOverGround !== undefined) {
              console.log(`  ├─ Speed Over Ground: ${decoded.speedOverGround.toFixed(1)} knots`);
            }
            
            if (decoded.courseOverGround !== undefined) {
              console.log(`  ├─ Course Over Ground: ${decoded.courseOverGround.toFixed(1)}°`);
            }
            
            if (decoded.trueHeading !== undefined && decoded.trueHeading !== 511) {
              console.log(`  ├─ True Heading: ${decoded.trueHeading}°`);
            }
            
            if (decoded.navigationStatus !== undefined) {
              console.log(`  ├─ Navigation Status: ${decoded.navigationStatusText}`);
            }
            
            // Static data (Type 5, 24)
            if (decoded.shipName) {
              console.log(`  ├─ Ship Name: ${decoded.shipName}`);
            }
            
            if (decoded.callsign) {
              console.log(`  ├─ Callsign: ${decoded.callsign}`);
            }
            
            if (decoded.destination) {
              console.log(`  ├─ Destination: ${decoded.destination}`);
            }
            
            if (decoded.shipType !== undefined) {
              console.log(`  ├─ Ship Type Code: ${decoded.shipType}`);
            }
            
            if (decoded.draught !== undefined) {
              console.log(`  └─ Draught: ${decoded.draught}m`);
            }
          } else {
            console.log('  └─ Failed to decode payload');
          }
        } else if (fragmentCount > 1) {
          console.log('  └─ ⚠️  Multi-fragment message (decoding not implemented yet)');
        }
      }
    }

    // Hiển thị tất cả các fields
    console.log('\nAll Fields:');
    fields.forEach((field, idx) => {
      console.log(`  [${idx}]: ${field}`);
    });
  }
}

/**
 * Xử lý dữ liệu nhận được từ socket
 */
function handleData(data) {
  dataReceivedCount++;

  // Clear no-data timer vì đã nhận được data
  if (noDataTimer) {
    clearTimeout(noDataTimer);
    noDataTimer = null;
  }

  // Log raw data để debug
  console.log(`\n📦 Received ${data.length} bytes (total chunks: ${dataReceivedCount}):`);
  console.log(`   Hex:`, data.toString('hex').substring(0, 100));
  console.log(`   Text:`, JSON.stringify(data.toString().substring(0, 100)));

  // Thêm data vào buffer
  buffer += data.toString();

  // Xử lý từng dòng NMEA (kết thúc bằng \r\n hoặc \n)
  let lines = buffer.split(/\r?\n/);

  // Giữ lại phần chưa hoàn chỉnh trong buffer
  buffer = lines.pop();

  // Xử lý từng dòng hoàn chỉnh
  lines.forEach(line => {
    line = line.trim();
    if (line.length > 0) {
      parseNMEA(line);
    }
  });
}

/**
 * Kết nối đến AIS gateway
 */
function connectToGateway() {
  console.log(`\n🔌 Connecting to AIS Gateway at ${AIS_HOST}:${AIS_PORT}...`);

  client = new net.Socket();

  // Xử lý kết nối thành công
  client.on('connect', () => {
    console.log('✅ Connected to AIS Gateway successfully!');
    console.log('📡 Listening for NMEA data...\n');
    buffer = '';
    messageCount = 0;
    dataReceivedCount = 0;

    // Set timer để check xem có nhận data không sau 10 giây
    noDataTimer = setTimeout(() => {
      if (dataReceivedCount === 0) {
        console.log('\n⚠️  WARNING: Không nhận được data nào sau 10 giây!');
        console.log('   Có thể:');
        console.log('   1. Gateway đang idle (không có tàu trong vùng)');
        console.log('   2. Gateway chưa có dữ liệu để gửi');
        console.log('   3. Kiểm tra cấu hình gateway');
        console.log('\n   💡 Tiếp tục lắng nghe...');
      }
    }, 10000);
  });

  // Xử lý dữ liệu nhận được
  client.on('data', handleData);

  // Xử lý lỗi
  client.on('error', (err) => {
    console.error('❌ Connection error:', err.message);
  });

  // Xử lý ngắt kết nối
  client.on('close', () => {
    console.log('\n🔌 Connection closed');
    console.log(`⏰ Reconnecting in ${RECONNECT_DELAY/1000} seconds...`);

    // Tự động kết nối lại
    setTimeout(connectToGateway, RECONNECT_DELAY);
  });

  // Kết nối
  client.connect(AIS_PORT, AIS_HOST);
}

/**
 * Xử lý tắt chương trình
 */
function cleanup() {
  console.log('\n\n👋 Shutting down...');

  if (noDataTimer) {
    clearTimeout(noDataTimer);
  }

  if (client) {
    client.destroy();
  }

  console.log(`📊 Total messages received: ${messageCount}`);
  console.log(`📦 Total data chunks received: ${dataReceivedCount}`);
  process.exit(0);
}

// Xử lý Ctrl+C
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Bắt đầu
console.log('🚢 AIS Gateway Test Script');
console.log('=' .repeat(80));
console.log(`Gateway: ${AIS_HOST}:${AIS_PORT}`);
console.log('Press Ctrl+C to stop');
console.log('='.repeat(80));

connectToGateway();
