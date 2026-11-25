const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const originals = JSON.parse(fs.readFileSync(path.join(__dirname, 'original.json'), 'utf8'));
const helper = fs.readFileSync(path.join(__dirname, 'datetime-normalizer.js'), 'utf8');
const patch = {};
const hashes = {};
for (const original of originals) {
  let func = original.func.replace("const moment = global.get('moment');\n", '');
  func = func.replace('const serverScheduleList = msg.serverScheduleList;', 'const serverScheduleList = msg.serverScheduleList.map(normalizeTemporalRecord);');
  func = func.replace('const serverSchedulePlanList = msg.serverSchedulePlanList;', 'const serverSchedulePlanList = msg.serverSchedulePlanList.map(normalizeTemporalRecord);');
  func = func.replace('const schedules = msg.payload.result.data[0].schedules;', 'const schedules = msg.payload.result.data[0].schedules.map(normalizeTemporalRecord);');
  func = func.replace('moment(existingRecord).isSameOrAfter(incomingModified)', 'existingIsSameOrAfter(existingRecord, incomingModified)');
  // is_synced is bookkeeping: suppress MySQL's ON UPDATE modified timestamp.
  func = func.replace('SET is_synced = 0', 'SET is_synced = 0, modified = modified');
  func = func.replace('node.warn(moment(existingRecord))', "node.warn(normalizeTemporal(existingRecord, 'modified'))").replace('node.warn(moment(incomingModified))', "node.warn(normalizeTemporal(incomingModified, 'modified'))");
  patch[original.id] = helper + '\n' + func;
  hashes[original.id] = {name: original.name, funcSha256: crypto.createHash('sha256').update(original.func).digest('hex')};
}
fs.writeFileSync(path.join(__dirname, 'datetime-patch.json'), JSON.stringify(patch, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'datetime-baseline-hashes.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(`Built ${Object.keys(patch).length} function-only patches; original hashes recorded.`);
