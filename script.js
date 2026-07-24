/* Static tracker: local backup + GitHub Gist sync. Entries can only be created for today. */
const STORE = 'daily_activity_data_v1';
const PENDING_SYNC = 'daily_activity_pending_today_sync';
const PREFS = 'daily_activity_preferences_v1';
const MONTHS = ['Yan','Fev','Mar','Apr','May','Iyun','Iyul','Avg','Sen','Okt','Noy','Dek'];
const WEEKDAYS = ['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba'];
const PALETTE = ['#43c987','#55b5e9','#a782e3','#e7bd5c','#ea7f93','#70cbbb','#ef9663'];
const $ = (selector) => document.querySelector(selector);
let state = normalizeState(safeParse(localStorage.getItem(STORE)) || {});
let data = state.activities;
let shownYear = new Date().getFullYear();
let selectedTag = '';
let searchRange = 'all';
let retryTimer;
let lastAddedKey = '';
const toastQueue = [];
let toastShowing = false;

function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
const todayKey = () => dateKey(new Date());
function safeParse(value) { try { return JSON.parse(value); } catch { return null; } }
function normalizeState(value) {
  if (value && value.activities) return { activities:value.activities || {}, achievements:Array.isArray(value.achievements) ? value.achievements : [], tagColors:value.tagColors || {} };
  return { activities:value || {}, achievements:[], tagColors:{} }; // Upgrade the old date-keyed JSON without losing it.
}
function mergeStates(remoteValue, localValue) {
  const remote=normalizeState(remoteValue), local=normalizeState(localValue), activities={...remote.activities};
  Object.entries(local.activities).forEach(([date, entries])=>{const ids=new Set((activities[date]||[]).map(entry=>entry.id));activities[date]=[...(activities[date]||[]),...entries.filter(entry=>!ids.has(entry.id))];});
  return {activities,achievements:[...remote.achievements,...local.achievements.filter(item=>!remote.achievements.some(found=>found.id===item.id))],tagColors:{...remote.tagColors,...local.tagColors}};
}
function preferences() { return { goal:Number(localStorage.getItem('monthly_goal') || 0), reduceMotion:localStorage.getItem('reduce_motion')==='true', sound:localStorage.getItem('sound_enabled')==='true', summaries:localStorage.getItem('summaries_enabled')!=='false' }; }
function saveLocal() { state.activities=data; localStorage.setItem(STORE, JSON.stringify(state)); }
function config() { return { token: localStorage.getItem('gh_token') || '', gist: localStorage.getItem('gh_gist_id') || '' }; }
function localDate(key) { return new Date(`${key}T12:00:00`); }
function isConfigured() { const {token, gist} = config(); return Boolean(token && gist); }
function formatDate(key) { return new Intl.DateTimeFormat('uz-UZ', {weekday:'long', day:'numeric', month:'long', year:'numeric'}).format(localDate(key)); }
function escapeHtml(value='') { const d=document.createElement('div'); d.textContent=value; return d.innerHTML; }
function tagColor(tag) { if(state.tagColors[tag])return state.tagColors[tag]; let n=0; for (const char of tag) n=char.charCodeAt(0)+((n<<5)-n); return PALETTE[Math.abs(n)%PALETTE.length]; }
function eventLevel(entries) { return entries.length >= 3 ? 3 : entries.length; }
function setSync(state, text) { const el=$('#syncStatus'); el.className=`sync-status ${state}`; el.textContent=({saved:'🟢',syncing:'🟡',error:'🔴'})[state]+' '+text; }
function notify(text) { $('#message').textContent=text; setTimeout(()=>{if($('#message').textContent===text)$('#message').textContent='';},5000); }
function queueToast(title, detail='') { toastQueue.push({title,detail}); showNextToast(); }
function showNextToast() { if(toastShowing||!toastQueue.length)return;toastShowing=true;const {title,detail}=toastQueue.shift(),toast=document.createElement('div');toast.className='toast';toast.innerHTML=`<strong>${escapeHtml(title)}</strong>${detail?`<span>${escapeHtml(detail)}</span>`:''}`;$('#toastStack').append(toast);setTimeout(()=>{toast.remove();toastShowing=false;showNextToast();},3800); }
function currentStreak() { let run=0; let d=new Date(); if(!(data[dateKey(d)]||[]).length)d.setDate(d.getDate()-1); while((data[dateKey(d)]||[]).length){run++;d.setDate(d.getDate()-1);} return run; }
function playDing() { if (!preferences().sound) return; try { const audio=new (window.AudioContext||window.webkitAudioContext)(), oscillator=audio.createOscillator(), gain=audio.createGain();oscillator.type='sine';oscillator.frequency.setValueAtTime(660,audio.currentTime);oscillator.frequency.exponentialRampToValueAtTime(880,audio.currentTime+.18);gain.gain.setValueAtTime(.0001,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.06,audio.currentTime+.03);gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+.25);oscillator.connect(gain).connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+.26); } catch {} }
function confetti() { if(preferences().reduceMotion)return;const layer=$('#confettiLayer'), colors=['#08df93','#e7cc64','#76d18b','#55b5e9','#f17e91'];for(let i=0;i<36;i++){const bit=document.createElement('i');bit.className='confetti';bit.style.background=colors[i%colors.length];bit.style.left=`${45+Math.random()*10}%`;bit.style.top='38%';bit.style.setProperty('--dx',`${(Math.random()-.5)*480}px`);bit.style.setProperty('--dy',`${180+Math.random()*300}px`);bit.style.animationDelay=`${Math.random()*.16}s`;layer.append(bit);setTimeout(()=>bit.remove(),1800);}}

function render() {
  renderTracker(); renderAnalytics(); renderBanners();
}
function renderTracker() {
  $('#yearLabel').textContent=shownYear;
  const start=new Date(shownYear,0,1); start.setDate(start.getDate()-start.getDay());
  const end=new Date(shownYear,11,31); end.setDate(end.getDate()+(6-end.getDay()));
  const graph=$('#graph'); graph.innerHTML='';
  for (let d=new Date(start); d<=end; d.setDate(d.getDate()+1)) {
    const key=dateKey(d), entries=data[key]||[], cell=document.createElement('button');
    cell.className=`cell level-${eventLevel(entries)}`; cell.type='button';
    cell.title=`${formatDate(key)} — ${entries.length} ta ish`; cell.setAttribute('aria-label',cell.title);
    if (selectedTag && !entries.some(entry=>entry.tag===selectedTag)) cell.classList.add('dim');
    if (key===lastAddedKey) { cell.classList.add('just-added'); setTimeout(()=>cell.classList.remove('just-added'),500); }
    cell.onclick=()=>openDay(key); graph.append(cell);
  }
  renderMonths(start); renderStats(); renderFilters();
}
function renderMonths(start) {
  const labels=$('#monthLabels'); labels.innerHTML='';
  MONTHS.forEach((month,index)=>{ const first=new Date(shownYear,index,1); const week=Math.floor((first-start)/(7*864e5)); const label=document.createElement('span'); label.className='month-label'; label.style.left=`${week*19}px`; label.textContent=month; labels.append(label); });
}
function entriesOfYear() { return Object.entries(data).filter(([key])=>Number(key.slice(0,4))===shownYear); }
function yearTotal() { return entriesOfYear().reduce((total,[,entries])=>total+entries.length,0); }
function monthlyTotals(year=shownYear) { const totals=Array(12).fill(0); Object.entries(data).forEach(([key,entries])=>{if(Number(key.slice(0,4))===year)totals[Number(key.slice(5,7))-1]+=entries.length;}); return totals; }
function longestStreak() { let longest=0, run=0; for(let d=new Date(shownYear,0,1);d<=new Date(shownYear,11,31);d.setDate(d.getDate()+1)){ if((data[dateKey(d)]||[]).length){run++;longest=Math.max(longest,run);}else run=0;} return longest; }
function renderStats() {
  const total=yearTotal(), now=new Date(), currentMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  $('#totalEvents').textContent=total; $('#currentStreakMetric').textContent=`${currentStreak()} kun`; $('#streakMetric').textContent=`${longestStreak()} kun`;
  $('#monthMetric').textContent=Object.entries(data).filter(([key])=>key.startsWith(currentMonth)).reduce((sum,[,entries])=>sum+entries.length,0)+' ish';
  const totals=monthlyTotals(), max=Math.max(...totals); $('#activeMonthMetric').textContent=max?`${MONTHS[totals.indexOf(max)]} (${max})`:'—';
  document.title=`🔥${longestStreak()} | Activity Tracker`;
  renderGoal();
}
function renderGoal() { const goal=preferences().goal, card=$('#goalCard'); if(!goal){card.classList.add('hidden');return;}const now=new Date(), count=monthlyTotals(now.getFullYear())[now.getMonth()], percent=Math.min(100,Math.round(count/goal*100));card.classList.remove('hidden');$('#goalText').textContent=`${count} / ${goal} ish`;$('#goalProgress').style.width=`${percent}%`;$('#goalPercent').textContent=`${percent}%`; }
function renderFilters() {
  const tags=[...new Set(Object.values(data).flat().map(entry=>entry.tag).filter(Boolean))], box=$('#tagFilters'); box.innerHTML='';
  const addFilter=(name,active,onClick)=>{const button=document.createElement('button');button.className=`tag-filter ${active?'active':''}`;button.textContent=name;button.onclick=onClick;box.append(button);};
  addFilter('Barchasi',!selectedTag,()=>{selectedTag='';renderTracker();});
  tags.forEach(tag=>addFilter(tag,selectedTag===tag,()=>{selectedTag=selectedTag===tag?'':tag;renderTracker();}));
}
function renderSearchResults() { const query=$('#searchInput').value.trim().toLowerCase(), box=$('#searchResults'); if(!query&&searchRange==='all'){box.classList.add('hidden');return;}const now=new Date(), earliest=new Date(now);if(searchRange!=='all'){if(searchRange==='year')earliest.setMonth(0,1);else earliest.setDate(now.getDate()-Number(searchRange));}const matches=Object.entries(data).flatMap(([date,entries])=>entries.map(entry=>({date,entry}))).filter(({date,entry})=>localDate(date)>=earliest&&(!query||`${entry.title} ${entry.description}`.toLowerCase().includes(query))).sort((a,b)=>b.date.localeCompare(a.date));box.classList.remove('hidden');box.innerHTML=matches.length?`<h3>${matches.length} ta natija</h3>${matches.map(({date,entry})=>`<button class="search-result" data-date="${date}"><span>${formatDate(date)} · ${escapeHtml(entry.time)}</span><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.description||'Tavsif yo‘q')}</small>${entry.tag?`<i style="background:${tagColor(entry.tag)}">${escapeHtml(entry.tag)}</i>`:''}</button>`).join('')}`:'<p class="empty">Hech narsa topilmadi, boshqa so‘z bilan qidirib ko‘ring.</p>';box.querySelectorAll('[data-date]').forEach(button=>button.onclick=()=>openDay(button.dataset.date));}
function setRange(range){searchRange=range;document.querySelectorAll('[data-range]').forEach(button=>button.classList.toggle('active',button.dataset.range===range));renderSearchResults();}
function renderBanners() {
  $('#todayReminder').classList.toggle('hidden',(data[todayKey()]||[]).length>0);
  const banner=$('#offlineBanner');
  if(!isConfigured()){banner.textContent='⚠️ Bulutga ulanmagan — Sozlamalarda GitHub token va Gist ID kiriting. Ma’lumotlar hozir qurilmangizda saqlanmoqda.';banner.classList.remove('hidden');}else banner.classList.add('hidden');
}
function periodKey(type) { const now=new Date();if(type==='month')return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;const monday=new Date(now);monday.setDate(now.getDate()-((now.getDay()+6)%7));return dateKey(monday); }
function showSummary(type) { const now=new Date(), end=type==='month'?new Date(now.getFullYear(),now.getMonth(),1):new Date(now.getFullYear(),now.getMonth(),now.getDate()-((now.getDay()+6)%7));const start=new Date(end);if(type==='month')start.setMonth(start.getMonth()-1);else start.setDate(start.getDate()-7);const items=Object.entries(data).flatMap(([date,entries])=>entries.map(entry=>({date,entry}))).filter(({date})=>localDate(date)>=start&&localDate(date)<end);if(!items.length)return;const weekday=Array(7).fill(0),tags={};items.forEach(({date,entry})=>{weekday[localDate(date).getDay()]++;if(entry.tag)tags[entry.tag]=(tags[entry.tag]||0)+1;});const bestDay=WEEKDAYS[weekday.indexOf(Math.max(...weekday))],bestTag=Object.keys(tags).sort((a,b)=>tags[b]-tags[a])[0]||'Tegsiz';$('#summaryText').textContent=`📊 O‘tgan ${type==='month'?'oy':'hafta'} xulosasi: ${items.length} ta ish, eng faol kun — ${bestDay}, eng ko‘p ishlatilgan kategoriya — ${bestTag}.`;$('#summaryBanner').classList.remove('hidden');localStorage.setItem(type==='month'?'lastMonthlySummaryShown':'lastWeeklySummaryShown',periodKey(type));setTimeout(()=>$('#summaryBanner').classList.add('hidden'),9000);}
function checkSummaries(){if(!preferences().summaries)return;['week','month'].forEach(type=>{const key=type==='month'?'lastMonthlySummaryShown':'lastWeeklySummaryShown';if(localStorage.getItem(key)!==periodKey(type))showSummary(type);});}
function checkBackupReminder(){if(isConfigured())return;const first=Number(localStorage.getItem('tracker_first_seen')||Date.now()),last=Number(localStorage.getItem('last_backup_download')||0),dismissed=Number(localStorage.getItem('backup_reminder_dismissed')||0),week=7*864e5;if(Date.now()-first>week&&Date.now()-Math.max(last,dismissed)>week)$('#backupBanner').classList.remove('hidden');}

function categoryStats() {
  const stats={};
  Object.entries(data).forEach(([date,entries])=>entries.forEach(entry=>{const tag=entry.tag||'Tegsiz'; if(!stats[tag])stats[tag]={tag,count:0,last:date};stats[tag].count++;if(date>stats[tag].last)stats[tag].last=date;}));
  return Object.values(stats).sort((a,b)=>b.count-a.count);
}
function renderAnalytics() {
  const total=yearTotal(), dailyCount=entriesOfYear().filter(([,entries])=>entries.length).length;
  $('#analyticsTotal').textContent=total; $('#analyticsAverage').textContent=dailyCount?(total/dailyCount).toFixed(1):'0';
  const weekCounts=Array(7).fill(0); entriesOfYear().forEach(([key,entries])=>weekCounts[localDate(key).getDay()]+=entries.length); const weekMax=Math.max(...weekCounts); $('#analyticsWeekday').textContent=weekMax?WEEKDAYS[weekCounts.indexOf(weekMax)]:'—';
  const now=new Date(), thisMonth=monthlyTotals(now.getFullYear())[now.getMonth()], previous=now.getMonth()===0?monthlyTotals(now.getFullYear()-1)[11]:monthlyTotals(now.getFullYear())[now.getMonth()-1];
  $('#analyticsGrowth').textContent=previous?`${thisMonth>=previous?'+':''}${Math.round((thisMonth-previous)/previous*100)}%`:thisMonth?'Yangi':'—';
  const categories=categoryStats(); drawDonut(categories); drawBars(monthlyTotals()); renderCategoryTable(categories);
  renderComparisons(); renderAchievements();
}
function comparisonText(current, previous) { if(!previous)return current?'Yangi odat':'—';const percent=Math.round((current-previous)/previous*100);return `${percent>=0?'+':''}${percent}% ${percent>=0?'▲':'▼'}`; }
function renderComparisons() { const now=new Date(), startOfWeek=new Date(now);startOfWeek.setHours(0,0,0,0);startOfWeek.setDate(now.getDate()-((now.getDay()+6)%7));const countRange=(start,end)=>Object.entries(data).filter(([key])=>{const day=localDate(key);return day>=start&&day<end;}).reduce((sum,[,entries])=>sum+entries.length,0);const lastWeek=new Date(startOfWeek);lastWeek.setDate(lastWeek.getDate()-7);const weeklyCurrent=countRange(startOfWeek,new Date(startOfWeek.getTime()+7*864e5)),weeklyPrevious=countRange(lastWeek,startOfWeek);const monthlyCurrent=monthlyTotals(now.getFullYear())[now.getMonth()],monthlyPrevious=now.getMonth()?monthlyTotals(now.getFullYear())[now.getMonth()-1]:monthlyTotals(now.getFullYear()-1)[11];[['#weeklyComparison',weeklyCurrent,weeklyPrevious],['#monthlyComparison',monthlyCurrent,monthlyPrevious]].forEach(([selector,current,previous])=>{const item=$(selector);item.textContent=comparisonText(current,previous);item.classList.toggle('neutral',current<previous);}); }
const ACHIEVEMENTS=[
  {id:'first_step',icon:'🌱',name:'Birinchi qadam',description:'Birinchi yozuvingizni qo‘shing',check:()=>totalAll()>=1},
  {id:'events_10',icon:'✦',name:'10 ta ish',description:'10 ta yozuv yarating',check:()=>totalAll()>=10},
  {id:'events_50',icon:'🚀',name:'50 ta ish',description:'50 ta yozuv yarating',check:()=>totalAll()>=50},
  {id:'events_100',icon:'💯',name:'100 ta ish',description:'100 ta yozuv yarating',check:()=>totalAll()>=100},
  {id:'streak_7',icon:'🔥',name:'7 kunlik olov',description:'7 kunlik streakga erishing',check:()=>longestStreakAll()>=7},
  {id:'streak_30',icon:'🌋',name:'30 kunlik olov',description:'30 kunlik streakga erishing',check:()=>longestStreakAll()>=30},
  {id:'specialist',icon:'🧠',name:'Mutaxassis',description:'Bir kategoriyada 20 ish qiling',check:()=>categoryStats().some(item=>item.count>=20)},
  {id:'full_month',icon:'🗓️',name:'To‘liq oy',description:'Bir oyning har kunida faol bo‘ling',check:()=>hasFullMonth()}
];
function totalAll(){return Object.values(data).reduce((sum,entries)=>sum+entries.length,0)}
function longestStreakAll(){const days=Object.keys(data).filter(key=>data[key].length).sort();let best=0,run=0,previous='';days.forEach(key=>{if(previous&&localDate(key)-localDate(previous)===864e5)run++;else run=1;best=Math.max(best,run);previous=key;});return best;}
function hasFullMonth(){const months={};Object.keys(data).filter(key=>data[key].length).forEach(key=>{const month=key.slice(0,7);(months[month]??=new Set()).add(key);});return Object.entries(months).some(([month,days])=>days.size===new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate());}
function renderAchievements(){const unlocked=new Map(state.achievements.map(item=>[item.id,item]));$('#achievementCount').textContent=`${unlocked.size} / ${ACHIEVEMENTS.length}`;$('#achievementGrid').innerHTML=ACHIEVEMENTS.map(item=>`<article class="achievement ${unlocked.has(item.id)?'':'locked'}"><span class="achievement-icon">${item.icon}</span><strong>${item.name}</strong><small>${item.description}</small></article>`).join('');}
function checkAchievements(){let changed=false;ACHIEVEMENTS.forEach(item=>{if(item.check()&&!state.achievements.some(found=>found.id===item.id)){state.achievements.push({id:item.id,unlockedAt:todayKey()});queueToast(`🏆 Yangi yutuq: ${item.name}`,item.description);changed=true;}});if(changed)saveLocal();return changed;}
function canvasContext(id) { const canvas=$(id), rect=canvas.getBoundingClientRect(), scale=window.devicePixelRatio||1; canvas.width=Math.max(1,Math.floor(rect.width*scale)); canvas.height=Math.max(1,Math.floor(rect.height*scale)); const ctx=canvas.getContext('2d'); ctx.scale(scale,scale); return {ctx,width:rect.width,height:rect.height}; }
function drawDonut(categories) {
  const {ctx,width,height}=canvasContext('#donutChart'); ctx.clearRect(0,0,width,height); const total=categories.reduce((sum,item)=>sum+item.count,0), cx=width/2, cy=height/2-2, radius=Math.min(width,height)*.29;
  if(!total){ctx.fillStyle='#93a1b8';ctx.font='13px system-ui';ctx.textAlign='center';ctx.fillText('Hali kategoriya yo‘q',cx,cy);$('#donutLegend').innerHTML='';return;}
  let start=-Math.PI/2; categories.forEach(item=>{const angle=item.count/total*Math.PI*2;ctx.beginPath();ctx.strokeStyle=tagColor(item.tag);ctx.lineWidth=28;ctx.arc(cx,cy,radius,start,start+angle);ctx.stroke();start+=angle;});
  ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--text');ctx.textAlign='center';ctx.font='700 25px system-ui';ctx.fillText(total,cx,cy+4);ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--muted');ctx.font='11px system-ui';ctx.fillText('jami ish',cx,cy+22);
  $('#donutLegend').innerHTML=categories.map(item=>`<div class="legend-item"><i class="legend-dot" style="background:${tagColor(item.tag)}"></i><span>${escapeHtml(item.tag)} <b>${Math.round(item.count/total*100)}%</b></span></div>`).join('');
}
function drawBars(totals) {
  const {ctx,width,height}=canvasContext('#barChart');ctx.clearRect(0,0,width,height);const max=Math.max(...totals,1), left=20,right=10,top=14,bottom=31, chartWidth=width-left-right,chartHeight=height-top-bottom, step=chartWidth/12;
  ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue('--line');ctx.lineWidth=1;for(let i=0;i<4;i++){const y=top+(chartHeight/3)*i;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(width-right,y);ctx.stroke();}
  totals.forEach((value,index)=>{const barWidth=Math.min(28,step*.58), x=left+index*step+(step-barWidth)/2, barHeight=value/max*chartHeight,y=top+chartHeight-barHeight;ctx.fillStyle='#43c987';ctx.beginPath();ctx.roundRect(x,y,barWidth,Math.max(barHeight,2),[5,5,0,0]);ctx.fill();ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--muted');ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText(MONTHS[index],x+barWidth/2,height-10);if(value){ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--text');ctx.fillText(value,x+barWidth/2,y-6);}});
}
function renderCategoryTable(categories) { $('#categoryTable').innerHTML=categories.length?categories.map(item=>`<tr><td><span class="category-name"><i class="legend-dot" style="background:${tagColor(item.tag)}"></i>${escapeHtml(item.tag)}</span></td><td>${item.count}</td><td>${formatDate(item.last)}</td></tr>`).join(''):'<tr><td colspan="3" class="empty">Hali kategoriyali yozuv yo‘q.</td></tr>'; }

function openDay(key) { $('#dayModalTitle').textContent=formatDate(key); const entries=data[key]||[]; $('#dayEntries').innerHTML=entries.length?entries.map(entry=>`<article class="entry"><div class="entry-head"><time>${escapeHtml(entry.time)}</time><h3>${escapeHtml(entry.title)}</h3>${entry.tag?`<span class="badge" style="background:${tagColor(entry.tag)}">${escapeHtml(entry.tag)}</span>`:''}</div>${entry.description?`<p>${escapeHtml(entry.description)}</p>`:''}</article>`).join(''):'<p class="empty">Bu kunda faoliyat qayd etilmagan.</p>'; openModal('dayModal'); }
function openModal(id) { $(`#${id}`).classList.remove('hidden'); }
function closeModal(id) { $(`#${id}`).classList.add('hidden'); }

async function loadCloud() { if(!isConfigured()){setSync('saved','Mahalliy saqlangan');return;} const {token,gist}=config(), localState=state;setSync('syncing','Yuklanmoqda...');try{const response=await fetch(`https://api.github.com/gists/${encodeURIComponent(gist)}`,{headers:{Authorization:`token ${token}`,Accept:'application/vnd.github+json'}});if(!response.ok)throw new Error(String(response.status));const gistData=await response.json(),file=gistData.files?.['activity-data.json'];if(!file)throw new Error('nofile');const cloud=safeParse(file.content);if(!cloud)throw new Error('json');state=mergeStates(cloud,localState);data=state.activities;saveLocal();render();setSync('saved','Saqlangan');}catch(error){handleSyncError(error);}}
function handleSyncError(error) {const code=error.message,msg=code==='401'?'Token noto‘g‘ri, Sozlamalarda tekshiring.':code==='404'?'Gist topilmadi, ID ni tekshiring.':code==='nofile'?"Gist ichida activity-data.json fayli topilmadi.":navigator.onLine?'GitHub bilan aloqa xatosi.':'Internet yo‘q — mahalliy nusxa saqlandi.';setSync('error','Xatolik');notify(msg);clearTimeout(retryTimer);retryTimer=setTimeout(()=>{if(navigator.onLine)syncCloud();},30000);}
async function syncCloud(settingsOnly=false) { /* Entries still PATCH only after today; merge prevents one device from replacing another device's list. */ if(!isConfigured() || (!settingsOnly&&localStorage.getItem(PENDING_SYNC)!==todayKey()))return;const {token,gist}=config();setSync('syncing','Saqlanmoqda...');try{const current=await fetch(`https://api.github.com/gists/${encodeURIComponent(gist)}`,{headers:{Authorization:`token ${token}`,Accept:'application/vnd.github+json'}});if(!current.ok)throw new Error(String(current.status));const gistData=await current.json(), cloud=safeParse(gistData.files?.['activity-data.json']?.content);if(!cloud)throw new Error('json');state=mergeStates(cloud,state);data=state.activities;const response=await fetch(`https://api.github.com/gists/${encodeURIComponent(gist)}`,{method:'PATCH',headers:{Authorization:`token ${token}`,'Content-Type':'application/json',Accept:'application/vnd.github+json'},body:JSON.stringify({files:{'activity-data.json':{content:JSON.stringify(state,null,2)}}})});if(!response.ok)throw new Error(String(response.status));if(!settingsOnly)localStorage.removeItem(PENDING_SYNC);saveLocal();setSync('saved','Saqlangan');notify('GitHub Gist ga saqlandi.');}catch(error){handleSyncError(error);}}
function addEntry(values) { const key=todayKey(); /* no date parameter: past/future dates cannot enter this path */ if(key!==todayKey())throw new Error('Faqat bugungi sana uchun yozuv qo‘shish mumkin.');const wasFirstToday=!(data[key]||[]).length, oldRecord=longestStreakAll(), entry={id:crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`,time:new Date().toLocaleTimeString('uz-UZ',{hour:'2-digit',minute:'2-digit'}),title:values.title.trim(),description:values.description.trim(),tag:values.tag.trim()};if(!entry.title)return;(data[key]??=[]).push(entry);lastAddedKey=key;localStorage.setItem(PENDING_SYNC,key);checkAchievements();saveLocal();render();playDing();if(wasFirstToday){confetti();const current=currentStreak(),record=longestStreakAll();if(record>oldRecord)queueToast('🎉 Yangi rekord!',`Endi eng uzun streak: ${record} kun`);else queueToast(`🔥 ${current} kunlik streak davom etmoqda`);}const goal=preferences().goal,monthly=monthlyTotals(new Date().getFullYear())[new Date().getMonth()];if(goal&&monthly>=goal)queueToast('🎯 Oylik maqsadga yetdingiz!','Ajoyib ritmni saqlab qoling.');syncCloud();}
function renderTagColorSettings(){const tags=[...new Set(Object.values(data).flat().map(entry=>entry.tag).filter(Boolean))], box=$('#tagColorSettings');box.innerHTML=tags.length?tags.map(tag=>`<label class="tag-color-row"><span>${escapeHtml(tag)}</span><input type="color" data-tag-color="${escapeHtml(tag)}" value="${tagColor(tag)}" /></label>`).join(''):'<p class="help">Rang tanlash uchun avval tegli yozuv qo‘shing.</p>';}
function openSettings(){const current=config(),prefs=preferences();$('#tokenInput').value='';$('#tokenInput').placeholder=current.token?'Token saqlangan — almashtirish uchun yangisini kiriting':'github_pat_...';$('#gistInput').value=current.gist;$('#goalInput').value=prefs.goal||'';$('#reduceMotionInput').checked=prefs.reduceMotion;$('#soundInput').checked=prefs.sound;$('#summariesInput').checked=prefs.summaries;renderTagColorSettings();openModal('settingsModal');}
function switchView(view) { document.querySelectorAll('.view').forEach(item=>item.classList.toggle('active',item.id===`${view}View`));document.querySelectorAll('[data-view]').forEach(item=>item.classList.toggle('active',item.dataset.view===view));$('#pageTitle').textContent=view==='analytics'?'Analytics':'Yearly Activity';if(view==='analytics')requestAnimationFrame(renderAnalytics); }

$('#addButton').onclick=()=>openModal('entryModal'); $('#settingsButton').onclick=openSettings; $('#mobileSettings').onclick=openSettings;
$('#themeButton').onclick=()=>{document.body.classList.toggle('light');localStorage.setItem('activity_theme',document.body.classList.contains('light')?'light':'dark');renderAnalytics();};
$('#prevYear').onclick=()=>{shownYear--;render();};$('#nextYear').onclick=()=>{shownYear++;render();};
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
$('#searchInput').oninput=renderSearchResults;document.querySelectorAll('[data-range]').forEach(button=>button.onclick=()=>setRange(button.dataset.range));document.querySelectorAll('[data-close-notice]').forEach(button=>button.onclick=()=>{const id=button.dataset.closeNotice;$(`#${id}`).classList.add('hidden');if(id==='backupBanner')localStorage.setItem('backup_reminder_dismissed',String(Date.now()));});
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>closeModal(button.dataset.close));document.querySelectorAll('.modal').forEach(modal=>modal.onclick=event=>{if(event.target===modal)closeModal(modal.id);});
$('#entryForm').onsubmit=event=>{event.preventDefault();addEntry({title:$('#entryTitle').value,description:$('#entryDescription').value,tag:$('#entryTag').value});event.target.reset();closeModal('entryModal');};
$('#settingsForm').onsubmit=event=>{event.preventDefault();const newToken=$('#tokenInput').value.trim();if(newToken)localStorage.setItem('gh_token',newToken);localStorage.setItem('gh_gist_id',$('#gistInput').value.trim());const goal=Number($('#goalInput').value);if(goal>0)localStorage.setItem('monthly_goal',String(goal));else localStorage.removeItem('monthly_goal');localStorage.setItem('reduce_motion',$('#reduceMotionInput').checked);localStorage.setItem('sound_enabled',$('#soundInput').checked);localStorage.setItem('summaries_enabled',$('#summariesInput').checked);document.querySelectorAll('[data-tag-color]').forEach(input=>state.tagColors[input.dataset.tagColor]=input.value);saveLocal();closeModal('settingsModal');render();syncCloud(true);};
$('#downloadButton').onclick=()=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));link.download='activity-data-backup.json';link.click();URL.revokeObjectURL(link.href);localStorage.setItem('last_backup_download',String(Date.now()));$('#backupBanner').classList.add('hidden');};
window.addEventListener('online',()=>{notify('Internet qaytdi, qayta sinxronlash boshlandi.');syncCloud();});window.addEventListener('resize',()=>{if($('#analyticsView').classList.contains('active'))renderAnalytics();});
$('#soundYes').onclick=()=>{localStorage.setItem('sound_enabled','true');closeModal('soundModal');playDing();};
$('#soundNo').onclick=()=>{localStorage.setItem('sound_enabled','false');closeModal('soundModal');};
function showGentleStreakMessage(){const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);const noticeKey=`streak_break_seen_${todayKey()}`;if(!localStorage.getItem(noticeKey)&&Object.keys(data).some(key=>key<dateKey(yesterday))&&!(data[dateKey(yesterday)]||[]).length){localStorage.setItem(noticeKey,'true');setTimeout(()=>queueToast('Streak uzildi, lekin bugundan yangisini boshlash mumkin 💪'),700);}}
if(!localStorage.getItem('tracker_first_seen'))localStorage.setItem('tracker_first_seen',String(Date.now()));if(localStorage.getItem('activity_theme')==='light')document.body.classList.add('light');render();loadCloud();showGentleStreakMessage();checkSummaries();checkBackupReminder();if('serviceWorker'in navigator)navigator.serviceWorker.register('service-worker.js').catch(()=>{});if(localStorage.getItem('sound_enabled')===null)setTimeout(()=>openModal('soundModal'),900);
