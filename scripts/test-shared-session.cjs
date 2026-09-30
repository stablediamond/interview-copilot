const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const calls = [];
let upstreamStatus = 200;
let configured = true;
const exportsObj = {};
const source = ts.transpileModule(fs.readFileSync('src/app/api/calendar/shared-session/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(source, {exports:exportsObj,Request,Response,URL,AbortSignal,
 fetch:async (url,init)=>{calls.push({url,init});return Response.json(upstreamStatus===200?{messages:[],links:{},participants:[]}:{error:'Access revoked'},{status:upstreamStatus})},
 require(id){
  if(id==='@/lib/api')return {jsonOk:data=>Response.json({ok:true,data}),jsonError:(error,status)=>Response.json({ok:false,error},{status}),handleRouteError:()=>Response.json({ok:false},{status:500})};
  if(id==='@/lib/access')return {assertAccess:async()=>{}};
  if(id==='@/lib/job-track')return {getJobTrackUrl:()=> 'https://job.test',isJobTrackConfigured:()=>configured};
  throw Error(id);
 }});
(async()=>{
 const url='http://localhost:3000/api/calendar/shared-session?eventId=event-1';
 const headers={authorization:'Bearer valid','content-type':'application/json'};
 const got=await exportsObj.GET(new Request(url,{headers}));assert.equal(got.status,200);assert.equal((await got.json()).ok,true);
 const body=JSON.stringify({op:'message',clientId:'once',connectionId:'tab',after:0,kind:'chat',body:'Hello'});
 await exportsObj.POST(new Request(url,{method:'POST',headers,body}));
 assert.equal(calls[1].url,'https://job.test/api/event-sessions/event-1');
 assert.equal(calls[1].init.headers.Authorization,'Bearer valid');
 assert.equal(calls[1].init.body,body);
 upstreamStatus=403;assert.equal((await exportsObj.POST(new Request(url,{method:'POST',headers,body}))).status,403);
 upstreamStatus=409;assert.equal((await exportsObj.POST(new Request(url,{method:'POST',headers,body}))).status,409);
 assert.equal((await exportsObj.GET(new Request(url))).status,401);
 assert.equal((await exportsObj.GET(new Request('http://localhost:3000/api/calendar/shared-session',{headers}))).status,400);
 configured=false;assert.equal((await exportsObj.GET(new Request(url,{headers}))).status,401);
 console.log('Shared session proxy tests passed: context, auth forwarding, same-room messages, conflicts, revocation, and missing configuration.');
})().catch(error=>{console.error(error);process.exitCode=1});
