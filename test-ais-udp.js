#!/usr/bin/env node

/**
 * AIS Gateway Test Script - UDP Version
 * Test xem data có được gửi qua UDP không
 * IP: 192.168.20.246
 * Port: 8899
 */

const dgram = require('dgram');

const AIS_HOST = '192.168.20.246';
const AIS_PORT = 8899;

const server = dgram.createSocket('udp4');
let messageCount = 0;
let buffer = '';

/**
 * Parse NMEA sentence
 */
function parseNMEA(sentence) {
  messageCount++;

  console.log('\n' + '='.repeat(80));
  console.log(`[${new Date().toISOString()}] Message #${messageCount}`);
  console.log('='.repeat(80));
  console.log('Raw NMEA:', sentence);

  const fields = sentence.split(',');
  if (fields.length > 0) {
    console.log('Message Type:', fields[0]);

    if (fields[0].includes('AIVDM') || fields[0].includes('AIVDO')) {
      console.log('AIS Message Detected!');
      if (fields.length >= 6) {
        console.log('  - Payload:', fields[5]);
      }
    }
  }
}

server.on('error', (err) => {
  console.error(`❌ Server error: ${err.message}`);
  server.close();
});

server.on('message', (msg, rinfo) => {
  console.log(`\n📦 Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
  console.log(`   Hex:`, msg.toString('hex').substring(0, 100));
  console.log(`   Text:`, JSON.stringify(msg.toString().substring(0, 100)));

  // Thêm vào buffer và parse
  buffer += msg.toString();
  let lines = buffer.split(/\r?\n/);
  buffer = lines.pop();

  lines.forEach(line => {
    line = line.trim();
    if (line.length > 0) {
      parseNMEA(line);
    }
  });
});

server.on('listening', () => {
  const address = server.address();
  console.log('✅ UDP Server listening');
  console.log(`   Local: ${address.address}:${address.port}`);
  console.log(`   Waiting for data from ${AIS_HOST}:${AIS_PORT}...\n`);

  // Set timeout warning
  setTimeout(() => {
    if (messageCount === 0) {
      console.log('\n⚠️  WARNING: Không nhận được UDP data nào sau 10 giây!');
      console.log('   AIS Gateway có thể đang sử dụng TCP thay vì UDP');
    }
  }, 10000);
});

// Cleanup
function cleanup() {
  console.log('\n\n👋 Shutting down...');
  console.log(`📊 Total messages received: ${messageCount}`);
  server.close();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start
console.log('🚢 AIS Gateway Test Script - UDP Mode');
console.log('='.repeat(80));
console.log(`Listening for UDP packets from ${AIS_HOST}:${AIS_PORT}`);
console.log('Press Ctrl+C to stop');
console.log('='.repeat(80) + '\n');

// Bind to port
server.bind(AIS_PORT);
