const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const originals = JSON.parse(fs.readFileSync(path.join(__dirname, 'original.json'), 'utf8'));
const baseline = process.env.DATETIME_BASELINE === '1';
const patch = baseline ? null : JSON.parse(fs.readFileSync(path.join(__dirname, 'datetime-patch.json'), 'utf8'));
const batchId = 'f12ee062bf3c2b43';
const fixtures = [
  { name: 'fake-cam-don-01', id: 'fake-cam-don-01', label: 'cẩm đơn', device_id: 'fake-device-36', creation: '2026-09-08T15:44:02.000Z', modified: '2026-11-25T06:00:00.123456Z', start_date: '2026-11-25T00:00:00.000Z', end_date: '2026-12-31', action: '[{"key":"fake-valve","value":1}]', enable: 1, interval: '0,2,3,5', set_time: '00:13:00', start_time: '06:54:00', end_time: '07:07:00', status: 'finished', type: 'interval', is_from_local: 0, is_synced: 1, is_deleted: 0, schedule_plan_id: 'fake-cam-plan' },
  { name: 'fake-cam-chum-02', id: 'fake-cam-chum-02', label: 'cẩm chùm', device_id: 'fake-device-36', creation: '2026-11-03T06:09:45.000Z', modified: '2026-11-25T06:00:00.123456Z', start_date: '2026-11-25', end_date: '2026-12-31', action: '[{"key":"fake-valve-2","value":1}]', enable: 0, interval: '0,2,3,5', set_time: '00:13:00', start_time: '07:09:00', end_time: '07:22:00', status: 'finished', type: 'interval', is_from_local: 0, is_synced: 1, is_deleted: 0, schedule_plan_id: 'fake-cam-plan' }
];
function invoke(node, records, existing = [], index = 0) {
  const msg = node.id === batchId ? {payload: {result: {data: [{schedules: records}]}}} : {payload: existing, parts: {index}, serverScheduleList: records, serverSchedulePlanList: records};
  const state = new Map();
  const run = new Function('msg', 'node', 'flow', 'global', patch ? patch[node.id] : node.func);
  const result = run(msg, {warn() {}}, {set: (key, value) => state.set(key, value)}, {get() { return undefined; }});
  return {result, state};
}
function rows(node, result) {
  const queries = node.id === batchId ? result.queries : [{query: result.topic, queryParams: result.payload}];
  return queries.map(({query, queryParams}) => {
    const fields = /INSERT INTO\s+\w+\s*\(([^)]+)\)/.exec(query)[1].split(',').map(s => s.trim().replaceAll('`', ''));
    return Object.fromEntries(fields.map((field, i) => [field, queryParams[i]]));
  });
}
for (const node of originals) {
  const check = (record) => rows(node, invoke(node, [record]).result)[0];
  test(`${node.id}: ISO timestamps become SQL datetime without a seven-hour shift`, () => {
    const record = check({...fixtures[0]});
    assert.equal(record.creation, '2026-09-08 15:44:02.000');
    assert.equal(record.modified, '2026-11-25 06:00:00.123456');
    assert.equal(record.start_date, '2026-11-25');
  });
  const cases = [
    ['SQL with microseconds', '2026-09-08 15:44:02.123456', '2026-09-08 15:44:02.123456'],
    ['SQL whole seconds', '2026-09-08 15:44:02', '2026-09-08 15:44:02'],
    ['positive offset crosses previous day', '2026-01-01T00:04:02.123456+07:00', '2025-12-31 17:04:02.123456'],
    ['negative offset crosses next day', '2026-12-31T23:44:02.000-02:00', '2027-01-01 01:44:02.000'],
    ['Date instance', new Date('2026-09-08T15:44:02.123Z'), '2026-09-08 15:44:02.123'],
  ];
  for (const [label, value, expected] of cases) test(`${node.id}: ${label}`, () => {
    const record = check({...fixtures[0], creation: value});
    assert.equal(record.creation, expected);
  });
  test(`${node.id}: DATE retains source calendar date across UTC offset`, () => {
    const record = check({...fixtures[0], start_date: '2026-01-01T00:00:00+07:00', end_date: new Date('2026-12-31T23:00:00Z')});
    assert.equal(record.start_date, '2026-01-01');
    assert.equal(record.end_date, '2026-12-31');
  });
  test(`${node.id}: absent temporal values retain omitted-field semantics`, () => {
    const record = check({...fixtures[0], creation: null, modified: undefined, start_date: null, end_date: undefined});
    for (const field of ['creation', 'modified', 'start_date', 'end_date']) assert.equal(Object.hasOwn(record, field), false);
  });
  for (const field of ['creation', 'modified', 'start_date', 'end_date']) {
    for (const bad of ['2026-02-30T15:44:02Z', '2026-09-08T25:44:02Z', '2026-09-08T15:44:02.1234567Z', '2026-09-08T15:44:02+24:00', "2026-09-08'; DROP TABLE x;--", '', 123, new Date(NaN)]) {
      test(`${node.id}: rejects malformed ${field} ${String(bad)}`, () => {
        assert.throws(() => invoke(node, [{...fixtures[0], [field]: bad}]), /invalid|Invalid/);
      });
    }
  }
  test(`${node.id}: validates later records before emitting first query`, () => {
    assert.throws(() => invoke(node, [{...fixtures[0]}, {...fixtures[1], modified: '2026-02-30 00:00:00'}]), /invalid|Invalid/);
  });
  test(`${node.id}: preserves schedule fields and IDs for distinct cẩm-shaped records`, () => {
    const before = structuredClone(fixtures);
    const actual = node.id === batchId ? rows(node, invoke(node, before).result) : before.map((_, i) => rows(node, invoke(node, before, [], i).result)[0]);
    for (let i = 0; i < 2; i++) {
      for (const field of ['device_id', 'enable', 'status']) assert.equal(actual[i][field], fixtures[i][field]);
      assert.equal(actual[i].name, fixtures[i].name);
      if (node.id !== 'bd7a1af262ff3ba1') for (const field of ['action', 'interval', 'set_time', 'start_time', 'end_time', 'schedule_plan_id']) assert.equal(actual[i][field], fixtures[i][field]);
    }
    assert.deepEqual(before, fixtures);
  });
  if (node.id !== batchId) {
    // The baseline needs real Moment for this branch; no substitute parser is used.
    test(`${node.id}: newer/equal existing records skip, preserving identity params`, {skip: baseline && 'Original branch requires unavailable Moment'}, () => {
      for (const modified of ['2026-11-25 06:00:00.123456', '2026-11-25T13:00:00.123456+07:00', new Date('2026-11-25T06:00:01Z')]) {
        const result = invoke(node, [{...fixtures[0]}], [{modified}]).result;
        assert.match(result.topic, /UPDATE\s+tabiot_schedule/);
        assert.deepEqual(result.payload, node.id === 'bd7a1af262ff3ba1' ? ['fake-cam-don-01'] : ['fake-cam-don-01', 'fake-device-36']);
      }
    });
    test(`${node.id}: existing older microsecond permits incoming upsert`, {skip: baseline && 'Original branch requires unavailable Moment'}, () => {
      const record = rows(node, invoke(node, [{...fixtures[0]}], [{modified: '2026-11-25 06:00:00.123455'}]).result)[0];
      assert.equal(record.modified, '2026-11-25 06:00:00.123456');
    });
    test(`${node.id}: null comparison timestamp permits upsert`, {skip: baseline && 'Original branch requires unavailable Moment'}, () => {
      const record = rows(node, invoke(node, [{...fixtures[0], modified: null}], [{modified: '2026-11-25 06:00:00'}]).result)[0];
      assert.equal(record.creation, '2026-09-08 15:44:02.000');
    });
  }
}
