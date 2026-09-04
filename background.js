// src/model.js
const ND='Not disclosed';
const missing=v=>!String(v??'').trim()||/^not\s+disclosed?$/i.test(String(v).trim());
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
function validDate(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;}
function normalizeUrl(value){
  try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '';
    if(/(^|\.)linkedin\.com$/i.test(u.hostname)){const id=u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1]||u.searchParams.get('currentJobId');if(id&&/^\d+$/.test(id))return `https://www.linkedin.com/jobs/view/${id}/`;}
    u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^(?:trk|trackingId|refId|fbclid|gclid)$/i.test(key))u.searchParams.delete(key);
    return u.href;
  }catch{return '';}
}
function parseUrls(text){return [...new Set((String(text).match(/https?:\/\/[^\s<>"|\])]+/gi)??[]).map(v=>normalizeUrl(v.replace(/[.,;]+$/,''))).filter(Boolean))];}
function sourceName(value){try{const h=new URL(value).hostname.replace(/^www\./,'');for(const [domain,name]of [['linkedin.com','LinkedIn'],['dice.com','Dice'],['monster.com','Monster'],['ziprecruiter.com','ZipRecruiter']])if(h===domain||h.endsWith('.'+domain))return name;return h;}catch{return '';}}
function blankState(){return {schema:1,reports:{},runner:{status:'idle',queue:[],current:null,date:'',done:0,total:0,runId:''}};}
function reportFor(state,date){if(!validDate(date))throw new Error('Choose a valid report date.');return state.reports[date]??={title:'Daily leads report',rows:[],updatedAt:new Date().toISOString()};}
function newRow(url){return {id:crypto.randomUUID(),url,rate:ND,vendor:ND,employmentType:ND,status:'queued',message:'Waiting to read this job page.',checkedAt:'',sourceUrl:'',jobTitle:'',manual:{},evidence:{}};}
function applyResult(row,result){
  const next={...row,status:result.status,message:result.message,sourceUrl:result.sourceUrl||row.url,checkedAt:new Date().toISOString(),jobTitle:result.jobTitle||row.jobTitle,evidence:result.evidence||{}};
  for(const field of ['rate','vendor','employmentType'])if(!row.manual?.[field])next[field]=result[field]||ND;
  if(!['blocked','unavailable'].includes(next.status))next.status=['rate','vendor','employmentType'].every(f=>!missing(next[f]))?'complete':'partial';
  return next;
}
function csvCell(value){const str=String(value??'');return '"'+(/^[\s]*[=+@-]/.test(str)?"'"+str:str).replaceAll('"','""')+'"';}
function csvReport(rows){return '\uFEFF'+[['Lead URL','Rate','Vendor name','Job type'],...rows.map(r=>[r.url,r.rate||ND,r.vendor||ND,r.employmentType||ND])].map(row=>row.map(csvCell).join(',')).join('\r\n');}


// src/queue.js
const NON_LINKEDIN_MIN_OPEN_MS=20000;
const MODES={
 fast:{label:'Smart',concurrency:2,perHost:2,deadline:35000,interval:1500,partialWait:8000},
 balanced:{label:'Low CPU',concurrency:1,perHost:1,deadline:45000,interval:2000,partialWait:10000},
 thorough:{label:'Thorough',concurrency:2,perHost:1,deadline:90000,interval:2500,partialWait:18000}
};
const KEY='leadLedger',NO_WRITE=Symbol('no-write');
let writes=Promise.resolve(),pumping=false,timer;
const working=new Set();
const modeFor=q=>MODES[q.speed]??MODES.fast;
const score=r=>[r?.vendor,r?.rate,r?.employmentType].filter(v=>!missing(v)).length;

const OFFSCREEN_PATH='offscreen.html',WORKER_PATH='worker.html';
let creatingOffscreen,creatingWorkerWindow;
const linkedinJobId=url=>{try{const u=new URL(url);if(!/(^|\.)linkedin\.com$/i.test(u.hostname))return '';return u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1]||u.searchParams.get('currentJobId')||'';}catch{return '';}};
const linkedinGuestUrl=url=>{const id=linkedinJobId(url);return id?`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`:'';};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ensureOffscreen(){
 const url=chrome.runtime.getURL(OFFSCREEN_PATH);
 const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]});
 if(contexts.length)return;
 if(!creatingOffscreen){creatingOffscreen=chrome.offscreen.createDocument({url:OFFSCREEN_PATH,reasons:['DOM_PARSER'],justification:'Parse public job-detail HTML without opening visible browser tabs.'}).finally(()=>{creatingOffscreen=null;});}
 await creatingOffscreen;
}
async function parseHTML(html,url){
 await ensureOffscreen();
 const response=await chrome.runtime.sendMessage({target:'lead-ledger-offscreen',type:'parse-html',html,url});
 if(!response?.ok)throw new Error(response?.error||'The hidden job parser did not respond.');
 return response.data;
}
async function fetchLinkedInPublic(t){
 const guest=linkedinGuestUrl(t.url);if(!guest)throw new Error('LinkedIn job ID was not found.');
 let last='';
 for(let attempt=0;attempt<3;attempt++){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),9000);
  try{
   const response=await fetch(guest,{method:'GET',credentials:'omit',cache:'no-store',redirect:'follow',signal:controller.signal,headers:{accept:'text/html,application/xhtml+xml'}});
   if(response.status===404||response.status===410)return {status:'unavailable',vendor:'',rate:'',employmentType:'',jobTitle:'',sourceUrl:t.url,evidence:{},message:'LinkedIn says this public job detail is unavailable or expired. Open the lead to verify it.'};
   if(response.status===429||response.status>=500){last=`LinkedIn public reader returned HTTP ${response.status}.`;if(attempt<2){await wait(700*(attempt+1));continue;}}
   if(!response.ok)throw new Error(`LinkedIn public reader returned HTTP ${response.status}.`);
   const html=await response.text();
   if(!html||html.length<80)throw new Error('LinkedIn returned an empty public job page.');
   if(html.length>3000000)throw new Error('LinkedIn job page was too large to parse safely.');
   const result=await parseHTML(html,guest);
   result.sourceUrl=t.url;
   if(result.status==='blocked'||result.status==='loading')result.status='unavailable';
   const details=score(result);
   if(details){
    result.message=details===3?'LinkedIn read in Smart mode without opening a job tab.':'LinkedIn read in Smart mode without opening a job tab. '+(result.message||'Review any missing field.');
    return result;
   }
   return {...result,status:'unavailable',sourceUrl:t.url,message:'LinkedIn public details did not expose the job fields. Open this exact job normally, wait for its details, leave that tab open, then Retry this lead; the extension can read that existing tab without switching or closing it.'};
  }catch(error){last=error?.name==='AbortError'?'LinkedIn public reader timed out.':String(error?.message||error);if(attempt<2&&/HTTP 429|HTTP 5\d\d|timed out|network|fetch/i.test(last)){await wait(700*(attempt+1));continue;}}
  finally{clearTimeout(timeout);}
 }
 return {status:'unavailable',vendor:'',rate:'',employmentType:'',jobTitle:'',sourceUrl:t.url,evidence:{},message:`Smart LinkedIn reading could not finish. ${last} Open this exact job normally, wait for its details, leave that tab open, then Retry this lead.`};
}
const busy=s=>['running','paused'].includes(s.runner.status);
const hostOf=url=>{try{const host=new URL(url).hostname.replace(/^www\./,'');for(const board of ['linkedin.com','dice.com','monster.com','ziprecruiter.com'])if(host===board||host.endsWith('.'+board))return board;return host;}catch{return '';}};
const rowFor=(s,id)=>s.reports[s.runner.date]?.rows.find(r=>r.id===id);
function migrate(s){
 const q=s.runner;
 // Upgrade an existing single-reader queue without changing reports or IDs.
 if(!Array.isArray(q.active))q.active=q.current?[{...q.current,token:`legacy:${q.runId}:${q.current.id}:${q.current.startedAt}`,host:hostOf(rowFor(s,q.current.id)?.url)}]:[];
 delete q.current;q.speed=MODES[q.speed]?q.speed:'fast';q.blockedHosts??={};q.queue??=[];q.startedAt??=q.active[0]?.startedAt??Date.now();q.elapsedMs??=0;q.foreground=false;q.workerWindowId??=null;
 return s;
}
async function read(){const s=(await chrome.storage.local.get(KEY))[KEY];return migrate(s?.schema===1?s:blankState());}
function mutate(fn){const promise=writes.then(async()=>{const s=await read();const out=await fn(s);if(out!==NO_WRITE)await chrome.storage.local.set({[KEY]:s});return out;});writes=promise.catch(()=>{});return promise;}
const closeTab=async id=>{if(Number.isInteger(id))try{await chrome.tabs.remove(id);}catch{}};
const workerURL=()=>chrome.runtime.getURL(WORKER_PATH);
async function isWorkerWindow(id){
 if(!Number.isInteger(id))return false;
 try{const tabs=await chrome.tabs.query({windowId:id});return tabs.some(tab=>tab.url===workerURL());}catch{return false;}
}
async function closeWorkerWindow(id){
 if(!Number.isInteger(id)||!await isWorkerWindow(id))return;
 try{await chrome.windows.remove(id);}catch{}
}
async function ensureWorkerWindow(runId){
 const state=await read(),existing=state.runner.runId===runId?state.runner.workerWindowId:null;
 if(await isWorkerWindow(existing)){try{await chrome.windows.update(existing,{state:'minimized'});}catch{}return existing;}
 if(!creatingWorkerWindow){
  creatingWorkerWindow=(async()=>{
   const created=await chrome.windows.create({url:workerURL(),focused:false,state:'minimized',type:'normal'});
   if(!Number.isInteger(created?.id))throw new Error('Chrome could not create the silent background worker.');
   let accepted=false;
   await mutate(s=>{const q=s.runner;if(q.status!=='running'||q.runId!==runId)return NO_WRITE;q.workerWindowId=created.id;q.foreground=false;accepted=true;return {};});
   if(!accepted){await closeWorkerWindow(created.id);throw new Error('The batch changed before the silent worker was ready.');}
   try{await chrome.windows.update(created.id,{state:'minimized'});}catch{}
   return created.id;
  })().finally(()=>{creatingWorkerWindow=null;});
 }
 return creatingWorkerWindow;
}
async function releaseRunnerWorker(runId){
 let id;
 await mutate(s=>{const q=s.runner;if(q.runId!==runId||q.status==='running'||q.active?.length||!Number.isInteger(q.workerWindowId))return NO_WRITE;id=q.workerWindowId;q.workerWindowId=null;return {};});
 await closeWorkerWindow(id);
}
function schedule(ms=500){clearTimeout(timer);timer=setTimeout(()=>void pump(),ms);}
async function setup(){await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await chrome.alarms.create('lead-ledger-recovery',{periodInMinutes:.5});}
const currentTask=(s,t)=>s.runner.status==='running'&&s.runner.runId===t.runId?s.runner.active.find(a=>a.token===t.token):null;
function markReport(report){report.revision=(report.revision??0)+1;report.updatedAt=new Date().toISOString();}
function markFinished(q){if(!q.queue.length&&!q.active.length){q.status='done';q.elapsedMs=Date.now()-q.startedAt;q.finishedAt=Date.now();}}
async function cleanupFinishing(t){
 let tabId,workerWindowId;
 await mutate(s=>{const task=currentTask(s,t);if(!task||!task.finishing)return NO_WRITE;tabId=task.ownedTab===false?null:task.tabId;return {};});
 // Keep the slot occupied until Chrome confirms closing its background reader tab.
 await closeTab(tabId);
 await mutate(s=>{const task=currentTask(s,t);if(!task||!task.finishing)return NO_WRITE;const q=s.runner;q.active=q.active.filter(a=>a.token!==t.token);q.done++;markFinished(q);if(q.status==='done'&&Number.isInteger(q.workerWindowId)){workerWindowId=q.workerWindowId;q.workerWindowId=null;}return {};});
 await closeWorkerWindow(workerWindowId);
}
async function finish(t,result){
 let accepted=false;
 await mutate(s=>{const task=currentTask(s,t);if(!task||task.finishing)return NO_WRITE;
  const q=s.runner,report=s.reports[q.date],index=report.rows.findIndex(r=>r.id===t.id);
  if(index>=0)report.rows[index]=applyResult(report.rows[index],result);markReport(report);
  task.finishing=true;accepted=true;
  // Access checks are not a reason to keep sending new tabs to the same site.
  if(result?.status==='blocked')q.blockedHosts[t.host]=result.message;
  return {};
 });
 if(accepted)await cleanupFinishing(t);
}
async function reserve(){
 const out=await mutate(s=>{
  const q=s.runner;if(q.status!=='running')return NO_WRITE;
  const mode=modeFor(q),limit=mode.concurrency,hostLimit=mode.perHost;
  const tasks=[];let changed=false;
  for(let i=0;i<q.queue.length&&q.active.length<limit;){
   const id=q.queue[i],row=rowFor(s,id);if(!row){q.queue.splice(i,1);changed=true;continue;}
   const host=hostOf(row.url);
   // Keep company/job-board browsing strictly one-at-a-time. LinkedIn Smart reads do not open tabs.
   const anotherNonLinkedIn=q.active.some(a=>a.host!=='linkedin.com');
   if(q.blockedHosts[host]||q.active.filter(a=>a.host===host).length>=hostLimit||(host!=='linkedin.com'&&anotherNonLinkedIn)){i++;continue;}
   q.queue.splice(i,1);
   const task={id,url:row.url,token:crypto.randomUUID(),host,tabId:null,ownedTab:true,startedAt:Date.now(),attempts:0};q.active.push(task);
   row.status='reading';row.message=host==='linkedin.com'?'Reading LinkedIn in Smart mode without opening a job tab…':'Reading this job inside the minimized Silent Worker for at least 20 seconds…';
   tasks.push({...task,runId:q.runId,url:row.url,foreground:false,speed:q.speed});changed=true;
  }
  if(tasks.length)markReport(s.reports[q.date]);
  if(!q.active.length){
   if(q.queue.length){q.status='paused';q.error='A website requires sign-in or verification. Open a flagged lead, complete the check, then Resume. Other readable websites were processed.';changed=true;}
   else{markFinished(q);changed=true;}
  }
  return changed?tasks:NO_WRITE;
 });return out===NO_WRITE?[]:out;
}
function launch(t,fn){
 if(working.has(t.token))return;working.add(t.token);
 void fn(t).catch(async e=>{console.error('Lead queue',e);await mutate(s=>{if(s.runner.runId===t.runId){s.runner.status='paused';s.runner.error='Reading paused: '+e.message;}else return NO_WRITE;}).catch(()=>{});}).finally(()=>{working.delete(t.token);schedule(0);});
}
async function openTask(t){
 try{
  let tab,ownedTab=true;
  if(t.host==='linkedin.com'){
   // Best case: reuse the exact already-loaded job page. No focus, navigation or reload.
   try{const existing=await chrome.tabs.query({url:['https://*.linkedin.com/jobs/*','https://linkedin.com/jobs/*']});
    const s=await read(),inUse=new Set(s.runner.active.map(a=>a.tabId));
    tab=existing.find(x=>Number.isInteger(x.id)&&!inUse.has(x.id)&&!x.discarded&&!x.frozen&&/\/jobs\/view\/\d+/.test(x.url||'')&&normalizeUrl(x.url)===normalizeUrl(t.url));
    if(tab)ownedTab=false;
   }catch{/* Smart public reading remains available if tab lookup fails. */}
   if(!tab){
    let accepted=false;await mutate(s=>{const task=currentTask(s,t);if(!task)return NO_WRITE;task.readerKind='linkedin-public';task.lastAttempt=Date.now();accepted=true;});
    if(!accepted)return;
    const result=await fetchLinkedInPublic(t);await finish(t,result);return;
   }
  }
  if(!tab){
   const windowId=await ensureWorkerWindow(t.runId);
   tab=await chrome.tabs.create({windowId,url:t.url,active:false});
   try{await chrome.windows.update(windowId,{state:'minimized'});}catch{}
   ownedTab=true;
  }
  let accepted=false;
  await mutate(s=>{const task=currentTask(s,t);if(!task)return NO_WRITE;task.tabId=tab.id;task.ownedTab=ownedTab;task.openedAt=Date.now();task.readerKind=ownedTab?'silent-worker-tab':'borrowed-tab';accepted=true;});
  if(!accepted&&ownedTab)await closeTab(tab.id);
 }catch(e){await finish(t,{status:'unavailable',message:'Could not read this URL. '+e.message});}
}
async function boundedRead(tabId){let timeout;try{return await Promise.race([
 chrome.scripting.executeScript({target:{tabId},files:['capture.js'],injectImmediately:true}),
 new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('The page reader did not respond within 6 seconds.')),6000);})
 ]);}finally{clearTimeout(timeout);}}
async function scanTask(t){
 const q=(await read()).runner;if(q.status!=='running'||q.runId!==t.runId)return;
 const c=q.active.find(a=>a.token===t.token);if(!c)return;
 if(c.finishing){await cleanupFinishing(t);return;}
 const age=Date.now()-c.startedAt,mode=modeFor(q);
 if(!Number.isInteger(c.tabId)){
  if(c.readerKind==='linkedin-public'){try{const result=await fetchLinkedInPublic(t);await finish(t,result);}catch(e){await finish(t,{status:'unavailable',message:'Smart LinkedIn retry failed. '+e.message});}return;}
  if(age>12000)await finish(t,{status:'unavailable',message:'The browser interrupted opening this lead. Retry it.'});return;
 }
 let tab;try{tab=await chrome.tabs.get(c.tabId);}catch{await finish(t,{status:'unavailable',message:'The reading tab was closed. Retry this lead.'});return;}
 if(c.ownedTab===false&&normalizeUrl(tab.url)!==normalizeUrl(c.url)){await finish(t,{status:'unavailable',message:'The existing job tab navigated elsewhere. It was left untouched; open this job again and retry.'});return;}
 if(age>=mode.deadline){
  const seconds=mode.deadline/1000,diagnostics=`${c.attempts??0} attempts; Chrome tab: ${tab.status??'unknown'}.${c.lastError?' '+c.lastError:''}${c.diagnosticText?' '+c.diagnosticText:''}`;
  await finish(t,score(c.best)?{...c.best,message:c.best.message+` ${mode.label} time limit (${seconds}s) reached. Retry this lead in Thorough mode if needed.`}:{status:'unavailable',message:`No readable job content within the ${mode.label} limit (${seconds}s). ${diagnostics} ${t.host==='linkedin.com'?'Open this exact job normally, wait until its details appear, leave that tab open, and Retry this lead. It will be read without switching or closing your tab.':'Open the lead or retry it in Thorough mode.'}`});return;
 }
 let accepted=false;
 await mutate(s=>{const task=currentTask(s,t);if(!task)return NO_WRITE;task.lastAttempt=Date.now();task.attempts++;task.lastTabStatus=tab.status;accepted=true;});if(!accepted)return;
 try{
  const response=await boundedRead(c.tabId),result=response[0]?.result;
  if(!result||typeof result.status!=='string')throw new Error('No reading result returned.');
  if(c.ownedTab===false){const current=await chrome.tabs.get(c.tabId);if(normalizeUrl(current.url)!==normalizeUrl(c.url)||result.sourceUrl&&normalizeUrl(result.sourceUrl)!==normalizeUrl(c.url)){await finish(t,{status:'unavailable',message:'The existing job tab changed while reading. No different job was saved; open this job again and retry.'});return;}}
  const signature=JSON.stringify([result.vendor,result.rate,result.employmentType,result.status,result.contentLength??0]);
  const stable=c.signature===signature,unchangedSince=stable?(c.unchangedSince??Date.now()):Date.now();
  // For tabs opened by Report from Leads on non-LinkedIn sites, keep the page alive for at least 20 seconds
  // before accepting a settled result. This gives dynamic ATS/company pages time to render fully.
  const tabOpenAge=Date.now()-(c.openedAt??c.startedAt);
  const minimumOpenTimePassed=c.ownedTab===false||t.host==='linkedin.com'||tabOpenAge>=NON_LINKEDIN_MIN_OPEN_MS;
  const settledCore=result.status==='complete'?stable:result.status==='partial'?stable&&result.contentReady!==false&&Date.now()-unchangedSince>=mode.partialWait:result.status==='blocked'?stable:result.status==='unavailable'?stable&&age>=Math.min(12000,mode.deadline):false;
  const settled=minimumOpenTimePassed&&settledCore;
  if(settled){await finish(t,result);return;}
  await mutate(s=>{const task=currentTask(s,t);if(!task)return NO_WRITE;const d=result.diagnostics;Object.assign(task,{signature,unchangedSince,lastError:'',diagnosticText:d?`Job root: ${d.jobRoot?'yes':'no'}; heading: ${d.jobHeading?'yes':'no'}; company candidates: ${d.companyCandidates}; description chars: ${d.descriptionChars}.`:''});if(result.status!=='loading'&&score(result)>=score(task.best))task.best=result;});
 }catch(e){
  const message=String(e.message).slice(0,180);
  await mutate(s=>{const task=currentTask(s,t);if(!task)return NO_WRITE;task.lastError=message;});
  if(age>=4000&&/cannot access|missing host permission|permission denied/i.test(message))await finish(t,{status:'unavailable',message:'Chrome denied page access. Allow access in extension settings, then retry. '+message});
 }
}
async function pump(){
 if(pumping)return;pumping=true;
 try{
  let s=await read();if(s.runner.status!=='running')return;
  if(s.runner.queue.length&&s.runner.active.length<modeFor(s.runner).concurrency||!s.runner.active.length){
   for(const task of await reserve())launch(task,openTask);
  }
  s=await read();const q=s.runner;if(q.status!=='running')return;
  for(const task of q.active){
   if(working.has(task.token))continue;
   const age=Date.now()-task.startedAt;
   if(age>=modeFor(q).deadline||(!Number.isInteger(task.tabId)?age>12000:age>=1000&&Date.now()-(task.lastAttempt??0)>=modeFor(q).interval))launch({...task,runId:q.runId,speed:q.speed},scanTask);
  }
 }catch(e){console.error('Lead queue',e);await mutate(s=>{s.runner.status='paused';s.runner.error='Reading paused: '+e.message;}).catch(()=>{});}
 finally{pumping=false;const s=await read().catch(()=>null);if(s?.runner.status==='running')schedule();else if(s?.runner)await releaseRunnerWorker(s.runner.runId).catch(()=>{});}
}
async function start(msg){
 const urls=msg.urls?parseUrls(msg.urls):[];
 return mutate(s=>{
  if(busy(s))throw new Error('Finish the current batch before starting another.');
  const report=reportFor(s,msg.date),ids=[];
  if(msg.retry){for(const row of report.rows)if(msg.ids?.includes(row.id)||!msg.ids&&row.status!=='complete')ids.push(row.id);}
  else{
   if(!urls.length)throw new Error('Paste at least one complete job URL.');
   if(report.rows.length+urls.filter(url=>!report.rows.some(r=>r.url===url)).length>500)throw new Error('Use up to 500 leads in one daily report.');
   for(const url of urls){let row=report.rows.find(r=>r.url===url);if(!row){row=newRow(url);report.rows.push(row);}ids.push(row.id);}
  }
  if(!ids.length)throw new Error('No leads need reading.');
  for(const row of report.rows)if(ids.includes(row.id)){row.status='queued';row.message='Waiting to read this job page.';}
  markReport(report);s.runner={runId:crypto.randomUUID(),status:'running',date:msg.date,queue:ids,active:[],done:0,total:ids.length,error:'',foreground:false,workerWindowId:null,speed:MODES[msg.speed]?msg.speed:'fast',startedAt:Date.now(),elapsedMs:0,blockedHosts:{}};
  return {count:ids.length};
 });
}
async function pause(){let tabs=[],workerWindowId;await mutate(s=>{const q=s.runner;if(q.status!=='running')return NO_WRITE;q.status='paused';tabs=q.active.filter(t=>t.ownedTab!==false).map(t=>t.tabId);workerWindowId=q.workerWindowId;q.workerWindowId=null;q.queue=[...q.active.map(t=>t.id),...q.queue];for(const t of q.active){const row=rowFor(s,t.id);if(row){row.status='queued';row.message='Paused; waiting to resume.';}}q.active=[];markReport(s.reports[q.date]);});await closeWorkerWindow(workerWindowId);await Promise.all(tabs.map(closeTab));}
async function resume(){await mutate(s=>{if(s.runner.status!=='paused')return NO_WRITE;s.runner.status='running';s.runner.error='';s.runner.blockedHosts={};s.runner.foreground=false;s.runner.workerWindowId=null;});void setup();schedule(0);}
async function end(){let tabs=[],workerWindowId;await mutate(s=>{const q=s.runner;tabs=q.active.filter(t=>t.ownedTab!==false).map(t=>t.tabId);workerWindowId=q.workerWindowId;q.workerWindowId=null;const report=s.reports[q.date];for(const row of report?.rows??[])if(['queued','reading'].includes(row.status)){row.status='unavailable';row.message='Batch stopped before this lead was read.';}if(report)markReport(report);q.status='stopped';q.queue=[];q.active=[];q.foreground=false;q.runId=crypto.randomUUID();});await closeWorkerWindow(workerWindowId);await Promise.all(tabs.map(closeTab));}
async function browserStartup(){void setup();let workerWindowId;await mutate(s=>{const q=s.runner;workerWindowId=q.workerWindowId;q.workerWindowId=null;q.foreground=false;if(q.status!=='running')return {};q.queue=[...q.active.map(t=>t.id),...q.queue];q.active=[];q.runId=crypto.randomUUID();q.status='paused';q.error='Chrome restarted. Click Resume to continue your saved queue.';return {};});await closeWorkerWindow(workerWindowId);}


// src/background.js
async function command(m){
 if(!m||typeof m.type!=='string')throw new Error('Invalid action.');
 if(m.type==='get')return read();
 if(m.type==='start'){const out=await start(m);void setup();schedule(0);return out;}
 if(m.type==='pause'){await pause();return {};}
 if(m.type==='resume'){await resume();return {};}
 if(m.type==='end'){await end();return {};}
 if(m.type==='patch')return mutate(s=>{const report=reportFor(s,m.date);const row=report.rows.find(r=>r.id===m.id);if(!row)throw new Error('This lead no longer exists.');if(!['rate','vendor','employmentType','url'].includes(m.field))throw new Error('Invalid field.');const value=String(m.value??'').trim();if(value.length>(m.field==='url'?4000:250))throw new Error('This value is too long.');if(m.field==='url'){if(busy(s)&&s.runner.date===m.date)throw new Error('Finish the batch before changing a URL.');const url=normalizeUrl(value);if(!url)throw new Error('Use an http or https URL.');if(report.rows.some(r=>r.id!==row.id&&r.url===url))throw new Error('This URL is already in the report.');Object.assign(row,newRow(url),{id:row.id});row.status='unavailable';row.message='URL changed. Retry to read the new job.';}else{row[m.field]=value||'Not disclosed';row.manual??={};row.manual[m.field]=true;}report.updatedAt=new Date().toISOString();report.revision=(report.revision??0)+1;return {};});
 if(m.type==='title')return mutate(s=>{const report=reportFor(s,m.date);report.title=String(m.title||'Daily leads report').slice(0,160);report.revision=(report.revision??0)+1;return {};});
 if(m.type==='remove')return mutate(s=>{if(busy(s)&&s.runner.date===m.date)throw new Error('Finish the batch before removing a lead.');const r=reportFor(s,m.date);r.rows=r.rows.filter(v=>v.id!==m.id);r.revision=(r.revision??0)+1;return {};});
 if(m.type==='clear')return mutate(s=>{if(busy(s)&&s.runner.date===m.date)throw new Error('Finish the batch before clearing the report.');const r=reportFor(s,m.date),removed=r.rows.length;r.rows=[];markReport(r);return {removed};});
 if(m.type==='backup')return read();
 if(m.type==='restore')return mutate(s=>{if(busy(s))throw new Error('Finish the current batch before restoring a backup.');const value=m.data;if(value?.schema!==1||!value.reports||Object.keys(value.reports).length>1000)throw new Error('Invalid Report from Leads backup.');let added=0;for(const [date,r]of Object.entries(value.reports)){if(!validDate(date)||!Array.isArray(r.rows)||r.rows.length>500)throw new Error('Invalid report in backup.');const target=reportFor(s,date);const cleanRows=r.rows.map(row=>{const url=normalizeUrl(row.url);if(!url)throw new Error('Invalid URL in backup.');return {...newRow(url),status:'partial',message:'Restored from a backup. Review the fields.',rate:String(row.rate||'Not disclosed').slice(0,250),vendor:String(row.vendor||'Not disclosed').slice(0,250),employmentType:String(row.employmentType||'Not disclosed').slice(0,250),manual:Object.fromEntries(['rate','vendor','employmentType'].map(field=>[field,!missing(row[field])]))};});for(const row of cleanRows)if(!target.rows.some(v=>v.url===row.url)){if(target.rows.length>=500)throw new Error('Restored report would exceed 500 leads.');target.rows.push(row);target.revision=(target.revision??0)+1;added++;}if(target.title==='Daily leads report')target.title=String(r.title??target.title).slice(0,160);}return {added};});
 throw new Error('Unknown action.');
}
// Do not let a fast Resume/Start race the previous command's tab cleanup.
let controls=Promise.resolve();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{if(message?.target==='lead-ledger-offscreen')return false;if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL('')))return false;let operation;if(['start','pause','resume','end'].includes(message?.type)){operation=controls.then(()=>command(message));controls=operation.catch(()=>{});}else operation=command(message);operation.then(data=>respond({ok:true,data}),e=>respond({ok:false,error:e.message}));return true;});
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}));
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='lead-ledger-recovery')void pump();});
chrome.tabs.onUpdated.addListener((_id,change)=>{if(change.status==='complete')schedule(200);});
chrome.tabs.onRemoved.addListener(()=>schedule(100));
chrome.runtime.onInstalled.addListener(()=>void setup());
chrome.runtime.onStartup.addListener(()=>void browserStartup());

