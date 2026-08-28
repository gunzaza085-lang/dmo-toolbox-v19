/**
 * Facebook Auto Bump — Phase 1/2 (Core + Dry Run only)
 *
 * This module never opens Facebook, never authenticates with Facebook and never
 * calls Graph API. The executor only records a simulated comment ID so the
 * queue, scheduling, ownership and cleanup rules can be verified safely.
 */

const FACEBOOK_BUMP_TRIGGER_HANDLER='facebookBumpSchedulerTick';
const FACEBOOK_BUMP_ACTIVE_JOB_STATUSES=['PENDING','PROCESSING'];
const FACEBOOK_BUMP_JOB_STATUSES=['PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED'];

function ensureFacebookBumpDatabase(){
  const cache=CacheService.getScriptCache(),cacheKey='facebook-bump-ready-'+DATABASE_VERSION,properties=PropertiesService.getScriptProperties(),persistentKey='FACEBOOK_BUMP_SCHEMA_READY_'+DATABASE_VERSION.replace(/\W/g,'_');
  if(cache.get(cacheKey)==='TRUE')return;
  if(properties.getProperty(persistentKey)==='TRUE'){cache.put(cacheKey,'TRUE',300);return;}
  sheet(SHEETS.facebookBumpPosts,HEADERS.facebookBumpPosts);
  sheet(SHEETS.facebookBumpQueue,HEADERS.facebookBumpQueue);
  sheet(SHEETS.facebookBumpHistory,HEADERS.facebookBumpHistory);
  sheet(SHEETS.facebookOwnedComments,HEADERS.facebookOwnedComments);
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
function facebookBumpBoolean(value){return value===true||String(value).toUpperCase()==='TRUE';}
function facebookBumpDateValue(value){const time=value instanceof Date?value.getTime():new Date(value||0).getTime();return Number.isFinite(time)?time:0;}
function facebookBumpIso(value){const time=facebookBumpDateValue(value);return time?new Date(time).toISOString():'';}
function facebookBumpNextRunAt(base,intervalMinutes){return new Date(facebookBumpDateValue(base||new Date())+Math.max(1,number(intervalMinutes)||60)*60000);}
function facebookBumpUrlValid(value){return /^https:\/\/(?:www\.|m\.|web\.)?facebook\.com\/[^\s]+$/i.test(String(value||'').trim());}
function facebookBumpActiveJob(queue,targetPostId){return queue.find(job=>String(job.targetPostId)===String(targetPostId)&&FACEBOOK_BUMP_ACTIVE_JOB_STATUSES.includes(String(job.status)));}
function facebookBumpPlanDuePosts(posts,queue,now){const time=facebookBumpDateValue(now||new Date());return posts.filter(post=>!post.deletedAt&&facebookBumpBoolean(post.enabled)&&facebookBumpDateValue(post.nextRunAt)>0&&facebookBumpDateValue(post.nextRunAt)<=time&&!facebookBumpActiveJob(queue,post.id)).sort((a,b)=>facebookBumpDateValue(a.nextRunAt)-facebookBumpDateValue(b.nextRunAt));}
function facebookBumpSelectNextPending(queue,now){const time=facebookBumpDateValue(now||new Date());return queue.filter(job=>String(job.status)==='PENDING'&&facebookBumpDateValue(job.scheduledAt)<=time).sort((a,b)=>facebookBumpDateValue(a.scheduledAt)-facebookBumpDateValue(b.scheduledAt))[0]||null;}
function facebookBumpCleanupCandidate(comments,targetPostId,newCommentId){return comments.filter(comment=>String(comment.targetPostId)===String(targetPostId)&&String(comment.externalCommentId)!==String(newCommentId)&&String(comment.status)==='ACTIVE'&&!comment.deletedAt).sort((a,b)=>facebookBumpDateValue(b.createdAt)-facebookBumpDateValue(a.createdAt))[0]||null;}

function facebookBumpSettings(settingRows){
  const values={};(settingRows||rows(SHEETS.settings)).forEach(item=>{values[String(item.key)]=smart(item.value);});
  const value=(key,fallback)=>Object.prototype.hasOwnProperty.call(values,key)?values[key]:fallback;
  const mode=String(value('facebookBumpMode',value('facebookBumpDryRun',true)===false?'REAL':'DRY_RUN')).toUpperCase()==='REAL'?'REAL':'DRY_RUN';
  return{
    defaultInterval:Math.max(5,number(value('facebookBumpDefaultInterval',60))||60),
    defaultMessage:String(value('facebookBumpDefaultMessage','+')||'+'),
    delaySeconds:Math.max(0,number(value('facebookBumpDelaySeconds',30))||0),
    cleanupOld:value('facebookBumpCleanupOld',true)!==false,
    paused:facebookBumpBoolean(value('facebookBumpPaused',false)),
    mode,dryRun:mode!=='REAL',
    nextJobAllowedAt:value('facebookBumpNextJobAllowedAt','')||''
  };
}

function facebookBumpSetSetting(key,value,description){
  const s=sheet(SHEETS.settings,HEADERS.settings),values=s.getDataRange().getValues();
  const safeValue=typeof value==='string'?safeSheetText(value,5000):value;
  for(let index=1;index<values.length;index++)if(String(values[index][0])===String(key)){s.getRange(index+1,2).setValue(safeValue);if(description)s.getRange(index+1,3).setValue(description);return;}
  s.appendRow([key,safeValue,description||'']);
}

function facebookBumpTriggerActive(){try{return ScriptApp.getProjectTriggers().some(trigger=>trigger.getHandlerFunction()===FACEBOOK_BUMP_TRIGGER_HANDLER);}catch(error){return false;}}
function facebookBumpPublicRecord(record){const outputRecord={};Object.keys(record).forEach(key=>{if(key==='_row')return;outputRecord[key]=record[key] instanceof Date?record[key].toISOString():record[key];});return outputRecord;}

function getFacebookBumpData(actor){
  if(!actor||!['OWNER','ADMIN'].includes(String(actor.role)))return null;
  ensureFacebookBumpDatabase();
  const posts=facebookBumpReadRowsFast(SHEETS.facebookBumpPosts).filter(post=>!post.deletedAt).sort((a,b)=>String(a.name).localeCompare(String(b.name),'th'));
  const queue=facebookBumpReadRowsFast(SHEETS.facebookBumpQueue).sort((a,b)=>facebookBumpDateValue(b.createdAt)-facebookBumpDateValue(a.createdAt)).slice(0,300);
  const history=facebookBumpReadRowsFast(SHEETS.facebookBumpHistory).sort((a,b)=>facebookBumpDateValue(b.createdAt)-facebookBumpDateValue(a.createdAt)).slice(0,500);
  const settings=facebookBumpSettings(facebookBumpReadRowsFast(SHEETS.settings));return{posts:posts.map(facebookBumpPublicRecord),queue:queue.map(facebookBumpPublicRecord),history:history.map(facebookBumpPublicRecord),settings,triggerActive:facebookBumpTriggerActive(),mode:settings.mode};
}

function saveFacebookBumpPost(body,actor){return withLock(()=>{
  ensureFacebookBumpDatabase();
  const input=body.post||{},now=new Date(),posts=facebookBumpRows(SHEETS.facebookBumpPosts),existing=input.id?posts.find(post=>String(post.id)===String(input.id)):null;
  const name=safeSheetText(input.name,120),postUrl=String(input.postUrl||'').trim(),bumpMessage=safeSheetText(input.bumpMessage||facebookBumpSettings().defaultMessage,500),intervalMinutes=number(input.intervalMinutes||facebookBumpSettings().defaultInterval),enabled=facebookBumpBoolean(input.enabled);
  if(!name)throw Error('กรุณาตั้งชื่อโพสต์');
  if(!facebookBumpUrlValid(postUrl))throw Error('กรุณาใช้ URL โพสต์จาก facebook.com ที่ขึ้นต้นด้วย https://');
  if(!bumpMessage)throw Error('กรุณากำหนดข้อความดันโพสต์');
  if(!Number.isInteger(intervalMinutes)||intervalMinutes<5||intervalMinutes>10080)throw Error('รอบดันโพสต์ต้องเป็น 5–10,080 นาที');
  const record={
    id:existing?existing.id:makeId('FBP'),name,postUrl,bumpMessage,intervalMinutes,enabled:enabled?'TRUE':'FALSE',
    lastRunAt:existing?existing.lastRunAt:'',nextRunAt:enabled?(existing&&facebookBumpDateValue(existing.nextRunAt)>Date.now()?existing.nextRunAt:facebookBumpNextRunAt(now,intervalMinutes)):'',
    lastStatus:existing?existing.lastStatus:'READY',createdAt:existing?existing.createdAt:now,updatedAt:now,deletedAt:'',_row:existing&&existing._row
  };
  facebookBumpWriteRow(SHEETS.facebookBumpPosts,record);
  log(existing?'FACEBOOK_BUMP_POST_UPDATE':'FACEBOOK_BUMP_POST_CREATE','FACEBOOK_BUMP',record.id,record.name,'DRY_RUN • '+actor.userId);
  return output({ok:true,post:facebookBumpPublicRecord(record)});
});}

function deleteFacebookBumpPost(body,actor){return withLock(()=>{
  const id=String(body.id||''),post=facebookBumpRows(SHEETS.facebookBumpPosts).find(item=>String(item.id)===id&&!item.deletedAt);if(!post)throw Error('ไม่พบโพสต์');
  post.enabled='FALSE';post.deletedAt=new Date();post.updatedAt=new Date();post.lastStatus='DELETED';facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);
  facebookBumpRows(SHEETS.facebookBumpQueue).filter(job=>String(job.targetPostId)===id&&String(job.status)==='PENDING').forEach(job=>{job.status='CANCELLED';job.error='POST_DELETED';job.updatedAt=new Date();facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);});
  log('FACEBOOK_BUMP_POST_DELETE','FACEBOOK_BUMP',id,post.name,'SOFT_DELETE • '+actor.userId);return output({ok:true});
});}

function toggleFacebookBumpPost(body,actor){return withLock(()=>{
  const post=facebookBumpRows(SHEETS.facebookBumpPosts).find(item=>String(item.id)===String(body.id)&&!item.deletedAt);if(!post)throw Error('ไม่พบโพสต์');
  const enabled=facebookBumpBoolean(body.enabled);post.enabled=enabled?'TRUE':'FALSE';post.nextRunAt=enabled?facebookBumpNextRunAt(new Date(),post.intervalMinutes):'';post.updatedAt=new Date();post.lastStatus=enabled?'READY':'PAUSED';facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);
  log(enabled?'FACEBOOK_BUMP_RESUME':'FACEBOOK_BUMP_PAUSE','FACEBOOK_BUMP',post.id,post.name,actor.userId);return output({ok:true});
});}

function facebookBumpCreateJob(post,source,scheduledAt){
  const now=new Date(),record={jobId:makeId('FBJ'),targetPostId:post.id,postName:post.name,postUrl:post.postUrl,message:post.bumpMessage||'+',scheduledAt:scheduledAt||now,status:'PENDING',attempts:0,error:'',createdAt:now,updatedAt:now,source:source||'SCHEDULED'};
  return facebookBumpAppend(SHEETS.facebookBumpQueue,record);
}

function queueFacebookBumpNow(body,actor){return withLock(()=>{
  const post=facebookBumpRows(SHEETS.facebookBumpPosts).find(item=>String(item.id)===String(body.id)&&!item.deletedAt);if(!post)throw Error('ไม่พบโพสต์');
  const queue=facebookBumpRows(SHEETS.facebookBumpQueue),active=facebookBumpActiveJob(queue,post.id);if(active)return output({ok:true,duplicate:true,jobId:active.jobId,message:'โพสต์นี้มีงานรออยู่แล้ว'});
  const job=facebookBumpCreateJob(post,'MANUAL',new Date());log('FACEBOOK_BUMP_QUEUE_MANUAL','FACEBOOK_BUMP',post.id,post.name,actor.userId);return output({ok:true,jobId:job.jobId});
});}

function cancelFacebookBumpJob(body,actor){return withLock(()=>{
  const job=facebookBumpRows(SHEETS.facebookBumpQueue).find(item=>String(item.jobId)===String(body.jobId));if(!job)throw Error('ไม่พบงานในคิว');if(String(job.status)!=='PENDING')throw Error('ยกเลิกได้เฉพาะงานที่กำลังรอ');
  job.status='CANCELLED';job.error='CANCELLED_BY_'+actor.userId;job.updatedAt=new Date();facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);return output({ok:true});
});}

function retryFacebookBumpJob(body,actor){return withLock(()=>{
  const job=facebookBumpRows(SHEETS.facebookBumpQueue).find(item=>String(item.jobId)===String(body.jobId));if(!job)throw Error('ไม่พบงานในคิว');if(String(job.status)!=='FAILED')throw Error('Retry ได้เฉพาะงานที่ล้มเหลว');
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

function claimFacebookBumpJob(body,actor){return withLock(()=>{
  const now=new Date(),settings=facebookBumpSettings();if(settings.mode!=='REAL')return output({ok:true,job:null,reason:'DRY_RUN'});if(settings.paused)return output({ok:true,job:null,reason:'PAUSED'});if(facebookBumpDateValue(settings.nextJobAllowedAt)>now.getTime())return output({ok:true,job:null,reason:'DELAY'});
  const queue=facebookBumpRows(SHEETS.facebookBumpQueue);queue.filter(job=>String(job.status)==='PROCESSING'&&String(job.source).indexOf('REAL_WORKER:')===0&&now.getTime()-facebookBumpDateValue(job.updatedAt)>300000).forEach(job=>{job.status='PENDING';job.error='WORKER_LEASE_EXPIRED';job.updatedAt=now;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);});
  const job=facebookBumpSelectNextPending(queue,now);if(!job)return output({ok:true,job:null,reason:'EMPTY'});
  const post=facebookBumpRows(SHEETS.facebookBumpPosts).find(item=>String(item.id)===String(job.targetPostId)&&!item.deletedAt&&facebookBumpBoolean(item.enabled));if(!post){job.status='CANCELLED';job.error='POST_NOT_AVAILABLE';job.updatedAt=now;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);return output({ok:true,job:null,reason:'POST_NOT_AVAILABLE'});}
  job.status='PROCESSING';job.attempts=number(job.attempts)+1;job.error='';job.updatedAt=now;job.source='REAL_WORKER:'+actor.userId;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);facebookBumpSetSetting('facebookBumpNextJobAllowedAt',new Date(now.getTime()+settings.delaySeconds*1000),'Next Facebook Bump job gate');
  const previous=facebookBumpCleanupCandidate(facebookBumpRows(SHEETS.facebookOwnedComments),post.id,'');return output({ok:true,job:facebookBumpPublicRecord(job),previousOwnedComment:previous?facebookBumpPublicRecord(previous):null,cleanupOld:settings.cleanupOld});
});}

function completeFacebookBumpJob(body,actor){return withLock(()=>{
  const now=new Date(),job=facebookBumpRows(SHEETS.facebookBumpQueue).find(item=>String(item.jobId)===String(body.jobId));if(!job)throw Error('ไม่พบงานในคิว');if(String(job.status)==='COMPLETED')return output({ok:true,idempotent:true});if(String(job.status)!=='PROCESSING'||String(job.source).indexOf('REAL_WORKER:')!==0)throw Error('งานไม่ได้ถูกจองโดย Local Worker');
  const post=facebookBumpRows(SHEETS.facebookBumpPosts).find(item=>String(item.id)===String(job.targetPostId)&&!item.deletedAt),external=safeSheetText(body.externalCommentId,1000),message=safeSheetText(body.message||job.message,500),cleanupResult=safeSheetText(body.cleanupResult||'SKIPPED',500);if(!post)throw Error('ไม่พบโพสต์');if(!external)throw Error('ไม่มีหลักฐาน Comment ใหม่');
  const comments=facebookBumpRows(SHEETS.facebookOwnedComments),ownedId='REAL-'+String(job.jobId),existing=comments.find(item=>String(item.id)===ownedId);if(!existing)facebookBumpAppend(SHEETS.facebookOwnedComments,{id:ownedId,targetPostId:post.id,externalCommentId:external,message,createdAt:now,deletedAt:'',status:'ACTIVE'});
  if(cleanupResult==='DELETED'&&body.previousCommentId){const previous=comments.find(item=>String(item.targetPostId)===String(post.id)&&String(item.externalCommentId)===String(body.previousCommentId)&&String(item.status)==='ACTIVE'&&!item.deletedAt);if(previous){previous.deletedAt=now;previous.status='DELETED';facebookBumpWriteRow(SHEETS.facebookOwnedComments,previous);}}
  job.status='COMPLETED';job.error='';job.updatedAt=now;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);post.lastRunAt=now;post.nextRunAt=facebookBumpNextRunAt(now,post.intervalMinutes);post.lastStatus=cleanupResult.indexOf('CLEANUP_FAILED')===0?'REAL_SUCCESS_CLEANUP_FAILED':'REAL_SUCCESS';post.updatedAt=now;facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);facebookBumpAppendHistory({targetPostId:post.id,postName:post.name,postUrl:job.postUrl||post.postUrl,action:'CREATE_COMMENT_REAL',message,result:'COMPLETED',commentId:external,cleanupResult,jobId:job.jobId});log('FACEBOOK_BUMP_REAL_SUCCESS','FACEBOOK_BUMP',post.id,post.name,actor.userId);return output({ok:true});
});}

function failFacebookBumpJob(body,actor){return withLock(()=>{
  const now=new Date(),job=facebookBumpRows(SHEETS.facebookBumpQueue).find(item=>String(item.jobId)===String(body.jobId));if(!job)throw Error('ไม่พบงานในคิว');if(String(job.status)==='FAILED')return output({ok:true,idempotent:true});if(String(job.status)!=='PROCESSING')throw Error('งานไม่ได้อยู่ระหว่างทำงาน');const error=safeSheetText(body.error||'REAL_EXECUTOR_FAILED',500),post=facebookBumpRows(SHEETS.facebookBumpPosts).find(item=>String(item.id)===String(job.targetPostId));job.status='FAILED';job.error=error;job.updatedAt=now;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);if(post){post.lastStatus=/LOGIN|CHECKPOINT|CAPTCHA|2FA/.test(error)?'LOGIN_REQUIRED':'REAL_FAILED';post.updatedAt=now;facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);}facebookBumpAppendHistory({targetPostId:job.targetPostId,postName:job.postName,postUrl:job.postUrl,action:'CREATE_COMMENT_REAL',message:job.message,result:'FAILED',cleanupResult:'NOT_RUN',error,jobId:job.jobId});log('FACEBOOK_BUMP_REAL_FAILED','FACEBOOK_BUMP',job.targetPostId,job.postName,actor.userId+' • '+error);return output({ok:true});
});}

function setFacebookBumpGlobalPause(paused,body,actor){return withLock(()=>{
  facebookBumpSetSetting('facebookBumpPaused',paused?'TRUE':'FALSE','Pause all Facebook Bump jobs');
  if(!paused)facebookBumpSetSetting('facebookBumpNextJobAllowedAt',new Date(),'Resume queue safely');
  log(paused?'FACEBOOK_BUMP_PAUSE_ALL':'FACEBOOK_BUMP_RESUME_ALL','FACEBOOK_BUMP','','',actor.userId);return output({ok:true,paused});
});}

function ensureFacebookBumpTriggerAction(body,actor){
  requireRole(body.token,['OWNER','ADMIN']);
  const existing=ScriptApp.getProjectTriggers().filter(trigger=>trigger.getHandlerFunction()===FACEBOOK_BUMP_TRIGGER_HANDLER);
  if(!existing.length)ScriptApp.newTrigger(FACEBOOK_BUMP_TRIGGER_HANDLER).timeBased().everyMinutes(1).create();
  log('FACEBOOK_BUMP_TRIGGER','FACEBOOK_BUMP','','','DRY_RUN • '+actor.userId);return output({ok:true,active:true,created:!existing.length});
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
    post.lastRunAt=runAt;post.nextRunAt=facebookBumpNextRunAt(runAt,post.intervalMinutes);post.lastStatus='DRY_RUN_SUCCESS';post.updatedAt=runAt;facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);
    facebookBumpAppendHistory({targetPostId:post.id,postName:post.name,postUrl:job.postUrl||post.postUrl,action:'CREATE_COMMENT_DRY_RUN',message:job.message,result:'COMPLETED',commentId:owned.externalCommentId,cleanupResult,jobId:job.jobId});
    return{status:'COMPLETED',commentId:owned.externalCommentId,cleanupResult};
  }catch(error){
    job.status='FAILED';job.error=safeAdminError(error);job.updatedAt=runAt;facebookBumpWriteRow(SHEETS.facebookBumpQueue,job);
    post.lastStatus='DRY_RUN_FAILED';post.nextRunAt=facebookBumpNextRunAt(runAt,post.intervalMinutes);post.updatedAt=runAt;facebookBumpWriteRow(SHEETS.facebookBumpPosts,post);
    facebookBumpAppendHistory({targetPostId:post.id,postName:post.name,postUrl:job.postUrl||post.postUrl,action:'CREATE_COMMENT_DRY_RUN',message:job.message,result:'FAILED',cleanupResult:'NOT_RUN',error:job.error,jobId:job.jobId});return{status:'FAILED',error:job.error};
  }
}

function facebookBumpSchedulerTick(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return{ok:true,skipped:'LOCKED'};
  try{
    ensureDatabase();const now=new Date(),settings=facebookBumpSettings(),posts=facebookBumpRows(SHEETS.facebookBumpPosts).filter(post=>!post.deletedAt&&facebookBumpBoolean(post.enabled)),queue=facebookBumpRows(SHEETS.facebookBumpQueue);
    facebookBumpPlanDuePosts(posts,queue,now).forEach(post=>{const job=facebookBumpCreateJob(post,'SCHEDULED',post.nextRunAt);queue.push(job);});
    if(settings.paused)return{ok:true,skipped:'PAUSED'};
    if(facebookBumpDateValue(settings.nextJobAllowedAt)>now.getTime())return{ok:true,skipped:'DELAY'};
    const pending=facebookBumpSelectNextPending(facebookBumpRows(SHEETS.facebookBumpQueue),now);
    if(!pending)return{ok:true,processed:0};
    if(settings.mode==='REAL')return{ok:true,processed:0,waitingForWorker:true};
    const result=facebookBumpExecuteJob(pending,new DryRunFacebookBumpExecutor(),now);facebookBumpSetSetting('facebookBumpNextJobAllowedAt',new Date(now.getTime()+settings.delaySeconds*1000),'Next Facebook Bump job gate');return{ok:true,processed:1,result};
  }finally{lock.releaseLock();}
}
