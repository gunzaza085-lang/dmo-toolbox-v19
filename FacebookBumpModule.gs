/**
 * Facebook Auto Bump — scheduler, durable worker pairing and audit state.
 *
 * Apps Script remains the source of truth for scheduling and ownership. Browser
 * interaction is performed only by the separately paired local Worker.
 */

const FACEBOOK_BUMP_TRIGGER_HANDLER='facebookBumpSchedulerTick';
const FACEBOOK_BUMP_ACTIVE_JOB_STATUSES=['PENDING','PROCESSING'];
const FACEBOOK_BUMP_JOB_STATUSES=['PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED'];
const FACEBOOK_WORKER_STATUS_PROPERTY='FACEBOOK_BUMP_REMOTE_WORKER_STATUS';
const FACEBOOK_WORKER_COMMAND_PROPERTY='FACEBOOK_BUMP_REMOTE_WORKER_COMMAND';
const FACEBOOK_WORKER_AUTH_PROPERTY='FACEBOOK_BUMP_WORKER_AUTH_V1';
const FACEBOOK_WORKER_HEARTBEAT_TTL_MS=90000;
const FACEBOOK_BUMP_LEASE_MS=180000;
const FACEBOOK_BUMP_IDLE_CLAIM_AUDIT_SECONDS=300;

function ensureFacebookBumpDatabase(){
  const cache=CacheService.getScriptCache(),cacheKey='facebook-bump-ready-'+DATABASE_VERSION,properties=PropertiesService.getScriptProperties(),persistentKey='FACEBOOK_BUMP_SCHEMA_READY_'+DATABASE_VERSION.replace(/\W/g,'_');
  if(cache.get(cacheKey)==='TRUE')return;
  if(properties.getProperty(persistentKey)==='TRUE'){cache.put(cacheKey,'TRUE',300);return;}
  sheet(SHEETS.facebookBumpPosts,HEADERS.facebookBumpPosts);
  sheet(SHEETS.facebookBumpQueue,HEADERS.facebookBumpQueue);
  sheet(SHEETS.facebookBumpHistory,HEADERS.facebookBumpHistory);
  sheet(SHEETS.facebookOwnedComments,HEADERS.facebookOwnedComments);
  sheet(SHEETS.facebookBumpTelemetry,HEADERS.facebookBumpTelemetry);
  facebookBumpRepairLiteralErrors();
  properties.setProperty(persistentKey,'TRUE');
  cache.put(cacheKey,'TRUE',300);
}

function facebookBumpRepairLiteralErrors(){
  const fallback=safeSheetText(String(settingValue('facebookBumpDefaultMessage','+')||'+'),5000);
  [[SHEETS.facebookBumpPosts,'bumpMessage'],[SHEETS.facebookBumpQueue,'message'],[SHEETS.facebookBumpHistory,'message'],[SHEETS.facebookOwnedComments,'message']].forEach(([name,header])=>{
    const key=Object.keys(SHEETS).find(item=>SHEETS[item]===name),s=sheet(name,HEADERS[key]||[]),headers=s.getRange(1,1,1,s.getLastColumn()).getValues()[0].map(String),column=headers.indexOf(header)+1;
    if(column<1||s.getLastRow()<2)return;
    s.getRange(2,column,s.getLastRow()-1,1).getDisplayValues().forEach((row,index)=>{if(String(row[0])==='#ERROR!')s.getRange(index+2,column).setValue(fallback);});
  });
}

function facebookBumpRows(name){
  const key=Object.keys(SHEETS).find(k=>SHEETS[k]===name),s=sheet(name,HEADERS[key]||[]),lastRow=s.getLastRow(),lastCol=s.getLastColumn();
  if(lastRow<2)return[];
  const headers=s.getRange(1,1,1,lastCol).getValues()[0].map(String),values=s.getRange(2,1,lastRow-1,lastCol).getValues();
  return values.map((row,index)=>{const record={_row:index+2};headers.forEach((header,column)=>{if(header)record[header]=row[column];});return record;})
    .filter(record=>headers.some(header=>header&&String(record[header]??'').trim()!==''));
}
function facebookBumpReadRowsFast(name){
  const s=ss().getSheetByName(name);if(!s||s.getLastRow()<2)return[];
  const values=s.getDataRange().getValues(),headers=values[0].map(String);
  return values.slice(1).map((row,index)=>{const record={_row:index+2};headers.forEach((header,column)=>{if(header)record[header]=row[column];});return record;})
    .filter(record=>headers.some(header=>header&&String(record[header]??'').trim()!==''));
}

function facebookBumpWriteRow(name,record){
  const key=Object.keys(SHEETS).find(k=>SHEETS[k]===name),headers=HEADERS[key],s=sheet(name,headers);
  const values=headers.map(header=>{const value=record[header]??'';return typeof value==='string'?safeSheetText(value,5000):value;});
  if(record._row)s.getRange(record._row,1,1,headers.length).setValues([values]);
  else{s.appendRow(values);record._row=s.getLastRow();}
}

function facebookBumpAppend(name,record){facebookBumpWriteRow(name,record);return record;}
function facebookBumpBoolean(value){return value===true||value===1||String(value).toUpperCase()==='TRUE'||String(value)==='1';}
function facebookBumpDateValue(value){const time=value instanceof Date?value.getTime():new Date(value||0).getTime();return Number.isFinite(time)?time:0;}
function facebookBumpIso(value){const time=facebookBumpDateValue(value);return time?new Date(time).toISOString():'';}
function facebookBumpWithLock(fn){if(typeof LockService==='undefined')return fn();const lock=LockService.getScriptLock();if(!lock.tryLock(15000))throw Error('FACEBOOK_BUSY_RETRY');try{return fn();}finally{lock.releaseLock();}}
function facebookBumpIdleClaimAuditDue(){return typeof CacheService==='undefined'||CacheService.getScriptCache().get('facebook-bump-idle-claim-audit-v1')!=='TRUE';}
function facebookBumpMarkIdleClaimAudit(){if(typeof CacheService!=='undefined')CacheService.getScriptCache().put('facebook-bump-idle-claim-audit-v1','TRUE',FACEBOOK_BUMP_IDLE_CLAIM_AUDIT_SECONDS);}
function facebookBumpCommentKey(value){const text=String(value||'');if(/^\d+$/.test(text))return text;const match=text.match(/[?&](?:comment_id|reply_comment_id)=([^&#]+)/i);if(!match)return'';try{return decodeURIComponent(match[1]);}catch(error){return match[1];}}
function facebookBumpLeaseExpiry(job){const explicit=facebookBumpDateValue(job&&job.leaseExpiresAt);return explicit||facebookBumpDateValue(job&&job.updatedAt)+300000;}
function facebookBumpLeaseMatches(job,body){const expected=String(job&&job.leaseToken||''),actual=String(body&&body.leaseToken||'');return expected?actual===expected:!actual;}
function facebookBumpKnownCommentIds(comments,targetPostId){return[...new Set((comments||[]).filter(item=>String(item.targetPostId)===String(targetPostId)).map(item=>facebookBumpCommentKey(item.commentKey||item.externalCommentId)).filter(Boolean))];}
function facebookBumpNextRunAt(base,intervalMinutes){return new Date(facebookBumpDateValue(base||new Date())+Math.max(1,number(intervalMinutes)||60)*60000);}
function facebookBumpNextCadenceAt(anchor,intervalMinutes,now){const interval=Math.max(1,number(intervalMinutes)||60)*60000,current=facebookBumpDateValue(now||new Date()),base=facebookBumpDateValue(anchor)||current;let next=base+interval;if(next<=current)next+=Math.floor((current-next)/interval+1)*interval;return new Date(next);}
function facebookBumpDurationHours(value){const duration=number(value);return Number.isFinite(duration)&&duration>0?duration:0;}
function facebookBumpExpired(post,now){const until=facebookBumpDateValue(post&&post.runUntil);return until>0&&until<=facebookBumpDateValue(now||new Date());}
function facebookBumpNextPostRun(post,job,now){const next=facebookBumpNextCadenceAt(job&&job.scheduledAt||post.nextRunAt||now,post.intervalMinutes,now),until=facebookBumpDateValue(post.runUntil);return until>0&&next.getTime()>=until?new Date(until):next;}
function facebookBumpUrlValid(value){return /^https:\/\/(?:www\.|m\.|web\.)?facebook\.com\/[^\s]+$/i.test(String(value||'').trim());}
function facebookBumpActiveJob(queue,targetPostId){return queue.find(job=>String(job.targetPostId)===String(targetPostId)&&FACEBOOK_BUMP_ACTIVE_JOB_STATUSES.includes(String(job.status)));}
function facebookBumpPlanDuePosts(posts,queue,now){const time=facebookBumpDateValue(now||new Date());return posts.filter(post=>!post.deletedAt&&facebookBumpBoolean(post.enabled)&&!facebookBumpExpired(post,time)&&facebookBumpDateValue(post.nextRunAt)>0&&facebookBumpDateValue(post.nextRunAt)<=time&&!facebookBumpActiveJob(queue,post.id)).sort((a,b)=>facebookBumpDateValue(a.nextRunAt)-facebookBumpDateValue(b.nextRunAt));}
function facebookBumpSelectNextPending(queue,now){const time=facebookBumpDateValue(now||new Date());return queue.filter(job=>String(job.status)==='PENDING'&&facebookBumpDateValue(job.scheduledAt)<=time).sort((a,b)=>facebookBumpDateValue(a.scheduledAt)-facebookBumpDateValue(b.scheduledAt))[0]||null;}
function facebookBumpOwnedReferenceVerifiable(value){const text=String(value||'');return /^DRY-/.test(text)||(/^https:\/\/(?:www\.|m\.|web\.)?facebook\.com\//i.test(text)&&/[?&](?:comment_id|reply_comment_id)=[^&#]+/i.test(text));}
function facebookBumpRealCommentReferenceValid(value){const text=String(value||'');return /^https:\/\/(?:www\.|m\.|web\.)?facebook\.com\//i.test(text)&&/[?&](?:comment_id|reply_comment_id)=[^&#]+/i.test(text)&&!/[?&](?:comment_id|reply_comment_id)=client(?::|%3A)/i.test(text);}
function facebookBumpCleanupCandidate(comments,targetPostId,newCommentId){const newKey=facebookBumpCommentKey(newCommentId);return comments.filter(comment=>String(comment.targetPostId)===String(targetPostId)&&(!newKey||facebookBumpCommentKey(comment.commentKey||comment.externalCommentId)!==newKey)&&String(comment.status)==='ACTIVE'&&!comment.deletedAt&&facebookBumpOwnedReferenceVerifiable(comment.externalCommentId)).sort((a,b)=>facebookBumpDateValue(a.createdAt)-facebookBumpDateValue(b.createdAt))[0]||null;}
function facebookBumpCancelPending(queue,targetPostId,reason,now){let cancelled=0;(queue||[]).filter(job=>(!targetPostId||String(job.targetPostId)===String(targetPostId))&&String(job.status)==='PENDING').forEach(job=>{job.status='CANCELLED';job.error=reason;job.updatedAt=now||new Date();facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);cancelled++;});return cancelled;}
function facebookBumpPauseNeedsReview(post,queue,now){if(!post)return;post.enabled='FALSE';post.nextRunAt='';post.lastStatus='NEEDS_REVIEW';post.updatedAt=now||new Date();facebookBumpCancelPending(queue,post.id,'POST_NEEDS_REVIEW',post.updatedAt);facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);}
function facebookBumpRecoverStaleJobs(queue,posts,now){const recovered=[];(queue||[]).filter(job=>String(job.status)==='PROCESSING'&&String(job.source).indexOf('REAL_WORKER:')===0&&facebookBumpLeaseExpiry(job)<facebookBumpDateValue(now)).forEach(job=>{job.status='FAILED';job.error='WORKER_LEASE_EXPIRED_NEEDS_REVIEW';job.reconcileStatus='NEEDS_REVIEW';job.updatedAt=now;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);facebookBumpPauseNeedsReview((posts||[]).find(item=>String(item.id)===String(job.targetPostId)&&!item.deletedAt),queue,now);facebookBumpAppendHistory({targetPostId:job.targetPostId,postName:job.postName,postUrl:job.postUrl,action:'RECOVER_STALE_REAL_JOB',message:job.message,result:'FAILED',cleanupResult:'NOT_RUN',error:job.error,jobId:job.jobId});recovered.push(job.jobId);});return recovered;}
function facebookBumpExpirePosts(posts,queue,now){const expired=[];(posts||[]).filter(post=>!post.deletedAt&&facebookBumpBoolean(post.enabled)&&facebookBumpExpired(post,now)).forEach(post=>{post.enabled='FALSE';post.nextRunAt='';post.lastStatus='AUTO_PAUSED_EXPIRED';post.updatedAt=now||new Date();facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);facebookBumpCancelPending(queue,post.id,'POST_RUN_EXPIRED',now);facebookBumpAppendHistory({targetPostId:post.id,postName:post.name,postUrl:post.postUrl,action:'AUTO_PAUSE_EXPIRED',message:'',result:'COMPLETED',cleanupResult:'NOT_RUN',error:'',jobId:''});log('FACEBOOK_BUMP_AUTO_PAUSE','FACEBOOK_BUMP',post.id,post.name,facebookBumpIso(post.runUntil));expired.push(post.id);});return expired;}

function facebookBumpSettings(settingRows){
  const values={};(settingRows||rows(SHEETS.settings)).forEach(item=>{const key=String(item.key),raw=item.value;if(!Object.prototype.hasOwnProperty.call(values,key))values[key]=typeof raw==='boolean'?raw:smart(raw);});
  const value=(key,fallback)=>Object.prototype.hasOwnProperty.call(values,key)?values[key]:fallback;
  const mode=String(value('facebookBumpMode',value('facebookBumpDryRun',true)===false?'REAL':'DRY_RUN')).toUpperCase()==='REAL'?'REAL':'DRY_RUN';
  return{
    defaultInterval:Math.max(5,number(value('facebookBumpDefaultInterval',60))||60),
    defaultMessage:String(value('facebookBumpDefaultMessage','+')||'+'),
    delaySeconds:Math.max(0,number(value('facebookBumpDelaySeconds',30))||0),
    cleanupOld:value('facebookBumpCleanupOld',true)!==false,
    paused:facebookBumpBoolean(value('facebookBumpPaused',true)),
    mode,dryRun:mode!=='REAL',
    nextJobAllowedAt:value('facebookBumpNextJobAllowedAt','')||''
  };
}

function facebookBumpSetSetting(key,value,description){
  const s=sheet(SHEETS.settings,HEADERS.settings),values=s.getDataRange().getValues();
  const safeValue=typeof value==='string'?safeSheetText(value,5000):value;
  let matched=0;for(let index=1;index<values.length;index++)if(String(values[index][0])===String(key)){s.getRange(index+1,2).setValue(safeValue);if(description)s.getRange(index+1,3).setValue(description);matched++;}
  if(matched)return;
  s.appendRow([key,safeValue,description||'']);
}

function facebookBumpTriggerActive(){try{return ScriptApp.getProjectTriggers().some(trigger=>trigger.getHandlerFunction()===FACEBOOK_BUMP_TRIGGER_HANDLER);}catch(error){return false;}}
function facebookBumpPublicRecord(record){const outputRecord={};Object.keys(record).forEach(key=>{if(key==='_row')return;outputRecord[key]=record[key] instanceof Date?record[key].toISOString():record[key];});return outputRecord;}

function facebookBumpWorkerTokenHash(value){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value||''),Utilities.Charset.UTF_8)).replace(/=+$/,'');}
function facebookBumpWorkerAuth(){try{const raw=PropertiesService.getScriptProperties().getProperty(FACEBOOK_WORKER_AUTH_PROPERTY);return raw?JSON.parse(raw):null;}catch(error){return null;}}
function facebookBumpRequireWorker(token){const auth=facebookBumpWorkerAuth(),actual=facebookBumpWorkerTokenHash(token);if(!auth||!actual||String(auth.tokenHash)!==actual)throw Error('WORKER_PAIR_REQUIRED');return{userId:'FACEBOOK_WORKER:'+String(auth.workerId||'PC2'),role:'WORKER'};}
function pairFacebookWorker(body,actor){return withLock(()=>{const token='fbw_'+Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''),record={workerId:safeSheetText(body.workerId||'PC2',80),tokenHash:facebookBumpWorkerTokenHash(token),pairedAt:new Date().toISOString(),pairedBy:String(actor.userId)};PropertiesService.getScriptProperties().setProperty(FACEBOOK_WORKER_AUTH_PROPERTY,JSON.stringify(record));log('FACEBOOK_WORKER_PAIRED','FACEBOOK_BUMP',record.workerId,'',actor.userId);return output({ok:true,workerToken:token,workerId:record.workerId});});}
function revokeFacebookWorkerPair(body,actor){return withLock(()=>{const properties=PropertiesService.getScriptProperties();properties.deleteProperty(FACEBOOK_WORKER_AUTH_PROPERTY);properties.deleteProperty(FACEBOOK_WORKER_STATUS_PROPERTY);properties.deleteProperty(FACEBOOK_WORKER_COMMAND_PROPERTY);log('FACEBOOK_WORKER_REVOKED','FACEBOOK_BUMP','','',actor.userId);return output({ok:true});});}
function disconnectFacebookWorker(body,actor){return withLock(()=>{const properties=PropertiesService.getScriptProperties();properties.deleteProperty(FACEBOOK_WORKER_STATUS_PROPERTY);properties.deleteProperty(FACEBOOK_WORKER_COMMAND_PROPERTY);properties.deleteProperty(FACEBOOK_WORKER_AUTH_PROPERTY);log('FACEBOOK_WORKER_DISCONNECTED','FACEBOOK_BUMP','','',actor.userId);return output({ok:true});});}

function facebookBumpStoreWorkerStatus(input,actor){
  const source=input&&typeof input==='object'?input:{},now=new Date(),allowedConnections=['CONNECTED','LOGIN_REQUIRED','CHECKPOINT','DISCONNECTED','INVALID','UNKNOWN'];
  const connection=allowedConnections.includes(String(source.connection))?String(source.connection):'UNKNOWN';
  const status={worker:'ONLINE',workerVersion:safeSheetText(source.workerVersion||'',80),browser:String(source.browser)==='RUNNING'?'RUNNING':'STOPPED',connection,paired:true,running:facebookBumpBoolean(source.running),activeJobId:safeSheetText(source.activeJobId||'',120),currentJobPhase:safeSheetText(source.currentJobPhase||'',100),pendingResultCount:Math.max(0,number(source.pendingResultCount)||0),lastTelemetryEvent:safeSheetText(source.lastTelemetryEvent||'',100),lastError:safeSheetText(source.lastError||'',300),lastClaimReason:safeSheetText(source.lastClaimReason||'',220),lastClaimAt:facebookBumpIso(source.lastClaimAt),workerPid:Math.max(0,number(source.workerPid)||0),browserProfile:safeSheetText(source.browserProfile||'',120),account:{name:safeSheetText(source.account&&source.account.name||'',160),identifier:safeSheetText(source.account&&source.account.identifier||'',160),checkedAt:facebookBumpIso(source.account&&source.account.checkedAt)},lastChecked:now.toISOString(),reportedBy:String(actor&&actor.userId||'WORKER'),transport:'REMOTE'};
  PropertiesService.getScriptProperties().setProperty(FACEBOOK_WORKER_STATUS_PROPERTY,JSON.stringify(status));return status;
}
function reportFacebookWorkerStatus(body,actor){return output({ok:true,status:facebookBumpStoreWorkerStatus(body.workerStatus||{},actor)});}
function reportFacebookBumpTelemetry(body,actor){return facebookBumpWithLock(()=>{
  const input=body.telemetry||{},jobId=safeSheetText(input.jobId||'',120),targetPostId=safeSheetText(input.targetPostId||'',120),leaseToken=safeSheetText(input.leaseToken||'',160),now=new Date();
  const record={eventId:makeId('FBT'),createdAt:now,jobId,targetPostId,workerId:String(actor.userId),phase:safeSheetText(input.phase||'UNKNOWN',100),outcome:safeSheetText(input.outcome||'',80),detail:safeSheetText(input.detail||'',600),durationMs:Math.max(0,number(input.durationMs)||0),attempt:Math.max(0,number(input.attempt)||0),leaseToken,externalCommentId:safeSheetText(input.externalCommentId||'',1000)};
  facebookBumpAppend(SHEETS.facebookBumpTelemetry,record);
  if(jobId){const job=facebookBumpRows(SHEETS.facebookBumpQueue).find(item=>String(item.jobId)===jobId);if(job&&facebookBumpLeaseMatches(job,{leaseToken})){job.lastTelemetryAt=now;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);}}
  return output({ok:true,eventId:record.eventId});
});}
function facebookBumpWorkerStatus(){
  try{const raw=PropertiesService.getScriptProperties().getProperty(FACEBOOK_WORKER_STATUS_PROPERTY);if(!raw)return null;const status=JSON.parse(raw),checked=facebookBumpDateValue(status.lastChecked),stale=!checked||Date.now()-checked>FACEBOOK_WORKER_HEARTBEAT_TTL_MS;return stale?{...status,worker:'OFFLINE',running:false,stale:true,lastSeenAt:status.lastChecked,transport:'REMOTE'}:{...status,stale:false,transport:'REMOTE'};}catch(error){return null;}
}
function facebookBumpWorkerCommand(){
  try{const raw=PropertiesService.getScriptProperties().getProperty(FACEBOOK_WORKER_COMMAND_PROPERTY);return raw?JSON.parse(raw):null;}catch(error){return null;}
}
function facebookBumpPublicWorkerCommand(command){if(!command)return null;return{id:command.id||'',command:command.command||'',status:command.status||'',requestedAt:command.requestedAt||'',completedAt:command.completedAt||'',error:command.error||''};}
function facebookBumpClaimWorkerCommand(actor){
  const properties=PropertiesService.getScriptProperties(),command=facebookBumpWorkerCommand();if(!command)return null;
  const active=String(command.status)==='PENDING'||String(command.status)==='PROCESSING',expired=Date.now()-facebookBumpDateValue(command.claimedAt||command.requestedAt)>120000;if(!active||String(command.status)==='PROCESSING'&&!expired)return null;
  command.status='PROCESSING';command.claimedAt=new Date().toISOString();command.claimedBy=String(actor.userId);properties.setProperty(FACEBOOK_WORKER_COMMAND_PROPERTY,JSON.stringify(command));return{id:command.id,command:command.command};
}

function getFacebookBumpData(actor){
  if(!actor||!['OWNER','ADMIN'].includes(String(actor.role)))return null;
  ensureFacebookBumpDatabase();
  const posts=facebookBumpReadRowsFast(SHEETS.facebookBumpPosts).filter(post=>!post.deletedAt).sort((a,b)=>String(a.name).localeCompare(String(b.name),'th'));
  const visiblePostIds=new Set(posts.map(post=>String(post.id)));
  const queue=facebookBumpReadRowsFast(SHEETS.facebookBumpQueue).sort((a,b)=>facebookBumpDateValue(b.createdAt)-facebookBumpDateValue(a.createdAt)).slice(0,300);
  const history=facebookBumpReadRowsFast(SHEETS.facebookBumpHistory).filter(item=>visiblePostIds.has(String(item.targetPostId))).sort((a,b)=>facebookBumpDateValue(b.createdAt)-facebookBumpDateValue(a.createdAt)).slice(0,500);
  const telemetry=rowsTail(SHEETS.facebookBumpTelemetry,100).reverse(),settings=facebookBumpSettings();return{posts:posts.map(facebookBumpPublicRecord),queue:queue.map(facebookBumpPublicRecord),history:history.map(facebookBumpPublicRecord),telemetry:telemetry.map(facebookBumpPublicRecord),settings,triggerActive:facebookBumpTriggerActive(),mode:settings.mode,workerStatus:facebookBumpWorkerStatus(),workerCommand:facebookBumpPublicWorkerCommand(facebookBumpWorkerCommand())};
}

function queueFacebookWorkerCommand(body,actor){return withLock(()=>{
  const command=String(body.command||'').toUpperCase();if(!['TEST','OPEN_FACEBOOK'].includes(command))throw Error('คำสั่ง Worker ไม่ถูกต้อง');
  const properties=PropertiesService.getScriptProperties(),current=facebookBumpWorkerCommand(),active=current&&(String(current.status)==='PENDING'||String(current.status)==='PROCESSING')&&Date.now()-facebookBumpDateValue(current.requestedAt)<120000;
  if(active)return output({ok:true,duplicate:true,command:facebookBumpPublicWorkerCommand(current),message:'Worker มีคำสั่งที่กำลังดำเนินการอยู่แล้ว'});
  const record={id:makeId('FBW'),command,status:'PENDING',requestedAt:new Date().toISOString(),requestedBy:String(actor.userId),claimedAt:'',completedAt:'',error:''};properties.setProperty(FACEBOOK_WORKER_COMMAND_PROPERTY,JSON.stringify(record));log('FACEBOOK_WORKER_COMMAND','FACEBOOK_BUMP',record.id,command,actor.userId);return output({ok:true,command:facebookBumpPublicWorkerCommand(record)});
});}

function completeFacebookWorkerCommand(body,actor){return withLock(()=>{
  const properties=PropertiesService.getScriptProperties(),command=facebookBumpWorkerCommand();if(!command||String(command.id)!==String(body.commandId||''))return output({ok:true,idempotent:true});
  command.status=body.ok===false?'FAILED':'COMPLETED';command.completedAt=new Date().toISOString();command.error=safeSheetText(body.error||'',300);properties.setProperty(FACEBOOK_WORKER_COMMAND_PROPERTY,JSON.stringify(command));if(body.workerStatus)facebookBumpStoreWorkerStatus(body.workerStatus,actor);return output({ok:true,command:facebookBumpPublicWorkerCommand(command)});
});}

function saveFacebookBumpPost(body,actor){return withLock(()=>{
  ensureFacebookBumpDatabase();
  const input=body.post||{},now=new Date(),posts=facebookBumpRows(SHEETS.facebookBumpPosts),existing=input.id?posts.find(post=>String(post.id)===String(input.id)):null;
  const name=safeSheetText(input.name,120),postUrl=String(input.postUrl||'').trim(),bumpMessage=safeSheetText(input.bumpMessage||facebookBumpSettings().defaultMessage,500),intervalMinutes=number(input.intervalMinutes||facebookBumpSettings().defaultInterval),enabled=facebookBumpBoolean(input.enabled),runDurationHours=input.runDurationHours===''?0:number(input.runDurationHours),intervalChanged=Boolean(existing)&&number(existing.intervalMinutes)!==intervalMinutes,durationChanged=Boolean(existing)&&facebookBumpDurationHours(existing.runDurationHours)!==facebookBumpDurationHours(runDurationHours),wasEnabled=Boolean(existing)&&facebookBumpBoolean(existing.enabled),startNewRun=enabled&&(!existing||!wasEnabled||durationChanged);
  if(!name)throw Error('กรุณาตั้งชื่อโพสต์');
  if(!facebookBumpUrlValid(postUrl))throw Error('กรุณาใช้ URL โพสต์จาก facebook.com ที่ขึ้นต้นด้วย https://');
  if(!bumpMessage)throw Error('กรุณากำหนดข้อความดันโพสต์');
  if(!Number.isInteger(intervalMinutes)||intervalMinutes<5||intervalMinutes>10080)throw Error('รอบดันโพสต์ต้องเป็น 5–10,080 นาที');
  if(!Number.isFinite(runDurationHours)||runDurationHours<0||runDurationHours>8760)throw Error('ระยะเวลาทำงานต้องอยู่ระหว่าง 0–8,760 ชั่วโมง');
  const duration=facebookBumpDurationHours(runDurationHours),runStartedAt=enabled?(startNewRun?now:(existing.runStartedAt||now)):(existing?existing.runStartedAt:''),runUntil=enabled&&duration>0?(startNewRun?new Date(now.getTime()+duration*3600000):(existing.runUntil||new Date(facebookBumpDateValue(runStartedAt)+duration*3600000))):(existing&&!enabled?existing.runUntil:'');
  const record={
    id:existing?existing.id:makeId('FBP'),name,postUrl,bumpMessage,intervalMinutes,enabled:enabled?'TRUE':'FALSE',
    lastRunAt:existing?existing.lastRunAt:'',nextRunAt:enabled?(existing&&!startNewRun&&!intervalChanged&&facebookBumpDateValue(existing.nextRunAt)>Date.now()?existing.nextRunAt:facebookBumpNextRunAt(now,intervalMinutes)):'',
    lastStatus:existing?existing.lastStatus:'READY',createdAt:existing?existing.createdAt:now,updatedAt:now,deletedAt:'',runDurationHours:duration,runStartedAt,runUntil,_row:existing&&existing._row
  };
  facebookBumpWriteRow(SHEETS.facebookBumpPosts,record);
  log(existing?'FACEBOOK_BUMP_POST_UPDATE':'FACEBOOK_BUMP_POST_CREATE','FACEBOOK_BUMP',record.id,record.name,facebookBumpSettings().mode+' • '+actor.userId);
  return output({ok:true,post:facebookBumpPublicRecord(record)});
});}

function deleteFacebookBumpPost(body,actor){return withLock(()=>{
  const id=String(body.id||''),queue=facebookBumpRows(SHEETS.facebookBumpQueue),post=facebookBumpRows(SHEETS.facebookBumpPosts).find(item=>String(item.id)===id&&!item.deletedAt);if(!post)throw Error('ไม่พบโพสต์');if(queue.some(job=>String(job.targetPostId)===id&&String(job.status)==='PROCESSING'))throw Error('โพสต์กำลังส่ง Comment กรุณารอให้งานจบหรือ Pause ก่อนลบ');
  post.enabled='FALSE';post.deletedAt=new Date();post.updatedAt=new Date();post.lastStatus='DELETED';facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);
  facebookBumpCancelPending(queue,id,'POST_DELETED',new Date());
  log('FACEBOOK_BUMP_POST_DELETE','FACEBOOK_BUMP',id,post.name,'SOFT_DELETE • '+actor.userId);return output({ok:true});
});}

function toggleFacebookBumpPost(body,actor){return withLock(()=>{
  const post=facebookBumpRows(SHEETS.facebookBumpPosts).find(item=>String(item.id)===String(body.id)&&!item.deletedAt);if(!post)throw Error('ไม่พบโพสต์');
  const enabled=facebookBumpBoolean(body.enabled),now=new Date(),duration=facebookBumpDurationHours(post.runDurationHours);post.enabled=enabled?'TRUE':'FALSE';post.nextRunAt=enabled?facebookBumpNextRunAt(now,post.intervalMinutes):'';post.updatedAt=now;post.lastStatus=enabled?'READY':'PAUSED';if(enabled){post.runStartedAt=now;post.runUntil=duration>0?new Date(now.getTime()+duration*3600000):'';}else facebookBumpCancelPending(facebookBumpRows(SHEETS.facebookBumpQueue),post.id,'POST_PAUSED',now);facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);
  log(enabled?'FACEBOOK_BUMP_RESUME':'FACEBOOK_BUMP_PAUSE','FACEBOOK_BUMP',post.id,post.name,actor.userId);return output({ok:true});
});}

function facebookBumpCreateJob(post,source,scheduledAt){
  const now=new Date(),record={jobId:makeId('FBJ'),targetPostId:post.id,postName:post.name,postUrl:post.postUrl,message:post.bumpMessage||'+',scheduledAt:scheduledAt||now,status:'PENDING',attempts:0,error:'',createdAt:now,updatedAt:now,source:source||'SCHEDULED'};
  return facebookBumpAppend(SHEETS.facebookBumpQueue,record);
}

function queueFacebookBumpNow(body,actor){return withLock(()=>{
  const post=facebookBumpRows(SHEETS.facebookBumpPosts).find(item=>String(item.id)===String(body.id)&&!item.deletedAt);if(!post)throw Error('ไม่พบโพสต์');
  if(!facebookBumpBoolean(post.enabled))throw Error('โพสต์นี้ถูก Pause อยู่ กรุณา Resume ก่อนดันตอนนี้');
  if(facebookBumpExpired(post,new Date()))throw Error('ระยะเวลาทำงานของโพสต์สิ้นสุดแล้ว กรุณา Resume เพื่อเริ่มรอบใหม่');
  const queue=facebookBumpRows(SHEETS.facebookBumpQueue),active=facebookBumpActiveJob(queue,post.id);if(active)return output({ok:true,duplicate:true,jobId:active.jobId,message:'โพสต์นี้มีงานรออยู่แล้ว'});
  const job=facebookBumpCreateJob(post,'MANUAL',new Date());log('FACEBOOK_BUMP_QUEUE_MANUAL','FACEBOOK_BUMP',post.id,post.name,actor.userId);return output({ok:true,jobId:job.jobId});
});}

function cancelFacebookBumpJob(body,actor){return withLock(()=>{
  const job=facebookBumpRows(SHEETS.facebookBumpQueue).find(item=>String(item.jobId)===String(body.jobId));if(!job)throw Error('ไม่พบงานในคิว');if(String(job.status)!=='PENDING')throw Error('ยกเลิกได้เฉพาะงานที่กำลังรอ');
  job.status='CANCELLED';job.error='CANCELLED_BY_'+actor.userId;job.updatedAt=new Date();facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);return output({ok:true});
});}

function retryFacebookBumpJob(body,actor){return withLock(()=>{
  const job=facebookBumpRows(SHEETS.facebookBumpQueue).find(item=>String(item.jobId)===String(body.jobId));if(!job)throw Error('ไม่พบงานในคิว');if(String(job.status)!=='FAILED')throw Error('Retry ได้เฉพาะงานที่ล้มเหลว');
  if(/NEEDS_REVIEW/.test(String(job.error||'')))throw Error('งานนี้อาจส่ง Comment สำเร็จก่อน Worker หยุด กรุณาตรวจ Facebook และสร้างงานใหม่หลังยืนยัน ห้าม Retry อัตโนมัติ');
  const post=facebookBumpRows(SHEETS.facebookBumpPosts).find(item=>String(item.id)===String(job.targetPostId)&&!item.deletedAt&&facebookBumpBoolean(item.enabled));if(!post||facebookBumpExpired(post,new Date()))throw Error('โพสต์ถูก Pause หรือหมดเวลาทำงาน กรุณา Resume ก่อน Retry');
  if(facebookBumpActiveJob(facebookBumpRows(SHEETS.facebookBumpQueue),job.targetPostId))return output({ok:true,duplicate:true,message:'โพสต์นี้มีงานรออยู่แล้ว'});
  job.status='PENDING';job.error='';job.scheduledAt=new Date();job.updatedAt=new Date();job.source='RETRY';facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);log('FACEBOOK_BUMP_RETRY','FACEBOOK_BUMP',job.targetPostId,job.postName,actor.userId);return output({ok:true});
});}

function saveFacebookBumpSettings(body,actor){return withLock(()=>{
  const input=body.settings||{},interval=number(input.defaultInterval),delay=number(input.delaySeconds),message=safeSheetText(input.defaultMessage||'+',500),mode=String(input.mode||'DRY_RUN').toUpperCase()==='REAL'?'REAL':'DRY_RUN';
  if(!Number.isInteger(interval)||interval<5||interval>10080)throw Error('Default interval ต้องเป็น 5–10,080 นาที');
  if(!Number.isFinite(delay)||delay<0||delay>3600)throw Error('Delay ต้องอยู่ระหว่าง 0–3,600 วินาที');
  if(!message)throw Error('กรุณากำหนด Default message');
  if(mode==='REAL'){if(String(actor.role)!=='OWNER')throw Error('เฉพาะ OWNER เท่านั้นที่เปิด Real Facebook ได้');if(String(input.realConfirmed||'')!=='ENABLE_REAL_FACEBOOK')throw Error('กรุณายืนยันการเปิด Real Facebook จากหน้า Admin');}
  facebookBumpSetSetting('facebookBumpDefaultInterval',interval,'Facebook Bump default interval (minutes)');
  facebookBumpSetSetting('facebookBumpDefaultMessage',message,'Facebook Bump default message');
  facebookBumpSetSetting('facebookBumpDelaySeconds',delay,'Delay between Facebook jobs');
  facebookBumpSetSetting('facebookBumpCleanupOld',facebookBumpBoolean(input.cleanupOld)?'TRUE':'FALSE','Owned-comment cleanup after new comment succeeds');
  facebookBumpSetSetting('facebookBumpMode',mode,'DRY_RUN or REAL; default remains DRY_RUN');
  facebookBumpSetSetting('facebookBumpDryRun',mode==='REAL'?'FALSE':'TRUE','Compatibility flag');
  log('FACEBOOK_BUMP_SETTINGS','FACEBOOK_BUMP','','',mode+' • '+actor.userId);return output({ok:true,settings:facebookBumpSettings()});
});}

function claimFacebookBumpJob(body,actor){return facebookBumpWithLock(()=>{
  const now=new Date(),workerStatus=facebookBumpStoreWorkerStatus(body.workerStatus||{},actor),settings=facebookBumpSettings(),command=facebookBumpClaimWorkerCommand(actor);if(command)return output({ok:true,job:null,reason:'REMOTE_COMMAND',command});
  const idleReason=workerStatus.connection!=='CONNECTED'?(workerStatus.connection||'FACEBOOK_NOT_CONNECTED'):settings.mode!=='REAL'?'DRY_RUN':settings.paused?'PAUSED':'';if(idleReason&&!facebookBumpIdleClaimAuditDue())return output({ok:true,job:null,reason:idleReason});
  const queue=facebookBumpRows(SHEETS.facebookBumpQueue),posts=facebookBumpRows(SHEETS.facebookBumpPosts);facebookBumpRecoverStaleJobs(queue,posts,now);if(idleReason){facebookBumpMarkIdleClaimAudit();return output({ok:true,job:null,reason:idleReason});}if(facebookBumpDateValue(settings.nextJobAllowedAt)>now.getTime())return output({ok:true,job:null,reason:'DELAY'});
  const job=facebookBumpSelectNextPending(queue,now);if(!job)return output({ok:true,job:null,reason:'EMPTY'});
  const post=posts.find(item=>String(item.id)===String(job.targetPostId)&&!item.deletedAt&&facebookBumpBoolean(item.enabled));if(!post){job.status='CANCELLED';job.error='POST_NOT_AVAILABLE';job.updatedAt=now;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);return output({ok:true,job:null,reason:'POST_NOT_AVAILABLE'});}
  if(facebookBumpExpired(post,now)){facebookBumpExpirePosts([post],queue,now);return output({ok:true,job:null,reason:'POST_RUN_EXPIRED'});}
  job.status='PROCESSING';job.attempts=number(job.attempts)+1;job.error='';job.updatedAt=now;job.source='REAL_WORKER:'+actor.userId;job.leaseToken=Utilities.getUuid().replace(/-/g,'');job.leaseExpiresAt=new Date(now.getTime()+FACEBOOK_BUMP_LEASE_MS);job.claimedAt=now;job.completedAt='';job.resultFingerprint='';job.reconcileStatus='IN_PROGRESS';job.lastTelemetryAt=now;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);facebookBumpSetSetting('facebookBumpNextJobAllowedAt',new Date(now.getTime()+settings.delaySeconds*1000),'Next Facebook Bump job gate');
  const comments=facebookBumpRows(SHEETS.facebookOwnedComments),previous=facebookBumpCleanupCandidate(comments,post.id,'');return output({ok:true,job:facebookBumpPublicRecord(job),previousOwnedComment:previous?facebookBumpPublicRecord(previous):null,knownCommentIds:facebookBumpKnownCommentIds(comments,post.id),cleanupOld:settings.cleanupOld,leaseExpiresAt:facebookBumpIso(job.leaseExpiresAt)});
});}

function renewFacebookBumpJobLease(body,actor){return facebookBumpWithLock(()=>{
  const now=new Date(),queue=facebookBumpRows(SHEETS.facebookBumpQueue),job=queue.find(item=>String(item.jobId)===String(body.jobId||'')),posts=facebookBumpRows(SHEETS.facebookBumpPosts);if(!job)throw Error('JOB_NOT_FOUND');
  if(String(job.status)!=='PROCESSING'||String(job.source)!=='REAL_WORKER:'+String(actor.userId))throw Error('LEASE_JOB_NOT_PROCESSING');
  if(!facebookBumpLeaseMatches(job,body))throw Error('LEASE_TOKEN_MISMATCH_NEEDS_REVIEW');
  if(facebookBumpLeaseExpiry(job)<now.getTime()){facebookBumpRecoverStaleJobs(queue,posts,now);throw Error('LEASE_EXPIRED_NEEDS_REVIEW');}
  job.leaseExpiresAt=new Date(now.getTime()+FACEBOOK_BUMP_LEASE_MS);job.updatedAt=now;job.lastTelemetryAt=now;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);facebookBumpStoreWorkerStatus(body.workerStatus||{},actor);return output({ok:true,leaseExpiresAt:facebookBumpIso(job.leaseExpiresAt)});
});}

function facebookBumpFinalizeCleanup(job,body,now){
  const external=safeSheetText(body.externalCommentId,1000),externalKey=facebookBumpCommentKey(external),cleanupResult=safeSheetText(body.cleanupResult||'SKIPPED',500),accepted=cleanupResult==='DELETED'||cleanupResult==='ALREADY_ABSENT'||cleanupResult==='SKIPPED'||cleanupResult==='PENDING'||cleanupResult.indexOf('CLEANUP_FAILED:')===0;if(!accepted||!facebookBumpRealCommentReferenceValid(external))return false;
  const comments=facebookBumpRows(SHEETS.facebookOwnedComments),owned=comments.find(item=>String(item.id)==='REAL-'+String(job.jobId)&&facebookBumpCommentKey(item.commentKey||item.externalCommentId)===externalKey&&String(item.status)==='ACTIVE'&&!item.deletedAt);if(!owned)return false;
  if((cleanupResult==='DELETED'||cleanupResult==='ALREADY_ABSENT')&&body.previousCommentId){const previousKey=facebookBumpCommentKey(body.previousCommentId),previous=comments.find(item=>String(item.targetPostId)===String(job.targetPostId)&&facebookBumpCommentKey(item.commentKey||item.externalCommentId)===previousKey&&previousKey!==externalKey&&String(item.status)==='ACTIVE'&&!item.deletedAt&&facebookBumpOwnedReferenceVerifiable(item.externalCommentId));if(previous){previous.deletedAt=now;previous.status=cleanupResult==='DELETED'?'DELETED':'ALREADY_ABSENT';facebookBumpWriteRow(SHEETS.facebookOwnedComments,previous);}}
  const history=facebookBumpRows(SHEETS.facebookBumpHistory).find(item=>String(item.jobId)===String(job.jobId)&&String(item.result)==='COMPLETED');if(history&&String(history.cleanupResult)!==cleanupResult){history.cleanupResult=cleanupResult;facebookBumpWriteRow(SHEETS.facebookBumpHistory,history);}return true;
}

function completeFacebookBumpJob(body,actor){return facebookBumpWithLock(()=>{
  const now=new Date(),job=facebookBumpRows(SHEETS.facebookBumpQueue).find(item=>String(item.jobId)===String(body.jobId));if(!job)throw Error('ไม่พบงานในคิว');
  const external=safeSheetText(body.externalCommentId,1000),externalKey=facebookBumpCommentKey(external),fingerprint=String(job.jobId)+':'+externalKey;if(String(job.status)==='COMPLETED'){if(String(job.resultFingerprint||fingerprint)!==fingerprint)throw Error('RESULT_CONFLICT_NEEDS_REVIEW');return output({ok:true,idempotent:true,cleanupUpdated:facebookBumpFinalizeCleanup(job,body,now)});}
  const lateReconcile=String(job.status)==='FAILED'&&String(job.error)==='WORKER_LEASE_EXPIRED_NEEDS_REVIEW'&&body.reconcile===true;if((String(job.status)!=='PROCESSING'&&!lateReconcile)||String(job.source).indexOf('REAL_WORKER:')!==0)throw Error('งานไม่ได้ถูกจองโดย Local Worker');if(!facebookBumpLeaseMatches(job,body))throw Error('LEASE_TOKEN_MISMATCH_NEEDS_REVIEW');
  const post=facebookBumpRows(SHEETS.facebookBumpPosts).find(item=>String(item.id)===String(job.targetPostId)&&!item.deletedAt),message=safeSheetText(body.message||job.message,500),cleanupResult=safeSheetText(body.cleanupResult||'SKIPPED',500);if(!post)throw Error('ไม่พบโพสต์');if(!facebookBumpRealCommentReferenceValid(external)||!externalKey)throw Error('COMMENT_REFERENCE_INVALID_NEEDS_REVIEW');
  const comments=facebookBumpRows(SHEETS.facebookOwnedComments),ownedId='REAL-'+String(job.jobId),duplicate=comments.find(item=>facebookBumpCommentKey(item.commentKey||item.externalCommentId)===externalKey&&String(item.id)!==ownedId);if(duplicate)throw Error('COMMENT_ID_ALREADY_OWNED_NEEDS_REVIEW');const existing=comments.find(item=>String(item.id)===ownedId);if(existing&&facebookBumpCommentKey(existing.commentKey||existing.externalCommentId)!==externalKey)throw Error('RESULT_CONFLICT_NEEDS_REVIEW');if(!existing)facebookBumpAppend(SHEETS.facebookOwnedComments,{id:ownedId,targetPostId:post.id,externalCommentId:external,message,createdAt:now,deletedAt:'',status:'ACTIVE',commentKey:externalKey,jobId:job.jobId,verifiedAt:now,verificationMethod:safeSheetText(body.verificationMethod||'WORKER_VERIFIED',80)});
  facebookBumpFinalizeCleanup(job,{...body,externalCommentId:external,cleanupResult},now);
  const expired=facebookBumpExpired(post,now),enabled=!lateReconcile&&facebookBumpBoolean(post.enabled)&&!expired;job.status='COMPLETED';job.error='';job.updatedAt=now;job.completedAt=now;job.resultFingerprint=fingerprint;job.reconcileStatus=lateReconcile?'RECONCILED_COMPLETED':'COMPLETED';job.leaseExpiresAt='';facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);post.lastRunAt=now;post.nextRunAt=enabled?facebookBumpNextPostRun(post,job,now):'';if(expired||lateReconcile)post.enabled='FALSE';post.lastStatus=lateReconcile?'RECONCILED_SUCCESS_PAUSED':expired?'AUTO_PAUSED_EXPIRED':!enabled?'PAUSED':cleanupResult.indexOf('CLEANUP_FAILED')===0?'REAL_SUCCESS_CLEANUP_FAILED':'REAL_SUCCESS';post.updatedAt=now;facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);facebookBumpAppendHistory({targetPostId:post.id,postName:post.name,postUrl:job.postUrl||post.postUrl,action:lateReconcile?'RECONCILE_COMMENT_REAL':'CREATE_COMMENT_REAL',message,result:'COMPLETED',commentId:external,cleanupResult,jobId:job.jobId});log('FACEBOOK_BUMP_REAL_SUCCESS','FACEBOOK_BUMP',post.id,post.name,actor.userId);return output({ok:true,reconciled:lateReconcile,nextRunAt:facebookBumpIso(post.nextRunAt)});
});}

function failFacebookBumpJob(body,actor){return facebookBumpWithLock(()=>{
  const now=new Date(),queue=facebookBumpRows(SHEETS.facebookBumpQueue),job=queue.find(item=>String(item.jobId)===String(body.jobId));if(!job)throw Error('ไม่พบงานในคิว');if(String(job.status)==='FAILED')return output({ok:true,idempotent:true});if(String(job.status)!=='PROCESSING')throw Error('งานไม่ได้อยู่ระหว่างทำงาน');if(!facebookBumpLeaseMatches(job,body))throw Error('LEASE_TOKEN_MISMATCH_NEEDS_REVIEW');const error=safeSheetText(body.error||'REAL_EXECUTOR_FAILED',500),external=safeSheetText(body.externalCommentId||'',1000),post=facebookBumpRows(SHEETS.facebookBumpPosts).find(item=>String(item.id)===String(job.targetPostId)),needsReview=/NEEDS_REVIEW/.test(error);job.status='FAILED';job.error=error;job.updatedAt=now;job.completedAt=now;job.reconcileStatus=needsReview?'NEEDS_REVIEW':'SAFE_TO_RETRY';job.leaseExpiresAt='';facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);if(post){if(needsReview)facebookBumpPauseNeedsReview(post,queue,now);else{const enabled=facebookBumpBoolean(post.enabled)&&!facebookBumpExpired(post,now);post.lastStatus=!enabled?'PAUSED':/LOGIN|CHECKPOINT|CAPTCHA|2FA/.test(error)?'LOGIN_REQUIRED':'REAL_FAILED';post.nextRunAt=enabled?facebookBumpNextPostRun(post,job,now):'';if(facebookBumpExpired(post,now))post.enabled='FALSE';post.updatedAt=now;facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);}}facebookBumpAppendHistory({targetPostId:job.targetPostId,postName:job.postName,postUrl:job.postUrl,action:'CREATE_COMMENT_REAL',message:job.message,result:'FAILED',commentId:external,cleanupResult:'NOT_RUN',error,jobId:job.jobId});log('FACEBOOK_BUMP_REAL_FAILED','FACEBOOK_BUMP',job.targetPostId,job.postName,actor.userId+' • '+error);return output({ok:true,paused:needsReview,nextRunAt:post?facebookBumpIso(post.nextRunAt):''});
});}

function setFacebookBumpGlobalPause(paused,body,actor){return withLock(()=>{
  facebookBumpSetSetting('facebookBumpPaused',paused?'TRUE':'FALSE','Pause all Facebook Bump jobs');
  if(paused)facebookBumpCancelPending(facebookBumpRows(SHEETS.facebookBumpQueue),'','GLOBAL_PAUSE',new Date());
  else facebookBumpSetSetting('facebookBumpNextJobAllowedAt',new Date(),'Resume queue safely');
  log(paused?'FACEBOOK_BUMP_PAUSE_ALL':'FACEBOOK_BUMP_RESUME_ALL','FACEBOOK_BUMP','','',actor.userId);return output({ok:true,paused});
});}

function ensureFacebookBumpTriggerAction(body,actor){
  requireRole(body.token,['OWNER','ADMIN']);
  const existing=ScriptApp.getProjectTriggers().filter(trigger=>trigger.getHandlerFunction()===FACEBOOK_BUMP_TRIGGER_HANDLER);
  existing.slice(1).forEach(trigger=>ScriptApp.deleteTrigger(trigger));
  if(!existing.length)ScriptApp.newTrigger(FACEBOOK_BUMP_TRIGGER_HANDLER).timeBased().everyMinutes(1).create();
  log('FACEBOOK_BUMP_TRIGGER','FACEBOOK_BUMP','','',facebookBumpSettings().mode+' • '+actor.userId);return output({ok:true,active:true,created:!existing.length,deduplicated:Math.max(0,existing.length-1)});
}

function disableFacebookBumpTriggerAction(body,actor){
  requireRole(body.token,['OWNER','ADMIN']);
  const existing=ScriptApp.getProjectTriggers().filter(trigger=>trigger.getHandlerFunction()===FACEBOOK_BUMP_TRIGGER_HANDLER);
  existing.forEach(trigger=>ScriptApp.deleteTrigger(trigger));
  log('FACEBOOK_BUMP_TRIGGER_OFF','FACEBOOK_BUMP','','',actor.userId);return output({ok:true,active:false,deleted:existing.length});
}

class DryRunFacebookBumpExecutor{
  execute(post,job){return{ok:true,externalCommentId:'DRY-'+Utilities.getUuid(),message:job.message||post.bumpMessage||'+',mode:'DRY_RUN'};}
}

function facebookBumpAppendHistory(record){facebookBumpAppend(SHEETS.facebookBumpHistory,{historyId:makeId('FBH'),createdAt:new Date(),targetPostId:record.targetPostId,postName:record.postName,postUrl:record.postUrl,action:record.action||'BUMP',message:record.message||'',result:record.result||'',commentId:record.commentId||'',cleanupResult:record.cleanupResult||'',error:record.error||'',jobId:record.jobId||''});}

function facebookBumpExecuteJob(job,executor,now){
  const posts=facebookBumpRows(SHEETS.facebookBumpPosts),post=posts.find(item=>String(item.id)===String(job.targetPostId)&&!item.deletedAt),runAt=now||new Date();
  if(!post||!facebookBumpBoolean(post.enabled)){job.status='CANCELLED';job.error=!post?'POST_NOT_FOUND':'POST_DISABLED';job.updatedAt=runAt;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);return{status:'CANCELLED'};}
  job.status='PROCESSING';job.attempts=number(job.attempts)+1;job.updatedAt=runAt;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);
  try{
    const result=(executor||new DryRunFacebookBumpExecutor()).execute(post,job);if(!result||result.ok!==true)throw Error(result&&result.error||'DRY_RUN_FAILED');
    const comments=facebookBumpRows(SHEETS.facebookOwnedComments),owned={id:makeId('FBC'),targetPostId:post.id,externalCommentId:result.externalCommentId,message:result.message||job.message,createdAt:runAt,deletedAt:'',status:'ACTIVE'},previous=facebookBumpCleanupCandidate(comments,post.id,owned.externalCommentId);
    facebookBumpAppend(SHEETS.facebookOwnedComments,owned);
    let cleanupResult='SKIPPED';
    if(facebookBumpSettings().cleanupOld&&previous){previous.deletedAt=runAt;previous.status='DELETED_SIMULATED';facebookBumpWriteRow(SHEETS.facebookOwnedComments,previous);cleanupResult='SIMULATED_DELETE '+previous.externalCommentId;}
    job.status='COMPLETED';job.error='';job.updatedAt=runAt;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);
    post.lastRunAt=runAt;post.nextRunAt=facebookBumpNextPostRun(post,job,runAt);post.lastStatus='DRY_RUN_SUCCESS';post.updatedAt=runAt;facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);
    facebookBumpAppendHistory({targetPostId:post.id,postName:post.name,postUrl:job.postUrl||post.postUrl,action:'CREATE_COMMENT_DRY_RUN',message:job.message,result:'COMPLETED',commentId:owned.externalCommentId,cleanupResult,jobId:job.jobId});
    return{status:'COMPLETED',commentId:owned.externalCommentId,cleanupResult};
  }catch(error){
    job.status='FAILED';job.error=safeAdminError(error);job.updatedAt=runAt;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);
    post.lastStatus='DRY_RUN_FAILED';post.nextRunAt=facebookBumpNextPostRun(post,job,runAt);post.updatedAt=runAt;facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);
    facebookBumpAppendHistory({targetPostId:post.id,postName:post.name,postUrl:job.postUrl||post.postUrl,action:'CREATE_COMMENT_DRY_RUN',message:job.message,result:'FAILED',cleanupResult:'NOT_RUN',error:job.error,jobId:job.jobId});return{status:'FAILED',error:job.error};
  }
}

function facebookBumpSchedulerTick(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return{ok:true,skipped:'LOCKED'};
  try{
    ensureDatabase();const now=new Date(),settings=facebookBumpSettings(),posts=facebookBumpRows(SHEETS.facebookBumpPosts).filter(post=>!post.deletedAt&&facebookBumpBoolean(post.enabled)),queue=facebookBumpRows(SHEETS.facebookBumpQueue),expired=facebookBumpExpirePosts(posts,queue,now);
    if(settings.paused)return{ok:true,skipped:'PAUSED',expired:expired.length};
    facebookBumpPlanDuePosts(posts,queue,now).forEach(post=>{const job=facebookBumpCreateJob(post,'SCHEDULED',post.nextRunAt);queue.push(job);});
    if(facebookBumpDateValue(settings.nextJobAllowedAt)>now.getTime())return{ok:true,skipped:'DELAY'};
    const pending=facebookBumpSelectNextPending(facebookBumpRows(SHEETS.facebookBumpQueue),now);
    if(!pending)return{ok:true,processed:0};
    if(settings.mode==='REAL')return{ok:true,processed:0,waitingForWorker:true};
    const result=facebookBumpExecuteJob(pending,new DryRunFacebookBumpExecutor(),now);facebookBumpSetSetting('facebookBumpNextJobAllowedAt',new Date(now.getTime()+settings.delaySeconds*1000),'Next Facebook Bump job gate');return{ok:true,processed:1,result};
  }finally{lock.releaseLock();}
}
