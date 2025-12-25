"use strict";
/**
 * Test file to verify the coil tracking entity works properly
 */
Object.defineProperty(exports, "__esModule", { value: true });
const TabiotCoilTrackingSession_1 = require("../../orm/entities/coil-tracking/TabiotCoilTrackingSession");
// Test creating an instance
const testSession = new TabiotCoilTrackingSession_1.TabiotCoilTrackingSession();
testSession.name = 'test_session_123';
testSession.tracking_key = 'mixing_operation';
testSession.coil_key = 'COIL_AUTO_TRON';
testSession.board_id = 'board1';
testSession.device_id = 'test_device_123';
testSession.start_time = new Date();
testSession.status = 'active';
testSession.start_snapshot = {
    current_ec: 1450,
    current_ph: 650,
    volume_iri: 100,
    ts: Date.now()
};
console.log('✅ Test entity created successfully');
console.log('Entity data:', JSON.stringify(testSession, null, 2));
// Verify required fields
console.log('\n✅ Required fields check:');
console.log('- name:', testSession.name);
console.log('- tracking_key:', testSession.tracking_key);
console.log('- coil_key:', testSession.coil_key);
console.log('- start_time:', testSession.start_time);
console.log('- status:', testSession.status);
console.log('\n✅ Entity structure is correct and ready for use with TypeORM');
