/**
 * GUN SHOP DMO 3.1 API (V20.1 Stability & Security Final)
 * - Customer: Seals, Items, Services, Orders
 * - Admin: Dashboard, calculator, catalog, orders, settings, logs
 * - DMO Wiki Seal Master image gallery + import to Google Drive
 */
const SHEETS = { seals:'Seals', items:'Items', services:'Services', settings:'Settings', orders:'Orders', logs:'Logs', stockLogs:'StockLogs', stockRequests:'StockRequests', customers:'Customers', promotions:'Promotions', promotionProducts:'PromotionProducts', system:'System', trash:'Trash', wikiCache:'WikiCache', customerInteractions:'CustomerInteractions', reportSettings:'ReportSettings', users:'Users', sessions:'Sessions', backups:'Backups', notifications:'Notifications', orderItems:'OrderItems', orderRequests:'OrderRequests' };
const HEADERS = {
  seals:['id','name','aliases','category','section','price','unit','packSize','status','stock','note','imageUrl','wikiName','badge','sortOrder','updatedAt','reservedStock','lowStockAlert','costPrice','wikiTitle','wikiUrl','wikiImageSource','tags','searchKeywords','wikiSyncedAt'],
  items:['id','name','aliases','itemCategory','price','unit','status','stock','note','description','imageUrl','badge','sortOrder','updatedAt','reservedStock','lowStockAlert','costPrice','tags','searchKeywords'],
  services:['id','name','aliases','serviceCategory','price','unit','status','stock','note','description','imageUrl','badge','sortOrder','updatedAt','tags','searchKeywords'],
  settings:['key','value','description'],
  orders:['orderId','createdAt','tamer','server','contact','itemsJson','total','promoSets','status','adminNote','updatedAt','requestId','pricingJson','inventoryState','deletedAt','deletedBy','deleteReason','legacyOrder'],
  logs:['createdAt','action','kind','id','name','details'],
  stockLogs:['createdAt','kind','productId','productName','beforeStock','changeQty','afterStock','reservedStock','availableStock','action','reason','admin'],
  stockRequests:['requestId','createdAt','action','kind','productId','actor','responseJson'],
  customers:['customerId','createdAt','updatedAt','tamer','server','contact','orderCount','totalSpent','vipLevel','status','note','lastOrderAt','tags','preferredContact','followUpAt','lastContactAt'],
  promotions:['promotionId','name','type','value','minSpend','buyQty','freeQty','rewardText','startAt','endAt','status','priority','stackable','scope','note','updatedAt'],
  promotionProducts:['promotionId','kind','productId','productName'],
  system:['key','value','description'],
  trash:['deletedAt','kind','id','name','dataJson','deletedBy'],
  wikiCache:['cachedAt','query','title','url','thumbnail','extract'],
  customerInteractions:['interactionId','createdAt','customerId','customerName','type','channel','note','nextFollowUpAt','admin'],
  reportSettings:['key','value','description'],
  users:['userId','displayName','passwordHash','role','status','createdAt','updatedAt','lastLoginAt','passwordSalt','passwordAlgo','mustChangePassword','failedLoginCount','lockedUntil'],
  sessions:['token','userId','role','createdAt','expiresAt','lastSeenAt','status'],
  backups:['backupId','createdAt','createdBy','reason','fileId','fileUrl','fileName','sizeBytes','status'],
  notifications:['notificationId','createdAt','type','severity','title','message','status','relatedId'],
  orderItems:['orderItemId','orderId','kind','productId','productName','quantity','unit','unitPrice','lineTotal','pickStatus','stockCheck','createdAt','updatedAt'],
  orderRequests:['requestId','createdAt','orderId','contactHash','status','responseJson']
};
const DEFAULT_SETTINGS = {
  shopName:'GUN SHOP DMO', ownerName:'Natthananat Kawinwatthanakorn', promoThreshold:100, promoReward:150,
  orderNotice:'รายการนี้ยังไม่ใช่การยืนยันคำสั่งซื้อ กรุณารอร้านตรวจสอบสต๊อกและยืนยันยอดก่อนโอน',
  autoRefreshSeconds:60, allowOrderSave:'TRUE', showStock:'TRUE', facebookUrl:'', lineUrl:'',
  sessionDays:7, autoLockMinutes:30, apiKey:'',
  backupEnabled:'TRUE', backupHour:3, backupRetention:14, alertLowStock:'TRUE', alertNewOrders:'TRUE',
  themeDefault:'DARK', enablePWA:'TRUE', offlineCacheHours:12, mobileCompact:'TRUE', showMobileBottomNav:'TRUE',
  orderSuccessMessage:'ส่งรายการให้ทางร้านเรียบร้อยแล้ว ทางร้านจะตรวจสอบสต๊อกและจัดรายการให้', orderPrefix:'GUN'
};

const PUBLIC_PRODUCT_FIELDS=['id','kind','name','aliases','category','section','itemCategory','serviceCategory','description','price','unit','packSize','status','imageUrl','wikiName','badge','sortOrder','wikiTitle','wikiUrl','tags','searchKeywords'];
const PUBLIC_SETTING_FIELDS=['shopName','ownerName','promoThreshold','promoReward','orderNotice','autoRefreshSeconds','allowOrderSave','showStock','facebookUrl','lineUrl','themeDefault','enablePWA','offlineCacheHours','mobileCompact','showMobileBottomNav','orderSuccessMessage'];
const PUBLIC_PROMOTION_FIELDS=['promotionId','name','type','value','minSpend','buyQty','freeQty','rewardText','startAt','endAt','status','priority','stackable','scope'];
const ORDER_TRANSITIONS={NEW:['CHECKING','CANCELLED'],CHECKING:['PREPARING','CANCELLED'],PREPARING:['READY','CANCELLED'],READY:['COMPLETED','CANCELLED'],COMPLETED:[],CANCELLED:[]};
const PASSWORD_ALGO='ITERATED-HMAC-SHA256-6000';
const KNOWN_INSECURE_OWNER_HASH='77acc467d71ca17d5a480aa17d8b0b05d536139a61c99a08d1573dd81eab7d03';
const PUBLIC_CACHE_KEY='public-catalog-v20-1-perf-1';
const PRODUCTION_SPREADSHEET_ID='1AXYpPnrBRQPYhdDYODV80S4UTz5-gLEXIO_Jn8Rt-sM';
const TEST_SPREADSHEET_ID='1WPtJgFe7jswHafieD7zJ19pjSxrdFZACT4iLCi_PfLM';
const PUBLIC_CACHE_MUTATIONS=['createOrder','upsert','delete','softDelete','restoreTrash','permanentDelete','bulkUpdate','saveSettings','adjustStock','setStock','upsertPromotion','deletePromotion','updateOrder'];

function doGet(e){
  try {
    return output({ok:true,...readPublic(),updatedAt:new Date().toISOString()});
  } catch(err){ return publicFailure(err); }
}

function doPost(e){
  let publicAction=false;
  try {
    const rawBody=(e.postData&&e.postData.contents)||'{}';
    if(rawBody.length>200000)throw Error('คำขอมีขนาดใหญ่เกินกำหนด');
    const body=JSON.parse(rawBody);
    if(PUBLIC_CACHE_MUTATIONS.includes(body.action))invalidatePublicCache();
    publicAction=body.action==='login'||body.action==='createOrder';
    if(body.action==='login'){ensureDatabase();return login(body);}
    if(body.action==='createOrder'){ensureDatabase();return createOrder(body);}
    if(body.action==='logout') return logout(body.token);
    ensureDatabase();
    const session=getSession(body.token,true);
    if(!session) throw Error('กรุณาเข้าสู่ระบบใหม่');
    const actor={userId:String(session.userId),role:String(session.role||'VIEWER')};
    const adminWriteActions=['upsert','delete','softDelete','restoreTrash','permanentDelete','bulkUpdate','saveSettings','uploadImage','importWikiImage','attachWikiMetadata','upsertPromotion','deletePromotion','createBackup','restoreBackup','setupBackupTrigger','deleteBackup','saveSecurityUser','adjustStock','setStock','syncStock'];
    const staffWriteActions=['updateOrder','updateOrderItemPick','updateCustomer','addCustomerInteraction'];
    if(adminWriteActions.includes(body.action)) requireRole(body.token,['OWNER','ADMIN']);
    if(staffWriteActions.includes(body.action)) requireRole(body.token,['OWNER','ADMIN','STAFF']);
    switch(body.action){
      case'getAdminData': return output({ok:true,...readAdmin(actor)});
      case'upsert': return upsert(body.record,actor.userId);
      case'delete': return softDelete(body.kind,body.id,actor.userId);
      case'softDelete': return softDelete(body.kind,body.id,actor.userId);
      case'restoreTrash': return restoreTrash(body.trashId,actor.userId);
      case'permanentDelete': return permanentDelete(body.trashId,actor.userId);
      case'bulkUpdate': return bulkUpdate(body.records,body.changes,actor.userId);
      case'saveSettings': requireRole(body.token,['OWNER','ADMIN']);return saveSettings(body.settings,actor.userId);
      case'updateOrder': return updateOrder(body,actor.userId);
      case'updateOrderItemPick': return updateOrderItemPick(body,actor.userId);
      case'archiveOrder': requireRole(body.token,['OWNER','ADMIN']);return archiveOrder(body,actor.userId);
      case'restoreArchivedOrder': requireRole(body.token,['OWNER','ADMIN']);return restoreArchivedOrder(body,actor.userId);
      case'uploadImage': return uploadImage(body);
      case'wikiGallery': return output({ok:true,images:getWikiSealImages()});
      case'importWikiImage': return importWikiImage(body);
      case'wikiSearchPages': return output({ok:true,results:searchDmoWikiPages(body.query)});
      case'attachWikiMetadata': return attachWikiMetadata(body);
      case'adjustStock': return adjustStock(body,actor.userId);
      case'setStock': return setStock(body,actor.userId);
      case'syncStock': invalidatePublicCache();markStockUpdated();return output({ok:true,stockUpdatedAt:stockUpdatedAt(),message:'ซิงก์ข้อมูลสต๊อกแล้ว'});
      case'updateCustomer': return updateCustomer(body);
      case'addCustomerInteraction': return addCustomerInteraction(body,actor.userId);
      case'upsertPromotion': return upsertPromotion(body.promotion);
      case'deletePromotion': return deletePromotion(body.promotionId);
      case'saveSecurityUser': return saveSecurityUser(body,actor);
      case'changeOwnerPassword': return changeOwnerPassword(body,actor);
      case'createBackup': return createBackupAction(body,actor);
      case'restoreBackup': return restoreBackupAction(body,actor);
      case'setupBackupTrigger': return setupBackupTriggerAction(body,actor);
      case'deleteBackup': return deleteBackupAction(body,actor);
      case'runIntegrityCheck': requireRole(body.token,['OWNER','ADMIN']);return output({ok:true,integrity:runIntegrityCheck()});
      case'initialize': return output({ok:true,message:'ฐานข้อมูลพร้อมใช้งาน'});
      default: throw Error('ไม่รู้จักคำสั่ง');
    }
  } catch(err){ return publicAction?publicFailure(err):output({ok:false,error:safeAdminError(err)}); }
}

function ss(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet(name,headers){
  let s=ss().getSheetByName(name);
  if(!s) s=ss().insertSheet(name);
  if(s.getLastRow()===0) s.getRange(1,1,1,headers.length).setValues([headers]);
  const actual=s.getRange(1,1,1,Math.max(s.getLastColumn(),headers.length)).getDisplayValues()[0];
  if(String(actual[0]||'').trim()!==headers[0]) throw Error('หัวตารางชีต '+name+' ไม่ถูกต้อง กรุณาใช้ไฟล์ฐานข้อมูล Part 1');
  // Append newly introduced columns without deleting current data.
  const current=s.getRange(1,1,1,s.getLastColumn()).getDisplayValues()[0].map(String);
  headers.forEach((h)=>{ if(!current.includes(h)){ s.getRange(1,s.getLastColumn()+1).setValue(h); current.push(h); } });
  return s;
}
function ensureDatabase(){
  const cache=CacheService.getScriptCache(),cacheKey='database-ready-3.1.0';
  if(cache.get(cacheKey)==='TRUE')return;
  sheet(SHEETS.seals,HEADERS.seals); sheet(SHEETS.items,HEADERS.items); sheet(SHEETS.services,HEADERS.services);
  sheet(SHEETS.settings,HEADERS.settings); sheet(SHEETS.orders,HEADERS.orders); sheet(SHEETS.orderRequests,HEADERS.orderRequests); sheet(SHEETS.logs,HEADERS.logs); sheet(SHEETS.stockLogs,HEADERS.stockLogs); sheet(SHEETS.stockRequests,HEADERS.stockRequests);
  sheet(SHEETS.customers,HEADERS.customers); sheet(SHEETS.customerInteractions,HEADERS.customerInteractions); sheet(SHEETS.promotions,HEADERS.promotions); sheet(SHEETS.promotionProducts,HEADERS.promotionProducts); sheet(SHEETS.system,HEADERS.system); sheet(SHEETS.trash,HEADERS.trash); sheet(SHEETS.wikiCache,HEADERS.wikiCache); sheet(SHEETS.reportSettings,HEADERS.reportSettings); sheet(SHEETS.users,HEADERS.users); sheet(SHEETS.sessions,HEADERS.sessions); sheet(SHEETS.backups,HEADERS.backups); sheet(SHEETS.notifications,HEADERS.notifications); sheet(SHEETS.orderItems,HEADERS.orderItems);
  seedSettings(); seedSystem(); seedDefaultPromotions(); seedSecurity(); migrateLegacy();
  cache.put(cacheKey,'TRUE',300);
}
function seedSettings(){
  const s=sheet(SHEETS.settings,HEADERS.settings), values=s.getDataRange().getValues(), keys=new Set(values.slice(1).map(r=>String(r[0])));
  Object.keys(DEFAULT_SETTINGS).forEach(k=>{if(!keys.has(k))s.appendRow([k,DEFAULT_SETTINGS[k],'']);});
}

function seedSystem(){
  const s=sheet(SHEETS.system,HEADERS.system),values=s.getDataRange().getValues(),map={};
  values.slice(1).forEach(r=>map[String(r[0])]=r[1]);
  if(!map.databaseVersion)s.appendRow(['databaseVersion','3.1.0','GUN SHOP DMO V20.1 Stability & Security Final']);
  else setSystemValue('databaseVersion','3.1.0','GUN SHOP DMO V20.1 Stability & Security Final');
  if(!map.appFamily)s.appendRow(['appFamily','GUN SHOP DMO','ชื่อชุดระบบ']); else setSystemValue('appFamily','GUN SHOP DMO','ชื่อชุดระบบ');
  if(!map.installedAt)s.appendRow(['installedAt',new Date(),'วันที่ติดตั้งครั้งแรก']);
  setSystemValue('lastMigrationAt',new Date(),'วันที่ปรับโครงสร้างล่าสุด');
}
function setSystemValue(key,value,description){
  const s=sheet(SHEETS.system,HEADERS.system),vals=s.getDataRange().getValues();
  for(let i=1;i<vals.length;i++)if(String(vals[i][0])===key){s.getRange(i+1,2).setValue(value);if(description)s.getRange(i+1,3).setValue(description);return;}
  s.appendRow([key,value,description||'']);
}
function seedDefaultPromotions(){
  const s=sheet(SHEETS.promotions,HEADERS.promotions);if(s.getLastRow()>1)return;
  s.appendRow(['PROMO-D2','โปรโมชั่น D2','REWARD_PER_SPEND',150,100,'','','รับ D2 150 อัน ทุกยอดซื้อครบ 100 บาท','','','ACTIVE',10,'TRUE','ALL','โปรเดิมของร้าน',new Date()]);
}

function sha256(value){
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value||''),Utilities.Charset.UTF_8);
  return bytes.map(b=>('0'+((b<0?b+256:b).toString(16))).slice(-2)).join('');
}
function settingValue(key, fallback){
  const list=rows(SHEETS.settings),found=list.find(x=>String(x.key)===String(key));
  return found ? smart(found.value) : fallback;
}
function randomSalt(){return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');}
function bytesToHex(bytes){return bytes.map(b=>('0'+((b<0?b+256:b).toString(16))).slice(-2)).join('');}
function passwordHashV2(password,salt){
  let value=Utilities.newBlob(String(salt)+'\u0000'+String(password||'')).getBytes();
  const key=Utilities.newBlob(String(password||'')).getBytes();
  for(let i=0;i<6000;i++)value=Utilities.computeHmacSha256Signature(value,key);
  return bytesToHex(value);
}
function securePasswordRecord(password){const salt=randomSalt();return{salt,hash:passwordHashV2(password,salt),algo:PASSWORD_ALGO};}
function passwordMatches(password,stored,salt,algo){return String(algo||'')===PASSWORD_ALGO&&salt?passwordHashV2(password,salt)===String(stored||''):sha256(password)===String(stored||'');}
function environmentInfo(){const id=ss().getId();return{environment:id===PRODUCTION_SPREADSHEET_ID?'PRODUCTION':id===TEST_SPREADSHEET_ID?'TEST':'BACKUP',ownerSetupAllowed:id===PRODUCTION_SPREADSHEET_ID||id===TEST_SPREADSHEET_ID};}
function seedSecurity(){
  const u=sheet(SHEETS.users,HEADERS.users),v=u.getDataRange().getValues(),h=v[0].map(String),now=new Date();
  for(let i=1;i<v.length;i++){
    const hash=String(v[i][h.indexOf('passwordHash')]||''),status=String(v[i][h.indexOf('status')]||'ACTIVE');
    if(hash===KNOWN_INSECURE_OWNER_HASH&&status==='ACTIVE'){
      u.getRange(i+1,h.indexOf('status')+1).setValue('RESET_REQUIRED');
      u.getRange(i+1,h.indexOf('mustChangePassword')+1).setValue('TRUE');
      u.getRange(i+1,h.indexOf('updatedAt')+1).setValue(now);
    }
  }
  setSystemValue('securityVersion','2.0','V20.1 salted password storage and throttling');
}
function cleanupSessions(){
  const s=sheet(SHEETS.sessions,HEADERS.sessions),v=s.getDataRange().getValues();if(v.length<2)return;
  const h=v[0].map(String),exp=h.indexOf('expiresAt'),status=h.indexOf('status'),now=Date.now();
  for(let i=v.length-1;i>=1;i--){if(String(v[i][status])!=='ACTIVE'||new Date(v[i][exp]).getTime()<now)s.deleteRow(i+1);}
}
function getSession(token,touch){
  if(!token)return null;const s=sheet(SHEETS.sessions,HEADERS.sessions),v=s.getDataRange().getValues(),h=v[0].map(String),now=Date.now();
  for(let i=1;i<v.length;i++)if(String(v[i][0])===String(token)&&String(v[i][h.indexOf('status')])==='ACTIVE'){
    if(new Date(v[i][h.indexOf('expiresAt')]).getTime()<now){s.getRange(i+1,h.indexOf('status')+1).setValue('EXPIRED');return null;}
    if(touch)s.getRange(i+1,h.indexOf('lastSeenAt')+1).setValue(new Date());
    return Object.fromEntries(h.map((k,j)=>[k,v[i][j]]));
  }return null;
}
function validToken(token){return !!getSession(token,true);}
function currentActor(token){const s=getSession(token,false);return s?{userId:String(s.userId),role:String(s.role||'VIEWER')}:null;}
function requireRole(token,allowed){const a=currentActor(token);if(!a)throw Error('กรุณาเข้าสู่ระบบใหม่');if(!allowed.includes(a.role))throw Error('บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้');return a;}
function loginThrottleKey(id){return'login-'+sha256(String(id||'').toLowerCase()).slice(0,32);}
function registerUnknownLoginFailure(id){const c=CacheService.getScriptCache(),k=loginThrottleKey(id),n=number(c.get(k))+1;c.put(k,String(n),900);if(n>=6)throw Error('ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที');}
function login(b){
  const u=sheet(SHEETS.users,HEADERS.users),v=u.getDataRange().getValues(),h=v[0].map(String),id=String(b.adminId||'').trim(),password=String(b.password||''),now=new Date();
  for(let i=1;i<v.length;i++)if(String(v[i][h.indexOf('userId')])===id){
    const row=i+1,status=String(v[i][h.indexOf('status')]||'ACTIVE'),lockedAt=v[i][h.indexOf('lockedUntil')],lockedUntil=lockedAt?new Date(lockedAt):null;
    if(status==='RESET_REQUIRED')throw Error('บัญชีนี้ต้องตั้งรหัสผ่านใหม่ในชีต Users ก่อนใช้งาน');
    if(status!=='ACTIVE')throw Error('ไอดีหรือรหัสผ่านไม่ถูกต้อง');
    if(lockedUntil&&lockedUntil.getTime()>Date.now())throw Error('บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง');
    const algo=String(v[i][h.indexOf('passwordAlgo')]||''),salt=String(v[i][h.indexOf('passwordSalt')]||''),stored=String(v[i][h.indexOf('passwordHash')]||'');
    const valid=passwordMatches(password,stored,salt,algo);
    if(!valid){const count=number(v[i][h.indexOf('failedLoginCount')])+1;u.getRange(row,h.indexOf('failedLoginCount')+1).setValue(count);if(count>=5)u.getRange(row,h.indexOf('lockedUntil')+1).setValue(new Date(Date.now()+15*60000));securityLog('LOGIN_FAILED',id,'INVALID_CREDENTIALS');throw Error(count>=5?'บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง':'ไอดีหรือรหัสผ่านไม่ถูกต้อง');}
    if(algo!==PASSWORD_ALGO){const rec=securePasswordRecord(password);u.getRange(row,h.indexOf('passwordHash')+1).setValue(rec.hash);u.getRange(row,h.indexOf('passwordSalt')+1).setValue(rec.salt);u.getRange(row,h.indexOf('passwordAlgo')+1).setValue(rec.algo);}
    const token=Utilities.getUuid()+Utilities.getUuid(),days=Math.max(1,Math.min(30,Number(settingValue('sessionDays',7))||7)),expires=new Date(now.getTime()+days*86400000),role=String(v[i][h.indexOf('role')]||'VIEWER');
    sheet(SHEETS.sessions,HEADERS.sessions).appendRow([token,id,role,now,expires,now,'ACTIVE']);[['lastLoginAt',now],['failedLoginCount',0],['lockedUntil','']].forEach(x=>u.getRange(row,h.indexOf(x[0])+1).setValue(x[1]));cleanupSessions();securityLog('LOGIN_SUCCESS',id,role);
    return output({ok:true,token,user:{userId:id,displayName:String(v[i][h.indexOf('displayName')]||id),role,mustChangePassword:String(v[i][h.indexOf('mustChangePassword')]||'FALSE')==='TRUE'},expiresAt:expires});
  }registerUnknownLoginFailure(id);securityLog('LOGIN_FAILED',id,'UNKNOWN_USER');throw Error('ไอดีหรือรหัสผ่านไม่ถูกต้อง');
}
function logout(token){const s=sheet(SHEETS.sessions,HEADERS.sessions),v=s.getDataRange().getValues(),h=v[0].map(String);for(let i=1;i<v.length;i++)if(String(v[i][0])===String(token)){s.getRange(i+1,h.indexOf('status')+1).setValue('LOGGED_OUT');break;}return output({ok:true});}
function securityLog(action,userId,details){sheet(SHEETS.logs,HEADERS.logs).appendRow([new Date(),action,'SECURITY',userId||'','',details||'']);}
function invalidateUserSessions(userId){const s=sheet(SHEETS.sessions,HEADERS.sessions),v=s.getDataRange().getValues();if(v.length<2)return 0;const h=v[0].map(String),uid=h.indexOf('userId'),status=h.indexOf('status');let count=0;for(let i=1;i<v.length;i++)if(String(v[i][uid])===String(userId)&&String(v[i][status])==='ACTIVE'){s.getRange(i+1,status+1).setValue('PASSWORD_CHANGED');count++;}return count;}
function changeOwnerPassword(b,actor){return withLock(()=>{const verified=requireRole(b.token,['OWNER']);if(String(actor.userId)!==String(verified.userId))throw Error('ไม่สามารถยืนยันบัญชีผู้ใช้ได้');const current=String(b.currentPassword||''),next=String(b.newPassword||''),confirm=String(b.confirmPassword||'');if(!current)throw Error('กรุณากรอกรหัสผ่านปัจจุบัน');if(next.length<10)throw Error('รหัสผ่านใหม่ต้องมีอย่างน้อย 10 ตัวอักษร');if(next!==confirm)throw Error('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน');if(current===next)throw Error('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน');const s=sheet(SHEETS.users,HEADERS.users),v=s.getDataRange().getValues(),h=v[0].map(String),uid=h.indexOf('userId');let row=-1;for(let i=1;i<v.length;i++)if(String(v[i][uid])===String(actor.userId)){row=i+1;break;}if(row<0||String(v[row-1][h.indexOf('role')])!=='OWNER'||String(v[row-1][h.indexOf('status')])!=='ACTIVE')throw Error('ไม่พบบัญชี OWNER ที่พร้อมใช้งาน');if(!passwordMatches(current,v[row-1][h.indexOf('passwordHash')],v[row-1][h.indexOf('passwordSalt')],v[row-1][h.indexOf('passwordAlgo')])){securityLog('OWNER_PASSWORD_CHANGE_REJECTED',actor.userId,'INVALID_CURRENT_PASSWORD');throw Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');}const rec=securePasswordRecord(next),set=(k,val)=>{const c=h.indexOf(k);if(c>=0)s.getRange(row,c+1).setValue(val);};set('passwordHash',rec.hash);set('passwordSalt',rec.salt);set('passwordAlgo',rec.algo);set('mustChangePassword','FALSE');set('failedLoginCount',0);set('lockedUntil','');set('updatedAt',new Date());const revoked=invalidateUserSessions(actor.userId);securityLog('OWNER_PASSWORD_CHANGED',actor.userId,'SESSIONS_REVOKED='+revoked);return output({ok:true,message:'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบอีกครั้ง'});});}
function listUsers(source){return (source||rows(SHEETS.users)).map(x=>({userId:x.userId,displayName:x.displayName,role:x.role,status:x.status,createdAt:x.createdAt,updatedAt:x.updatedAt,lastLoginAt:x.lastLoginAt}));}
function saveSecurityUser(b,actor){return withLock(()=>{requireRole(b.token,['OWNER']);const p=b.user||{},id=String(p.userId||'').trim();if(!id)throw Error('กรุณากรอก User ID');if(p.password&&String(p.password).length<10)throw Error('รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร');const role=['OWNER','ADMIN','STAFF','VIEWER'].includes(p.role)?p.role:'VIEWER',s=sheet(SHEETS.users,HEADERS.users),v=s.getDataRange().getValues(),h=v[0].map(String),now=new Date();let row=-1;for(let i=1;i<v.length;i++)if(String(v[i][0])===id){row=i+1;break;}const rec=p.password?securePasswordRecord(p.password):null;if(row<0){if(!rec)throw Error('ผู้ใช้ใหม่ต้องกำหนดรหัสผ่าน');const data={userId:id,displayName:p.displayName||id,passwordHash:rec.hash,role,status:p.status||'ACTIVE',createdAt:now,updatedAt:now,lastLoginAt:'',passwordSalt:rec.salt,passwordAlgo:rec.algo,mustChangePassword:'FALSE',failedLoginCount:0,lockedUntil:''};s.appendRow(HEADERS.users.map(k=>data[k]??''));}else{const set=(k,val)=>{const c=h.indexOf(k);if(c>=0)s.getRange(row,c+1).setValue(val);};set('displayName',p.displayName||id);set('role',role);set('status',p.status||'ACTIVE');set('updatedAt',now);if(rec){set('passwordHash',rec.hash);set('passwordSalt',rec.salt);set('passwordAlgo',rec.algo);set('mustChangePassword','FALSE');set('failedLoginCount',0);set('lockedUntil','');}}securityLog('USER_SAVE',actor.userId,id+' '+role);return output({ok:true});});}
function migrateLegacy(){
  const target=sheet(SHEETS.seals,HEADERS.seals); if(target.getLastRow()>1)return;
  const legacy=ss().getSheetByName('Prices'); if(legacy&&legacy.getLastRow()>1){migrateRowsFromSheet(legacy,'PRICES');return;}
}
function migrateRowsFromSheet(s,forcedCategory){
  const rows=readSheetFlexible(s),target=sheet(SHEETS.seals,HEADERS.seals);
  rows.forEach((r,i)=>{
    if(!r.name)return;
    const category=forcedCategory==='PRICES'?String(r.category||'').toUpperCase():forcedCategory;
    if(!['AT','HT','CT','HP','DS','DE','EV','BL'].includes(category))return;
    target.appendRow([r.id||makeId('SEAL'),r.name,r.aliases||'',category,r.section||'NORMAL',number(r.price),r.unit||'ชุด',number(r.packSize)||1000,r.status||'ACTIVE',r.stock||'',r.note||'',r.imageUrl||'',r.wikiName||'','',number(r.sortOrder)||i+10,new Date()]);
  });
  log('MIGRATE','SYSTEM',s.getName(),s.getName(),'ย้ายข้อมูลเดิมเข้า Seals');
}
function readSheetFlexible(s){
  const vals=s.getDataRange().getDisplayValues(); let headerRow=0;
  for(let i=0;i<Math.min(vals.length,5);i++){if(vals[i].map(String).includes('id')&&vals[i].map(String).includes('name')){headerRow=i;break;}}
  const h=vals[headerRow].map(x=>String(x).trim());
  return vals.slice(headerRow+1).map(r=>{const o={};h.forEach((k,i)=>{if(k)o[k]=r[i];});return o;}).filter(o=>Object.keys(o).some(k=>String(o[k]??'').trim()!==''));
}
function rows(name){
  const key=Object.keys(SHEETS).find(k=>SHEETS[k]===name);
  return readSheetFlexible(sheet(name,HEADERS[key]||[]));
}
function rowsTail(name,limit){
  const key=Object.keys(SHEETS).find(k=>SHEETS[k]===name),s=sheet(name,HEADERS[key]||[]),lastRow=s.getLastRow(),lastCol=s.getLastColumn();
  if(lastRow<2||lastCol<1)return[];
  const h=s.getRange(1,1,1,lastCol).getDisplayValues()[0].map(x=>String(x).trim()),start=Math.max(2,lastRow-Math.max(1,number(limit))+1),vals=s.getRange(start,1,lastRow-start+1,lastCol).getDisplayValues();
  return vals.map(r=>{const o={};h.forEach((k,i)=>{if(k)o[k]=r[i];});return o;}).filter(o=>Object.keys(o).some(k=>String(o[k]??'').trim()!==''));
}
function existingRows(name){const s=ss().getSheetByName(name);return s?readSheetFlexible(s):[];}
function pickFields(source,fields){const out={};fields.forEach(k=>{if(source[k]!==undefined)out[k]=source[k];});return out;}
function publicProduct(product){const out=pickFields(product,PUBLIC_PRODUCT_FIELDS);out.availableStock=availableQty(product.stock,product.reservedStock);Object.keys(out).forEach(k=>{if(out[k]===undefined||out[k]===null||out[k]===''||(Array.isArray(out[k])&&!out[k].length))delete out[k];});return out;}
function publicSettings(){const all={};existingRows(SHEETS.settings).forEach(x=>{if(PUBLIC_SETTING_FIELDS.includes(String(x.key)))all[x.key]=smart(x.value);});return all;}
function publicPromotion(p){return pickFields(p,PUBLIC_PROMOTION_FIELDS);}
function invalidatePublicCache(){const cache=CacheService.getScriptCache(),meta=Number(cache.get(PUBLIC_CACHE_KEY+'-count')||0),keys=[PUBLIC_CACHE_KEY+'-count'];for(let i=0;i<meta;i++)keys.push(PUBLIC_CACHE_KEY+'-'+i);cache.removeAll(keys);}
function getCachedPublic(){const cache=CacheService.getScriptCache(),count=Number(cache.get(PUBLIC_CACHE_KEY+'-count')||0);if(!count)return null;let json='';for(let i=0;i<count;i++){const part=cache.get(PUBLIC_CACHE_KEY+'-'+i);if(part===null)return null;json+=part;}try{return JSON.parse(json);}catch(e){return null;}}
function putCachedPublic(data){const cache=CacheService.getScriptCache(),json=JSON.stringify(data),size=30000,count=Math.ceil(json.length/size),entries={};entries[PUBLIC_CACHE_KEY+'-count']=String(count);for(let i=0;i<count;i++)entries[PUBLIC_CACHE_KEY+'-'+i]=json.slice(i*size,(i+1)*size);cache.putAll(entries,20);}
function readPublic(){
  const cached=getCachedPublic();if(cached)return cached;
  const seals=existingRows(SHEETS.seals).filter(x=>x.id&&x.name).map(normalizeSeal).filter(x=>!['HIDDEN','INACTIVE'].includes(String(x.status))).map(publicProduct);
  const gameItems=existingRows(SHEETS.items).filter(x=>x.id&&x.name).map(normalizeItem).filter(x=>!['HIDDEN','INACTIVE'].includes(String(x.status))).map(publicProduct);
  const services=existingRows(SHEETS.services).filter(x=>x.id&&x.name).map(normalizeService).filter(x=>!['HIDDEN','INACTIVE'].includes(String(x.status))).map(publicProduct);
  const promotions=existingRows(SHEETS.promotions).filter(x=>x.promotionId&&x.name).map(normalizePromotion).filter(p=>p.status==='ACTIVE').map(publicPromotion);
  const result={seals,gameItems,services,settings:publicSettings(),promotions,stockUpdatedAt:stockUpdatedAt()};putCachedPublic(result);return result;
}
function readAdmin(actor){
  const seals=rows(SHEETS.seals).filter(x=>x.id&&x.name).map(normalizeSeal),gameItems=rows(SHEETS.items).filter(x=>x.id&&x.name).map(normalizeItem),services=rows(SHEETS.services).filter(x=>x.id&&x.name).map(normalizeService),settingRows=rows(SHEETS.settings),settings={};settingRows.forEach(x=>{if(String(x.key)!=='apiKey'||(actor&&['OWNER','ADMIN'].includes(actor.role)))settings[x.key]=smart(x.value);});
  const orders=rows(SHEETS.orders),reversedOrders=orders.slice().reverse(),customers=rows(SHEETS.customers),users=actor&&actor.role==='OWNER'?rows(SHEETS.users):[],systemRows=rows(SHEETS.system),setting=(key,fallback)=>Object.prototype.hasOwnProperty.call(settings,key)?settings[key]:fallback;
  const actorUser=actor?rows(SHEETS.users).find(x=>String(x.userId)===String(actor.userId)):null,environment=environmentInfo();
  return{seals,gameItems,services,settings,orders:reversedOrders.filter(x=>!x.deletedAt).slice(0,500),deletedOrders:actor&&['OWNER','ADMIN'].includes(actor.role)?reversedOrders.filter(x=>!!x.deletedAt).slice(0,500):[],orderItems:rowsTail(SHEETS.orderItems,5000).reverse(),logs:rowsTail(SHEETS.logs,300).reverse(),stockLogs:rowsTail(SHEETS.stockLogs,500).reverse(),stockUpdatedAt:stockUpdatedAt(),customers:customers.slice().reverse().slice(0,1500),customerInteractions:rowsTail(SHEETS.customerInteractions,3000).reverse(),promotions:rows(SHEETS.promotions).map(normalizePromotion),trash:rowsTail(SHEETS.trash,1000).reverse(),databaseVersion:(systemRows.find(x=>String(x.key)==='databaseVersion')||{}).value||'3.1.0',security:{actor,account:actorUser?{userId:actorUser.userId,displayName:actorUser.displayName,role:actorUser.role,status:actorUser.status}:null,environment:environment.environment,users:listUsers(users),sessionDays:setting('sessionDays',7),autoLockMinutes:setting('autoLockMinutes',30),apiKeyConfigured:!!String(setting('apiKey',''))},automation:getAutomationData(actor,{seals,gameItems,orders:orders.filter(x=>!x.deletedAt),customers,settings})};
}
function normalizeSeal(x){return{...x,kind:'SEAL',price:number(x.price),packSize:number(x.packSize)||1,stock:x.stock===''?'':number(x.stock),reservedStock:number(x.reservedStock),lowStockAlert:number(x.lowStockAlert),costPrice:x.costPrice===''?'':number(x.costPrice),sortOrder:number(x.sortOrder),aliases:splitAliases(x.aliases)};}
function normalizeItem(x){return{...x,kind:'ITEM',price:number(x.price),stock:x.stock===''?'':number(x.stock),reservedStock:number(x.reservedStock),lowStockAlert:number(x.lowStockAlert),costPrice:x.costPrice===''?'':number(x.costPrice),sortOrder:number(x.sortOrder),aliases:splitAliases(x.aliases)};}
function normalizeService(x){return{...x,kind:'SERVICE',price:number(x.price),stock:x.stock===''?'':number(x.stock),sortOrder:number(x.sortOrder),aliases:splitAliases(x.aliases)};}
function normalizePromotion(x){return{...x,value:number(x.value),minSpend:number(x.minSpend),buyQty:number(x.buyQty),freeQty:number(x.freeQty),priority:number(x.priority),stackable:String(x.stackable||'TRUE')};}
function getSystemValue(key){const all=rows(SHEETS.system);const hit=all.find(x=>String(x.key)===String(key));return hit&&hit.value;}
function splitAliases(v){return String(v||'').split('|').map(x=>x.trim()).filter(Boolean);}
function smart(v){if(v==='TRUE')return true;if(v==='FALSE')return false;if(v!==''&&isFinite(Number(v)))return Number(v);return v;}
function makeId(kind){return kind+'-'+Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyyMMddHHmmss')+'-'+Math.floor(Math.random()*9000+1000);}
function withLock(fn){const lock=LockService.getScriptLock();lock.waitLock(120000);try{return fn();}finally{lock.releaseLock();}}
function catalogInfo(kind){
  if(kind==='SEAL')return{name:SHEETS.seals,headers:HEADERS.seals};
  if(kind==='SERVICE')return{name:SHEETS.services,headers:HEADERS.services};
  return{name:SHEETS.items,headers:HEADERS.items};
}
function upsert(record,actor){return withLock(()=>{
  if(!record||!record.name)throw Error('กรุณากรอกชื่อสินค้า');
  const info=catalogInfo(record.kind),s=sheet(info.name,info.headers),headers=info.headers;
  record.id=record.id||makeId(record.kind||'ITEM'); record.updatedAt=new Date();
  if(record.kind==='SEAL'&&!['AT','HT','CT','HP','DS','DE','EV','BL'].includes(String(record.category||'').toUpperCase()))throw Error('กรุณาเลือกสายซีล');
  const values=s.getDataRange().getValues(),idIndex=headers.indexOf('id');let rowIndex=-1;
  for(let i=1;i<values.length;i++){if(String(values[i][idIndex])===String(record.id)){rowIndex=i+1;break;}}
  const row=headers.map(k=>k==='aliases'&&Array.isArray(record.aliases)?record.aliases.join('|'):(record[k]??''));
  if(rowIndex<0)s.appendRow(row);else s.getRange(rowIndex,1,1,headers.length).setValues([row]);
  sortCatalog(s,headers,record.kind);
  log('UPSERT',record.kind,record.id,record.name,JSON.stringify({price:record.price,stock:record.stock,status:record.status,actor:actor||'SYSTEM'}));
  return output({ok:true,id:record.id});
});}

function findCatalogRecord(kind,id){
  const info=catalogInfo(kind),s=sheet(info.name,info.headers),values=s.getDataRange().getValues(),headers=values[0].map(String),idc=headers.indexOf('id');
  for(let i=1;i<values.length;i++)if(String(values[i][idc])===String(id))return{info,s,values,headers,row:i+1,data:Object.fromEntries(headers.map((h,j)=>[h,values[i][j]]))};
  throw Error('ไม่พบสินค้า');
}
function availableQty(stock,reserved){return stock===''?'':Math.max(0,number(stock)-number(reserved));}
function stockStatus(stock,reserved,current){
  if(stock==='')return current==='HIDDEN'||current==='INACTIVE'?current:'CHECK_STOCK';
  if(availableQty(stock,reserved)<=0)return'OUT_OF_STOCK';
  if(current==='HIDDEN'||current==='INACTIVE')return current;
  return'ACTIVE';
}
function writeStockLog(kind,product,before,delta,after,reserved,action,reason,actor){
  sheet(SHEETS.stockLogs,HEADERS.stockLogs).appendRow([new Date(),kind,product.id,product.name,before,delta,after,reserved,availableQty(after,reserved),action,reason||'',actor||'SYSTEM']);
}
function stockRequestId(b){const id=String(b.requestId||'').trim();if(!id||id.length>120)throw Error('คำขอปรับสต๊อกไม่ถูกต้อง กรุณาลองใหม่');return id;}
function previousStockRequest(requestId){return rowsTail(SHEETS.stockRequests,2000).find(x=>String(x.requestId)===String(requestId));}
function rememberStockRequest(requestId,action,kind,productId,actor,response){sheet(SHEETS.stockRequests,HEADERS.stockRequests).appendRow([requestId,new Date(),action,kind,productId,actor||'SYSTEM',JSON.stringify(response)]);}
function stockNumber(value,label){const n=Number(value);if(!Number.isFinite(n)||n<0)throw Error((label||'จำนวนสต๊อก')+' ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');return n;}
function truncateTo(sheetObject,lastRow){while(sheetObject.getLastRow()>lastRow)sheetObject.deleteRow(sheetObject.getLastRow());}
function markStockUpdated(value){PropertiesService.getScriptProperties().setProperty('STOCK_UPDATED_AT',value||new Date().toISOString());}
function stockUpdatedAt(){return String(PropertiesService.getScriptProperties().getProperty('STOCK_UPDATED_AT')||'');}
function adjustStock(b,actor){return withLock(()=>{
  if(!['SEAL','ITEM'].includes(String(b.kind)))throw Error('ปรับสต๊อกได้เฉพาะซีลและไอเทม');
  const requestId=stockRequestId(b),prior=previousStockRequest(requestId);if(prior&&prior.responseJson)return output({...JSON.parse(String(prior.responseJson)),duplicate:true});
  const found=findCatalogRecord(b.kind,b.id),h=found.headers,d=found.data;
  const before=d.stock===''?0:stockNumber(d.stock,'สต๊อกเดิม'),delta=Number(b.delta);if(!Number.isFinite(delta)||delta===0)throw Error('จำนวนที่ปรับต้องไม่เป็น 0');
  const after=before+delta,reserved=stockNumber(d.reservedStock||0,'Reserved Stock');if(after<0)throw Error('สต๊อกไม่เพียงพอ ไม่สามารถลดจนติดลบได้');if(after<reserved)throw Error('สต๊อกใหม่ต้องไม่น้อยกว่าจำนวนที่กันไว้');
  const status=stockStatus(after,reserved,d.status),beforeRow=found.s.getRange(found.row,1,1,h.length).getValues()[0],stockLogSheet=sheet(SHEETS.stockLogs,HEADERS.stockLogs),logSheet=sheet(SHEETS.logs,HEADERS.logs),requestSheet=sheet(SHEETS.stockRequests,HEADERS.stockRequests),logRows=stockLogSheet.getLastRow(),auditRows=logSheet.getLastRow(),requestRows=requestSheet.getLastRow(),now=new Date();
  try{
    const next=beforeRow.slice();next[h.indexOf('stock')]=after;next[h.indexOf('status')]=status;next[h.indexOf('updatedAt')]=now;found.s.getRange(found.row,1,1,h.length).setValues([next]);
    writeStockLog(b.kind,d,before,delta,after,reserved,delta>0?'ADD':'REMOVE',b.reason||'',actor);
    log('STOCK_ADJUST',b.kind,d.id,d.name,JSON.stringify({requestId,before,delta,after,reserved,reason:b.reason||''}));
    const response={ok:true,requestId,productId:d.id,productName:d.name,beforeStock:before,changeAmount:delta,stock:after,reservedStock:reserved,availableStock:availableQty(after,reserved),status,updatedAt:now.toISOString()};rememberStockRequest(requestId,'ADJUST',b.kind,d.id,actor,response);markStockUpdated(response.updatedAt);invalidatePublicCache();return output(response);
  }catch(err){found.s.getRange(found.row,1,1,h.length).setValues([beforeRow]);truncateTo(stockLogSheet,logRows);truncateTo(logSheet,auditRows);truncateTo(requestSheet,requestRows);throw err;}
});}
function setStock(b,actor){return withLock(()=>{
  if(!['SEAL','ITEM'].includes(String(b.kind)))throw Error('กำหนดสต๊อกได้เฉพาะซีลและไอเทม');
  const requestId=stockRequestId(b),prior=previousStockRequest(requestId);if(prior&&prior.responseJson)return output({...JSON.parse(String(prior.responseJson)),duplicate:true});
  const found=findCatalogRecord(b.kind,b.id),h=found.headers,d=found.data;
  const before=d.stock===''?'':stockNumber(d.stock,'สต๊อกเดิม'),stock=b.stock===''?'':stockNumber(b.stock,'สต๊อกใหม่'),reserved=stockNumber(b.reservedStock||0,'Reserved Stock'),low=stockNumber(b.lowStockAlert||0,'จุดแจ้งเตือน');if(stock!==''&&stock<reserved)throw Error('สต๊อกใหม่ต้องไม่น้อยกว่าจำนวนที่กันไว้');
  const status=stockStatus(stock,reserved,d.status),beforeRow=found.s.getRange(found.row,1,1,h.length).getValues()[0],stockLogSheet=sheet(SHEETS.stockLogs,HEADERS.stockLogs),logSheet=sheet(SHEETS.logs,HEADERS.logs),requestSheet=sheet(SHEETS.stockRequests,HEADERS.stockRequests),logRows=stockLogSheet.getLastRow(),auditRows=logSheet.getLastRow(),requestRows=requestSheet.getLastRow(),now=new Date();
  const delta=stock===''?0:number(stock)-number(before);
  try{const next=beforeRow.slice();[['stock',stock],['reservedStock',reserved],['lowStockAlert',low],['status',status],['updatedAt',now]].forEach(([key,value])=>next[h.indexOf(key)]=value);found.s.getRange(found.row,1,1,h.length).setValues([next]);
    if(delta!==0)writeStockLog(b.kind,d,before===''?0:before,delta,stock===''?0:stock,reserved,'SET',b.reason||'',actor);
    log('STOCK_SET',b.kind,d.id,d.name,JSON.stringify({requestId,before,stock,reserved,lowStockAlert:low,reason:b.reason||''}));
    const response={ok:true,requestId,productId:d.id,productName:d.name,beforeStock:before,changeAmount:delta,stock,reservedStock:reserved,availableStock:availableQty(stock,reserved),lowStockAlert:low,status,updatedAt:now.toISOString()};rememberStockRequest(requestId,'SET',b.kind,d.id,actor,response);markStockUpdated(response.updatedAt);invalidatePublicCache();return output(response);
  }catch(err){found.s.getRange(found.row,1,1,h.length).setValues([beforeRow]);truncateTo(stockLogSheet,logRows);truncateTo(logSheet,auditRows);truncateTo(requestSheet,requestRows);throw err;}
});}

function softDelete(kind,id,actor){return withLock(()=>{
  const found=findCatalogRecord(kind,id),d=found.data;
  sheet(SHEETS.trash,HEADERS.trash).appendRow([new Date(),kind,id,d.name||'',JSON.stringify(d),actor||'SYSTEM']);
  found.s.deleteRow(found.row);
  log('TRASH',kind,id,d.name||'','ย้ายเข้าถังขยะ');
  return output({ok:true});
});}
function restoreTrash(trashId,actor){return withLock(()=>{
  const s=sheet(SHEETS.trash,HEADERS.trash),values=s.getDataRange().getValues(),h=values[0].map(String),idc=h.indexOf('id');
  for(let i=1;i<values.length;i++)if(String(values[i][idc])===String(trashId)){
    const kind=String(values[i][h.indexOf('kind')]),data=JSON.parse(String(values[i][h.indexOf('dataJson')]||'{}')),info=catalogInfo(kind),target=sheet(info.name,info.headers);
    const existing=target.getDataRange().getValues(),targetId=info.headers.indexOf('id');
    for(let r=1;r<existing.length;r++)if(String(existing[r][targetId])===String(data.id))throw Error('มีรายการรหัสนี้อยู่แล้ว');
    data.updatedAt=new Date();target.appendRow(info.headers.map(k=>data[k]??''));sortCatalog(target,info.headers,kind);
    s.deleteRow(i+1);log('RESTORE',kind,data.id,data.name||'','กู้คืนจากถังขยะ');return output({ok:true});
  }
  throw Error('ไม่พบรายการในถังขยะ');
});}
function permanentDelete(trashId,actor){return withLock(()=>{
  const s=sheet(SHEETS.trash,HEADERS.trash),values=s.getDataRange().getValues(),h=values[0].map(String),idc=h.indexOf('id');
  for(let i=1;i<values.length;i++)if(String(values[i][idc])===String(trashId)){const name=values[i][h.indexOf('name')],kind=values[i][h.indexOf('kind')];s.deleteRow(i+1);log('DELETE_FOREVER',kind,trashId,name||'','ลบถาวร');return output({ok:true});}
  throw Error('ไม่พบรายการในถังขยะ');
});}
function bulkUpdate(records,changes,actor){return withLock(()=>{
  const list=Array.isArray(records)?records:[];if(!list.length)throw Error('ยังไม่ได้เลือกรายการ');
  const allowed=['status','category','section','itemCategory','serviceCategory','unit','packSize','price','sortOrder','lowStockAlert'];let updated=0;
  list.forEach(ref=>{
    try{const found=findCatalogRecord(ref.kind,ref.id),h=found.headers;Object.keys(changes||{}).forEach(k=>{if(!allowed.includes(k)||changes[k]==='')return;const c=h.indexOf(k);if(c>=0)found.s.getRange(found.row,c+1).setValue(changes[k]);});const uc=h.indexOf('updatedAt');if(uc>=0)found.s.getRange(found.row,uc+1).setValue(new Date());updated++;log('BULK_UPDATE',ref.kind,ref.id,found.data.name||'',JSON.stringify(changes||{}));}catch(err){}
  });
  return output({ok:true,updated});
});}
function removeRecord(kind,id){return softDelete(kind,id);}
function sortCatalog(s,headers,kind){
  if(s.getLastRow()<3)return;const sort=[];
  if(kind==='SEAL')sort.push({column:headers.indexOf('category')+1,ascending:true},{column:headers.indexOf('section')+1,ascending:true});
  else if(kind==='SERVICE')sort.push({column:headers.indexOf('serviceCategory')+1,ascending:true});
  else sort.push({column:headers.indexOf('itemCategory')+1,ascending:true});
  sort.push({column:headers.indexOf('sortOrder')+1,ascending:true},{column:headers.indexOf('name')+1,ascending:true});
  s.getRange(2,1,s.getLastRow()-1,s.getLastColumn()).sort(sort);
}
function saveSettings(settingsObj,actor){return withLock(()=>{
  const s=sheet(SHEETS.settings,HEADERS.settings),values=s.getDataRange().getValues(),rowByKey=new Map();for(let i=1;i<values.length;i++)rowByKey.set(String(values[i][0]),i+1);
  Object.keys(settingsObj||{}).forEach(k=>{const row=rowByKey.get(k);if(!row){s.appendRow([k,settingsObj[k],'']);rowByKey.set(k,s.getLastRow());}else s.getRange(row,2).setValue(settingsObj[k]);});
  log('SETTINGS','SYSTEM','','',actor||'SYSTEM');return output({ok:true});
});}
function catalogSnapshot(){
  const map=new Map();
  [['SEAL',SHEETS.seals,HEADERS.seals],['ITEM',SHEETS.items,HEADERS.items],['SERVICE',SHEETS.services,HEADERS.services]].forEach(([kind,name,headers])=>{const s=sheet(name,headers),v=s.getDataRange().getValues(),h=v[0].map(String);for(let i=1;i<v.length;i++){const data=Object.fromEntries(h.map((k,j)=>[k,v[i][j]]));if(data.id)map.set(kind+'|'+data.id,{kind,s,row:i+1,headers:h,data});}});return map;
}
function promotionActive(p,now){const start=p.startAt?new Date(p.startAt).getTime():0,end=p.endAt?new Date(p.endAt).getTime():0;return String(p.status||'ACTIVE')==='ACTIVE'&&(!start||now>=start)&&(!end||now<=end);}
function calculateServerPricing(items,promotions){
  const subtotal=items.reduce((sum,x)=>sum+number(x.lineTotal),0),sealSubtotal=items.filter(x=>String(x.kind)==='SEAL').reduce((sum,x)=>sum+number(x.lineTotal),0),now=Date.now();let discount=0;const applied=[],active=promotions.filter(p=>promotionActive(p,now)).sort((a,b)=>number(a.priority||999)-number(b.priority||999));
  for(const p of active){const promotionBase=p.type==='REWARD_PER_SPEND'?sealSubtotal:subtotal;if(promotionBase<number(p.minSpend))continue;let amount=0;if(p.type==='DISCOUNT_PERCENT'||p.type==='FLASH_SALE')amount=subtotal*Math.max(0,Math.min(100,number(p.value)))/100;else if(p.type==='DISCOUNT_AMOUNT')amount=Math.min(subtotal,Math.max(0,number(p.value)));if(amount>0){discount+=amount;applied.push({promotionId:p.promotionId,name:p.name,type:p.type,amount});}else if(p.type==='REWARD_PER_SPEND')applied.push({promotionId:p.promotionId,name:p.name,type:p.type,amount:0,eligibleSubtotal:sealSubtotal,rewardSets:Math.floor(sealSubtotal/(number(p.minSpend)||100))});if(String(p.stackable)==='FALSE')break;}
  discount=Math.min(subtotal,discount);return{subtotal,sealSubtotal,discount,total:Math.max(0,subtotal-discount),applied};
}
function findRequest(requestId){return rows(SHEETS.orderRequests).find(x=>String(x.requestId)===String(requestId));}
function uniqueOrderId(existing){for(let i=0;i<8;i++){const now=new Date(),suffix=Utilities.getUuid().replace(/-/g,'').slice(0,8).toUpperCase(),id='GUN-'+Utilities.formatDate(now,Session.getScriptTimeZone(),'yyyyMMdd-HHmmss')+'-'+suffix;if(!existing.has(id))return id;}throw Error('ไม่สามารถสร้างเลขออเดอร์ได้ กรุณาลองใหม่');}
function deleteRowsByValue(s,column,value){const v=s.getDataRange().getValues();for(let i=v.length-1;i>=1;i--)if(String(v[i][column])===String(value))s.deleteRow(i+1);}
function createOrder(b){return withLock(()=>{
  const settings={};rows(SHEETS.settings).forEach(x=>settings[x.key]=smart(x.value));if(settings.allowOrderSave===false)return output({ok:true,orderId:''});
  const customer=b.customer||{},requestId=String(b.requestId||'').trim();if(!requestId||requestId.length>120)throw Error('คำขอออเดอร์ไม่ถูกต้อง กรุณารีเฟรชหน้าเว็บ');
  const prior=findRequest(requestId);if(prior&&prior.responseJson){const saved=JSON.parse(String(prior.responseJson));return output({...saved,duplicate:true});}
  const customerText={tamer:safeSheetText(customer.tamer,120),server:safeSheetText(customer.server,120),contact:safeSheetText(customer.contact,250)};
  if(!customerText.tamer.trim()||!customerText.server.trim()||!customerText.contact.trim())throw Error('กรุณากรอกข้อมูลลูกค้าให้ครบ');
  if(CacheService.getScriptCache().get('order-contact-'+sha256(customer.contact).slice(0,24)))throw Error('มีการส่งออเดอร์ล่าสุดแล้ว กรุณารอสักครู่ก่อนส่งรายการใหม่');
  const raw=Array.isArray(b.items)?b.items:[];if(!raw.length)throw Error('ไม่มีสินค้าในออเดอร์');if(raw.length>100)throw Error('รายการสินค้าเกินกำหนด');
  const grouped=new Map();raw.forEach(x=>{const kind=String(x.kind||'').toUpperCase();if(!['SEAL','ITEM','SERVICE'].includes(kind))throw Error('ประเภทสินค้าไม่ถูกต้อง');const id=String(x.id||''),qty=Number(x.quantity);if(!id||id.length>160||!Number.isFinite(qty)||!Number.isInteger(qty)||qty<1||qty>9999)throw Error('จำนวนสินค้าไม่ถูกต้อง');const key=kind+'|'+id;grouped.set(key,(grouped.get(key)||0)+qty);});
  const catalog=catalogSnapshot(),normalized=[];grouped.forEach((qty,key)=>{if(qty>9999)throw Error('จำนวนสินค้าเกินกำหนด');const found=catalog.get(key);if(!found)throw Error('ไม่พบสินค้าในฐานข้อมูล');const p=found.data,status=String(p.status||'ACTIVE');if(['OUT_OF_STOCK','INACTIVE','HIDDEN'].includes(status))throw Error(String(p.name)+' ไม่พร้อมขาย');const stock=p.stock===''?'':number(p.stock),reserved=Math.max(0,number(p.reservedStock)),available=stock===''?'':stock-reserved;if(found.kind!=='SERVICE'&&available!==''&&qty>available)throw Error('สต๊อก '+String(p.name)+' ไม่พอ (พร้อมขาย '+available+')');const price=Math.max(0,number(p.price)),unit=found.kind==='SEAL'?(String(p.section)==='SUSA'?'ใบ':'ชุด'):(p.unit||'');normalized.push({orderItemId:'OI-'+Utilities.getUuid(),kind:found.kind,productId:p.id,productName:p.name,quantity:qty,unit,unitPrice:price,lineTotal:price*qty,pickStatus:'UNCHECKED',stockCheck:available===''?'CHECK':'OK',_found:found,_stock:stock,_reserved:reserved});});
  const pricing=calculateServerPricing(normalized,rows(SHEETS.promotions).map(normalizePromotion)),now=new Date(),existingIds=new Set(rows(SHEETS.orders).map(x=>String(x.orderId))),id=uniqueOrderId(existingIds),promo=Math.floor(pricing.sealSubtotal/(number(settings.promoThreshold)||100));
  const orderSheet=sheet(SHEETS.orders,HEADERS.orders),itemSheet=sheet(SHEETS.orderItems,HEADERS.orderItems),requestSheet=sheet(SHEETS.orderRequests,HEADERS.orderRequests),stockSnapshots=[];let itemsWritten=false,orderWritten=false,requestWritten=false;
  try{
    normalized.forEach(x=>{if(x.kind==='SERVICE'||x._stock==='')return;const f=x._found,rc=f.headers.indexOf('reservedStock'),next=x._reserved+x.quantity;if(next>x._stock)throw Error('สต๊อกไม่พอสำหรับ '+x.productName);stockSnapshots.push({s:f.s,row:f.row,col:rc+1,value:x._reserved,item:x});f.s.getRange(f.row,rc+1).setValue(next);});
    const publicItems=normalized.map(x=>({orderItemId:x.orderItemId,orderId:id,kind:x.kind,productId:x.productId,productName:x.productName,quantity:x.quantity,unit:x.unit,unitPrice:x.unitPrice,lineTotal:x.lineTotal,pickStatus:x.pickStatus,stockCheck:x.stockCheck}));
    if(publicItems.length){itemSheet.getRange(itemSheet.getLastRow()+1,1,publicItems.length,HEADERS.orderItems.length).setValues(publicItems.map(x=>HEADERS.orderItems.map(k=>k==='createdAt'||k==='updatedAt'?now:(x[k]??''))));itemsWritten=true;}
    const order={orderId:id,createdAt:now,tamer:customerText.tamer,server:customerText.server,contact:customerText.contact,itemsJson:JSON.stringify(publicItems),total:pricing.total,promoSets:promo,status:'NEW',adminNote:'',updatedAt:now,requestId,pricingJson:JSON.stringify(pricing),inventoryState:'RESERVED'};orderSheet.appendRow(HEADERS.orders.map(k=>order[k]??''));orderWritten=true;
    const response={ok:true,orderId:id,total:pricing.total,subtotal:pricing.subtotal,discount:pricing.discount,promoSets:promo,promotions:pricing.applied};requestSheet.appendRow([requestId,now,id,sha256(customer.contact).slice(0,24),'COMPLETED',JSON.stringify(response)]);requestWritten=true;
    try{ensureCustomerProfile(customerText,now);stockSnapshots.forEach(x=>writeStockLog(x.item.kind,{id:x.item.productId,name:x.item.productName},x.item._stock,0,x.item._stock,x.item._reserved+x.item.quantity,'ORDER_RESERVE','ORDER '+id,'SYSTEM'));log('ORDER','ORDER',id,customerText.tamer,JSON.stringify({total:pricing.total,promo,items:publicItems.length,requestId}));}catch(logErr){}
    CacheService.getScriptCache().put('order-contact-'+sha256(customer.contact).slice(0,24),String(Date.now()),30);invalidatePublicCache();return output(response);
  }catch(err){for(let i=stockSnapshots.length-1;i>=0;i--){try{const x=stockSnapshots[i];x.s.getRange(x.row,x.col).setValue(x.value);}catch(rollbackErr){}}try{if(itemsWritten)deleteRowsByValue(itemSheet,1,id);}catch(rollbackErr){}try{if(orderWritten)deleteRowsByValue(orderSheet,0,id);}catch(rollbackErr){}try{if(requestWritten)deleteRowsByValue(requestSheet,0,requestId);}catch(rollbackErr){}throw err;}
});}
function migrateLegacyOrderItems(){return withLock(()=>{
  if(String(getSystemValue('databaseVersion'))!=='3.1.0')throw Error('Corrective migration requires database version 3.1.0');
  const orderSheet=sheet(SHEETS.orders,HEADERS.orders),itemSheet=sheet(SHEETS.orderItems,HEADERS.orderItems),orderValues=orderSheet.getDataRange().getValues(),orderHeaders=orderValues[0].map(String),itemValues=itemSheet.getDataRange().getValues(),itemHeaders=itemValues[0].map(String),itemOrderCol=itemHeaders.indexOf('orderId'),legacyCol=orderHeaders.indexOf('legacyOrder');
  const existingByOrder=new Set(itemValues.slice(1).map(r=>String(r[itemOrderCol]||'')).filter(Boolean)),planned=[],legacyRows=[];
  for(let i=1;i<orderValues.length;i++){
    const row=orderValues[i],order=Object.fromEntries(orderHeaders.map((key,index)=>[key,row[index]])),alreadyLegacy=String(order.legacyOrder).toUpperCase()==='TRUE';
    if(alreadyLegacy){if(!existingByOrder.has(String(order.orderId)))throw Error('Legacy order missing OrderItems: '+order.orderId);continue;}
    if(order.requestId||order.inventoryState||existingByOrder.has(String(order.orderId)))continue;
    let items;try{items=JSON.parse(String(order.itemsJson||''));}catch(e){throw Error('Cannot parse itemsJson: '+order.orderId);}
    if(!Array.isArray(items)||!items.length)throw Error('Legacy order has no items: '+order.orderId);
    let subtotal=0;items.forEach((item,index)=>{const kind=String(item.kind||item.type||'').toUpperCase(),productId=String(item.productId||item.id||'').trim(),productName=String(item.productName||item.name||'').trim(),quantity=Number(item.quantity??item.qty),unitPrice=Number(item.unitPrice??item.price),unit=String(item.unit||'').trim();if(!['SEAL','ITEM','SERVICE'].includes(kind)||!productId||!productName||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<0||!unit)throw Error('Invalid legacy item snapshot: '+order.orderId+' #'+(index+1));const lineTotal=quantity*unitPrice;subtotal+=lineTotal;planned.push({orderItemId:'LEGACY-'+order.orderId+'-'+String(index+1).padStart(2,'0'),orderId:String(order.orderId),kind,productId,productName,quantity,unit,unitPrice,lineTotal,pickStatus:'UNCHECKED',stockCheck:'LEGACY_NO_STOCK_ACTION',createdAt:order.createdAt,updatedAt:order.createdAt});});
    if(Math.abs(Number(order.total)-subtotal)>0.01)throw Error('Legacy snapshot total mismatch: '+order.orderId);legacyRows.push(i);
  }
  if(!planned.length){return{ok:true,idempotent:true,orders:legacyRows.length,orderItems:0};}
  if(legacyRows.length!==16||planned.length!==40||itemValues.length!==1)throw Error('Corrective migration safety count mismatch');
  const ids=planned.map(x=>x.orderItemId);if(new Set(ids).size!==ids.length)throw Error('Duplicate legacy OrderItem ID');
  const itemStart=itemSheet.getLastRow()+1,oldMarkers=orderValues.slice(1).map(r=>r[legacyCol]);
  try{itemSheet.getRange(itemStart,1,planned.length,HEADERS.orderItems.length).setValues(planned.map(x=>HEADERS.orderItems.map(k=>x[k]??'')));const markers=orderValues.slice(1).map((r,index)=>[legacyRows.includes(index+1)?'TRUE':r[legacyCol]]);orderSheet.getRange(2,legacyCol+1,markers.length,1).setValues(markers);return{ok:true,orders:legacyRows.length,orderItems:planned.length,stockMutations:0};}catch(err){try{if(itemSheet.getLastRow()>=itemStart)itemSheet.deleteRows(itemStart,itemSheet.getLastRow()-itemStart+1);}catch(e){}try{orderSheet.getRange(2,legacyCol+1,oldMarkers.length,1).setValues(oldMarkers.map(x=>[x]));}catch(e){}throw err;}
});}
function orderItemsFor(orderId){return rows(SHEETS.orderItems).filter(x=>String(x.orderId)===String(orderId));}
function updateOrderItemPick(b,actor){return withLock(()=>{const s=sheet(SHEETS.orderItems,HEADERS.orderItems),v=s.getDataRange().getValues(),h=v[0].map(String),idc=h.indexOf('orderItemId'),pc=h.indexOf('pickStatus'),uc=h.indexOf('updatedAt');for(let i=1;i<v.length;i++)if(String(v[i][idc])===String(b.orderItemId)){const status=String(b.pickStatus)==='PICKED'?'PICKED':'UNCHECKED';if(String(v[i][pc])===status)return output({ok:true,idempotent:true});const values=v[i].slice(pc,uc+1);values[0]=status;values[uc-pc]=new Date();s.getRange(i+1,pc+1,1,values.length).setValues([values]);try{log('ORDER_PICK','ORDER_ITEM',b.orderItemId,'',status+' • '+(actor||'SYSTEM'));}catch(e){}return output({ok:true});}throw Error('ไม่พบรายการจัดของ');});}
function groupedOrderItems(items){const map=new Map();items.forEach(x=>{if(String(x.kind).toUpperCase()==='SERVICE')return;const key=String(x.kind).toUpperCase()+'|'+x.productId;const cur=map.get(key)||{kind:String(x.kind).toUpperCase(),productId:x.productId,productName:x.productName,quantity:0};cur.quantity+=number(x.quantity);map.set(key,cur);});return[...map.values()];}
function applyInventoryTransition(items,newStatus,orderId,actor){const catalog=catalogSnapshot(),snapshots=[];try{groupedOrderItems(items).forEach(x=>{const f=catalog.get(x.kind+'|'+x.productId);if(!f)throw Error('ไม่พบสินค้า '+x.productName);const sc=f.headers.indexOf('stock'),rc=f.headers.indexOf('reservedStock'),stock=f.data.stock===''?'':number(f.data.stock),reserved=number(f.data.reservedStock),qty=number(x.quantity);if(stock==='')return;if(reserved<qty)throw Error('Reserved Stock ไม่พอสำหรับ '+x.productName);const nextStock=newStatus==='COMPLETED'?stock-qty:stock,nextReserved=reserved-qty;if(nextStock<0||nextReserved<0)throw Error('สต๊อกไม่ถูกต้องสำหรับ '+x.productName);snapshots.push({s:f.s,row:f.row,sc:sc+1,rc:rc+1,stock,reserved,item:x,nextStock,nextReserved});f.s.getRange(f.row,sc+1).setValue(nextStock);f.s.getRange(f.row,rc+1).setValue(nextReserved);});return{state:newStatus==='COMPLETED'?'DEDUCTED':'RELEASED',rollback:()=>snapshots.slice().reverse().forEach(x=>{x.s.getRange(x.row,x.sc).setValue(x.stock);x.s.getRange(x.row,x.rc).setValue(x.reserved);}),logs:()=>snapshots.forEach(x=>writeStockLog(x.item.kind,{id:x.item.productId,name:x.item.productName},x.stock,newStatus==='COMPLETED'?-x.item.quantity:0,x.nextStock,x.nextReserved,newStatus==='COMPLETED'?'ORDER_COMPLETE':'ORDER_CANCEL','ORDER '+orderId,actor))};}catch(err){snapshots.slice().reverse().forEach(x=>{try{x.s.getRange(x.row,x.sc).setValue(x.stock);x.s.getRange(x.row,x.rc).setValue(x.reserved);}catch(e){}});throw err;}}
function updateOrder(b,actor){return withLock(()=>{const s=sheet(SHEETS.orders,HEADERS.orders),v=s.getDataRange().getValues(),h=v[0].map(String),idc=h.indexOf('orderId');for(let i=1;i<v.length;i++)if(String(v[i][idc])===String(b.orderId)){const row=i+1,oldInventory=h.indexOf('inventoryState')>=0?v[i][h.indexOf('inventoryState')]:'',oldNote=v[i][h.indexOf('adminNote')],oldUpdatedAt=v[i][h.indexOf('updatedAt')],oldStatus=String(v[i][h.indexOf('status')]||'NEW'),newStatus=b.status!==undefined?String(b.status):oldStatus,legacy=String(v[i][h.indexOf('legacyOrder')]||'').toUpperCase()==='TRUE';if(newStatus===oldStatus){if(b.adminNote!==undefined)s.getRange(row,h.indexOf('adminNote')+1).setValue(String(b.adminNote).slice(0,500));return output({ok:true,idempotent:true});}if(legacy)throw Error('ออเดอร์เก่าไม่อยู่ในระบบจองสต๊อก V20.1 จึงไม่อนุญาตให้เปลี่ยนสถานะ');if(!ORDER_TRANSITIONS[oldStatus]||!ORDER_TRANSITIONS[oldStatus].includes(newStatus))throw Error('ไม่อนุญาตให้เปลี่ยนสถานะ '+oldStatus+' → '+newStatus);const items=orderItemsFor(b.orderId);if(!items.length)throw Error('ออเดอร์นี้ไม่มี OrderItems กรุณาตรวจสอบ Integrity ก่อน');if(newStatus==='COMPLETED'&&items.some(x=>String(x.pickStatus)!=='PICKED'))throw Error('ต้องจัดสินค้าครบทุกชิ้นก่อนปิดออเดอร์');if(['COMPLETED','CANCELLED'].includes(newStatus)&&String(oldInventory)!=='RESERVED')throw Error('สถานะสต๊อกของออเดอร์ไม่ใช่ RESERVED กรุณาตรวจสอบ Integrity ก่อน');let inventory=null;try{if(['COMPLETED','CANCELLED'].includes(newStatus))inventory=applyInventoryTransition(items,newStatus,b.orderId,actor);s.getRange(row,h.indexOf('status')+1).setValue(newStatus);if(inventory&&h.indexOf('inventoryState')>=0)s.getRange(row,h.indexOf('inventoryState')+1).setValue(inventory.state);if(b.adminNote!==undefined)s.getRange(row,h.indexOf('adminNote')+1).setValue(String(b.adminNote).slice(0,500));s.getRange(row,h.indexOf('updatedAt')+1).setValue(new Date());if(['COMPLETED','CANCELLED'].includes(newStatus))recalculateCustomerStats({tamer:v[i][h.indexOf('tamer')],server:v[i][h.indexOf('server')],contact:v[i][h.indexOf('contact')]});try{if(inventory)inventory.logs();log('ORDER_STATUS','ORDER',b.orderId,'',oldStatus+' → '+newStatus+' • '+(actor||'SYSTEM'));}catch(e){}invalidatePublicCache();return output({ok:true});}catch(err){if(inventory)try{inventory.rollback();}catch(e){}try{s.getRange(row,h.indexOf('status')+1).setValue(oldStatus);if(h.indexOf('inventoryState')>=0)s.getRange(row,h.indexOf('inventoryState')+1).setValue(oldInventory);if(h.indexOf('adminNote')>=0)s.getRange(row,h.indexOf('adminNote')+1).setValue(oldNote);if(h.indexOf('updatedAt')>=0)s.getRange(row,h.indexOf('updatedAt')+1).setValue(oldUpdatedAt);}catch(e){}throw err;}}throw Error('ไม่พบออเดอร์');});}

function archiveOrder(b,actor){return withLock(()=>{const reason=safeSheetText(b.reason||'',300);if(!reason)throw Error('กรุณาระบุเหตุผลที่เก็บออเดอร์');const s=sheet(SHEETS.orders,HEADERS.orders),v=s.getDataRange().getValues(),h=v[0].map(String),idc=h.indexOf('orderId');for(let i=1;i<v.length;i++)if(String(v[i][idc])===String(b.orderId)){if(v[i][h.indexOf('deletedAt')])return output({ok:true,idempotent:true});const row=i+1,original=v[i].slice(),status=String(v[i][h.indexOf('status')]||'NEW'),inventoryState=String(v[i][h.indexOf('inventoryState')]||''),legacy=String(v[i][h.indexOf('legacyOrder')]||'').toUpperCase()==='TRUE',items=orderItemsFor(b.orderId);let inventory=null;try{if(!legacy&&inventoryState==='RESERVED'){if(!items.length)throw Error('ออเดอร์นี้ไม่มี OrderItems กรุณาตรวจสอบ Integrity ก่อน');inventory=applyInventoryTransition(items,'CANCELLED',b.orderId,actor);v[i][h.indexOf('status')]='CANCELLED';v[i][h.indexOf('inventoryState')]='RELEASED';}else if(!legacy&&!((status==='CANCELLED'&&inventoryState==='RELEASED')||(status==='COMPLETED'&&inventoryState==='DEDUCTED')))throw Error('สถานะสต๊อกของออเดอร์ไม่ปลอดภัย กรุณาตรวจสอบ Integrity ก่อน');v[i][h.indexOf('deletedAt')]=new Date();v[i][h.indexOf('deletedBy')]=actor||'SYSTEM';v[i][h.indexOf('deleteReason')]=reason;v[i][h.indexOf('updatedAt')]=new Date();s.getRange(row,1,1,h.length).setValues([v[i].slice(0,h.length)]);if(inventory)recalculateCustomerStats({tamer:v[i][h.indexOf('tamer')],server:v[i][h.indexOf('server')],contact:v[i][h.indexOf('contact')]});try{if(inventory)inventory.logs();log('ORDER_ARCHIVE','ORDER',b.orderId,'',(legacy?'LEGACY_NO_STOCK_ACTION • ':'')+status+' • '+reason+' • '+(actor||'SYSTEM'));}catch(e){}invalidatePublicCache();return output({ok:true,status:v[i][h.indexOf('status')],inventoryState:v[i][h.indexOf('inventoryState')],legacyOrder:legacy});}catch(err){if(inventory)try{inventory.rollback();}catch(e){}try{s.getRange(row,1,1,h.length).setValues([original.slice(0,h.length)]);}catch(e){}throw err;}}throw Error('ไม่พบออเดอร์');});}
function restoreArchivedOrder(b,actor){return withLock(()=>{const s=sheet(SHEETS.orders,HEADERS.orders),v=s.getDataRange().getValues(),h=v[0].map(String),idc=h.indexOf('orderId');for(let i=1;i<v.length;i++)if(String(v[i][idc])===String(b.orderId)){if(!v[i][h.indexOf('deletedAt')])return output({ok:true,idempotent:true});v[i][h.indexOf('deletedAt')]='';v[i][h.indexOf('deletedBy')]='';v[i][h.indexOf('deleteReason')]='';v[i][h.indexOf('updatedAt')]=new Date();s.getRange(i+1,1,1,h.length).setValues([v[i].slice(0,h.length)]);try{log('ORDER_RESTORE','ORDER',b.orderId,'','กู้คืนโดยไม่เปลี่ยนสต๊อก • '+(actor||'SYSTEM'));}catch(e){}invalidatePublicCache();return output({ok:true,status:v[i][h.indexOf('status')],inventoryState:v[i][h.indexOf('inventoryState')]});}throw Error('ไม่พบออเดอร์');});}

function customerKey(customer){
  const contact=String(customer.contact||'').trim().toLowerCase();
  if(contact)return 'CONTACT-'+Utilities.base64EncodeWebSafe(contact).slice(0,36);
  const raw=[customer.tamer||'',customer.server||''].join('|').trim().toLowerCase();
  return 'TAMER-'+Utilities.base64EncodeWebSafe(raw).slice(0,36);
}
function vipLevel(total){total=number(total);if(total>=50000)return'VIP';if(total>=20000)return'PLATINUM';if(total>=10000)return'GOLD';if(total>=5000)return'SILVER';return'NORMAL';}
function ensureCustomerProfile(customer,now){const s=sheet(SHEETS.customers,HEADERS.customers),v=s.getDataRange().getValues(),h=v[0].map(String),id=customerKey(customer);for(let i=1;i<v.length;i++)if(String(v[i][0])===id){const updated=v[i].slice();[['updatedAt',now],['tamer',customer.tamer],['server',customer.server],['contact',customer.contact],['lastOrderAt',now]].forEach(x=>{const c=h.indexOf(x[0]);if(c>=0&&x[1]!==undefined)updated[c]=x[1];});s.getRange(i+1,1,1,h.length).setValues([updated.slice(0,h.length)]);return id;}const data={customerId:id,createdAt:now,updatedAt:now,tamer:customer.tamer||'',server:customer.server||'',contact:customer.contact||'',orderCount:0,totalSpent:0,vipLevel:'NORMAL',status:'ACTIVE',lastOrderAt:now};s.appendRow(HEADERS.customers.map(k=>data[k]??''));return id;}
function recalculateCustomerStats(customer){const id=customerKey(customer),s=sheet(SHEETS.customers,HEADERS.customers);let v=s.getDataRange().getValues(),h=v[0].map(String),row=v.findIndex((x,i)=>i>0&&String(x[0])===id);if(row<1){ensureCustomerProfile(customer,new Date());v=s.getDataRange().getValues();row=v.findIndex((x,i)=>i>0&&String(x[0])===id);}const completed=rows(SHEETS.orders).filter(o=>String(o.status)==='COMPLETED'&&customerKey(o)===id),total=completed.reduce((sum,o)=>sum+number(o.total),0);if(row>0){const start=h.indexOf('updatedAt'),end=h.indexOf('vipLevel'),values=v[row].slice(start,end+1);values[0]=new Date();values[h.indexOf('orderCount')-start]=completed.length;values[h.indexOf('totalSpent')-start]=total;values[h.indexOf('vipLevel')-start]=vipLevel(total);s.getRange(row+1,start+1,1,values.length).setValues([values]);}}
function updateCustomer(b){return withLock(()=>{
  const s=sheet(SHEETS.customers,HEADERS.customers),vals=s.getDataRange().getValues(),h=vals[0].map(String),idc=h.indexOf('customerId');
  for(let i=1;i<vals.length;i++)if(String(vals[i][idc])===String(b.customerId)){
    const allowed=['tamer','server','contact','vipLevel','status','note','tags','preferredContact','followUpAt'];
    const updated=vals[i].slice();allowed.forEach(k=>{if(b[k]!==undefined&&h.indexOf(k)>=0)updated[h.indexOf(k)]=b[k];});if(h.indexOf('updatedAt')>=0)updated[h.indexOf('updatedAt')]=new Date();s.getRange(i+1,1,1,h.length).setValues([updated.slice(0,h.length)]);
    try{log('CUSTOMER_UPDATE','CUSTOMER',b.customerId,b.tamer||vals[i][h.indexOf('tamer')],JSON.stringify({vipLevel:b.vipLevel,status:b.status,tags:b.tags}));}catch(e){}return output({ok:true});
  }
  throw Error('ไม่พบลูกค้า');
});}
function addCustomerInteraction(b,actor){return withLock(()=>{
  if(!b.customerId)throw Error('ไม่พบรหัสลูกค้า');
  const id=makeId('INTERACTION'),now=new Date(),s=sheet(SHEETS.customers,HEADERS.customers),vals=s.getDataRange().getValues(),h=vals[0].map(String),idc=h.indexOf('customerId'),row=vals.findIndex((x,i)=>i>0&&String(x[idc])===String(b.customerId));if(row<1)throw Error('ไม่พบลูกค้า');const updated=vals[row].slice();if(h.indexOf('lastContactAt')>=0)updated[h.indexOf('lastContactAt')]=now;if(b.nextFollowUpAt&&h.indexOf('followUpAt')>=0)updated[h.indexOf('followUpAt')]=b.nextFollowUpAt;if(h.indexOf('updatedAt')>=0)updated[h.indexOf('updatedAt')]=now;const interactionSheet=sheet(SHEETS.customerInteractions,HEADERS.customerInteractions);interactionSheet.appendRow([id,now,b.customerId,b.customerName||'',b.type||'NOTE',b.channel||'',String(b.note||'').slice(0,2000),b.nextFollowUpAt||'',actor||'SYSTEM']);try{s.getRange(row+1,1,1,h.length).setValues([updated.slice(0,h.length)]);}catch(err){try{deleteRowsByValue(interactionSheet,0,id);}catch(e){}throw err;}
  try{log('CUSTOMER_INTERACTION','CUSTOMER',b.customerId,b.customerName||'',JSON.stringify({type:b.type,channel:b.channel,note:b.note}));}catch(e){}
  return output({ok:true,interactionId:id});
});}
function upsertPromotion(p){return withLock(()=>{
  if(!p||!p.name)throw Error('กรุณากรอกชื่อโปรโมชั่น');const s=sheet(SHEETS.promotions,HEADERS.promotions),h=HEADERS.promotions,vals=s.getDataRange().getValues();
  p.promotionId=p.promotionId||makeId('PROMO');p.updatedAt=new Date();let row=-1;for(let i=1;i<vals.length;i++)if(String(vals[i][0])===String(p.promotionId)){row=i+1;break;}
  const data=h.map(k=>p[k]??'');if(row<0)s.appendRow(data);else s.getRange(row,1,1,h.length).setValues([data]);log('PROMOTION_UPSERT','PROMOTION',p.promotionId,p.name,p.type||'');return output({ok:true,promotionId:p.promotionId});
});}
function deletePromotion(id){return withLock(()=>{
  const s=sheet(SHEETS.promotions,HEADERS.promotions),vals=s.getDataRange().getValues();for(let i=1;i<vals.length;i++)if(String(vals[i][0])===String(id)){const name=vals[i][1];s.deleteRow(i+1);log('PROMOTION_DELETE','PROMOTION',id,name,'');return output({ok:true});}throw Error('ไม่พบโปรโมชั่น');
});}


function wikiRequest(params){
  const base='https://dmowiki.com/api.php';
  const query=Object.keys(params).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(params[k])).join('&');
  const response=UrlFetchApp.fetch(base+'?'+query,{muteHttpExceptions:true,followRedirects:true,headers:{'User-Agent':'DMO-Toolbox-Ultimate/1.6 (admin wiki integration)'}});
  if(response.getResponseCode()>=400)throw Error('DMO Wiki API ตอบกลับ '+response.getResponseCode());
  const parsed=JSON.parse(response.getContentText());
  if(parsed&&parsed.error)throw Error(parsed.error.info||parsed.error.code||'DMO Wiki API error');
  return parsed;
}
function stripWikiHtml(value){return String(value||'').replace(/<[^>]+>/g,' ').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();}
function searchDmoWikiPages(query){
  query=String(query||'').trim();if(!query)throw Error('กรุณาพิมพ์คำค้นหา DMO Wiki');
  const cache=CacheService.getScriptCache(),key='dmo-wiki-search-'+Utilities.base64EncodeWebSafe(query.toLowerCase()).slice(0,80),cached=cache.get(key);if(cached)return JSON.parse(cached);
  let results=[];
  try{
    const data=wikiRequest({action:'query',generator:'search',gsrsearch:query,gsrnamespace:0,gsrlimit:20,prop:'pageimages|info|extracts',piprop:'thumbnail|name',pithumbsize:360,inprop:'url',exintro:1,explaintext:1,exsentences:3,format:'json',formatversion:2});
    results=((data.query&&data.query.pages)||[]).map(p=>({title:p.title,url:p.fullurl||('https://dmowiki.com/'+encodeURIComponent(String(p.title).replace(/ /g,'_'))),thumbnail:p.thumbnail&&p.thumbnail.source||'',extract:String(p.extract||'').slice(0,420)}));
  }catch(err){
    const data=wikiRequest({action:'opensearch',search:query,limit:20,namespace:0,format:'json'});
    const titles=data[1]||[],descriptions=data[2]||[],urls=data[3]||[];
    results=titles.map((title,i)=>({title,url:urls[i]||('https://dmowiki.com/'+encodeURIComponent(String(title).replace(/ /g,'_'))),thumbnail:'',extract:stripWikiHtml(descriptions[i]||'')}));
  }
  const unique=[];const seen={};results.forEach(r=>{if(!seen[r.title]){seen[r.title]=1;unique.push(r);}});
  const limited=unique.slice(0,20);cache.put(key,JSON.stringify(limited),21600);
  const s=sheet(SHEETS.wikiCache,HEADERS.wikiCache);limited.slice(0,10).forEach(r=>s.appendRow([new Date(),query,r.title,r.url,r.thumbnail,r.extract]));
  return limited;
}
function attachWikiMetadata(b){return withLock(()=>{
  if(!b.kind||!b.id||!b.title)throw Error('ข้อมูลสำหรับเชื่อม DMO Wiki ไม่ครบ');
  const found=findCatalogRecord(b.kind,b.id),h=found.headers,d=found.data;
  const updates={wikiTitle:b.title,wikiUrl:b.wikiUrl||('https://dmowiki.com/'+encodeURIComponent(String(b.title).replace(/ /g,'_'))),wikiImageSource:b.thumbnail||'',wikiSyncedAt:new Date(),updatedAt:new Date()};
  if(h.indexOf('wikiName')>=0&&!d.wikiName)updates.wikiName=b.title;
  if(b.thumbnail&&h.indexOf('imageUrl')>=0&&!d.imageUrl){
    try{
      const response=UrlFetchApp.fetch(b.thumbnail,{muteHttpExceptions:true,followRedirects:true,headers:{'User-Agent':'DMO-Toolbox-Ultimate/1.6'}});
      if(response.getResponseCode()<400)updates.imageUrl=saveBlobToDrive(response.getBlob(),'wiki-'+String(b.title).replace(/[^a-zA-Z0-9_-]+/g,'-')+'.png');
      else updates.imageUrl=b.thumbnail;
    }catch(err){updates.imageUrl=b.thumbnail;}
  }
  Object.keys(updates).forEach(key=>{const index=h.indexOf(key);if(index>=0)found.s.getRange(found.row,index+1).setValue(updates[key]);});
  log('WIKI_ATTACH',b.kind,b.id,d.name||'',JSON.stringify({title:b.title,url:updates.wikiUrl}));
  return output({ok:true,wikiTitle:b.title,wikiUrl:updates.wikiUrl});
});}

function imageFolder(){let folders=DriveApp.getFoldersByName('DMO-Toolbox-Images');return folders.hasNext()?folders.next():DriveApp.createFolder('DMO-Toolbox-Images');}
function saveBlobToDrive(blob,fileName){
  blob.setName(fileName||blob.getName()||'image.png');const file=imageFolder().createFile(blob);file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
  return'https://drive.google.com/thumbnail?id='+file.getId()+'&sz=w1200';
}
function uploadImage(b){
  if(!b.data)throw Error('ไม่มีรูปภาพ');if(String(b.data).length>2800000)throw Error('รูปใหญ่เกินไป กรุณาใช้รูปไม่เกินประมาณ 2 MB');
  const blob=Utilities.newBlob(Utilities.base64Decode(b.data),b.mimeType||'image/png',b.fileName||'item.png');const imageUrl=saveBlobToDrive(blob,b.fileName||'item.png');
  log('UPLOAD','IMAGE','',b.fileName||'item.png',imageUrl);return output({ok:true,imageUrl});
}

/** Read image files embedded on the exact DMO Wiki Seal Master page. */
function getWikiSealImages(){
  const cache=CacheService.getScriptCache(),cached=cache.get('dmo-wiki-seal-images-v1');if(cached)return JSON.parse(cached);
  const api='https://dmowiki.com/api.php';
  const options={muteHttpExceptions:true,headers:{'User-Agent':'Mozilla/5.0 DMO-Toolbox/1.0'}};
  const parseUrl=api+'?action=parse&page=Seal_Master&prop=images&format=json';
  const parsedResponse=UrlFetchApp.fetch(parseUrl,options);
  if(parsedResponse.getResponseCode()>=400){
    const pageResponse=UrlFetchApp.fetch('https://dmowiki.com/Seal_Master',options);
    if(pageResponse.getResponseCode()>=400)throw Error('DMO Wiki ไม่อนุญาตให้โหลดรูปในขณะนี้');
    const source=pageResponse.getContentText(),tags=source.match(/<img\b[^>]*>/gi)||[],fallback=[];
    tags.forEach(tag=>{
      const srcMatch=tag.match(/(?:src|data-src)=[\"']([^\"']+)[\"']/i),altMatch=tag.match(/(?:alt|title)=[\"']([^\"']*)[\"']/i);
      if(!srcMatch)return;let url=srcMatch[1].replace(/&amp;/g,'&');if(url.indexOf('/images/')<0)return;if(url.indexOf('//')===0)url='https:'+url;else if(url.indexOf('/')===0)url='https://dmowiki.com'+url;
      fallback.push({title:'File:'+(altMatch&&altMatch[1]||url.split('/').pop()),url:url,thumb:url});
    });
    if(!fallback.length)throw Error('ไม่พบรูปในหน้า Seal Master');
    cache.put('dmo-wiki-seal-images-v1',JSON.stringify(fallback.slice(0,900)),21600);return fallback.slice(0,900);
  }
  const parsed=JSON.parse(parsedResponse.getContentText());const names=(parsed.parse&&parsed.parse.images)||[];if(!names.length)throw Error('ไม่พบรูปในหน้า Seal Master');
  const results=[];
  for(let start=0;start<names.length;start+=40){
    const titles=names.slice(start,start+40).map(n=>'File:'+n).join('|');
    const queryUrl=api+'?action=query&prop=imageinfo&iiprop=url&iiurlwidth=240&format=json&titles='+encodeURIComponent(titles);
    const response=UrlFetchApp.fetch(queryUrl,options);if(response.getResponseCode()>=400)continue;
    const data=JSON.parse(response.getContentText()),pages=(data.query&&data.query.pages)||{};
    Object.keys(pages).forEach(k=>{const p=pages[k],ii=p.imageinfo&&p.imageinfo[0];if(ii&&ii.url)results.push({title:p.title,url:ii.url,thumb:ii.thumburl||ii.url});});
  }
  results.sort((a,b)=>a.title.localeCompare(b.title));
  const limited=results.slice(0,900);cache.put('dmo-wiki-seal-images-v1',JSON.stringify(limited),21600);return limited;
}
function importWikiImage(b){
  if(!b.imageUrl)throw Error('ไม่มี URL รูป');
  const response=UrlFetchApp.fetch(b.imageUrl,{muteHttpExceptions:true,headers:{'User-Agent':'Mozilla/5.0 DMO-Toolbox/1.0'}});if(response.getResponseCode()>=400)throw Error('ดาวน์โหลดรูปจาก DMO Wiki ไม่สำเร็จ');
  const blob=response.getBlob(),name=String(b.fileName||'DMO-Wiki-Seal.png').replace(/^File:/,'');const imageUrl=saveBlobToDrive(blob,name);
  log('IMPORT_WIKI_IMAGE','IMAGE','',name,'Source: https://dmowiki.com/Seal_Master');return output({ok:true,imageUrl,source:'https://dmowiki.com/Seal_Master'});
}

function backupFolder(){let folders=DriveApp.getFoldersByName('DMO-Toolbox-Backups');return folders.hasNext()?folders.next():DriveApp.createFolder('DMO-Toolbox-Backups');}
function backupTriggerActive(){try{return ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='scheduledBackup');}catch(e){return false;}}
function listBackups(){return rows(SHEETS.backups).slice().reverse().map(x=>({...x,sizeBytes:number(x.sizeBytes)}));}
function pruneBackups(){
  const retention=Math.max(1,number(settingValue('backupRetention',14))||14),s=sheet(SHEETS.backups,HEADERS.backups),vals=s.getDataRange().getValues();
  if(vals.length<=retention+1)return;
  const remove=vals.slice(1,Math.max(1,vals.length-retention));
  remove.forEach(r=>{try{if(r[4])DriveApp.getFileById(String(r[4])).setTrashed(true);}catch(e){}});
  if(remove.length)s.deleteRows(2,remove.length);
}
function createServerBackup(reason,createdBy){
  const now=new Date(),name='DMO-Toolbox-Backup-'+Utilities.formatDate(now,Session.getScriptTimeZone(),'yyyyMMdd-HHmmss'),folder=backupFolder();
  const copy=DriveApp.getFileById(ss().getId()).makeCopy(name,folder),id=makeId('BKP');
  sheet(SHEETS.backups,HEADERS.backups).appendRow([id,now,createdBy||'SYSTEM',reason||'MANUAL',copy.getId(),copy.getUrl(),copy.getName(),copy.getSize()||0,'READY']);
  log('BACKUP_CREATE','SYSTEM',id,name,reason||'MANUAL');pruneBackups();return{id,fileId:copy.getId(),fileUrl:copy.getUrl(),fileName:copy.getName()};
}
function createBackupAction(b,actor){requireRole(b.token,['OWNER','ADMIN']);const result=createServerBackup(b.reason||'MANUAL',actor.userId);return output({ok:true,backup:result,backups:listBackups().slice(0,50)});}
function scheduledBackup(){try{ensureDatabase();if(settingValue('backupEnabled',true)!==false)createServerBackup('AUTO','SYSTEM');}catch(err){log('BACKUP_AUTO_ERROR','SYSTEM','','',String(err&&err.message||err));}}
function setupBackupTriggerAction(b,actor){
  requireRole(b.token,['OWNER']);const enabled=b.enabled!==false,hour=Math.max(0,Math.min(23,number(b.hour)));ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='scheduledBackup').forEach(t=>ScriptApp.deleteTrigger(t));
  saveSettings({backupEnabled:enabled?'TRUE':'FALSE',backupHour:hour});
  if(enabled)ScriptApp.newTrigger('scheduledBackup').timeBased().everyDays(1).atHour(hour).create();
  securityLog('BACKUP_TRIGGER',actor.userId,enabled?'ON '+hour:'OFF');return output({ok:true,triggerActive:backupTriggerActive()});
}
function restoreBackupAction(b,actor){return withLock(()=>{
  requireRole(b.token,['OWNER']);if(String(b.confirm||'')!=='RESTORE')throw Error('กรุณายืนยันด้วยคำว่า RESTORE');
  const rec=listBackups().find(x=>String(x.backupId)===String(b.backupId));if(!rec||!rec.fileId)throw Error('ไม่พบ Backup ที่เลือก');
  createServerBackup('PRE_RESTORE',actor.userId);
  const source=SpreadsheetApp.openById(String(rec.fileId));
  const skip=new Set([SHEETS.backups,SHEETS.sessions,SHEETS.users]);
  Object.keys(SHEETS).map(k=>SHEETS[k]).filter(name=>!skip.has(name)).forEach(name=>{
    const srcSheet=source.getSheetByName(name);if(!srcSheet)return;const srcRange=srcSheet.getDataRange(),values=srcRange.getValues(),formulas=srcRange.getFormulas();if(!values.length)return;
    const restored=values.map((row,r)=>row.map((value,c)=>formulas[r][c]||value));let target=ss().getSheetByName(name);if(!target)target=ss().insertSheet(name);target.clearContents();const targetRange=target.getRange(1,1,restored.length,restored[0].length);targetRange.setValues(restored);try{targetRange.setNumberFormats(srcRange.getNumberFormats());targetRange.setDataValidations(srcRange.getDataValidations());targetRange.setBackgrounds(srcRange.getBackgrounds());targetRange.setFontColors(srcRange.getFontColors());targetRange.setFontWeights(srcRange.getFontWeights());}catch(formatErr){}
  });
  securityLog('BACKUP_RESTORE',actor.userId,rec.backupId);log('BACKUP_RESTORE','SYSTEM',rec.backupId,rec.fileName||'',actor.userId);return output({ok:true});
});}
function deleteBackupAction(b,actor){return withLock(()=>{requireRole(b.token,['OWNER']);const s=sheet(SHEETS.backups,HEADERS.backups),v=s.getDataRange().getValues();for(let i=1;i<v.length;i++)if(String(v[i][0])===String(b.backupId)){try{if(v[i][4])DriveApp.getFileById(String(v[i][4])).setTrashed(true);}catch(e){}s.deleteRow(i+1);securityLog('BACKUP_DELETE',actor.userId,b.backupId);return output({ok:true});}throw Error('ไม่พบ Backup');});}
function automationAlerts(snapshot){
  const products=snapshot?[...(snapshot.seals||[]),...(snapshot.gameItems||[])]:[...rows(SHEETS.seals).map(normalizeSeal),...rows(SHEETS.items).map(normalizeItem)],orders=snapshot?snapshot.orders||[]:rows(SHEETS.orders),customers=snapshot?snapshot.customers||[]:rows(SHEETS.customers),now=Date.now();
  const low=products.filter(p=>{const a=availableQty(p.stock,p.reservedStock);return a!==''&&a>0&&number(p.lowStockAlert)>0&&a<=number(p.lowStockAlert);});
  const out=products.filter(p=>p.status==='OUT_OF_STOCK'||(availableQty(p.stock,p.reservedStock)!==''&&availableQty(p.stock,p.reservedStock)<=0));
  const fresh=orders.filter(o=>String(o.status)==='NEW');
  const follow=customers.filter(c=>c.followUpAt&&new Date(c.followUpAt).getTime()<=now&&String(c.status||'ACTIVE')==='ACTIVE');
  return{lowStock:low.slice(0,50),outOfStock:out.slice(0,50),newOrders:fresh.slice(-50).reverse(),followUps:follow.slice(0,50),counts:{lowStock:low.length,outOfStock:out.length,newOrders:fresh.length,followUps:follow.length}};
}
function getAutomationData(actor,snapshot){const settings=snapshot&&snapshot.settings||{},setting=(key,fallback)=>Object.prototype.hasOwnProperty.call(settings,key)?settings[key]:settingValue(key,fallback);return{backups:actor&&['OWNER','ADMIN'].includes(actor.role)?listBackups().slice(0,50):[],triggerActive:backupTriggerActive(),backupEnabled:setting('backupEnabled',true)!==false,backupHour:number(setting('backupHour',3)),retention:number(setting('backupRetention',14))||14,alerts:automationAlerts(snapshot)};}

function runIntegrityCheck(){
  const issues=[],orders=rows(SHEETS.orders),items=rows(SHEETS.orderItems),requests=rows(SHEETS.orderRequests),stockLogs=rows(SHEETS.stockLogs),customers=rows(SHEETS.customers),orderIds=new Set(orders.map(x=>String(x.orderId))),counts={};orders.forEach(o=>counts[o.orderId]=(counts[o.orderId]||0)+1);
  Object.keys(counts).filter(id=>counts[id]>1).forEach(id=>issues.push({severity:'ERROR',code:'DUPLICATE_ORDER_ID',orderId:id,message:'พบเลขออเดอร์ซ้ำ '+counts[id]+' รายการ'}));
  orders.filter(o=>!items.some(x=>String(x.orderId)===String(o.orderId))).forEach(o=>issues.push({severity:'ERROR',code:'ORDER_WITHOUT_ITEMS',orderId:o.orderId,message:'ออเดอร์ไม่มี OrderItems'}));
  items.filter(x=>!orderIds.has(String(x.orderId))).forEach(x=>issues.push({severity:'ERROR',code:'ITEM_WITHOUT_ORDER',orderId:x.orderId,orderItemId:x.orderItemId,message:'OrderItem ไม่มี Orders ต้นทาง'}));
  const requestOrderIds=new Set(requests.filter(x=>String(x.status)==='COMPLETED').map(x=>String(x.orderId)));
  const requestIds=new Set(requests.map(x=>String(x.requestId)));
  orders.filter(o=>o.requestId&&!requestIds.has(String(o.requestId))).forEach(o=>issues.push({severity:'ERROR',code:'ORDER_WITHOUT_REQUEST',orderId:o.orderId,message:'ออเดอร์มี requestId แต่ไม่พบ OrderRequests ต้นทาง'}));
  requests.filter(x=>String(x.status)==='COMPLETED'&&x.orderId&&!orderIds.has(String(x.orderId))).forEach(x=>issues.push({severity:'ERROR',code:'REQUEST_WITHOUT_ORDER',orderId:x.orderId,requestId:x.requestId,message:'OrderRequests สำเร็จแต่ไม่พบ Orders'}));
  orders.filter(o=>o.requestId&&!requestOrderIds.has(String(o.orderId))).forEach(o=>issues.push({severity:'WARN',code:'REQUEST_NOT_COMPLETED',orderId:o.orderId,requestId:o.requestId,message:'ออเดอร์มีอยู่แต่ OrderRequests ยังไม่ COMPLETED'}));
  [...rows(SHEETS.seals).map(x=>({...x,kind:'SEAL'})),...rows(SHEETS.items).map(x=>({...x,kind:'ITEM'}))].forEach(p=>{if(p.stock!==''&&number(p.stock)<0)issues.push({severity:'ERROR',code:'NEGATIVE_STOCK',kind:p.kind,productId:p.id,message:'Stock ติดลบ'});if(number(p.reservedStock)<0)issues.push({severity:'ERROR',code:'NEGATIVE_RESERVED',kind:p.kind,productId:p.id,message:'Reserved Stock ติดลบ'});if(p.stock!==''&&number(p.reservedStock)>number(p.stock))issues.push({severity:'ERROR',code:'RESERVED_OVER_STOCK',kind:p.kind,productId:p.id,message:'Reserved Stock มากกว่า Stock'});});
  orders.forEach(o=>{const state=String(o.inventoryState||''),legacy=String(o.legacyOrder||'').toUpperCase()==='TRUE';if(legacy)return;if(o.status==='COMPLETED'&&state!=='DEDUCTED')issues.push({severity:'ERROR',code:'COMPLETED_INVENTORY_STATE',orderId:o.orderId,message:'COMPLETED แต่ inventoryState ไม่ใช่ DEDUCTED'});if(o.status==='CANCELLED'&&state!=='RELEASED')issues.push({severity:'ERROR',code:'CANCELLED_INVENTORY_STATE',orderId:o.orderId,message:'CANCELLED แต่ inventoryState ไม่ใช่ RELEASED'});if(!['COMPLETED','CANCELLED'].includes(String(o.status))&&state!=='RESERVED')issues.push({severity:'ERROR',code:'OPEN_INVENTORY_STATE',orderId:o.orderId,message:'ออเดอร์เปิดอยู่แต่ inventoryState ไม่ใช่ RESERVED'});});
  orders.filter(o=>String(o.inventoryState||'')).forEach(o=>{const orderItems=items.filter(x=>String(x.orderId)===String(o.orderId)),requiresLog=orderItems.some(x=>String(x.stockCheck)==='OK'&&String(x.kind)!=='SERVICE');if(!requiresLog)return;const related=stockLogs.filter(x=>String(x.reason||'').includes(String(o.orderId)));if(!related.length)issues.push({severity:'WARN',code:'ORDER_WITHOUT_STOCK_LOG',orderId:o.orderId,message:'ออเดอร์มีการเปลี่ยนสต๊อกแต่ไม่พบ StockLogs'});});
  const customerIds=new Set(customers.map(x=>String(x.customerId)));
  orders.forEach(o=>{if(String(o.legacyOrder||'').toUpperCase()==='TRUE')return;const id=customerKey(o);if(id&&!customerIds.has(id))issues.push({severity:'WARN',code:'ORDER_WITHOUT_CUSTOMER',orderId:o.orderId,customerId:id,message:'ไม่พบโปรไฟล์ลูกค้าของออเดอร์'});});
  customers.forEach(c=>{const completed=orders.filter(o=>String(o.status)==='COMPLETED'&&customerKey(o)===String(c.customerId)),total=completed.reduce((sum,o)=>sum+number(o.total),0);if(number(c.orderCount)!==completed.length||Math.abs(number(c.totalSpent)-total)>0.01)issues.push({severity:'ERROR',code:'CUSTOMER_TOTAL_MISMATCH',customerId:c.customerId,message:'ยอดสะสมลูกค้าไม่ตรงกับออเดอร์ COMPLETED'});});
  return{checkedAt:new Date().toISOString(),summary:{orders:orders.length,orderItems:items.length,orderRequests:requests.length,stockLogs:stockLogs.length,customers:customers.length,issues:issues.length,errors:issues.filter(x=>x.severity==='ERROR').length,warnings:issues.filter(x=>x.severity==='WARN').length},issues:issues.slice(0,500)};
}
function safeAdminError(err){const message=String(err&&err.message||err||'');return message.length&&message.length<=300?message:'ทำรายการไม่สำเร็จ';}
function publicFailure(err){const message=String(err&&err.message||err||''),allowed=['กรุณา','ไม่มีสินค้า','ไม่พบสินค้า','ไม่พร้อมขาย','สต๊อก','จำนวนสินค้า','ประเภทสินค้า','ออเดอร์','คำขอ','บัญชี','ไอดีหรือรหัสผ่าน','ลองเข้าสู่ระบบ','ระบบยังไม่พร้อม'];const safe=allowed.some(x=>message.includes(x))?message:'ระบบไม่สามารถทำรายการได้ กรุณาลองใหม่หรือติดต่อร้าน';return output({ok:false,error:safe});}
function safeSheetText(value,maxLength){let text=String(value??'').replace(/\u0000/g,'').trim().slice(0,maxLength||500);if(/^[=+\-@]/.test(text))text="'"+text;return text;}
function number(v){return Number(String(v??'').replace(/,/g,''))||0;}
function log(action,kind,id,name,details){sheet(SHEETS.logs,HEADERS.logs).appendRow([new Date(),safeSheetText(action,80),safeSheetText(kind,80),safeSheetText(id,180),safeSheetText(name,250),safeSheetText(details||'',4000)]);}
function initializeOwnerPassword(){
  ensureDatabase();const ui=SpreadsheetApp.getUi(),idPrompt=ui.prompt('ตั้งค่าบัญชี OWNER','กรอก User ID ของเจ้าของร้าน (ห้ามใช้รหัสผ่านเดิมที่เคยเผยแพร่)',ui.ButtonSet.OK_CANCEL);if(idPrompt.getSelectedButton()!==ui.Button.OK)return;const id=String(idPrompt.getResponseText()||'').trim();if(!id)return ui.alert('กรุณากรอก User ID');const passPrompt=ui.prompt('ตั้งรหัสผ่านใหม่','กรอกรหัสผ่านอย่างน้อย 10 ตัวอักษร ระบบจะเก็บเฉพาะ salted hash',ui.ButtonSet.OK_CANCEL);if(passPrompt.getSelectedButton()!==ui.Button.OK)return;const password=String(passPrompt.getResponseText()||'');if(password.length<10)return ui.alert('รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร');const s=sheet(SHEETS.users,HEADERS.users),v=s.getDataRange().getValues(),h=v[0].map(String),now=new Date(),rec=securePasswordRecord(password);let row=-1;for(let i=1;i<v.length;i++)if(String(v[i][0])===id){row=i+1;break;}const data={userId:id,displayName:'Owner',passwordHash:rec.hash,role:'OWNER',status:'ACTIVE',createdAt:now,updatedAt:now,lastLoginAt:'',passwordSalt:rec.salt,passwordAlgo:rec.algo,mustChangePassword:'FALSE',failedLoginCount:0,lockedUntil:''};if(row<0)s.appendRow(HEADERS.users.map(k=>data[k]??''));else HEADERS.users.forEach(k=>{const c=h.indexOf(k);if(c>=0&&data[k]!==undefined)s.getRange(row,c+1).setValue(data[k]);});CacheService.getScriptCache().remove(loginThrottleKey(id));securityLog('OWNER_PASSWORD_RESET',id,'SHEET_EDITOR_ACTION');ui.alert('ตั้งค่าบัญชี OWNER สำเร็จแล้ว');
}
function assertSpreadsheetOwner(){const active=String(Session.getActiveUser().getEmail()||'').toLowerCase(),effective=String(Session.getEffectiveUser().getEmail()||'').toLowerCase(),owner=String(DriveApp.getFileById(ss().getId()).getOwner().getEmail()||'').toLowerCase();if(!active||active!==owner||effective!==owner)throw Error('อนุญาตเฉพาะเจ้าของไฟล์ Google Sheet เท่านั้น');return owner;}
function ownerSecuritySidebar(){const id=SpreadsheetApp.getActive().getId(),environment=id===PRODUCTION_SPREADSHEET_ID?'PRODUCTION':id===TEST_SPREADSHEET_ID?'TEST':'BACKUP';return HtmlService.createHtmlOutput(`<!doctype html><html><head><base target="_top"><style>body{font:14px system-ui;padding:18px;color:#15243a}label{display:block;margin:12px 0 5px;font-weight:700}input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #9aabc0;border-radius:8px}button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:8px;background:#1677db;color:white;font-weight:800}small{color:#52657c}.env{padding:10px;border-radius:8px;background:${environment==='PRODUCTION'?'#ffe3e6':environment==='TEST'?'#fff2c7':'#ffd9d9'};font-weight:800}.msg{margin-top:12px;white-space:pre-wrap}</style></head><body><div class="env">Environment: ${environment}</div><h2>ตั้งค่า/กู้คืน OWNER</h2><small>เฉพาะเจ้าของไฟล์ Google Sheet เท่านั้น ระบบจะตรวจสิทธิ์และ Environment ที่ Server ก่อนบันทึก และไม่เก็บรหัสผ่านจริง</small><label>User ID</label><input id="uid" autocomplete="username"><label>รหัสผ่านใหม่ (อย่างน้อย 10 ตัว)</label><input id="pass" type="password" autocomplete="new-password"><label>ยืนยันรหัสผ่านใหม่</label><input id="confirm" type="password" autocomplete="new-password"><button id="submit" onclick="save()">ตั้งค่า OWNER</button><div class="msg" id="msg"></div><script>function save(){const b=document.getElementById('submit'),m=document.getElementById('msg'),p=document.getElementById('pass').value,c=document.getElementById('confirm').value;if(p.length<10){m.textContent='รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร';return}if(p!==c){m.textContent='ยืนยันรหัสผ่านไม่ตรงกัน';return}b.disabled=true;m.textContent='กำลังดำเนินการ...';google.script.run.withSuccessHandler(x=>{m.textContent=x.message;b.style.display='none';document.getElementById('pass').value='';document.getElementById('confirm').value=''}).withFailureHandler(e=>{m.textContent=e.message;b.disabled=false}).saveOwnerFromSidebar({userId:document.getElementById('uid').value,password:p,confirmPassword:c});}</script></body></html>`).setTitle('บัญชี OWNER');}
function initializeOwnerPassword(){SpreadsheetApp.getUi().showSidebar(ownerSecuritySidebar());}
function authorizeOwnerSetup(){ensureDatabase();assertSpreadsheetOwner();const env=environmentInfo();if(!env.ownerSetupAllowed)throw Error('ฐานข้อมูลนี้เป็น BACKUP จึงไม่อนุญาตให้ตั้ง OWNER');return{ok:true,environment:env.environment,message:'อนุญาตสิทธิ์สำเร็จ กลับไปเปิดเมนูตั้งค่า OWNER ใน Google Sheet'};}
function saveOwnerFromSidebar(p){return withLock(()=>{assertSpreadsheetOwner();const env=environmentInfo();if(!env.ownerSetupAllowed)throw Error('ไม่อนุญาตให้ตั้ง OWNER บนฐานข้อมูล BACKUP');const id=String(p&&p.userId||'').trim(),password=String(p&&p.password||''),confirm=String(p&&p.confirmPassword||'');if(!id)throw Error('กรุณากรอก User ID');if(password.length<10)throw Error('รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร');if(password!==confirm)throw Error('ยืนยันรหัสผ่านไม่ตรงกัน');const s=sheet(SHEETS.users,HEADERS.users),v=s.getDataRange().getValues(),h=v[0].map(String),owners=[];for(let i=1;i<v.length;i++)if(String(v[i][h.indexOf('role')])==='OWNER'&&String(v[i][h.indexOf('status')])==='ACTIVE')owners.push(i+1);if(owners.length>1)throw Error('พบบัญชี OWNER มากกว่า 1 บัญชี กรุณาตรวจสอบก่อน');if(owners.length===1&&String(v[owners[0]-1][h.indexOf('userId')])!==id)throw Error('User ID ไม่ตรงกับ OWNER ปัจจุบัน');const rec=securePasswordRecord(password),now=new Date(),data={userId:id,displayName:owners.length?String(v[owners[0]-1][h.indexOf('displayName')]||'Owner'):'Owner',passwordHash:rec.hash,role:'OWNER',status:'ACTIVE',createdAt:owners.length?v[owners[0]-1][h.indexOf('createdAt')]:now,updatedAt:now,lastLoginAt:owners.length?v[owners[0]-1][h.indexOf('lastLoginAt')]:'',passwordSalt:rec.salt,passwordAlgo:rec.algo,mustChangePassword:'FALSE',failedLoginCount:0,lockedUntil:''};if(owners.length)HEADERS.users.forEach((k,j)=>s.getRange(owners[0],j+1).setValue(data[k]??''));else s.appendRow(HEADERS.users.map(k=>data[k]??''));invalidateUserSessions(id);CacheService.getScriptCache().remove(loginThrottleKey(id));securityLog(owners.length?'OWNER_EMERGENCY_RESET':'OWNER_INITIAL_SETUP',id,env.environment+'_SHEET_OWNER_ACTION');return{ok:true,message:owners.length?'รีเซ็ตรหัส OWNER สำเร็จ กรุณาเข้าสู่ระบบใหม่':'ตั้งค่าบัญชี OWNER สำเร็จแล้ว'};});}
function onEdit(e){
  try{
    if(!e||!e.range)return;const s=e.range.getSheet(),name=s.getName(),kind=name===SHEETS.seals?'SEAL':name===SHEETS.items?'ITEM':'';if(!kind||e.range.getRow()<2)return;
    const headers=s.getRange(1,1,1,s.getLastColumn()).getDisplayValues()[0].map(String),stockColumn=headers.indexOf('stock')+1;if(stockColumn<1||e.range.getColumn()>stockColumn||e.range.getLastColumn()<stockColumn)return;
    const actor=String(Session.getActiveUser().getEmail()||'SHEET_OWNER'),idColumn=headers.indexOf('id')+1,nameColumn=headers.indexOf('name')+1,reservedColumn=headers.indexOf('reservedStock')+1,statusColumn=headers.indexOf('status')+1,updatedColumn=headers.indexOf('updatedAt')+1;
    for(let row=e.range.getRow();row<=e.range.getLastRow();row++){
      const cell=s.getRange(row,stockColumn),raw=cell.getValue(),after=raw===''?'':Number(raw),reserved=reservedColumn>0?number(s.getRange(row,reservedColumn).getValue()):0;
      if(after!==''&&(!Number.isFinite(after)||after<0||after<reserved)){if(e.range.getNumRows()===1&&e.range.getNumColumns()===1)cell.setValue(e.oldValue===undefined?'':e.oldValue);SpreadsheetApp.getActive().toast('Stock ต้องเป็นตัวเลขตั้งแต่ 0 และไม่น้อยกว่า Reserved','GUN SHOP DMO',6);continue;}
      const product={id:idColumn>0?s.getRange(row,idColumn).getDisplayValue():'',name:nameColumn>0?s.getRange(row,nameColumn).getDisplayValue():''},before=e.range.getNumRows()===1&&e.range.getNumColumns()===1?(e.oldValue===undefined?'':e.oldValue):'',delta=before===''||after===''?0:Number(after)-number(before);
      if(statusColumn>0)s.getRange(row,statusColumn).setValue(stockStatus(after,reserved,s.getRange(row,statusColumn).getValue()));if(updatedColumn>0)s.getRange(row,updatedColumn).setValue(new Date());
      writeStockLog(kind,product,before===''?0:number(before),delta,after===''?0:after,reserved,'SHEET_SET','แก้ไขโดยตรงใน Google Sheet',actor);
    }
    markStockUpdated();invalidatePublicCache();
  }catch(err){try{SpreadsheetApp.getActive().toast('บันทึก Stock แล้ว แต่บันทึกประวัติ/Sync ไม่สำเร็จ: '+safeAdminError(err),'GUN SHOP DMO',8);}catch(ignore){}}
}
function onOpen(){SpreadsheetApp.getUi().createMenu('GUN SHOP DMO').addItem('ตรวจโครงสร้างฐานข้อมูล','menuInitialize').addItem('ตั้งค่า/กู้คืน OWNER (เจ้าของไฟล์เท่านั้น)','initializeOwnerPassword').addToUi();}
function menuInitialize(){ensureDatabase();SpreadsheetApp.getUi().alert('ฐานข้อมูล GUN SHOP DMO V20.1 พร้อมใช้งาน');}
function verifyLegacyMigration(){
  const orders=rows(SHEETS.orders),items=rows(SHEETS.orderItems),legacy=orders.filter(o=>String(o.legacyOrder||'').toUpperCase()==='TRUE'),orderIds=new Set(orders.map(o=>String(o.orderId))),itemIds=items.map(x=>String(x.orderItemId)),orphans=items.filter(x=>!orderIds.has(String(x.orderId))),duplicates=itemIds.length-new Set(itemIds).size,products=[...rows(SHEETS.seals),...rows(SHEETS.items)],reservedTotal=products.reduce((sum,p)=>sum+number(p.reservedStock),0),legacyStockLogs=rows(SHEETS.stockLogs).filter(x=>legacy.some(o=>String(x.reason||'').includes(String(o.orderId)))),integrity=runIntegrityCheck();
  const result={orders:orders.length,orderItems:items.length,legacyOrders:legacy.length,orphanOrderItems:orphans.length,duplicateOrderItemIds:duplicates,reservedStockTotal:reservedTotal,legacyStockLogs:legacyStockLogs.length,integrity:integrity.summary};
  if(result.orders!==16||result.orderItems!==40||result.legacyOrders!==16||result.orphanOrderItems||result.duplicateOrderItemIds||result.reservedStockTotal||result.legacyStockLogs||integrity.summary.errors||integrity.summary.warnings)throw Error('Legacy verification failed: '+JSON.stringify(result));
  return result;
}
function createLegacyCheckpointBackup(){return createServerBackup('POST_LEGACY_MIGRATION_CHECKPOINT','SYSTEM');}
function verifyProductionOwner(){const owners=rows(SHEETS.users).filter(u=>String(u.role)==='OWNER'&&String(u.status)==='ACTIVE');if(owners.length!==1)throw Error('OWNER verification failed: '+owners.length);return{owners:owners.length,userId:owners[0].userId,passwordAlgo:owners[0].passwordAlgo,mustChangePassword:owners[0].mustChangePassword};}
function output(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
