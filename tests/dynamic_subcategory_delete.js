'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'GoogleAppsScript.gs'),'utf8');
const context={
  console,Date,Map,Set,JSON,Math,String,Number,Object,Error,isFinite,
  Utilities:{getUuid:()=> 'test-uuid',formatDate:()=> '20260910-120000'},
  Session:{getScriptTimeZone:()=> 'Asia/Bangkok'},
};
vm.createContext(context);
new vm.Script(`${source}\n;globalThis.__subcategoryApi={deleteProductSubcategory,saveSettings,productSubcategoryUsage};`).runInContext(context);
const api=context.__subcategoryApi;

const initialCategories=[
  {id:'CAT-SEAL-USED',kind:'SEAL',value:'USED',label:'ซีลใช้งาน',sortOrder:10,enabled:true},
  {id:'CAT-SEAL-UNUSED',kind:'SEAL',value:'UNUSED',label:'ซีลไม่ใช้งาน',sortOrder:20,enabled:true},
  {id:'CAT-ITEM-USED',kind:'ITEM',value:'ITEM_USED',label:'ไอเทมใช้งาน',sortOrder:10,enabled:true},
  {id:'CAT-SERVICE-USED',kind:'SERVICE',value:'SERVICE_USED',label:'บริการใช้งาน',sortOrder:10,enabled:true},
];
const catalog={
  Seals:[
    {id:'S-HIDDEN',section:'USED',status:'HIDDEN'},
    {id:'S-INACTIVE',section:'USED',status:'INACTIVE'},
    {id:'',section:'USED',status:'ACTIVE'},
  ],
  Items:[{id:'I-HIDDEN',itemCategory:'ITEM_USED',status:'HIDDEN'}],
  Services:[{id:'V-INACTIVE',serviceCategory:'SERVICE_USED',status:'INACTIVE'}],
};

function settingsSheet(categories=initialCategories){
  const values=[['key','value','description'],['productSubcategoriesJson',JSON.stringify(categories),''],['unrelatedSetting','KEEP','']];
  return{
    values,
    getDataRange(){return{getValues:()=>values.map(row=>row.slice())};},
    getRange(row,column){return{setValue(value){values[row-1][column-1]=value;return this;},setNumberFormat(){return this;}};},
    appendRow(row){values.push(row.slice());},
    getLastRow(){return values.length;},
    deleteRow(row){values.splice(row-1,1);},
  };
}
function installStubs(sheetObject){
  const events=[];
  let locks=0;
  context.existingRows=name=>(catalog[name]||[]).map(row=>({...row}));
  context.sheet=()=>sheetObject;
  context.withLock=fn=>{locks++;return fn();};
  context.invalidatePublicCache=()=>events.push('PUBLIC_CACHE');
  context.invalidateAdminDashboardCaches=()=>events.push('ADMIN_CACHE');
  context.log=(...args)=>events.push(['LOG',...args]);
  context.output=value=>value;
  return{events,get locks(){return locks;}};
}
function storedCategories(sheetObject){return JSON.parse(sheetObject.values[1][1]);}

assert(source.includes("'deleteProductSubcategory'")&&source.includes("case'deleteProductSubcategory': return deleteProductSubcategory(body,actor.userId)"),'delete action is not routed through the authenticated admin dispatcher');

{
  const sheetObject=settingsSheet(),run=installStubs(sheetObject),result=api.deleteProductSubcategory({kind:'SEAL',value:'UNUSED',categoryId:'CAT-SEAL-UNUSED'},'OWNER-1');
  assert.strictEqual(run.locks,1,'delete must use exactly one server lock');
  assert.strictEqual(result.ok,true);
  assert.strictEqual(result.usageCount,0);
  assert(!storedCategories(sheetObject).some(row=>row.id==='CAT-SEAL-UNUSED'),'unused category was not removed');
  assert(storedCategories(sheetObject).some(row=>row.id==='CAT-SEAL-USED'),'delete changed an unrelated category');
  assert.strictEqual(sheetObject.values[2][1],'KEEP','delete changed an unrelated Setting');
  assert(run.events.includes('PUBLIC_CACHE')&&run.events.includes('ADMIN_CACHE'),'delete did not invalidate caches');
  assert(run.events.some(event=>Array.isArray(event)&&event[1]==='SUBCATEGORY_DELETE'),'delete was not audited');
}

{
  const onlyUnused=[{id:'CAT-LAST',kind:'SEAL',value:'LAST',label:'หมวดสุดท้าย',sortOrder:10,enabled:true}],sheetObject=settingsSheet(onlyUnused);
  installStubs(sheetObject);api.deleteProductSubcategory({kind:'SEAL',value:'LAST',categoryId:'CAT-LAST'},'OWNER-1');
  assert.deepStrictEqual(storedCategories(sheetObject),[],'deleting the final unused category did not persist an explicit empty list');
}

for(const [kind,value,count] of [['SEAL','USED',2],['ITEM','ITEM_USED',1],['SERVICE','SERVICE_USED',1]]){
  const sheetObject=settingsSheet();installStubs(sheetObject);const before=sheetObject.values[1][1];
  assert.throws(()=>api.deleteProductSubcategory({kind,value},'OWNER-1'),error=>error.message.includes(`${count} รายการ`),`${kind} must block with its exact usage count`);
  assert.strictEqual(sheetObject.values[1][1],before,`${kind} block changed Settings`);
}

{
  const sheetObject=settingsSheet();installStubs(sheetObject);const before=sheetObject.values[1][1];
  assert.throws(()=>api.deleteProductSubcategory({kind:'FUTURE_KIND',value:'ANY'},'OWNER-1'),/ไม่รองรับการลบหมวดย่อย/,'unknown kinds must fail closed');
  assert.strictEqual(sheetObject.values[1][1],before,'unknown-kind rejection changed Settings');
}

{
  const sheetObject=settingsSheet();installStubs(sheetObject);const before=sheetObject.values[1][1];
  assert.throws(()=>api.deleteProductSubcategory({kind:'SEAL',value:'UNUSED',categoryId:'STALE-ID'},'OWNER-1'),/ข้อมูลหมวดย่อยเปลี่ยนไป/,'stale identity must be rejected');
  assert.strictEqual(sheetObject.values[1][1],before,'stale identity rejection changed Settings');
}

{
  const sheetObject=settingsSheet();installStubs(sheetObject);const before=sheetObject.values[1][1],next=initialCategories.filter(row=>row.id!=='CAT-SEAL-USED');
  assert.throws(()=>api.saveSettings({productSubcategoriesJson:JSON.stringify(next)},'OWNER-1'),error=>error.message.includes('2 รายการ'),'saveSettings bypass must block removal of a referenced category');
  assert.strictEqual(sheetObject.values[1][1],before,'saveSettings guard wrote before validation');
}

console.log('PASS dynamic subcategory server delete: exact all-status usage counts, fail-closed kinds, stale-write protection, cache/audit, and saveSettings defense');
