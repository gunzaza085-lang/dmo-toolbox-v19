'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const port=Number(process.env.DMO_SMOKE_PORT||4174);
const adminDelayMs=Math.max(0,Number(process.env.DMO_SMOKE_ADMIN_DELAY_MS||0));
const configuredBase=String(process.env.DMO_SMOKE_BASE||'').trim();
const basePath=configuredBase?`/${configuredBase.replace(/^\/+|\/+$/g,'')}`:'';
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json;charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const subcategories=[
  {id:'SEAL-NORMAL',kind:'SEAL',value:'NORMAL',label:'ปกติ',sortOrder:10,enabled:true},
  {id:'SEAL-BASE-HARD',kind:'SEAL',value:'BASE_HARD',label:'เบสยาก',sortOrder:20,enabled:true},
  {id:'ITEM-EQUIP',kind:'ITEM',value:'EQUIP',label:'อุปกรณ์',sortOrder:10,enabled:true},
  {id:'SERVICE-DUNGEON',kind:'SERVICE',value:'DUNGEON',label:'ดันเจียน',sortOrder:10,enabled:true},
];
const settings={shopName:'SHOP DMO — LOCAL SMOKE',ownerName:'',promoThreshold:100,promoReward:150,categoryDiscountSealPercent:5,categoryDiscountItemPercent:10,categoryDiscountServicePercent:0,productSubcategoriesJson:JSON.stringify(subcategories),orderCopyTemplate:'{title}\n{items}\n{pricing}\n{promotions}\n{customer}\n{notice}',orderCopyShowItems:'TRUE',orderCopyShowPricing:'TRUE',orderCopyShowCategoryDiscounts:'TRUE',orderCopyShowPromotions:'TRUE',orderCopyShowD2:'TRUE',orderCopyShowCustomer:'TRUE',orderCopyShowNotice:'TRUE',websiteIntroText:'หน้าทดสอบ Local เท่านั้น',websiteAnnouncement:'ประกาศทดสอบ',websitePromotionText:'โปรโมชั่นทดสอบ',websiteImportantNotice:'ห้ามส่งออเดอร์จริง',allowOrderSave:'FALSE',showStock:'TRUE',autoRefreshSeconds:60,orderSubmitCooldownSeconds:30,orderRateWindowSeconds:300,orderRateMax:3,sessionDays:7,autoLockMinutes:30};
const seals=Array.from({length:28},(_,index)=>({id:`S-${index+1}`,name:`ซีลทดสอบ ${index+1}`,category:['AT','HT','CT'][index%3],section:index%2?'NORMAL':'BASE_HARD',price:100+index,unit:'ชุด',packSize:1000,status:'ACTIVE',availableStock:50,sortOrder:index+1}));
const gameItems=[{id:'I-1',name:'ไอเทมทดสอบ',itemCategory:'EQUIP',price:200,unit:'ชิ้น',status:'ACTIVE',availableStock:20,sortOrder:1}];
const services=[{id:'V-1',name:'บริการทดสอบ',serviceCategory:'DUNGEON',description:'ใช้ตรวจหน้าจอเท่านั้น',price:300,unit:'ครั้ง',status:'ACTIVE',availableStock:999,sortOrder:1}];
const publicData={ok:true,seals,gameItems,services,moneyT:null,promotions:[],settings,stockUpdatedAt:new Date().toISOString()};
function sendJson(res,data){res.writeHead(200,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(data));}
function adminData(scope){const base={ok:true,settings,security:{actor:{userId:'LOCAL-SMOKE',displayName:'Local smoke test',role:'OWNER',status:'ACTIVE'},account:{userId:'LOCAL-SMOKE',displayName:'Local smoke test',role:'OWNER',status:'ACTIVE'},environment:'TEST',users:[],sessionDays:7,autoLockMinutes:30,apiKeyConfigured:false},databaseVersion:'3.2.0'};if(scope==='dashboard')base.dashboardSummary={newOrders:0,preparingOrders:0,readyOrders:0,completedOrders:0,salesTotal:0,lowStock:0,checkOrOut:0,customerCount:0,repeatCustomers:0,activePromos:0,categoryCounts:[['AT',10],['HT',9],['CT',9],['HP',0],['DS',0],['DE',0],['EV',0],['BL',0]]};if(['catalog','images','inventory','calculator','categories'].includes(scope))Object.assign(base,{seals,gameItems,services,moneyT:null});if(scope==='promotions')base.promotions=[];return base;}
http.createServer((req,res)=>{
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  const requestPath=basePath&&url.pathname.startsWith(`${basePath}/`)?url.pathname.slice(basePath.length):url.pathname;
  if(requestPath==='/api'){
    if(req.method==='GET')return sendJson(res,publicData);
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{let payload={};try{payload=JSON.parse(body||'{}');}catch(error){}if(payload.action==='login')return sendJson(res,{ok:true,token:'LOCAL-SMOKE-TOKEN',user:{userId:'LOCAL-SMOKE',displayName:'Local smoke test',role:'OWNER',status:'ACTIVE'}});if(payload.action==='getAdminData'){const reply=()=>sendJson(res,adminData(String(payload.scope||'dashboard')));return adminDelayMs?setTimeout(reply,adminDelayMs):reply();}if(payload.action==='logout'||payload.action==='saveSettings')return sendJson(res,{ok:true});sendJson(res,{ok:false,error:'LOCAL_SMOKE_READ_ONLY'});});return;
  }
  if(requestPath==='/config.js'){res.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8','Cache-Control':'no-store'});return res.end(`window.DMO_CONFIG=${JSON.stringify({sheetsUrl:`http://127.0.0.1:${port}${basePath}/api`,refreshMs:600000,appVersion:'LOCAL-SMOKE'})};`);}
  const file=path.resolve(root,requestPath==='/'?'index.html':requestPath.slice(1));if(!file.startsWith(root)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});
}).listen(port,'127.0.0.1',()=>console.log(`Local smoke server ready at http://127.0.0.1:${port}${basePath}/`));
