const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(require('path').join(__dirname,'..','GoogleAppsScript.gs'),'utf8');
const context={Utilities:{newBlob(value){return{getBytes(){return Array.from(Buffer.from(String(value),'utf8')).map(byte=>byte>127?byte-256:byte);}}}}};
vm.createContext(context);
vm.runInContext(source+'\nthis.__passwordHashV2=passwordHashV2;',context);

function legacy(password,salt){
  let value=Buffer.from(String(salt)+'\0'+String(password||''),'utf8');
  const key=Buffer.from(String(password||''),'utf8');
  for(let i=0;i<6000;i++)value=crypto.createHmac('sha256',key).update(value).digest();
  return value.toString('hex');
}

for(const sample of [
  {password:'correct horse battery staple',salt:'0123456789abcdef'},
  {password:'รหัสผ่านทดสอบ-1234',salt:'เกลือทดสอบ'},
  {password:'',salt:'empty-password'}
]){
  const expected=legacy(sample.password,sample.salt);
  const started=Date.now(),actual=context.__passwordHashV2(sample.password,sample.salt),elapsed=Date.now()-started;
  assert.strictEqual(actual,expected,'hash compatibility failed');
  console.log(`PASS password hash compatibility (${elapsed} ms)`);
}
