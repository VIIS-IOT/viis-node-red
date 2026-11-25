// Offline only: no devices, Node-RED, MySQL, or network connections.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const originals = JSON.parse(fs.readFileSync(path.join(__dirname, 'original.json'), 'utf8'));
const hashes = JSON.parse(fs.readFileSync(path.join(__dirname, 'datetime-baseline-hashes.json'), 'utf8'));
const patch = JSON.parse(fs.readFileSync(path.join(__dirname, 'datetime-patch.json'), 'utf8'));
assert.deepEqual(Object.keys(patch).sort(), originals.map(node => node.id).sort());
for (const original of originals) {
  assert.equal(crypto.createHash('sha256').update(original.func).digest('hex'), hashes[original.id].funcSha256);
  new Function('msg', 'node', 'flow', 'global', patch[original.id]);
}
console.log('All three baseline functions match their recorded SHA-256 hashes; patched functions compile.');
for (const timezone of ['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York']) {
  const result = spawnSync(process.execPath, ['--test'], {
    cwd: __dirname, encoding: 'utf8', env: {...process.env, DATETIME_BASELINE: '0', TZ: timezone}
  });
  const output = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(__dirname, `datetime-green-${timezone.replaceAll('/', '-')}.log`), output);
  console.log(`${timezone}: exit ${result.status}\n${output.split('\n').filter(line => /tests |pass |fail |skipped /.test(line)).join('\n')}`);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
