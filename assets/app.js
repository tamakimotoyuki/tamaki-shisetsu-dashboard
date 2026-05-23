'use strict';
let AUTH=null, HAIFU=null, GRAPHS=null, GIDX=[], chart=null, curFac=null, curDept=null;

async function sha256(s){
  const b=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function boot(){
  AUTH=await (await fetch('data/auth.json')).json();
  document.getElementById('login-form').addEventListener('submit', onLogin);
  document.getElementById('logout').addEventListener('click', ()=>{ sessionStorage.removeItem('ok'); show('login'); });
  if(sessionStorage.getItem('ok')==='1') await enter();
}
async function onLogin(e){
  e.preventDefault();
  const id=document.getElementById('uid').value.trim(), pw=document.getElementById('upw').value;
  if(id===AUTH.id && (await sha256(pw))===AUTH.pw_sha256){ sessionStorage.setItem('ok','1'); await enter(); }
  else document.getElementById('login-err').textContent='ID または パスワードが違います';
}
function show(id){ document.querySelectorAll('.page').forEach(p=>p.classList.remove('active')); document.getElementById(id).classList.add('active'); }

const norm=s=>String(s).replace(/[\s　（）()／\/、%％・,，。:：]/g,'');
function buildGraphIndex(){
  GIDX=[];
  for(const f in GRAPHS) for(const d in GRAPHS[f]) for(const m in GRAPHS[f][d]) GIDX.push({name:m, o:GRAPHS[f][d][m]});
}
function findGraph(itemName){
  const n=norm(itemName).replace(/除透析|今月|当月|先月|前月|のべ/g,'');
  if(n.length<3) return null;
  for(const g of GIDX){ const gn=norm(g.name).replace(/名週|件週|名月|件月|週|月|除透析|のべ/g,''); if(gn && (gn.includes(n)||n.includes(gn))) return g; }
  return null;
}
function kijunNum(kijun){ if(!kijun) return null; const m=String(kijun).match(/(\d+\.?\d*)\s*(％|%|日|床|名|人|点|件|単位)?\s*(以上|以下|以内|未満)/); return m?parseFloat(m[1]):null; }

async function enter(){
  if(!HAIFU) HAIFU=await (await fetch('data/haifu.json')).json();
  if(!GRAPHS){ GRAPHS=(await (await fetch('data/dashboard.json')).json())['施設']; buildGraphIndex(); }
  show('dash');
  let latest=''; for(const g of GIDX){ if(g.o.series&&g.o.series.length){ latest=g.o.series[g.o.series.length-1][0]; break; } }
  document.getElementById('week-label').textContent='最新: '+latest;
  const ft=document.getElementById('fac-tabs'); ft.innerHTML='';
  Object.keys(HAIFU).forEach((f,i)=>{ const b=document.createElement('button'); b.textContent=f; b.onclick=()=>selFac(f); ft.appendChild(b); if(i===0)b.classList.add('active'); });
  selFac(Object.keys(HAIFU)[0]);
}
function selFac(f){
  curFac=f;
  document.querySelectorAll('#fac-tabs button').forEach(b=>b.classList.toggle('active', b.textContent===f));
  const dt=document.getElementById('dept-tabs'); dt.innerHTML='';
  Object.keys(HAIFU[f]).forEach((d,i)=>{ const b=document.createElement('button'); b.textContent=d; b.onclick=()=>selDept(d); dt.appendChild(b); if(i===0)b.classList.add('active'); });
  selDept(Object.keys(HAIFU[f])[0]);
}
function selDept(d){
  curDept=d;
  document.querySelectorAll('#dept-tabs button').forEach(b=>b.classList.toggle('active', b.textContent===d));
  renderTable();
}
function renderTable(){
  const items=HAIFU[curFac][curDept];
  const tb=document.querySelector('#metric-table tbody'); tb.innerHTML='';
  let first=null;
  items.forEach((it,i)=>{
    const tr=document.createElement('tr');
    const hasG=!!findGraph(it['項目']);
    tr.innerHTML=`<td>${it['項目']}${hasG?' 📈':''}</td><td class="num">${it['値表示']??'-'}</td><td>${it['単位']||''}</td><td class="kijun">${it['基準']||'—'}</td><td>${it['区分']||''}</td>`;
    tr.onclick=()=>{ document.querySelectorAll('#metric-table tbody tr').forEach(x=>x.classList.remove('sel')); tr.classList.add('sel'); drawChart(it); };
    tb.appendChild(tr); if(i===0)first=it;
  });
  if(first){ tb.firstChild.classList.add('sel'); drawChart(first); }
}
function drawChart(it){
  const g=findGraph(it['項目']);
  const ctx=document.getElementById('chart');
  if(chart){ chart.destroy(); chart=null; }
  const titleEl=document.getElementById('chart-title');
  if(!g){ titleEl.textContent=`${it['項目']}　（この項目の週次グラフはありません：表の値のみ）`; return; }
  const o=g.o, labels=o.series.map(x=>x[0]), vals=o.series.map(x=>x[1]);
  const ma=vals.map((_,i)=>{const s=Math.max(0,i-11),w=vals.slice(s,i+1);return +(w.reduce((a,b)=>a+b,0)/w.length).toFixed(1);});
  titleEl.textContent=`${g.name} の推移（${vals.length}週）`;
  const ds=[
    {type:'bar',label:'週次',data:vals,order:2,backgroundColor:'rgba(0,104,196,.55)',borderColor:'#0068c4',borderWidth:1},
    {type:'line',label:'3か月平均',data:ma,order:1,borderColor:'#e2001a',backgroundColor:'transparent',borderWidth:2,pointRadius:0,tension:.2}
  ];
  const kn=kijunNum(it['基準']);
  if(kn!=null){ ds.push({type:'line',label:'基準('+it['基準']+')',data:labels.map(()=>kn),order:0,borderColor:'rgba(226,0,26,.5)',borderDash:[5,4],borderWidth:1,pointRadius:0,fill:false}); }
  chart=new Chart(ctx,{type:'bar',data:{labels,datasets:ds},
    options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:true}},scales:{x:{ticks:{maxTicksLimit:12,autoSkip:true}},y:{beginAtZero:true}}}});
}
boot();
