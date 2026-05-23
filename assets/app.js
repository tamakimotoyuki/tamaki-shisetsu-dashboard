'use strict';
let DATA=null, AUTH=null, chart=null, curSection=null;

async function sha256(s){
  const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function boot(){
  AUTH=await (await fetch('data/auth.json')).json();
  document.getElementById('login-form').addEventListener('submit', onLogin);
  document.getElementById('logout').addEventListener('click', ()=>{
    sessionStorage.removeItem('ok'); show('login');
  });
  if(sessionStorage.getItem('ok')==='1'){ await enter(); }
}

async function onLogin(e){
  e.preventDefault();
  const id=document.getElementById('uid').value.trim();
  const pw=document.getElementById('upw').value;
  const h=await sha256(pw);
  if(id===AUTH.id && h===AUTH.pw_sha256){
    sessionStorage.setItem('ok','1'); await enter();
  }else{
    document.getElementById('login-err').textContent='ID または パスワードが違います';
  }
}

function show(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

let curFac=null, curDept=null;

async function enter(){
  if(!DATA) DATA=await (await fetch('data/dashboard.json')).json();
  show('dash');
  const facs=Object.keys(DATA['施設']);
  // 最新期間ラベル
  let latest='';
  outer: for(const f of facs) for(const d in DATA['施設'][f]) for(const m in DATA['施設'][f][d]){
    const ser=DATA['施設'][f][d][m].series; if(ser&&ser.length){ latest=ser[ser.length-1][0]; break outer; }
  }
  document.getElementById('week-label').textContent='最新: '+latest;
  // 第一ヘッダー：施設タブ
  const ft=document.getElementById('fac-tabs'); ft.innerHTML='';
  facs.forEach((f,i)=>{
    const b=document.createElement('button'); b.textContent=f;
    b.onclick=()=>selFac(f); ft.appendChild(b);
    if(i===0) b.classList.add('active');
  });
  selFac(facs[0]);
}

function selFac(f){
  curFac=f;
  document.querySelectorAll('#fac-tabs button').forEach(b=>b.classList.toggle('active', b.textContent===f));
  // 第二ヘッダー：部署タブ
  const dt=document.getElementById('dept-tabs'); dt.innerHTML='';
  const depts=Object.keys(DATA['施設'][f]);
  depts.forEach((d,i)=>{
    const b=document.createElement('button'); b.textContent=d;
    b.onclick=()=>selDept(d); dt.appendChild(b);
    if(i===0) b.classList.add('active');
  });
  selDept(depts[0]);
}

function selDept(d){
  curDept=d;
  document.querySelectorAll('#dept-tabs button').forEach(b=>b.classList.toggle('active', b.textContent===d));
  renderTable();
}

function shortName(m){
  return m.replace(/（[^）]*?\/(週|月|人\/日|日\/1人)[^）]*）/g,'').replace(/（[^）]*）\s*$/,'').replace(/\s+/g,' ').trim();
}

function renderTable(){
  const tbody=document.querySelector('#metric-table tbody'); tbody.innerHTML='';
  const metrics=DATA['施設'][curFac][curDept];
  let first=null;
  Object.keys(metrics).forEach((m,i)=>{
    const o=metrics[m];
    const tr=document.createElement('tr');
    const kijun=o['基準']?o['基準']['表示']:'—';
    tr.innerHTML=`<td>${shortName(m)}</td><td class="num">${o['最新']??'-'}</td><td>${o['単位']}</td><td class="kijun">${kijun}</td><td>${o['週数']}</td>`;
    tr.onclick=()=>{ document.querySelectorAll('#metric-table tbody tr').forEach(x=>x.classList.remove('sel')); tr.classList.add('sel'); drawChart(m); };
    tbody.appendChild(tr);
    if(i===0) first=m;
  });
  if(first){ tbody.firstChild.classList.add('sel'); drawChart(first); }
}

function drawChart(m){
  const o=DATA['施設'][curFac][curDept][m];
  const labels=o.series.map(x=>x[0]); const vals=o.series.map(x=>x[1]);
  document.getElementById('chart-title').textContent=`${shortName(m)} の推移（${o.series.length}週）`;
  // 3か月平均（=12週移動平均・職員向け呼称）の赤折れ線
  const ma=vals.map((_,i)=>{const s=Math.max(0,i-11),w=vals.slice(s,i+1);return +(w.reduce((a,b)=>a+b,0)/w.length).toFixed(1);});
  const unit=o['単位']?`(${o['単位']})`:'';
  const ctx=document.getElementById('chart');
  if(chart) chart.destroy();
  // 元グラフ準拠：週次の実数=棒(青) ＋ 3か月平均=赤線。基準があれば薄い赤の点線で水平基準線
  const datasets=[
    {type:'bar',label:shortName(m)+unit,data:vals,order:2,
      backgroundColor:'rgba(0,104,196,.55)',borderColor:'#0068c4',borderWidth:1},
    {type:'line',label:'3か月平均',data:ma,order:1,
      borderColor:'#e2001a',backgroundColor:'transparent',borderWidth:2,pointRadius:0,tension:.2}
  ];
  if(o['基準'] && typeof o['基準']['値']==='number'){
    datasets.push({type:'line',label:'基準('+o['基準']['表示']+')',data:labels.map(()=>o['基準']['値']),order:0,
      borderColor:'rgba(226,0,26,.5)',borderDash:[5,4],borderWidth:1,pointRadius:0,fill:false});
  }
  chart=new Chart(ctx,{type:'bar',data:{labels,datasets},
    options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:true}},
      scales:{x:{ticks:{maxTicksLimit:12,autoSkip:true}},y:{beginAtZero:true}}}});
}

boot();
