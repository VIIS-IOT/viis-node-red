// Test emitted builder SQL only on connection-local TEMPORARY tables.
const fs = require('fs'), assert = require('node:assert/strict'), crypto = require('crypto');
const mysql = require('mysql2/promise');
const patches = JSON.parse(fs.readFileSync(__dirname+'/datetime-patch.json'));
let code = patches;
if (process.argv.includes('--deployed')) {
    const flows = JSON.parse(fs.readFileSync('/data/flows.json'));
    code = Object.fromEntries(Object.keys(patches).map(id => [id, flows.find(n => n.id === id).func]));
    for (const id of Object.keys(patches)) assert.equal(code[id], patches[id], 'deployed builder differs: '+id);
}
function invoke(id, records, existing = [], index = 0) {
    const msg = id === 'f12ee062bf3c2b43'
        ? {payload:{result:{data:[{schedules:records}]}}}
        : {payload:existing,parts:{index},serverScheduleList:records,serverSchedulePlanList:records};
    return new Function('msg','node','flow','global',code[id])(msg,{warn(){}},{set(){}},{get(){return undefined;}});
}
const db = JSON.parse(fs.readFileSync('/usr/src/app/env/configs/common.json')).databaseHost;
const realNames = ['fe8700e8c212373a','0169c52a1f870c58'];
const records = [
    {name:'codex-datetime-don',label:'fake cẩm đơn',creation:'2026-09-08T15:44:02.000Z',modified:'2026-11-25T06:00:00.123456Z',start_time:'06:54:00',end_time:'07:07:00'},
    {name:'codex-datetime-chum',label:'fake cẩm chùm',creation:'2026-11-03T06:09:45.000Z',modified:'2026-11-25T06:00:00.123456Z',start_time:'07:09:00',end_time:'07:22:00'},
].map(x=>({...x,device_id:'codex-fake-device',enable:1,status:'finished',start_date:'2026-11-25T00:00:00.000Z',end_date:'2027-09-01',type:'',interval:'0,2,3,5',is_deleted:0,is_synced:1,is_from_local:0,schedule_plan_id:'codex-datetime-plan',action:JSON.stringify({input_pump:false})}));
const plan = {name:'codex-datetime-plan',label:'fake cẩm chướng',device_id:'codex-fake-device',enable:1,status:'active',schedule_count:2,is_deleted:0,creation:'2026-09-01T14:31:42.000Z',modified:'2026-11-25T06:00:00.123456Z',start_date:'2026-09-01',end_date:'2027-09-01'};
(async()=>{
    const c = await mysql.createConnection({host:db.DB_HOST,port:Number(db.DB_PORT),user:db.DB_USERNAME,password:db.DB_PASSWORD,database:db.DB_DATABASE,dateStrings:true});
    let checks = 0;
    const digest = async()=>{
        const [s]=await c.query('SELECT * FROM tabiot_schedule WHERE name IN (?,?) ORDER BY name',realNames);
        const [p]=await c.query('SELECT * FROM tabiot_schedule_plan WHERE name=?',['3f2717d4a01c19bb']);
        return crypto.createHash('sha256').update(JSON.stringify([s,p])).digest('hex');
    };
    const before=await digest();
    try {
        await c.query('CREATE TEMPORARY TABLE codex_dt_schedule LIKE tabiot_schedule');
        await c.query('CREATE TEMPORARY TABLE codex_dt_plan LIKE tabiot_schedule_plan');
        async function execute(query,params) {
            assert.match(query,/^\s*(INSERT INTO|UPDATE) tabiot_schedule(?:_plan)?\b/);
            const rewritten=query.replace(/\btabiot_schedule_plan\b/g,'codex_dt_plan').replace(/\btabiot_schedule\b/g,'codex_dt_schedule');
            assert.doesNotMatch(rewritten,/\btabiot_schedule(?:_plan)?\b/);
            await c.query(rewritten,params);
        }
        const p=invoke('bd7a1af262ff3ba1',[plan]);await execute(p.topic,p.payload);
        for(let i=0;i<records.length;i++) {const m=invoke('2ca1325dce29b527',records,[],i);await execute(m.topic,m.payload);}
        let [rows]=await c.query('SELECT name,creation,modified,start_date,start_time,end_time,action FROM codex_dt_schedule ORDER BY name');
        assert.equal(rows.length,2);checks++;
        assert.equal(rows.find(x=>x.name==='codex-datetime-don').creation,'2026-09-08 15:44:02.000000');checks++;
        for(const row of rows){assert.equal(row.modified,'2026-11-25 06:00:00.123456');assert.equal(row.start_date,'2026-11-25');checks+=2;}
        const batch=records.map(x=>({...x,id:x.name,name:x.label,modified:'2026-11-25T07:00:00.654321Z'}));
        const m=invoke('f12ee062bf3c2b43',batch);
        for(const q of m.queries) await execute(q.query,q.queryParams);
        [rows]=await c.query('SELECT name,modified,start_time,end_time,action FROM codex_dt_schedule ORDER BY name');
        for(const row of rows){assert.equal(row.modified,'2026-11-25 07:00:00.654321');const original=records.find(x=>x.name===row.name);assert.equal(row.start_time,original.start_time);assert.equal(row.end_time,original.end_time);assert.equal(row.action,original.action);checks+=4;}
        const stale=invoke('2ca1325dce29b527',records,[{modified:'2026-11-25 07:00:00.654321'}]);
        await execute(stale.topic,stale.payload);
        const [unchanged]=await c.query('SELECT modified FROM codex_dt_schedule WHERE name=?',[records[0].name]);
        assert.equal(unchanged[0].modified,'2026-11-25 07:00:00.654321');checks++;
        assert.throws(()=>invoke('f12ee062bf3c2b43',[batch[0],{...batch[1],creation:'2026-02-30T00:00:00Z'}]),/Invalid temporal/);checks++;
        const [plans]=await c.query('SELECT modified,start_date,end_date FROM codex_dt_plan');
        assert.equal(plans[0].modified,'2026-11-25 06:00:00.123456');assert.equal(plans[0].start_date,'2026-09-01');checks+=2;
        assert.equal(await digest(),before,'persistent schedules/plan changed during test');checks++;
        console.log(JSON.stringify({mode:process.argv.includes('--deployed')?'deployed-functions':'staged-functions',checks,rows:2,result:'PASS',persistentTargetRowsUnchanged:true}));
    } finally {
        await c.query('DROP TEMPORARY TABLE IF EXISTS codex_dt_schedule');
        await c.query('DROP TEMPORARY TABLE IF EXISTS codex_dt_plan');
        await c.end();
    }
})().catch(e=>{console.error(e.stack||e.code||e.message);process.exitCode=1;});
