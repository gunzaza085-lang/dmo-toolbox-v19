'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
let passed=0;
function check(condition,message){if(!condition)throw Error(message);passed+=1;console.log(`PASS ${message}`);}

const index=read('index.html');
const app=read('app.js');
const config=read('config.js');
const manifest=JSON.parse(read('manifest.webmanifest'));
const worker=read('facebook-worker/worker.js');
const sw=read('sw.js');

check(manifest.start_url==='./','manifest start URL is project-path relative');
check(!/(?:src|href)=["']\//i.test(index),'HTML assets do not escape the /shop-dmo/ project path');
check(app.includes("serviceWorker.register('./sw.js')"),'service worker registration is project-path relative');
check(!/['"]\/(?:index\.html|app\.(?:js|css)|config\.js|manifest\.webmanifest|icon-)/.test(sw),'service worker shell assets stay inside the project path');
check(config.includes('script.google.com/macros/s/')&&!/gunzaza085-lang|dmo-toolbox-v19/.test(config),'Apps Script endpoint is independent of the GitHub owner and repository');
check(worker.includes("DEFAULT_ALLOWED_ORIGINS = ['https://gunzaza085-lang.github.io', 'https://shop-dmo.github.io']"),'worker keeps an exact old/new origin compatibility window');
check(app.includes("['appOrigin',location.origin]")&&worker.includes('ALLOWED_ORIGINS.has(appOrigin)'),'Pair Bridge validates and returns to the requesting exact origin');
check(worker.includes("Access-Control-Allow-Private-Network")&&worker.includes("Access-Control-Allow-Origin"),'local Worker keeps explicit CORS and Private Network Access support');

console.log(`TOTAL ${passed}/${passed} PASS`);
