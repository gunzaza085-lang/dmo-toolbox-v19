/**
 * DMO Toolbox Ultimate 2.1 API (V19 Mobile/PWA)
 * - Customer: Seals, Items, Services, Orders
 * - Admin: Dashboard, calculator, catalog, orders, settings, logs
 * - DMO Wiki Seal Master image gallery + import to Google Drive
 */
const SHEETS = { seals:'Seals', items:'Items', services:'Services', settings:'Settings', orders:'Orders', logs:'Logs', stockLogs:'StockLogs', customers:'Customers', promotions:'Promotions', promotionProducts:'PromotionProducts', system:'System', trash:'Trash', wikiCache:'WikiCache', customerInteractions:'CustomerInteractions', reportSettings:'ReportSettings', users:'Users', sessions:'Sessions', backups:'Backups', notifications:'Notifications' };
const HEADERS = {
  seals:['id','name','aliases','category','section','price','unit','packSize','status','stock','note','imageUrl','wikiName','badge','sortOrder','updatedAt','reservedStock','lowStockAlert','costPrice','wikiTitle','wikiUrl','wikiImageSource','tags','searchKeywords','wikiSyncedAt'],
  items:['id','name','aliases','itemCategory','price','unit','status','stock','note','description','imageUrl','badge','sortOrder','updatedAt','reservedStock','lowStockAlert','costPrice','tags','searchKeywords'],
  services:['id','name','aliases','serviceCategory','price','unit','status','stock','note','description','imageUrl','badge','sortOrder','updatedAt','tags','searchKeywords'],
  settings:['key','value','description'],
  orders:['orderId','createdAt','tamer','server','contact','itemsJson','total','promoSets','status','adminNote','updatedAt'],
  logs:['createdAt','action','kind','id','name','details'],
  stockLogs:['createdAt','kind','productId','productName','beforeStock','changeQty','afterStock','reservedStock','availableStock','action','reason','admin'],
  customers:['customerId','createdAt','updatedAt','tamer','server','contact','orderCount','totalSpent','vipLevel','status','note','lastOrderAt','tags','preferredContact','followUpAt','lastContactAt'],
  promotions:['promotionId','name','type','value','minSpend','buyQty','freeQty','rewardText','startAt','endAt','status','priority','stackable','scope','note','updatedAt'],
  promotionProducts:['promotionId','kind','productId','productName'],
  system:['key','value','description'],
  trash:['deletedAt','kind','id','name','dataJson','deletedBy'],
  wikiCache:['cachedAt','query','title','url','thumbnail','extract'],
  customerInteractions:['interactionId','createdAt','customerId','customerName','type','channel','note','nextFollowUpAt','admin'],
  reportSettings:['key','value','description'],
  users:['userId','displayName','passwordHash','role','status','createdAt','updatedAt','lastLoginAt'],
  sessions:['token','userId','role','createdAt','expiresAt','lastSeenAt','status'],
  backups:['backupId','createdAt','createdBy','reason','fileId','fileUrl','fileName','sizeBytes','status'],
  notifications:['notificationId','createdAt','type','severity','title','message','status','relatedId']
};
const DEFAULT_SETTINGS = {
  shopName:'DMO Toolbox', promoThreshold:100, promoReward:150,
  orderNotice:'รายการนี้ยังไม่ใช่การยืนยันคำสั่งซื้อ กรุณารอร้านตรวจสอบสต๊อกและยืนยันยอดก่อนโอน',
  autoRefreshSeconds:60, allowOrderSave:'TRUE', showStock:'TRUE', facebookUrl:'', lineUrl:'',
  sessionDays:7, autoLockMinutes:30, apiKey:'',
  backupEnabled:'TRUE', backupHour:3, backupRetention:14, alertLowStock:'TRUE', alertNewOrders:'TRUE',
  themeDefault:'DARK', enablePWA:'TRUE', offlineCacheHours:12, mobileCompact:'TRUE', showMobileBottomNav:'TRUE'
};

function doGet(e){
  try {
    ensureDatabase();
    const isAdmin=e&&e.parameter&&e.parameter.admin==='1'&&validToken(e.parameter.token);
    const data=readAll(isAdmin);
    if(isAdmin){const actor=currentActor(e.parameter.token);data.security={actor,users:actor&&actor.role==='OWNER'?listUsers():[],sessionDays:settingValue('sessionDays',7),autoLockMinutes:settingValue('autoLockMinutes',30),apiKeyConfigured:!!String(settingValue('apiKey',''))};data.automation=getAutomationData(actor);}
    return output({ok:true,...data,updatedAt:new Date().toISOString()});
  } catch(err){ return output({ok:false,error:String(err&&err.message||err)}); }
}

function doPost(e){
  try {
    ensureDatabase();
    const body=JSON.parse((e.postData&&e.postData.contents)||'{}');
    if(body.action==='login') return login(body);
    if(body.action==='createOrder') return createOrder(body);
    if(body.action==='logout') return logout(body.token);
    if(!validToken(body.token)) throw Error('กรุณาเข้าสู่ระบบใหม่');
    const actor=currentActor(body.token);
    const writeActions=['upsert','delete','softDelete','restoreTrash','permanentDelete','bulkUpdate','saveSettings','updateOrder','uploadImage','importWikiImage','attachWikiMetadata','adjustStock','setStock','updateCustomer','addCustomerInteraction','upsertPromotion','deletePromotion','createBackup','restoreBackup','setupBackupTrigger','deleteBackup'];
    if(writeActions.includes(body.action)) requireRole(body.token,['OWNER','ADMIN','STAFF']);
    switch(body.action){
      case'upsert': return upsert(body.record);
      case'delete': return softDelete(body.kind,body.id);
      case'softDelete': return softDelete(body.kind,body.id);
      case'restoreTrash': return restoreTrash(body.trashId);
      case'permanentDelete': return permanentDelete(body.trashId);
      case'bulkUpdate': return bulkUpdate(body.records,body.changes);
      case'saveSettings': return saveSettings(body.settings);
      case'updateOrder': return updateOrder(body);
      case'uploadImage': return uploadImage(body);
      case'wikiGallery': return output({ok:true,images:getWikiSealImages()});
      case'importWikiImage': return importWikiImage(body);
      case'wikiSearchPages': return output({ok:true,results:searchDmoWikiPages(body.query)});
      case'attachWikiMetadata': return attachWikiMetadata(body);
      case'adjustStock': return adjustStock(body);
      case'setStock': return setStock(body);
      case'updateCustomer': return updateCustomer(body);
      case'addCustomerInteraction': return addCustomerInteraction(body);
      case'upsertPromotion': return upsertPromotion(body.promotion);
      case'deletePromotion': return deletePromotion(body.promotionId);
      case'saveSecurityUser': return saveSecurityUser(body,actor);
      case'createBackup': return createBackupAction(body,actor);
      case'restoreBackup': return restoreBackupAction(body,actor);
      case'setupBackupTrigger': return setupBackupTriggerAction(body,actor);
      case'deleteBackup': return deleteBackupAction(body,actor);
      case'initialize': return output({ok:true,message:'ฐานข้อมูลพร้อมใช้งาน'});
      default: throw Error('ไม่รู้จักคำสั่ง');
    }
  } catch(err){ return output({ok:false,error:String(err&&err.message||err)}); }
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
  sheet(SHEETS.seals,HEADERS.seals); sheet(SHEETS.items,HEADERS.items); sheet(SHEETS.services,HEADERS.services);
  sheet(SHEETS.settings,HEADERS.settings); sheet(SHEETS.orders,HEADERS.orders); sheet(SHEETS.logs,HEADERS.logs); sheet(SHEETS.stockLogs,HEADERS.stockLogs);
  sheet(SHEETS.customers,HEADERS.customers); sheet(SHEETS.customerInteractions,HEADERS.customerInteractions); sheet(SHEETS.promotions,HEADERS.promotions); sheet(SHEETS.promotionProducts,HEADERS.promotionProducts); sheet(SHEETS.system,HEADERS.system); sheet(SHEETS.trash,HEADERS.trash); sheet(SHEETS.wikiCache,HEADERS.wikiCache); sheet(SHEETS.reportSettings,HEADERS.reportSettings); sheet(SHEETS.users,HEADERS.users); sheet(SHEETS.sessions,HEADERS.sessions); sheet(SHEETS.backups,HEADERS.backups); sheet(SHEETS.notifications,HEADERS.notifications);
  seedSettings(); seedSystem(); seedDefaultPromotions(); seedSecurity(); migrateLegacy();
}
function seedSettings(){
  const s=sheet(SHEETS.settings,HEADERS.settings), values=s.getDataRange().getValues(), keys=new Set(values.slice(1).map(r=>String(r[0])));
  Object.keys(DEFAULT_SETTINGS).forEach(k=>{if(!keys.has(k))s.appendRow([k,DEFAULT_SETTINGS[k],'']);});
}

function seedSystem(){
  const s=sheet(SHEETS.system,HEADERS.system),values=s.getDataRange().getValues(),map={};
  values.slice(1).forEach(r=>map[String(r[0])]=r[1]);
  if(!map.databaseVersion)s.appendRow(['databaseVersion','2.1.0','ฐานถาวรสำหรับ DMO Toolbox Ultimate']);
  else setSystemValue('databaseVersion','2.1.0','V19 Mobile, PWA & Performance');
  if(!map.appFamily)s.appendRow(['appFamily','DMO Toolbox Ultimate','ชื่อชุดระบบ']);
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
function seedSecurity(){
  const u=sheet(SHEETS.users,HEADERS.users);
  if(u.getLastRow()===1){const now=new Date();u.appendRow(['181','Owner',sha256('6395'),'OWNER','ACTIVE',now,now,'']);}
  setSystemValue('securityVersion','1.0','V17 Security');
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
function login(b){
  const u=sheet(SHEETS.users,HEADERS.users),v=u.getDataRange().getValues(),h=v[0].map(String),id=String(b.adminId||'').trim(),hash=sha256(b.password||'');
  for(let i=1;i<v.length;i++)if(String(v[i][h.indexOf('userId')])===id&&String(v[i][h.indexOf('status')])==='ACTIVE'){
    if(String(v[i][h.indexOf('passwordHash')])!==hash){securityLog('LOGIN_FAILED',id,'รหัสผ่านไม่ถูกต้อง');throw Error('ไอดีหรือรหัสผ่านไม่ถูกต้อง');}
    const token=Utilities.getUuid()+Utilities.getUuid(),days=Math.max(1,Math.min(30,Number(settingValue('sessionDays',7))||7)),now=new Date(),expires=new Date(now.getTime()+days*86400000),role=String(v[i][h.indexOf('role')]||'VIEWER');
    sheet(SHEETS.sessions,HEADERS.sessions).appendRow([token,id,role,now,expires,now,'ACTIVE']);u.getRange(i+1,h.indexOf('lastLoginAt')+1).setValue(now);cleanupSessions();securityLog('LOGIN_SUCCESS',id,role);
    return output({ok:true,token,user:{userId:id,displayName:String(v[i][h.indexOf('displayName')]||id),role},expiresAt:expires});
  }securityLog('LOGIN_FAILED',id,'ไม่พบบัญชี');throw Error('ไอดีหรือรหัสผ่านไม่ถูกต้อง');
}
function logout(token){const s=sheet(SHEETS.sessions,HEADERS.sessions),v=s.getDataRange().getValues(),h=v[0].map(String);for(let i=1;i<v.length;i++)if(String(v[i][0])===String(token)){s.getRange(i+1,h.indexOf('status')+1).setValue('LOGGED_OUT');break;}return output({ok:true});}
function securityLog(action,userId,details){sheet(SHEETS.logs,HEADERS.logs).appendRow([new Date(),action,'SECURITY',userId||'','',details||'']);}
function listUsers(){return rows(SHEETS.users).map(x=>({userId:x.userId,displayName:x.displayName,role:x.role,status:x.status,createdAt:x.createdAt,updatedAt:x.updatedAt,lastLoginAt:x.lastLoginAt}));}
function saveSecurityUser(b,actor){return withLock(()=>{requireRole(b.token,['OWNER']);const p=b.user||{},id=String(p.userId||'').trim();if(!id)throw Error('กรุณากรอก User ID');const role=['OWNER','ADMIN','STAFF','VIEWER'].includes(p.role)?p.role:'VIEWER',s=sheet(SHEETS.users,HEADERS.users),v=s.getDataRange().getValues(),h=v[0].map(String),now=new Date();let row=-1;for(let i=1;i<v.length;i++)if(String(v[i][0])===id){row=i+1;break;}if(row<0){if(!p.password)throw Error('ผู้ใช้ใหม่ต้องกำหนดรหัสผ่าน');s.appendRow([id,p.displayName||id,sha256(p.password),role,p.status||'ACTIVE',now,now,'']);}else{const set=(k,val)=>{const c=h.indexOf(k);if(c>=0)s.getRange(row,c+1).setValue(val);};set('displayName',p.displayName||id);set('role',role);set('status',p.status||'ACTIVE');set('updatedAt',now);if(p.password)set('passwordHash',sha256(p.password));}securityLog('USER_SAVE',actor.userId,id+' '+role);return output({ok:true});});}
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
  return vals.slice(headerRow+1).map(r=>{const o={};h.forEach((k,i)=>{if(k)o[k]=r[i];});return o;}).filter(o=>o.id||o.name||o.key||o.orderId);
}
function rows(name){
  const key=Object.keys(SHEETS).find(k=>SHEETS[k]===name);
  return readSheetFlexible(sheet(name,HEADERS[key]||[]));
}
function readAll(admin){
  const seals=rows(SHEETS.seals).map(normalizeSeal),gameItems=rows(SHEETS.items).map(normalizeItem),services=rows(SHEETS.services).map(normalizeService);
  const settings={}; rows(SHEETS.settings).forEach(x=>settings[x.key]=smart(x.value));
  const promotions=rows(SHEETS.promotions).map(normalizePromotion).filter(p=>p.status==='ACTIVE');
  const data={seals,gameItems,services,settings,promotions};
  if(admin){data.orders=rows(SHEETS.orders).slice().reverse().slice(0,500);data.logs=rows(SHEETS.logs).slice().reverse().slice(0,300);data.stockLogs=rows(SHEETS.stockLogs).slice().reverse().slice(0,500);data.customers=rows(SHEETS.customers).slice().reverse().slice(0,1500);data.customerInteractions=rows(SHEETS.customerInteractions).slice().reverse().slice(0,3000);data.promotions=rows(SHEETS.promotions).map(normalizePromotion);data.trash=rows(SHEETS.trash).slice().reverse().slice(0,1000);data.databaseVersion=getSystemValue('databaseVersion')||'1.6.0';}
  return data;
}
function normalizeSeal(x){return{...x,kind:'SEAL',price:number(x.price),packSize:number(x.packSize)||1,stock:x.stock===''?'':number(x.stock),reservedStock:number(x.reservedStock),lowStockAlert:number(x.lowStockAlert),costPrice:x.costPrice===''?'':number(x.costPrice),sortOrder:number(x.sortOrder),aliases:splitAliases(x.aliases)};}
function normalizeItem(x){return{...x,kind:'ITEM',price:number(x.price),stock:x.stock===''?'':number(x.stock),reservedStock:number(x.reservedStock),lowStockAlert:number(x.lowStockAlert),costPrice:x.costPrice===''?'':number(x.costPrice),sortOrder:number(x.sortOrder),aliases:splitAliases(x.aliases)};}
function normalizeService(x){return{...x,kind:'SERVICE',price:number(x.price),stock:x.stock===''?'':number(x.stock),sortOrder:number(x.sortOrder),aliases:splitAliases(x.aliases)};}
function normalizePromotion(x){return{...x,value:number(x.value),minSpend:number(x.minSpend),buyQty:number(x.buyQty),freeQty:number(x.freeQty),priority:number(x.priority),stackable:String(x.stackable||'TRUE')};}
function getSystemValue(key){const all=rows(SHEETS.system);const hit=all.find(x=>String(x.key)===String(key));return hit&&hit.value;}
function splitAliases(v){return String(v||'').split('|').map(x=>x.trim()).filter(Boolean);}
function smart(v){if(v==='TRUE')return true;if(v==='FALSE')return false;if(v!==''&&isFinite(Number(v)))return Number(v);return v;}
function makeId(kind){return kind+'-'+Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyyMMddHHmmss')+'-'+Math.floor(Math.random()*9000+1000);}
function withLock(fn){const lock=LockService.getScriptLock();lock.waitLock(15000);try{return fn();}finally{lock.releaseLock();}}
function catalogInfo(kind){
  if(kind==='SEAL')return{name:SHEETS.seals,headers:HEADERS.seals};
  if(kind==='SERVICE')return{name:SHEETS.services,headers:HEADERS.services};
  return{name:SHEETS.items,headers:HEADERS.items};
}
function upsert(record){return withLock(()=>{
  if(!record||!record.name)throw Error('กรุณากรอกชื่อสินค้า');
  const info=catalogInfo(record.kind),s=sheet(info.name,info.headers),headers=info.headers;
  record.id=record.id||makeId(record.kind||'ITEM'); record.updatedAt=new Date();
  if(record.kind==='SEAL'&&!['AT','HT','CT','HP','DS','DE','EV','BL'].includes(String(record.category||'').toUpperCase()))throw Error('กรุณาเลือกสายซีล');
  const values=s.getDataRange().getValues(),idIndex=headers.indexOf('id');let rowIndex=-1;
  for(let i=1;i<values.length;i++){if(String(values[i][idIndex])===String(record.id)){rowIndex=i+1;break;}}
  const row=headers.map(k=>k==='aliases'&&Array.isArray(record.aliases)?record.aliases.join('|'):(record[k]??''));
  if(rowIndex<0)s.appendRow(row);else s.getRange(rowIndex,1,1,headers.length).setValues([row]);
  sortCatalog(s,headers,record.kind);
  log('UPSERT',record.kind,record.id,record.name,JSON.stringify({price:record.price,stock:record.stock,status:record.status}));
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
function writeStockLog(kind,product,before,delta,after,reserved,action,reason){
  sheet(SHEETS.stockLogs,HEADERS.stockLogs).appendRow([new Date(),kind,product.id,product.name,before,delta,after,reserved,availableQty(after,reserved),action,reason||'',ADMIN_ID]);
}
function adjustStock(b){return withLock(()=>{
  if(!['SEAL','ITEM'].includes(String(b.kind)))throw Error('ปรับสต๊อกได้เฉพาะซีลและไอเทม');
  const found=findCatalogRecord(b.kind,b.id),h=found.headers,d=found.data;
  const before=d.stock===''?0:number(d.stock),delta=number(b.delta),after=Math.max(0,before+delta),reserved=number(d.reservedStock),status=stockStatus(after,reserved,d.status);
  found.s.getRange(found.row,h.indexOf('stock')+1).setValue(after);
  found.s.getRange(found.row,h.indexOf('status')+1).setValue(status);
  found.s.getRange(found.row,h.indexOf('updatedAt')+1).setValue(new Date());
  writeStockLog(b.kind,d,before,after-before,after,reserved,delta>=0?'ADD':'REMOVE',b.reason||'');
  log('STOCK_ADJUST',b.kind,d.id,d.name,JSON.stringify({before,delta:after-before,after,reserved,reason:b.reason||''}));
  return output({ok:true,stock:after,status});
});}
function setStock(b){return withLock(()=>{
  if(!['SEAL','ITEM'].includes(String(b.kind)))throw Error('กำหนดสต๊อกได้เฉพาะซีลและไอเทม');
  const found=findCatalogRecord(b.kind,b.id),h=found.headers,d=found.data;
  const before=d.stock===''?'':number(d.stock),stock=b.stock===''?'':Math.max(0,number(b.stock)),reserved=Math.max(0,number(b.reservedStock)),low=Math.max(0,number(b.lowStockAlert)),status=stockStatus(stock,reserved,d.status);
  [['stock',stock],['reservedStock',reserved],['lowStockAlert',low],['status',status],['updatedAt',new Date()]].forEach(([key,value])=>found.s.getRange(found.row,h.indexOf(key)+1).setValue(value));
  const delta=stock===''?0:number(stock)-number(before);
  writeStockLog(b.kind,d,before===''?0:before,delta,stock===''?0:stock,reserved,'SET',b.reason||'');
  log('STOCK_SET',b.kind,d.id,d.name,JSON.stringify({before,stock,reserved,lowStockAlert:low,reason:b.reason||''}));
  return output({ok:true,stock,reservedStock:reserved,lowStockAlert:low,status});
});}

function softDelete(kind,id){return withLock(()=>{
  const found=findCatalogRecord(kind,id),d=found.data;
  sheet(SHEETS.trash,HEADERS.trash).appendRow([new Date(),kind,id,d.name||'',JSON.stringify(d),ADMIN_ID]);
  found.s.deleteRow(found.row);
  log('TRASH',kind,id,d.name||'','ย้ายเข้าถังขยะ');
  return output({ok:true});
});}
function restoreTrash(trashId){return withLock(()=>{
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
function permanentDelete(trashId){return withLock(()=>{
  const s=sheet(SHEETS.trash,HEADERS.trash),values=s.getDataRange().getValues(),h=values[0].map(String),idc=h.indexOf('id');
  for(let i=1;i<values.length;i++)if(String(values[i][idc])===String(trashId)){const name=values[i][h.indexOf('name')],kind=values[i][h.indexOf('kind')];s.deleteRow(i+1);log('DELETE_FOREVER',kind,trashId,name||'','ลบถาวร');return output({ok:true});}
  throw Error('ไม่พบรายการในถังขยะ');
});}
function bulkUpdate(records,changes){return withLock(()=>{
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
function saveSettings(settingsObj){return withLock(()=>{
  const s=sheet(SHEETS.settings,HEADERS.settings);
  Object.keys(settingsObj||{}).forEach(k=>{const values=s.getDataRange().getValues();let row=-1;for(let i=1;i<values.length;i++)if(String(values[i][0])===k){row=i+1;break;}if(row<0)s.appendRow([k,settingsObj[k],'']);else s.getRange(row,2).setValue(settingsObj[k]);});
  log('SETTINGS','SYSTEM','','','');return output({ok:true});
});}
function createOrder(b){return withLock(()=>{
  const settings={};rows(SHEETS.settings).forEach(x=>settings[x.key]=smart(x.value));if(settings.allowOrderSave===false)return output({ok:true,orderId:''});
  const s=sheet(SHEETS.orders,HEADERS.orders),now=new Date(),id='DMO-'+Utilities.formatDate(now,Session.getScriptTimeZone(),'yyyyMMdd-HHmmss'),total=number(b.total),promo=Math.floor(total/(number(settings.promoThreshold)||100));
  s.appendRow([id,now,b.customer&&b.customer.tamer||'',b.customer&&b.customer.server||'',b.customer&&b.customer.contact||'',JSON.stringify(b.items||[]),total,promo,'NEW','',now]);
  upsertCustomerFromOrder(b.customer||{},total,now);
  log('ORDER','ORDER',id,b.customer&&b.customer.tamer||'',JSON.stringify({total,promo}));return output({ok:true,orderId:id});
});}
function updateOrder(b){return withLock(()=>{
  const s=sheet(SHEETS.orders,HEADERS.orders),values=s.getDataRange().getValues(),h=values[0].map(String),idc=h.indexOf('orderId');
  for(let i=1;i<values.length;i++){if(String(values[i][idc])===String(b.orderId)){if(b.status!==undefined)s.getRange(i+1,h.indexOf('status')+1).setValue(b.status);if(b.adminNote!==undefined)s.getRange(i+1,h.indexOf('adminNote')+1).setValue(b.adminNote);s.getRange(i+1,h.indexOf('updatedAt')+1).setValue(new Date());log('ORDER_STATUS','ORDER',b.orderId,'',b.status||'');return output({ok:true});}}
  throw Error('ไม่พบออเดอร์');
});}

function customerKey(customer){
  const contact=String(customer.contact||'').trim().toLowerCase();
  if(contact)return 'CONTACT-'+Utilities.base64EncodeWebSafe(contact).slice(0,36);
  const raw=[customer.tamer||'',customer.server||''].join('|').trim().toLowerCase();
  return 'TAMER-'+Utilities.base64EncodeWebSafe(raw).slice(0,36);
}
function vipLevel(total){total=number(total);if(total>=50000)return'VIP';if(total>=20000)return'PLATINUM';if(total>=10000)return'GOLD';if(total>=5000)return'SILVER';return'NORMAL';}
function upsertCustomerFromOrder(customer,total,now){
  const s=sheet(SHEETS.customers,HEADERS.customers),vals=s.getDataRange().getValues(),h=vals[0].map(String),id=customerKey(customer);let row=-1;
  for(let i=1;i<vals.length;i++)if(String(vals[i][0])===id){row=i+1;break;}
  if(row<0){s.appendRow([id,now,now,customer.tamer||'',customer.server||'',customer.contact||'',1,number(total),vipLevel(total),'ACTIVE','',now]);return;}
  const current=Object.fromEntries(h.map((k,j)=>[k,vals[row-1][j]])),nextCount=number(current.orderCount)+1,nextSpent=number(current.totalSpent)+number(total);
  const updates={updatedAt:now,tamer:customer.tamer||current.tamer,server:customer.server||current.server,contact:customer.contact||current.contact,orderCount:nextCount,totalSpent:nextSpent,lastOrderAt:now};
  if(!current.vipLevel||current.vipLevel==='NORMAL'||current.vipLevel==='SILVER'||current.vipLevel==='GOLD'||current.vipLevel==='PLATINUM')updates.vipLevel=vipLevel(nextSpent);
  Object.keys(updates).forEach(k=>s.getRange(row,h.indexOf(k)+1).setValue(updates[k]));
}
function updateCustomer(b){return withLock(()=>{
  const s=sheet(SHEETS.customers,HEADERS.customers),vals=s.getDataRange().getValues(),h=vals[0].map(String),idc=h.indexOf('customerId');
  for(let i=1;i<vals.length;i++)if(String(vals[i][idc])===String(b.customerId)){
    const allowed=['tamer','server','contact','vipLevel','status','note','tags','preferredContact','followUpAt'];
    allowed.forEach(k=>{if(b[k]!==undefined&&h.indexOf(k)>=0)s.getRange(i+1,h.indexOf(k)+1).setValue(b[k]);});
    if(h.indexOf('updatedAt')>=0)s.getRange(i+1,h.indexOf('updatedAt')+1).setValue(new Date());
    log('CUSTOMER_UPDATE','CUSTOMER',b.customerId,b.tamer||vals[i][h.indexOf('tamer')],JSON.stringify({vipLevel:b.vipLevel,status:b.status,tags:b.tags}));return output({ok:true});
  }
  throw Error('ไม่พบลูกค้า');
});}
function addCustomerInteraction(b){return withLock(()=>{
  if(!b.customerId)throw Error('ไม่พบรหัสลูกค้า');
  const id=makeId('INTERACTION'),now=new Date();
  sheet(SHEETS.customerInteractions,HEADERS.customerInteractions).appendRow([id,now,b.customerId,b.customerName||'',b.type||'NOTE',b.channel||'',b.note||'',b.nextFollowUpAt||'',ADMIN_ID]);
  const s=sheet(SHEETS.customers,HEADERS.customers),vals=s.getDataRange().getValues(),h=vals[0].map(String),idc=h.indexOf('customerId');
  for(let i=1;i<vals.length;i++)if(String(vals[i][idc])===String(b.customerId)){
    if(h.indexOf('lastContactAt')>=0)s.getRange(i+1,h.indexOf('lastContactAt')+1).setValue(now);
    if(b.nextFollowUpAt&&h.indexOf('followUpAt')>=0)s.getRange(i+1,h.indexOf('followUpAt')+1).setValue(b.nextFollowUpAt);
    if(h.indexOf('updatedAt')>=0)s.getRange(i+1,h.indexOf('updatedAt')+1).setValue(now);break;
  }
  log('CUSTOMER_INTERACTION','CUSTOMER',b.customerId,b.customerName||'',JSON.stringify({type:b.type,channel:b.channel,note:b.note}));
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
function backupTriggerActive(){return ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='scheduledBackup');}
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
    const srcSheet=source.getSheetByName(name);if(!srcSheet)return;const values=srcSheet.getDataRange().getValues();if(!values.length)return;
    let target=ss().getSheetByName(name);if(!target)target=ss().insertSheet(name);target.clearContents();target.getRange(1,1,values.length,values[0].length).setValues(values);
  });
  securityLog('BACKUP_RESTORE',actor.userId,rec.backupId);log('BACKUP_RESTORE','SYSTEM',rec.backupId,rec.fileName||'',actor.userId);return output({ok:true});
});}
function deleteBackupAction(b,actor){return withLock(()=>{requireRole(b.token,['OWNER']);const s=sheet(SHEETS.backups,HEADERS.backups),v=s.getDataRange().getValues();for(let i=1;i<v.length;i++)if(String(v[i][0])===String(b.backupId)){try{if(v[i][4])DriveApp.getFileById(String(v[i][4])).setTrashed(true);}catch(e){}s.deleteRow(i+1);securityLog('BACKUP_DELETE',actor.userId,b.backupId);return output({ok:true});}throw Error('ไม่พบ Backup');});}
function automationAlerts(){
  const products=[...rows(SHEETS.seals).map(normalizeSeal),...rows(SHEETS.items).map(normalizeItem)],orders=rows(SHEETS.orders),customers=rows(SHEETS.customers),now=Date.now();
  const low=products.filter(p=>{const a=availableQty(p.stock,p.reservedStock);return a!==''&&a>0&&number(p.lowStockAlert)>0&&a<=number(p.lowStockAlert);});
  const out=products.filter(p=>p.status==='OUT_OF_STOCK'||(availableQty(p.stock,p.reservedStock)!==''&&availableQty(p.stock,p.reservedStock)<=0));
  const fresh=orders.filter(o=>String(o.status)==='NEW');
  const follow=customers.filter(c=>c.followUpAt&&new Date(c.followUpAt).getTime()<=now&&String(c.status||'ACTIVE')==='ACTIVE');
  return{lowStock:low.slice(0,50),outOfStock:out.slice(0,50),newOrders:fresh.slice(-50).reverse(),followUps:follow.slice(0,50),counts:{lowStock:low.length,outOfStock:out.length,newOrders:fresh.length,followUps:follow.length}};
}
function getAutomationData(actor){return{backups:actor&&['OWNER','ADMIN'].includes(actor.role)?listBackups().slice(0,50):[],triggerActive:backupTriggerActive(),backupEnabled:settingValue('backupEnabled',true)!==false,backupHour:number(settingValue('backupHour',3)),retention:number(settingValue('backupRetention',14))||14,alerts:automationAlerts()};}

function number(v){return Number(String(v??'').replace(/,/g,''))||0;}
function log(action,kind,id,name,details){sheet(SHEETS.logs,HEADERS.logs).appendRow([new Date(),action,kind,id,name,details||'']);}
function onOpen(){SpreadsheetApp.getUi().createMenu('DMO Toolbox').addItem('ตรวจโครงสร้างฐานข้อมูล','menuInitialize').addToUi();}
function menuInitialize(){ensureDatabase();SpreadsheetApp.getUi().alert('ฐานข้อมูล DMO Toolbox Ultimate V19 พร้อมใช้งาน');}
function output(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
