import {ScheduleService} from '../viis-schedule-executor-service';
const fixture=require('./host36-fixture.json');
describe('host36 schedule executes with actual register maps on a FAKE board',()=>{
 beforeEach(()=>{jest.useFakeTimers();jest.setSystemTime(new Date('2026-11-22T22:51:00Z'));});
 afterEach(()=>{jest.useRealTimers();});
 function setup(){
  const store:any={};const node:any={warn:jest.fn(),log:jest.fn(),error:jest.fn(),context:()=>({global:{get:(k:string)=>store[k],set:(k:string,v:any)=>{store[k]=v}}})};
  const service=new ScheduleService(node,true,false,true,7000);
  const env=fixture.env;(service as any).globalHelper={getEnvVar:(k:string,d:any)=>env[k]??d,getJsonEnvVar:(k:string,d:any={})=>env[k]??d};
  jest.spyOn(service,'delay').mockResolvedValue(undefined);
  const coils=new Map<number,boolean>(),regs=new Map<number,number>();
  const board:any={writeCoil:jest.fn(async(a:number,v:boolean)=>{coils.set(a,v)}),writeRegister:jest.fn(async(a:number,v:number)=>{regs.set(a,v)}),readCoils:jest.fn(async(a:number)=>({data:[coils.get(a)??false]})),readHoldingRegisters:jest.fn(async(a:number)=>({data:[regs.get(a)??0]}))};
  service.setBoardClientProvider(async()=>board);return {service,board};
 }
 it('runs Monday schedule in Vietnam time and writes/reads mapped commands, then stops on finish',async()=>{
  const {service,board}=setup();const schedule={...fixture.schedule,status:'running'};
  expect(service.isScheduleDue(schedule)).toBe(true);
  const commands=service.mapScheduleToModbus(schedule,{dryRun:true});
  expect(commands.coilCommands.length+commands.holdingCommands.length).toBeGreaterThan(0);
  for(const cmd of commands.coilCommands)expect(Object.values(fixture.env.MODBUS_BOARD1_COILS)).toContain(cmd.address);
  for(const cmd of commands.holdingCommands)expect(Object.values(fixture.env.MODBUS_BOARD1_HOLDING_REGISTERS)).toContain(cmd.address);
  const report=await service.executeModbusCommands(board,commands,schedule,{runId:'fake-run'});
  expect(report.steps.every(s=>s.ok)).toBe(true);
  expect(report.steps.flatMap(s=>s.keys).every(k=>k.status==='pass')).toBe(true);
  for(const cmd of commands.coilCommands)expect(board.writeCoil).toHaveBeenCalledWith(cmd.address,Boolean(cmd.value));
  for(const cmd of commands.holdingCommands)expect(board.writeRegister).toHaveBeenCalledWith(cmd.address,Number(cmd.value));
  expect(report.steps.map(s=>s.phase)).toContain('water_hammer_delay');
  expect(board.writeCoil.mock.calls.length+board.writeRegister.mock.calls.length).toBeGreaterThan(0);
  expect(board.readCoils.mock.calls.length+board.readHoldingRegisters.mock.calls.length).toBeGreaterThan(0);
  board.writeCoil.mockClear();
  await service.resetModbusCommands(board,commands.coilCommands,{...schedule,status:'finished'},true,{runId:'fake-finish'});
  expect(board.writeCoil.mock.calls.some((c:any[])=>c[1]===false)).toBe(true);
 });
 it('does not run on wrong weekday or when the plan is disabled',()=>{
  const {service}=setup();jest.setSystemTime(new Date('2026-11-23T22:51:00Z'));
  expect(service.isScheduleDue({...fixture.schedule})).toBe(false);
  jest.setSystemTime(new Date('2026-11-22T22:51:00Z'));
  expect(service.isScheduleDue({...fixture.schedule,schedulePlan:{enable:0,is_deleted:0}})).toBe(false);
 });
});
