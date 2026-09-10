'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'GoogleAppsScript.gs'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const context={
  console,Date,Map,Set,JSON,Math,String,Number,Object,Error,Array,isFinite,
  Utilities:{
    base64Decode:value=>Array.from(Buffer.from(String(value),'base64')),
    newBlob:(bytes,mimeType,fileName)=>({bytes,mimeType,fileName,setName(){return this;},getName(){return this.fileName;}}),
  },
};
vm.createContext(context);
new vm.Script(`${source}\n;globalThis.__imageApi={uploadImage};`).runInContext(context);
context.saveBlobToDrive=(blob,fileName)=>{context.__saved={blob,fileName};return'https://drive.google.com/thumbnail?id=test&sz=w1200';};
context.log=()=>{};
context.output=value=>value;

const api=context.__imageApi;
const encode=bytes=>Buffer.from(bytes).toString('base64');
const signatures={
  'image/png':[0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0,0,0,0],
  'image/jpeg':[0xFF,0xD8,0xFF,0xE0,0,0,0,0],
  'image/webp':[0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50],
  'image/gif':Array.from(Buffer.from('GIF89a00','ascii')),
};

for(const [mimeType,bytes] of Object.entries(signatures)){
  const result=api.uploadImage({data:encode(bytes),mimeType,fileName:'ภาพ ทดสอบ.bad'});
  assert.strictEqual(result.ok,true,`${mimeType} was rejected`);
  assert.strictEqual(result.mimeType,mimeType);
  assert(context.__saved.fileName.endsWith({
    'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif',
  }[mimeType]),`${mimeType} did not receive a safe extension`);
}

assert.throws(()=>api.uploadImage({data:encode(signatures['image/png']),mimeType:'image/jpeg',fileName:'fake.jpg'}),/ชนิดไฟล์รูปไม่ตรง/,'mismatched MIME/signature was accepted');
assert.throws(()=>api.uploadImage({data:encode(Array.from(Buffer.from('<svg></svg>'))),mimeType:'image/svg+xml',fileName:'unsafe.svg'}),/รองรับเฉพาะ/,'SVG was accepted');
assert.throws(()=>api.uploadImage({data:encode([1,2,3,4,5]),mimeType:'image/png',fileName:'broken.png'}),/ชนิดไฟล์รูปไม่ตรง/,'invalid image signature was accepted');
const oversized=Buffer.alloc(2*1024*1024+1);oversized.set(signatures['image/png']);
assert.throws(()=>api.uploadImage({data:oversized.toString('base64'),mimeType:'image/png',fileName:'large.png'}),/ใหญ่เกิน 2 MB/,'decoded byte limit was not enforced');

assert(source.includes('singleImageRequest?3200000:200000'),'single-image request body still uses the old ~145 KB gateway limit');
assert(app.includes('prepareAdminImage')&&app.includes('servicePosterFile')&&app.includes('recordImagePreviewWrap'),'client file validation/preview/poster flow is incomplete');
assert(app.includes("mime==='image/gif'")&&app.includes('ADMIN_IMAGE_MAX_UPLOAD_BYTES'),'client compression boundary is missing');

console.log('PASS image upload: PNG/JPEG/WEBP/GIF signatures, MIME match, exact byte cap, preview/compression and service poster flow');
