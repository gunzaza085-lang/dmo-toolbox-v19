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
const facebookPage=fs.readFileSync(path.join(root,'facebook-worker','facebook-page.js'),'utf8');
const recoverySource=fs.readFileSync(path.join(root,'facebook-worker','recovery.js'),'utf8');
const backendClientSource=fs.readFileSync(path.join(root,'facebook-worker','backend-client.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const serviceWorker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const tests=[];
function test(name,fn){try{fn();tests.push({name,status:'PASS'});}catch(error){tests.push({name,status:'FAIL',error:error.stack||error.message});}}
function assert(value,message){if(!value)throw Error(message);}

let uuidCounter=0;
const context={console,Date,Map,Set,JSON,Math,String,Number,Boolean,Error,RegExp,Utilities:{getUuid:()=>`00000000-0000-4000-8000-${String(++uuidCounter).padStart(12,'0')}`,formatDate:()=>`20260817-1200${String(uuidCounter).padStart(2,'0')}`},Session:{getScriptTimeZone:()=> 'Asia/Bangkok'}};
vm.createContext(context);
new vm.Script(`${main}\n${moduleSource}\n;globalThis.__fb={facebookBumpNextRunAt,facebookBumpNextCadenceAt,facebookBumpExpired,facebookBumpPlanDuePosts,facebookBumpSelectNextPending,facebookBumpCleanupCandidate,facebookBumpCommentKey,facebookBumpKnownCommentIds,facebookBumpRealCommentReferenceValid,facebookBumpUrlValid,facebookBumpSettings,facebookBumpPauseNeedsReview,facebookBumpRecoverStaleJobs,facebookBumpExpirePosts,facebookBumpExecuteJob,claimFacebookBumpJob,renewFacebookBumpJobLease,completeFacebookBumpJob,failFacebookBumpJob};`).runInContext(context);
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
    log=()=>{};
  `,context);
}

const baseTime=new Date('2026-08-17T05:00:00.000Z');
const post=(id,offset=0)=>({id,name:`Post ${id}`,postUrl:`https://www.facebook.com/posts/${id}`,bumpMessage:'+',intervalMinutes:60,enabled:'TRUE',nextRunAt:new Date(baseTime.getTime()+offset),lastRunAt:'',lastStatus:'READY',createdAt:baseTime,updatedAt:baseTime,deletedAt:''});
const job=(id,targetPostId,offset=0,url)=>({jobId:id,targetPostId,postName:`Post ${targetPostId}`,postUrl:url||`https://www.facebook.com/posts/${targetPostId}`,message:'+',scheduledAt:new Date(baseTime.getTime()+offset),status:'PENDING',attempts:0,error:'',createdAt:baseTime,updatedAt:baseTime,source:'SCHEDULED'});

test('Pre-flight schema is additive and database version advances',()=>{
  ['FacebookBumpPosts','FacebookBumpQueue','FacebookBumpHistory','FacebookOwnedComments','FacebookBumpTelemetry'].forEach(name=>assert(main.includes(name),`missing ${name}`));
  assert(main.includes("const DATABASE_VERSION='3.3.2'"),'database version is not 3.3.2');
  ['runDurationHours','runStartedAt','runUntil'].forEach(header=>assert(main.includes(header),`duration schema missing ${header}`));
  assert(main.includes("facebookBumpPaused:'TRUE'")&&moduleSource.includes("value('facebookBumpPaused',true)"),'Facebook module is not safe-paused by default');
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

test('Test B — cadence stays anchored and does not drift with worker latency',()=>{
  const next=api.facebookBumpNextRunAt(baseTime,60);
  assert(next.getTime()-baseTime.getTime()===3600000,'60 minute schedule is wrong');
  const due=new Date(baseTime.getTime()+30*60000),completed=new Date(due.getTime()+95000),nextCadence=api.facebookBumpNextCadenceAt(due,30,completed);
  assert(nextCadence.getTime()===due.getTime()+30*60000,'worker latency shifted the next cadence');
  assert(moduleSource.includes('!intervalChanged&&facebookBumpDateValue(existing.nextRunAt)>Date.now()'),'interval edits preserve an obsolete next run');
});

test('Duplicate Settings rows cannot override the first canonical safety value',()=>{
  const settings=api.facebookBumpSettings([
    {key:'facebookBumpPaused',value:'TRUE'},
    {key:'facebookBumpPaused',value:'FALSE'},
    {key:'facebookBumpMode',value:'DRY_RUN'},
    {key:'facebookBumpMode',value:'REAL'}
  ]);
  assert(settings.paused===true&&settings.mode==='DRY_RUN','later duplicate Settings rows overrode safe canonical values');
});

test('Fast Settings reads preserve native Boolean safety flags',()=>{
  const settings=api.facebookBumpSettings([
    {key:'facebookBumpPaused',value:true},
    {key:'facebookBumpCleanupOld',value:true},
    {key:'facebookBumpMode',value:'DRY_RUN'}
  ]);
  assert(settings.paused===true&&settings.cleanupOld===true,'native Boolean TRUE was coerced to a number');
});

test('Google Sheets numeric checkbox values preserve safety flags',()=>{
  const settings=api.facebookBumpSettings([
    {key:'facebookBumpPaused',value:1},
    {key:'facebookBumpCleanupOld',value:1},
    {key:'facebookBumpMode',value:'DRY_RUN'}
  ]);
  assert(settings.paused===true&&settings.cleanupOld===true,'numeric checkbox TRUE was treated as disabled');
});

test('Admin status reads safety settings through display values',()=>{
  const start=moduleSource.indexOf('function getFacebookBumpData');
  const end=moduleSource.indexOf('function queueFacebookWorkerCommand',start);
  const source=moduleSource.slice(start,end);
  assert(source.includes('settings=facebookBumpSettings()'),'Admin status bypasses the canonical display-value settings reader');
  assert(!source.includes('facebookBumpSettings(facebookBumpReadRowsFast(SHEETS.settings))'),'Admin status still uses the lossy fast Settings reader');
});

test('Long-duration schedule stays exact for one month and stops before runUntil',()=>{
  const start=new Date('2026-09-01T00:00:00.000Z'),runUntil=new Date(start.getTime()+30*24*3600000),scheduled=new Date(start.getTime()+30*60000),postRecord={...post('MONTH'),runUntil,intervalMinutes:30,nextRunAt:scheduled};
  let due=scheduled,count=0;
  while(due<runUntil){count++;const completed=new Date(due.getTime()+95000);due=api.facebookBumpNextCadenceAt(due,30,completed);}
  assert(count===1439,'30-day cadence count is wrong');
  assert(due.getTime()===runUntil.getTime(),'30-day cadence drifted');
  assert(api.facebookBumpExpired(postRecord,new Date(runUntil.getTime()-1))===false,'post expired early');
  assert(api.facebookBumpExpired(postRecord,runUntil)===true,'post did not expire at runUntil');
  assert(api.facebookBumpPlanDuePosts([{...postRecord,nextRunAt:runUntil}],[],runUntil).length===0,'expiry boundary queued an extra bump');
});

test('Expiry and uncertain outcomes cancel only pending work for the affected post',()=>{
  const expiredAt=new Date(baseTime.getTime()-1),posts=[{...post('A'),runUntil:expiredAt},{...post('B'),runUntil:''}],queue=[job('A-PENDING','A'),{...job('A-ACTIVE','A'),status:'PROCESSING'},job('B-PENDING','B')],comments=[],history=[];
  installMemoryStore(posts,queue,comments,history);
  const expired=api.facebookBumpExpirePosts(posts,queue,baseTime);
  assert(expired.join(',')==='A','wrong post expired');
  assert(posts[0].enabled==='FALSE'&&posts[0].lastStatus==='AUTO_PAUSED_EXPIRED','expired post was not paused');
  assert(queue[0].status==='CANCELLED'&&queue[1].status==='PROCESSING'&&queue[2].status==='PENDING','expiry cancelled the wrong queue work');
  api.facebookBumpPauseNeedsReview(posts[1],queue,baseTime);
  assert(posts[1].enabled==='FALSE'&&posts[1].lastStatus==='NEEDS_REVIEW','uncertain post was not fail-closed');
  assert(queue[2].status==='CANCELLED','uncertain post left pending work behind');
});

test('Stuck real queue leases fail closed without cancelling unrelated posts',()=>{
  const posts=[post('A'),post('B')],queue=[{...job('A-STALE','A'),status:'PROCESSING',source:'REAL_WORKER:PC2',updatedAt:new Date(baseTime.getTime()-301000)},job('A-PENDING','A'),job('B-PENDING','B')],comments=[],history=[];
  installMemoryStore(posts,queue,comments,history);
  const recovered=api.facebookBumpRecoverStaleJobs(queue,posts,baseTime);
  assert(recovered.join(',')==='A-STALE','stale lease was not recovered');
  assert(queue[0].status==='FAILED'&&queue[0].error==='WORKER_LEASE_EXPIRED_NEEDS_REVIEW','stale lease did not fail closed');
  assert(posts[0].enabled==='FALSE'&&queue[1].status==='CANCELLED','affected post can still create a duplicate');
  assert(posts[1].enabled==='TRUE'&&queue[2].status==='PENDING','unrelated post was changed');
  assert(history[0].action==='RECOVER_STALE_REAL_JOB','stale recovery audit history missing');
});

test('Renewed real queue leases are not falsely recovered',()=>{
  const posts=[post('A')],queue=[{...job('A-LIVE','A'),status:'PROCESSING',source:'REAL_WORKER:FACEBOOK_WORKER:PC2',updatedAt:new Date(baseTime.getTime()-600000),leaseToken:'lease-live',leaseExpiresAt:new Date(baseTime.getTime()+60000)}],comments=[],history=[];
  installMemoryStore(posts,queue,comments,history);
  assert(api.facebookBumpRecoverStaleJobs(queue,posts,baseTime).length===0,'renewed lease was recovered as stale');
  assert(queue[0].status==='PROCESSING'&&posts[0].enabled==='TRUE','renewed job was changed');
  assert(moduleSource.includes('function renewFacebookBumpJobLease')&&worker.includes("action: 'renewFacebookBumpJobLease'"),'renewable lease path is missing');
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
  assert(moduleSource.includes('Object.prototype.hasOwnProperty.call(values,key)')&&moduleSource.includes('if(matched)return'),'duplicate Settings keys can override safety controls');
});

test('REAL queue records the new owned comment before idempotent cleanup',()=>{
  const oldComment='https://www.facebook.com/groups/1/posts/2/?comment_id=8999',posts=[post('REAL')],queue=[job('REAL-J1','REAL')],comments=[{id:'REAL-OLD',targetPostId:'REAL',externalCommentId:oldComment,message:'+',createdAt:new Date(baseTime.getTime()-60000),deletedAt:'',status:'ACTIVE'}],history=[];installMemoryStore(posts,queue,comments,history);
  vm.runInContext(`
    withLock=(fn)=>fn();
    output=(value)=>value;
    facebookBumpStoreWorkerStatus=(input)=>input;
    facebookBumpClaimWorkerCommand=()=>null;
    facebookBumpSetSetting=()=>{};
    facebookBumpSettings=()=>({cleanupOld:true,delaySeconds:15,paused:false,mode:'REAL',nextJobAllowedAt:''});
  `,context);
  const actor={userId:'FACEBOOK_WORKER:PC2',role:'WORKER'};
  const claimed=api.claimFacebookBumpJob({workerStatus:{connection:'CONNECTED'}},actor);
  assert(claimed.job&&queue[0].status==='PROCESSING'&&queue[0].attempts===1,'PENDING did not transition to PROCESSING exactly once');
  const leaseToken=claimed.job.leaseToken;
  const commentUrl='https://www.facebook.com/groups/1/posts/2/?comment_id=9001';
  const completed=api.completeFacebookBumpJob({jobId:'REAL-J1',leaseToken,externalCommentId:commentUrl,message:'+',cleanupResult:'PENDING',verificationMethod:'TEST'},actor);
  assert(completed.ok&&queue[0].status==='COMPLETED','PROCESSING did not transition to COMPLETED');
  assert(comments.length===2&&comments[1].externalCommentId===commentUrl&&comments[1].status==='ACTIVE'&&comments[0].status==='ACTIVE','verified owned comment was not recorded before cleanup');
  assert(history.length===1&&history[0].result==='COMPLETED'&&history[0].commentId===commentUrl&&history[0].cleanupResult==='PENDING','REAL completion history is incomplete');
  const finalized=api.completeFacebookBumpJob({jobId:'REAL-J1',leaseToken,externalCommentId:commentUrl,cleanupResult:'DELETED',previousCommentId:oldComment},actor);
  assert(finalized.idempotent===true&&finalized.cleanupUpdated===true&&comments[0].status==='DELETED'&&history[0].cleanupResult==='DELETED','verified cleanup was not finalized idempotently');
  const repeated=api.completeFacebookBumpJob({jobId:'REAL-J1',leaseToken,externalCommentId:commentUrl,cleanupResult:'DELETED',previousCommentId:oldComment},actor);
  assert(repeated.idempotent===true&&comments.length===2&&history.length===1,'repeated completion duplicated audit or ownership records');

  posts.push(post('BAD'));queue.push(job('BAD-J1','BAD'));
  const badClaim=api.claimFacebookBumpJob({workerStatus:{connection:'CONNECTED'}},actor);
  let invalidReferenceRejected=false;try{api.completeFacebookBumpJob({jobId:'BAD-J1',leaseToken:badClaim.job.leaseToken,externalCommentId:'UNVERIFIED-temp'},actor);}catch(error){invalidReferenceRejected=/COMMENT_REFERENCE_INVALID_NEEDS_REVIEW/.test(String(error&&error.message||error));}
  assert(invalidReferenceRejected,'unverified reference was accepted as a REAL completion');
  api.failFacebookBumpJob({jobId:'BAD-J1',leaseToken:badClaim.job.leaseToken,error:'COMMENT_REFERENCE_INVALID_NEEDS_REVIEW',externalCommentId:'UNVERIFIED-temp'},actor);
  assert(queue[1].status==='FAILED'&&posts[1].enabled==='FALSE'&&posts[1].lastStatus==='NEEDS_REVIEW','unverified completion did not fail closed');
});

test('Duplicate comment IDs fail closed and late verified results reconcile once',()=>{
  const actor={userId:'FACEBOOK_WORKER:PC2',role:'WORKER'},existingUrl='https://www.facebook.com/groups/1/posts/2/?comment_id=7001';
  const posts=[post('DUP')],queue=[{...job('DUP-J1','DUP'),status:'PROCESSING',source:'REAL_WORKER:FACEBOOK_WORKER:PC2',leaseToken:'lease-dup'}],comments=[{id:'REAL-OLD',targetPostId:'DUP',externalCommentId:existingUrl,message:'+',createdAt:baseTime,deletedAt:'',status:'ACTIVE',commentKey:'7001',jobId:'OLD'}],history=[];
  installMemoryStore(posts,queue,comments,history);
  let duplicateRejected=false;try{api.completeFacebookBumpJob({jobId:'DUP-J1',leaseToken:'lease-dup',externalCommentId:`${existingUrl}&tracking=new`},actor);}catch(error){duplicateRejected=/COMMENT_ID_ALREADY_OWNED_NEEDS_REVIEW/.test(String(error));}
  assert(duplicateRejected&&queue[0].status==='PROCESSING'&&comments.length===1&&history.length===0,'duplicate comment ID produced a false completion');

  const latePost=post('LATE');latePost.enabled='FALSE';latePost.lastStatus='NEEDS_REVIEW';posts.push(latePost);
  queue.push({...job('LATE-J1','LATE'),status:'FAILED',source:'REAL_WORKER:FACEBOOK_WORKER:PC2',leaseToken:'lease-late',error:'WORKER_LEASE_EXPIRED_NEEDS_REVIEW'});
  const lateUrl='https://www.facebook.com/groups/1/posts/3/?comment_id=7002';
  const reconciled=api.completeFacebookBumpJob({jobId:'LATE-J1',leaseToken:'lease-late',externalCommentId:lateUrl,message:'+',cleanupResult:'SKIPPED',verificationMethod:'JOURNAL_REPLAY',reconcile:true},actor);
  assert(reconciled.reconciled===true&&queue[1].status==='COMPLETED','late verified result was not reconciled');
  assert(latePost.enabled==='FALSE'&&latePost.lastStatus==='RECONCILED_SUCCESS_PAUSED','late reconcile resumed scheduling automatically');
  const again=api.completeFacebookBumpJob({jobId:'LATE-J1',leaseToken:'lease-late',externalCommentId:lateUrl,cleanupResult:'SKIPPED'},actor);
  assert(again.idempotent===true&&comments.filter(item=>item.jobId==='LATE-J1').length===1,'repeated reconciled result duplicated ownership');
});

test('Permissions, safe Dry Run default and Real mode guard are present',()=>{
  assert(main.includes("'saveFacebookBumpPost'")&&main.includes("requireRole(body.token,['OWNER','ADMIN'])"),'server role guard missing');
  assert(main.includes("facebookBumpMode:'DRY_RUN'")&&moduleSource.includes("input.realConfirmed||''")&&moduleSource.includes("'ENABLE_REAL_FACEBOOK'"),'safe Real mode guard missing');
  ['claimFacebookBumpJob','completeFacebookBumpJob','failFacebookBumpJob'].forEach(name=>assert(main.includes(`'${name}'`)&&main.includes(`return ${name}(body,workerActor)`)&&moduleSource.includes(`function ${name}`),`worker action missing ${name}`));
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
  assert(worker.includes('acquireInstanceLock(INSTANCE_LOCK_FILE)'),'worker process has no profile-level single-instance lock');
  assert(worker.includes("args: ['--start-minimized']"),'worker browser does not start minimized');
  assert(worker.includes('if (focus) await page.bringToFront()'),'background polling can steal focus from other apps');
  assert(worker.includes("openFacebookPage(FACEBOOK_HOME,{focus:true})")&&worker.includes("ensureBrowser({ force: true, focus: true })"),'explicit browser actions cannot focus the worker window');
  assert(worker.includes("worker: 'ONLINE'")&&worker.includes("browser: browserRunning ? 'RUNNING' : 'STOPPED'"),'worker/browser status missing');
  assert(worker.includes('BACKEND_TIMEOUT_MS')&&backendClientSource.includes('AbortController'),'stalled backend request recovery missing');
  assert(worker.includes("DEFAULT_ALLOWED_ORIGINS = ['https://gunzaza085-lang.github.io', 'https://shop-dmo.github.io']")&&worker.includes('WORKER_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join')&&!worker.includes('loopbackOrigin'),'worker CORS trusts an unexpected origin by default');
  assert(worker.includes("if (!origin && req.method !== 'GET') return false"),'unauthenticated no-origin POST requests are still accepted');
  assert(worker.includes("req.url === '/open')")&&worker.includes('openFacebookPage(FACEBOOK_HOME,{focus:true})')&&!worker.includes('openFacebookPage(body.url || FACEBOOK_HOME'),'local open endpoint can navigate the Facebook profile to an arbitrary origin');
  assert(frontend.includes("targetAddressSpace:'local'"),'Production fetch does not request local-network access');
  assert(worker.includes("Access-Control-Allow-Private-Network', 'true'"),'worker does not approve private-network preflight');
  assert(index.includes('app.js?v=20260910-v20.2-admin-shell-performance-4')&&serviceWorker.includes('app.js?v=20260910-v20.2-admin-shell-performance-4'),'PWA cache does not include the combined admin shell/performance build');
  assert(frontend.includes('id="fbPauseAllBtn" ${state.facebookBump.pending?\'disabled\':\'\'}')&&frontend.includes('id="fbResumeAllBtn" ${state.facebookBump.pending?\'disabled\':\'\'}'),'stale admin state can lock out pause/resume recovery');
  assert(frontend.includes('facebookPairViaLocalTab')&&frontend.includes("event.data?.type!=='DMO_FACEBOOK_PAIR_RESULT'"),'BackOffice local pair bridge is missing');
  assert(worker.includes("req.url === '/pair-browser'")&&worker.includes('pairBridgeResponse'),'worker local pair bridge is missing');
  assert(worker.includes("DEFAULT_ALLOWED_ORIGINS = ['https://gunzaza085-lang.github.io', 'https://shop-dmo.github.io']")&&frontend.includes("['appOrigin',location.origin]")&&worker.includes('ALLOWED_ORIGINS.has(appOrigin)'),'old/new GitHub Pages origins are not safely validated by the pair bridge');
  assert(worker.includes("if(current.connection!=='CONNECTED')current=await openFacebookPage"),'pair bridge needlessly reloads an already connected Facebook session');
  assert(worker.includes("req.url === '/pair-browser' && origin === 'null'")&&worker.includes('!localPairNavigation'),'null origin is not narrowly limited to the local pair form');
});

test('Cleanup retries the oldest verified orphan without touching unverified ownership',()=>{
  const comments=[
    {targetPostId:'A',externalCommentId:'UNVERIFIED-old',createdAt:new Date(baseTime.getTime()-3000),status:'ACTIVE',deletedAt:''},
    {targetPostId:'A',externalCommentId:'https://www.facebook.com/groups/1/posts/2/?comment_id=100',createdAt:new Date(baseTime.getTime()-2000),status:'ACTIVE',deletedAt:''},
    {targetPostId:'A',externalCommentId:'https://www.facebook.com/groups/1/posts/2/?comment_id=101',createdAt:new Date(baseTime.getTime()-1000),status:'ACTIVE',deletedAt:''}
  ];
  assert(api.facebookBumpCleanupCandidate(comments,'A','').externalCommentId.endsWith('comment_id=100'),'cleanup did not retry the oldest verified orphan');
  assert(api.facebookBumpRealCommentReferenceValid('https://www.facebook.com/groups/1/posts/2/?comment_id=123'),'valid real comment reference was rejected');
  assert(!api.facebookBumpRealCommentReferenceValid('DRY-test')&&!api.facebookBumpRealCommentReferenceValid('https://www.facebook.com/groups/1/posts/2/?comment_id=client%3Atemp'),'unverified reference can complete a real job');
});

test('Deleted posts disappear from the visible bump history without erasing audit rows',()=>{
  assert(moduleSource.includes('visiblePostIds=new Set(posts.map'),'active post visibility set is missing');
  assert(moduleSource.includes('.filter(item=>visiblePostIds.has(String(item.targetPostId)))'),'deleted post history remains visible');
  const deletePostSource=moduleSource.slice(moduleSource.indexOf('function deleteFacebookBumpPost'),moduleSource.indexOf('function toggleFacebookBumpPost'));
  assert(!deletePostSource.includes('SHEETS.facebookBumpHistory'),'history rows should be hidden on read, not deleted');
  assert(deletePostSource.includes("String(job.status)==='PROCESSING'")&&deletePostSource.includes('กรุณารอให้งานจบหรือ Pause ก่อนลบ'),'a post can be deleted while its real comment is in flight');
});
test('Remote BackOffice status and commands route through the paired worker',()=>{
  assert(main.includes("case'queueFacebookWorkerCommand'")&&moduleSource.includes('function queueFacebookWorkerCommand'),'remote worker command queue is missing');
  assert(main.includes("'completeFacebookWorkerCommand'")&&main.includes('return completeFacebookWorkerCommand(body,workerActor)')&&moduleSource.includes('function completeFacebookWorkerCommand'),'remote worker command completion is missing');
  assert(moduleSource.includes('FACEBOOK_WORKER_HEARTBEAT_TTL_MS')&&moduleSource.includes('workerStatus:facebookBumpWorkerStatus()'),'remote worker heartbeat status missing');
  assert(worker.includes("workerStatus: publicStatus(connection)")&&worker.includes('executeRemoteCommand'),'paired worker does not poll remote commands');
  assert(main.includes("'reportFacebookWorkerStatus'")&&moduleSource.includes('function reportFacebookWorkerStatus')&&worker.includes("action: 'reportFacebookWorkerStatus'"),'worker heartbeat can falsely report OFFLINE during browser recovery');
  assert(worker.includes('reportRemoteHeartbeat(true)')&&worker.includes('lastStatusReportAt'),'long-running or failed browser recovery loses its remote heartbeat');
  assert(frontend.includes("transport:'REMOTE'")&&frontend.includes('queueFacebookWorkerCommand'),'BackOffice does not fall back to remote worker control');
  assert(frontend.includes("facebookWorkerRequest('/status',undefined,2500)"),'unreachable localhost can still block module loading');
  assert(frontend.includes("connection?.transport==='REMOTE'"),'remote worker buttons are not routed through the backend');
  assert(main.includes('facebookWorkerActions')&&moduleSource.includes('facebookBumpRequireWorker'),'worker calls still depend on an expiring admin session');
  assert(worker.includes('PAIRING_FILE')&&worker.includes('pairingStore.load()')&&worker.includes('pairingStore.persist(next)'),'worker pairing does not survive restart');
  assert(worker.includes('/WORKER_PAIR_REQUIRED/.test')&&worker.includes('pairingStore.forget()'),'revoked or obsolete pairing cannot recover through BackOffice');
});
test('Worker crash recovery is bounded and stale real jobs fail closed',()=>{
  assert(worker.includes('browserLaunchPromise')&&worker.includes('RecoveryBackoff'),'bounded browser recovery missing');
  assert(worker.includes("if (connection === 'INVALID')")&&worker.includes('openFacebookPage(FACEBOOK_HOME)'),'recovered browser stays on an invalid blank page');
  assert(worker.includes('maintainBrowser')&&worker.includes('browserAutoRecoveryEnabled'),'browser health recovery depends on an open BackOffice page');
  assert(recoverySource.includes('BROWSER_CLOSED_NEEDS_REVIEW'),'browser crash is not fail-closed');
  assert(moduleSource.includes('WORKER_LEASE_EXPIRED_NEEDS_REVIEW'),'stale real job can be retried blindly');
  assert(moduleSource.includes('facebookBumpRecoverStaleJobs(queue,posts,now)'),'stale real job recovery is not called');
  const claimSource=moduleSource.slice(moduleSource.indexOf('function claimFacebookBumpJob'),moduleSource.indexOf('function completeFacebookBumpJob'));
  assert(moduleSource.includes('FACEBOOK_BUMP_IDLE_CLAIM_AUDIT_SECONDS=300')&&claimSource.includes('if(idleReason&&!facebookBumpIdleClaimAuditDue())'),'idle polling no longer bounds the stale-job safety audit');
  assert(claimSource.indexOf('facebookBumpRecoverStaleJobs(queue,posts,now)')<claimSource.indexOf('if(idleReason){facebookBumpMarkIdleClaimAudit();return output'),'stale jobs stay stuck while Facebook is disconnected or globally paused');
  assert(claimSource.indexOf('facebookBumpRecoverStaleJobs(queue,posts,now)')<claimSource.indexOf('facebookBumpMarkIdleClaimAudit()'),'a failed idle audit can suppress safe recovery retries');
  assert(moduleSource.includes("if(/NEEDS_REVIEW/.test(String(job.error||'')))"),'unsafe retry guard missing');
  assert(frontend.includes('recoverFacebookWorkerPair'),'BackOffice pair recovery missing');
  assert(facebookPage.includes('COMMENT_SUBMIT_TIMEOUT_NEEDS_REVIEW')&&facebookPage.includes('COMMENT_REFERENCE_UNVERIFIED_NEEDS_REVIEW'),'uncertain comments can be retried and duplicated');
  assert(worker.includes("stored.state === 'SUBMITTING'")&&worker.includes("stored.state === 'COMMENT_CREATED'")&&worker.includes('reconcile: true'),'post-submit backend or cleanup failures can be retried and duplicated');
  assert(worker.indexOf("cleanupResult = previousCommentId ? 'PENDING' : 'SKIPPED'")<worker.indexOf('adapter.deleteOwnedComment(previousCommentId'),'worker deletes an old comment before the new ownership record is committed');
  assert(moduleSource.includes('function facebookBumpFinalizeCleanup')&&moduleSource.includes('cleanupUpdated:facebookBumpFinalizeCleanup'),'cleanup finalization is not idempotent');
  assert(moduleSource.includes("function facebookBumpPauseNeedsReview")&&moduleSource.includes("post.lastStatus='NEEDS_REVIEW'")&&moduleSource.includes('if(needsReview)facebookBumpPauseNeedsReview(post,queue,now)'),'uncertain real failure does not pause the post');
  assert(moduleSource.includes("if(String(job.status)==='COMPLETED')")&&moduleSource.includes("if(String(job.status)==='FAILED')return output({ok:true,idempotent:true})"),'bounded terminal-status retries are not idempotent');
});

test('Server-side expiry, queue cancellation and cleanup hardening are present',()=>{
  assert(moduleSource.includes('function facebookBumpExpirePosts')&&moduleSource.includes("lastStatus='AUTO_PAUSED_EXPIRED'"),'server-side auto pause is missing');
  assert(moduleSource.includes("facebookBumpCancelPending(facebookBumpRows(SHEETS.facebookBumpQueue),post.id,'POST_PAUSED'"),'pausing a post leaves pending work behind');
  const schedulerSource=moduleSource.slice(moduleSource.indexOf('function facebookBumpSchedulerTick'));
  assert(schedulerSource.includes("if(settings.paused)return{ok:true,skipped:'PAUSED'")&&schedulerSource.indexOf("if(settings.paused)return{ok:true,skipped:'PAUSED'")<schedulerSource.indexOf("facebookBumpPlanDuePosts(posts,queue,now).forEach"),'global pause still creates queue work');
  assert(frontend.includes('id="fbPostDuration"')&&frontend.includes('720 = 1 เดือน'),'BackOffice duration control is missing');
  assert(facebookPage.includes("['menuitem', 'button']")&&facebookPage.includes('aria-haspopup'),'Facebook cleanup menu fallbacks are missing');
  assert(facebookPage.includes("code: 'DELETE_NOT_CONFIRMED'")&&facebookPage.includes("state: 'detached', timeout: 10000"),'Facebook cleanup success is not verified');
});

test('Scheduler can be opened or closed with server-side permission checks',()=>{
  assert(main.includes("case'disableFacebookBumpTrigger'")&&main.includes("'disableFacebookBumpTrigger'"),'disable scheduler API missing');
  assert(moduleSource.includes('function disableFacebookBumpTriggerAction')&&moduleSource.includes("requireRole(body.token,['OWNER','ADMIN'])"),'disable scheduler permission guard missing');
  assert(moduleSource.includes('existing.slice(1).forEach(trigger=>ScriptApp.deleteTrigger(trigger))'),'duplicate scheduler triggers are not repaired');
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
