'use strict';

const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const main=fs.readFileSync(path.join(root,'GoogleAppsScript.gs'),'utf8');
const moduleSource=fs.readFileSync(path.join(root,'FacebookBumpModule.gs'),'utf8');
const frontend=fs.readFileSync(path.join(root,'app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'app.css'),'utf8');
const worker=fs.readFileSync(path.join(root,'facebook-worker','worker.js'),'utf8');
const recoverySource=fs.readFileSync(path.join(root,'facebook-worker','recovery.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const serviceWorker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const tests=[];
function test(name,fn){try{fn();tests.push({name,status:'PASS'});}catch(error){tests.push({name,status:'FAIL',error:error.stack||error.message});}}
function assert(value,message){if(!value)throw Error(message);}

let uuidCounter=0;
const context={console,Date,Map,Set,JSON,Math,String,Number,Boolean,Error,RegExp,Utilities:{getUuid:()=>`00000000-0000-4000-8000-${String(++uuidCounter).padStart(12,'0')}`,formatDate:()=>`20260817-1200${String(uuidCounter).padStart(2,'0')}`},Session:{getScriptTimeZone:()=> 'Asia/Bangkok'}};
vm.createContext(context);
new vm.Script(`${main}\n${moduleSource}\n;globalThis.__fb={facebookBumpNextRunAt,facebookBumpPlanDuePosts,facebookBumpSelectNextPending,facebookBumpCleanupCandidate,facebookBumpUrlValid,facebookBumpExecuteJob};`).runInContext(context);
const api=context.__fb;

function installMemoryStore(posts,queue,comments,history){
  context.__posts=posts;context.__queue=queue;context.__comments=comments;context.__history=history;
  vm.runInContext(`
    facebookBumpRows=(name)=>name===SHEETS.facebookBumpPosts?__posts:name===SHEETS.facebookBumpQueue?__queue:name===SHEETS.facebookOwnedComments?__comments:name===SHEETS.facebookBumpHistory?__history:[];
    facebookBumpWriteRow=(name,record)=>record;
    facebookBumpAppend=(name,record)=>{const list=name===SHEETS.facebookOwnedComments?__comments:name===SHEETS.facebookBumpQueue?__queue:__history;record._row=list.length+2;list.push(record);return record;};
    facebookBumpAppendHistory=(record)=>{__history.push({...record,createdAt:new Date()});};
    facebookBumpSettings=()=>({cleanupOld:true,delaySeconds:15,paused:false,dryRun:true});
    safeAdminError=(error)=>String(error&&error.message||error);
    makeId=(kind)=>kind+'-'+Utilities.getUuid();
  `,context);
}

const baseTime=new Date('2026-08-17T05:00:00.000Z');
const post=(id,offset=0)=>({id,name:`Post ${id}`,postUrl:`https://www.facebook.com/posts/${id}`,bumpMessage:'+',intervalMinutes:60,enabled:'TRUE',nextRunAt:new Date(baseTime.getTime()+offset),lastRunAt:'',lastStatus:'READY',createdAt:baseTime,updatedAt:baseTime,deletedAt:''});
const job=(id,targetPostId,offset=0,url)=>({jobId:id,targetPostId,postName:`Post ${targetPostId}`,postUrl:url||`https://www.facebook.com/posts/${targetPostId}`,message:'+',scheduledAt:new Date(baseTime.getTime()+offset),status:'PENDING',attempts:0,error:'',createdAt:baseTime,updatedAt:baseTime,source:'SCHEDULED'});

test('Pre-flight schema is additive and database version advances',()=>{
  ['FacebookBumpPosts','FacebookBumpQueue','FacebookBumpHistory','FacebookOwnedComments'].forEach(name=>assert(main.includes(name),`missing ${name}`));
  assert(main.includes("const DATABASE_VERSION='3.2.1'"),'database version is not 3.2.1');
  ['stockLogs','orders','customers','seals'].forEach(key=>assert(main.includes(`${key}:`),`protected schema missing ${key}`));
});

test('Test A — multiple due posts are ordered and processed one at a time',()=>{
  const posts=[post('A',0),post('B',1000),post('C',2000)],queue=[];
  const due=api.facebookBumpPlanDuePosts(posts,queue,new Date(baseTime.getTime()+5000));
  assert(due.map(item=>item.id).join(',')==='A,B,C','due order is wrong');
  due.forEach((item,index)=>queue.push(job(`J${index+1}`,item.id,index*1000)));
  const selected=[];while(queue.some(item=>item.status==='PENDING')){const next=api.facebookBumpSelectNextPending(queue,new Date(baseTime.getTime()+5000));selected.push(next.targetPostId);next.status='COMPLETED';}
  assert(selected.join(',')==='A,B,C','jobs did not process sequentially');
  assert(moduleSource.includes("facebookBumpNextJobAllowedAt"),'delay gate is missing');
});

test('Test B — hourly nextRunAt is persisted from successful run time',()=>{
  const next=api.facebookBumpNextRunAt(baseTime,60);
  assert(next.getTime()-baseTime.getTime()===3600000,'60 minute schedule is wrong');
});

test('Test C — new owned comment is recorded before previous owned comment cleanup',()=>{
  const posts=[post('A')],queue=[job('J1','A')],comments=[],history=[];installMemoryStore(posts,queue,comments,history);
  api.facebookBumpExecuteJob(queue[0],undefined,baseTime);
  const first=comments.find(item=>item.status==='ACTIVE');assert(first,'first owned comment missing');
  const secondJob=job('J2','A',60000);queue.push(secondJob);api.facebookBumpExecuteJob(secondJob,undefined,new Date(baseTime.getTime()+60000));
  const active=comments.filter(item=>item.status==='ACTIVE'),deleted=comments.filter(item=>item.status==='DELETED_SIMULATED');
  assert(active.length===1&&deleted.length===1,'owned cleanup state is wrong');
  assert(active[0].externalCommentId!==deleted[0].externalCommentId,'new comment was cleaned up');
});

test('Test D — failed new comment keeps previous owned comment',()=>{
  const posts=[post('A')],queue=[job('J1','A')],comments=[{id:'C1',targetPostId:'A',externalCommentId:'OLD-A',message:'+',createdAt:baseTime,deletedAt:'',status:'ACTIVE'}],history=[];installMemoryStore(posts,queue,comments,history);
  context.__failureExecutor={execute:()=>({ok:false,error:'SIMULATED_FAILURE'})};
  context.__failedJob=queue[0];context.__failedAt=new Date(baseTime.getTime()+120000);
  vm.runInContext(`facebookBumpExecuteJob(__failedJob,__failureExecutor,__failedAt)`,context);
  assert(queue[0].status==='FAILED','failed job not marked FAILED');
  assert(comments[0].status==='ACTIVE'&&!comments[0].deletedAt,'previous comment was removed on failure');
  assert(history[0].result==='FAILED'&&history[0].cleanupResult==='NOT_RUN','failure history is wrong');
});

test('Test E — URL edits do not corrupt historical URL snapshots',()=>{
  const posts=[post('A')],queue=[job('J1','A',0,'https://www.facebook.com/posts/old')],comments=[],history=[];installMemoryStore(posts,queue,comments,history);
  api.facebookBumpExecuteJob(queue[0],undefined,baseTime);posts[0].postUrl='https://www.facebook.com/posts/new';
  const second=job('J2','A',60000,posts[0].postUrl);queue.push(second);api.facebookBumpExecuteJob(second,undefined,new Date(baseTime.getTime()+60000));
  assert(history[0].postUrl.endsWith('/old')&&history[1].postUrl.endsWith('/new'),'URL snapshots were overwritten');
});

test('Test F — paused post is not executed',()=>{
  const posts=[{...post('A'),enabled:'FALSE'}],queue=[job('J1','A')],comments=[],history=[];installMemoryStore(posts,queue,comments,history);
  api.facebookBumpExecuteJob(queue[0],undefined,baseTime);
  assert(queue[0].status==='CANCELLED'&&comments.length===0,'paused post executed');
});

test('Test G — persisted active job prevents duplicate after restart',()=>{
  const posts=[post('A')],persistedQueue=[job('J1','A')];
  const restored=JSON.parse(JSON.stringify(persistedQueue));
  assert(api.facebookBumpPlanDuePosts(posts,restored,new Date(baseTime.getTime()+1000)).length===0,'restart created duplicate job');
});

test('Test H — manual bump routes through the shared queue',()=>{
  assert(moduleSource.includes("facebookBumpCreateJob(post,'MANUAL'"),'manual bump bypasses queue');
  assert(!/UrlFetchApp|playwright|selenium|document\.cookie/i.test(moduleSource),'real Facebook/browser integration found');
});

test('Queue mutations preserve one physical row and literal messages',()=>{
  assert(moduleSource.includes('record._row=s.getLastRow()'),'new queue rows do not retain their sheet row');
  assert(moduleSource.includes("typeof value==='string'?safeSheetText(value,5000):value"),'module writes do not protect literal text');
  assert(moduleSource.includes('facebookBumpRepairLiteralErrors'),'literal formula-error recovery is missing');
});

test('Permissions, safe Dry Run default and Real mode guard are present',()=>{
  assert(main.includes("'saveFacebookBumpPost'")&&main.includes("requireRole(body.token,['OWNER','ADMIN'])"),'server role guard missing');
  assert(main.includes("facebookBumpMode:'DRY_RUN'")&&moduleSource.includes("input.realConfirmed||''")&&moduleSource.includes("'ENABLE_REAL_FACEBOOK'"),'safe Real mode guard missing');
  ['claimFacebookBumpJob','completeFacebookBumpJob','failFacebookBumpJob'].forEach(name=>assert(main.includes(`case'${name}'`)&&moduleSource.includes(`function ${name}`),`worker action missing ${name}`));
  ['ดันโพสต์ Facebook','data-fb-now','data-fb-cancel-job','data-fb-retry-job','Delay Between Jobs'].forEach(text=>assert(frontend.includes(text),`UI missing ${text}`));
  assert(css.includes('.facebook-bump-module'),'module CSS missing');
});

test('Facebook action UX gives immediate feedback and blocks duplicate clicks',()=>{
  ['กำลังเชื่อมต่อ...','กำลังทดสอบ...','กำลังส่งงาน...','กำลังบันทึก...','กำลังเปิด Scheduler...','กำลังปิด Scheduler...'].forEach(text=>assert(frontend.includes(text),`loading feedback missing ${text}`));
  assert(frontend.includes("if(state.facebookBump.pending)return null")&&frontend.includes("if (state.facebookBump.pending) return;"),'duplicate click guard missing');
  assert(frontend.includes('facebookDisabled()')&&css.includes('button:disabled'),'disabled action styling missing');
  assert(moduleSource.includes('โพสต์นี้มีงานรออยู่แล้ว'),'duplicate queue message is unclear');
  ['Worker ${html(worker)}','Browser ${html(browser)}','Facebook ${html(status)}','PENDING ${queueCounts.PENDING}','PROCESSING ${queueCounts.PROCESSING}','COMPLETED ${queueCounts.COMPLETED}'].forEach(text=>assert(frontend.includes(text),`visible status missing ${text}`));
});

test('Worker uses one persistent browser and can focus an existing window',()=>{
  assert(worker.includes("launchPersistentContext(PROFILE_DIR"),'persistent browser profile missing');
  assert(worker.includes('if (!browserLaunchPromise)')&&worker.includes('await browserLaunchPromise'),'worker can open duplicate browser contexts');
  assert(worker.includes("args: ['--start-minimized']"),'worker browser does not start minimized');
  assert(worker.includes('if (focus) await page.bringToFront()'),'background polling can steal focus from other apps');
  assert(worker.includes("openFacebookPage(FACEBOOK_HOME,{focus:true})")&&worker.includes("ensureBrowser({ force: true, focus: true })"),'explicit browser actions cannot focus the worker window');
  assert(worker.includes("worker: 'ONLINE'")&&worker.includes("browser: browserRunning ? 'RUNNING' : 'STOPPED'"),'worker/browser status missing');
  assert(worker.includes('BACKEND_TIMEOUT_MS')&&worker.includes('AbortController'),'stalled backend request recovery missing');
  assert(worker.includes('loopbackOrigin')&&worker.includes('127\\.0\\.0\\.1|localhost'),'TEST localhost ports are blocked by CORS');
  assert(frontend.includes("targetAddressSpace:'local'"),'Production fetch does not request local-network access');
  assert(worker.includes("Access-Control-Allow-Private-Network', 'true'"),'worker does not approve private-network preflight');
  assert(index.includes('app.js?v=20260904-v20.2-pause-recovery-1')&&serviceWorker.includes('app.js?v=20260904-v20.2-pause-recovery-1'),'PWA cache does not refresh the pause recovery fix');
  assert(frontend.includes('id="fbPauseAllBtn" ${state.facebookBump.pending?\'disabled\':\'\'}')&&frontend.includes('id="fbResumeAllBtn" ${state.facebookBump.pending?\'disabled\':\'\'}'),'stale admin state can lock out pause/resume recovery');
  assert(frontend.includes('facebookPairViaLocalTab')&&frontend.includes("event.data?.type!=='DMO_FACEBOOK_PAIR_RESULT'"),'BackOffice local pair bridge is missing');
  assert(worker.includes("req.url === '/pair-browser'")&&worker.includes('pairBridgeResponse'),'worker local pair bridge is missing');
  assert(worker.includes("if(current.connection!=='CONNECTED')current=await openFacebookPage"),'pair bridge needlessly reloads an already connected Facebook session');
  assert(worker.includes("req.url === '/pair-browser' && origin === 'null'")&&worker.includes('!localPairNavigation'),'null origin is not narrowly limited to the local pair form');
});
test('Worker crash recovery is bounded and stale real jobs fail closed',()=>{
  assert(worker.includes('browserLaunchPromise')&&worker.includes('RecoveryBackoff'),'bounded browser recovery missing');
  assert(worker.includes("if (connection === 'INVALID')")&&worker.includes('openFacebookPage(FACEBOOK_HOME)'),'recovered browser stays on an invalid blank page');
  assert(worker.includes('maintainBrowser')&&worker.includes('browserAutoRecoveryEnabled'),'browser health recovery depends on an open BackOffice page');
  assert(recoverySource.includes('BROWSER_CLOSED_NEEDS_REVIEW'),'browser crash is not fail-closed');
  assert(moduleSource.includes('WORKER_LEASE_EXPIRED_NEEDS_REVIEW'),'stale real job can be retried blindly');
  assert(moduleSource.includes("if(/NEEDS_REVIEW/.test(String(job.error||'')))"),'unsafe retry guard missing');
  assert(frontend.includes('recoverFacebookWorkerPair'),'BackOffice pair recovery missing');
});

test('Scheduler can be opened or closed with server-side permission checks',()=>{
  assert(main.includes("case'disableFacebookBumpTrigger'")&&main.includes("'disableFacebookBumpTrigger'"),'disable scheduler API missing');
  assert(moduleSource.includes('function disableFacebookBumpTriggerAction')&&moduleSource.includes("requireRole(body.token,['OWNER','ADMIN'])"),'disable scheduler permission guard missing');
  assert(frontend.includes("active?'disableFacebookBumpTrigger':'ensureFacebookBumpTrigger'"),'scheduler toggle UI missing');
});

test('Protected systems remain present',()=>{
  ['createOrder','applyInventoryTransition','updateOrder','recalculateCustomerStats','publicProduct'].forEach(name=>assert(main.includes(`function ${name}`),`protected function ${name} missing`));
  assert(!moduleSource.includes('SHEETS.orders')&&!moduleSource.includes('SHEETS.stockLogs')&&!moduleSource.includes('SHEETS.customers')&&!moduleSource.includes('SHEETS.seals'),'module touches protected sheets');
});

tests.forEach(item=>console.log(`${item.status} ${item.name}${item.error?` — ${item.error}`:''}`));
const failed=tests.filter(item=>item.status==='FAIL');
console.log(`TOTAL ${tests.length} | PASS ${tests.length-failed.length} | FAIL ${failed.length}`);
if(failed.length)process.exitCode=1;
