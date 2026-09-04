const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const text=el=>clean(el?.innerText||el?.textContent||'');
const first=(doc,selectors)=>{for(const selector of selectors){const el=doc.querySelector(selector);if(el&&text(el))return el;}return null;};
const unique=a=>[...new Set(a.map(clean).filter(Boolean))];
const pickTexts=(doc,selectors)=>unique(selectors.flatMap(s=>[...doc.querySelectorAll(s)].map(text)));
const score=r=>[r.vendor,r.rate,r.employmentType].filter(Boolean).length;

function textSalary(value,explicit=false){
 let source=String(value??'');
 const number='\\d[\\d,]*(?:\\.\\d{1,2})?\\s*[kK]?';
 const money='(?:US\\$|USD\\s*|CAD\\s*|AUD\\s*|GBP\\s*|EUR\\s*|[$£€])\\s*'+number;
 const payUnit='hour|hr|year|yr|annum|month|week|day';
 const repeatedUnits=new RegExp('('+money+')\\s*(?:/|per\\s+|an?\\s+)\\s*('+payUnit+')\\s*([-–—]|to)\\s*('+money+')\\s*(?:/|per\\s+|an?\\s+)\\s*('+payUnit+')','gi');
 const norm=unit=>/^(?:hour|hr)$/i.test(unit)?'hr':/^(?:year|yr|annum)$/i.test(unit)?'yr':unit.toLowerCase();
 source=source.replace(repeatedUnits,(full,a,u,sep,b,v)=>norm(u)===norm(v)?`${a} ${sep} ${b}/${norm(v)}`:full);
 const pattern=new RegExp('('+money+'(?:\\s*(?:-|–|—|to)\\s*(?:(?:US\\$|USD\\s*|CAD\\s*|AUD\\s*|GBP\\s*|EUR\\s*|[$£€])\\s*)?'+number+')?)(?:\\s*(?:/|per\\s+|an?\\s+)\\s*(hour|hr|year|yr|annum|month|week|day)|\\s*(hourly|annually|annual|yearly))?','gi');
 const found=[];let m;
 while((m=pattern.exec(source))){
  const before=source.slice(Math.max(0,m.index-100),m.index),after=source.slice(m.index+m[0].length,m.index+m[0].length+100);
  if(/(?:bonus|sign[- ]?on|referral|401\(?k|reimbursement|allowance|benefit|equity|stock)[^.!?\n]{0,50}$/i.test(before)&&!/(?:base\s+(?:pay|salary)|pay\s+(?:rate|range)|salary\s+range)[^.!?\n]{0,45}$/i.test(before))continue;
  const unit=m[2]||m[3];if(!explicit&&!unit&&!/(?:salary|compensation|pay\s+(?:rate|range)|hourly\s+rate|base\s+pay|rate\s*:)[^.!?\n]{0,100}$/i.test(before))continue;
  let rate=m[1].trim().replace(/\s+(?=[kK](?:\s|$))/g,'');if(unit)rate+='/'+(/^(?:hour|hr|hourly)$/i.test(unit)?'hr':/^(?:year|yr|annum|annually|annual|yearly)$/i.test(unit)?'yr':unit.toLowerCase());
  found.push({rate,evidence:(before+m[0]+after).replace(/\s+/g,' ').trim().slice(0,300)});
 }
 const map=new Map(found.map(f=>[f.rate.replace(/[\s,]/g,'').replace(/–|—|to/g,'-'),f]));const values=[...map.values()];
 return {rate:values.length===1?values[0].rate:'',evidence:values.length===1?values[0].evidence:'',ambiguous:values.length>1};
}

const employmentOrder=['Contract','C2C','W2','Full-time','Part-time','Temporary','Internship'];
const employmentPatterns={Contract:/\bcontract(?:or|ing)?\b/i,C2C:/\b(?:c\s*2\s*c|corp(?:oration)?\s*(?:to|-)\s*corp(?:oration)?)\b/i,W2:/\bw\s*[-–]?\s*2\b/i,'Full-time':/\bfull[\s_-]*time\b/i,'Part-time':/\bpart[\s_-]*time\b/i,Temporary:/\btemporary\b/i,Internship:/\binternship\b/i};
function notAllowed(value,index,length){const before=value.slice(Math.max(0,index-70),index),after=value.slice(index+length,index+length+50);return /(?:\bno|\bnot|\bwithout|\bexclude[ds]?|\bexcluding|\bdoes\s+not\s+(?:accept|allow)|\bcannot\s+(?:accept|consider)|\bdo\s+not\s+(?:accept|allow|consider))\s+(?:any\s+|a\s+|an\s+)?$/i.test(before)||/^\s*(?:(?:candidates?|arrangements?|engagements?)\s+)?(?:are\s+|is\s+)?(?:not\s+(?:accepted|allowed|available|eligible|considered)|(?:will\s+not|cannot)\s+be\s+(?:accepted|considered))/i.test(after);}
function detectEmployment(header,description){
 const found=new Set(),evidence=[];
 const scan=(value,allowed=employmentOrder)=>{const normalized=String(value??'').replace(/_/g,' ');for(const label of allowed){const pattern=new RegExp(employmentPatterns[label].source,'gi');let match;while((match=pattern.exec(normalized))){if(notAllowed(normalized,match.index,match[0].length))continue;found.add(label);const snippet=normalized.slice(Math.max(0,match.index-35),Math.min(normalized.length,match.index+match[0].length+85)).replace(/\s+/g,' ').trim();if(snippet&&!evidence.includes(snippet))evidence.push(snippet);break;}}};
 scan(header);
 for(const line of String(description??'').split(/[\n\r]+/)){if(/^\s*(?:position\s+type|employment\s+type|job\s+type|engagement\s+type|contract\s+type|type\s+of\s+(?:employment|position)|duration)\s*[:–-]/i.test(line)||/\b(?:this|the)\s+(?:role|position|job)\s+(?:is|will be)\b/i.test(line))scan(line);}
 scan(description,['W2','C2C']);
 return {employmentType:employmentOrder.filter(v=>found.has(v)).join(' · '),evidence:evidence.join(' | ').slice(0,500)};
}

function parseLinkedIn(html,url){
 const doc=new DOMParser().parseFromString(String(html),'text/html');const pageTitle=doc.title||'',body=text(doc.body).slice(0,4000);
 if(/access denied|just a moment|security verification|verify you are human|captcha|request blocked/i.test(pageTitle+' '+body))return {vendor:'',rate:'',employmentType:'',jobTitle:'',sourceUrl:url,evidence:{},status:'unavailable',message:'LinkedIn public job details returned an access check.'};
 const title=text(first(doc,['.top-card-layout__title','[data-tracking-control-name="public_jobs_topcard-title"]','h1'])).slice(0,250);
 const vendorCandidates=pickTexts(doc,['.topcard__org-name-link','[data-tracking-control-name="public_jobs_topcard-org-name"]','.topcard__flavor--black-link']).filter(v=>v.length<200&&!/^(?:follow|company|view company)$/i.test(v));
 const vendor=vendorCandidates[0]||'';
 const descriptionEl=first(doc,['.show-more-less-html__markup','.description__text','.jobs-description-content__text','#job-details']);
 const description=(descriptionEl?.innerText||descriptionEl?.textContent||'').replace(/[\t ]+/g,' ').replace(/\n\s*\n/g,'\n').trim().slice(0,150000);
 const criteria=pickTexts(doc,['.description__job-criteria-item','.description__job-criteria-list']).join('\n').slice(0,10000);
 const payText=pickTexts(doc,['.compensation__salary','.salary','.salary-range']).join('\n');let pay=textSalary(payText,true);if(!pay.rate&&!pay.ambiguous)pay=textSalary(description,false);
 const employment=detectEmployment(criteria,description);
 const result={vendor,rate:pay.rate,employmentType:employment.employmentType,jobTitle:title,sourceUrl:url,evidence:{vendor:vendor?'Company on LinkedIn: '+vendor:'',rate:pay.evidence||'',employment:employment.evidence||''},status:'unavailable',message:''};
 const count=score(result);result.status=count===3?'complete':count?'partial':'unavailable';
 result.message=count===3?'LinkedIn public job details parsed.':count?'Some LinkedIn details were found; review any missing field.':'No job fields were found in LinkedIn public details.';
 if(pay.ambiguous)result.message='Multiple pay amounts were found in the LinkedIn description. Review the rate manually.';
 if(/job (?:is )?no longer available|job (?:has )?expired|position (?:has been|is) filled|no longer accepting applications/i.test(body))result.message='This LinkedIn posting appears expired. '+result.message;
 return result;
}

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message?.target!=='lead-ledger-offscreen'||message?.type!=='parse-html')return false;
 try{
  if(sender.id!==chrome.runtime.id)throw new Error('Untrusted parser request.');
  const html=String(message.html??'');if(!html||html.length>3000000)throw new Error('Invalid job HTML.');
  const url=new URL(String(message.url||''));if(!/^https?:$/.test(url.protocol))throw new Error('Invalid job URL.');
  respond({ok:true,data:parseLinkedIn(html,url.href)});
 }catch(error){respond({ok:false,error:String(error?.message||error)});}
 return false;
});
