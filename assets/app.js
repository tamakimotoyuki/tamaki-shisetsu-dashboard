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

async function enter(){
  if(!DATA) DATA=await (await fetch('data/dashboard.json')).json();
  show('dash');
  const secs=Object.keys(DATA['セクション']);
  // 最新週ラベル
  let latest='';
  for(const s of secs) for(const m in DATA['セクション'][s]){
    const w=DATA['セクション'][s][m]['最新週']; if(w&&w>latest) latest=w;
  }
  document.getElementById('week-label').textContent='最新週: '+latest;
  // タブ
  const tabs=document.getElementById('section-tabs'); tabs.innerHTML='';
  secs.forEach((s,i)=>{
    const b=document.createElement('button'); b.textContent=s;
    b.onclick=()=>selectSection(s,b); tabs.appendChild(b);
    if(i===0){ b.classList.add('active'); curSection=s; }
  });
  renderSection(secs[0]);
}

function selectSection(s,btn){
  document.querySelectorAll('#section-tabs button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); curSection=s; renderSection(s);
}

function renderSection(s){
  const tbody=document.querySelector('#metric-table tbody'); tbody.innerHTML='';
  const metrics=DATA['セクション'][s];
  let first=null;
  Object.keys(metrics).forEach((m,i)=>{
    const o=metrics[m];
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${m}</td><td class="num">${o['最新']??'-'}</td><td>${o['単位']}</td><td>${o['週数']}</td>`;
    tr.onclick=()=>{ document.querySelectorAll('#metric-table tbody tr').forEach(x=>x.classList.remove('sel')); tr.classList.add('sel'); drawChart(s,m); };
    tbody.appendChild(tr);
    if(i===0) first=m;
  });
  if(first){ tbody.firstChild.classList.add('sel'); drawChart(s,first); }
}

function drawChart(s,m){
  const o=DATA['セクション'][s][m];
  const labels=o.series.map(x=>x[0]); const vals=o.series.map(x=>x[1]);
  document.getElementById('chart-title').textContent=`${m} の推移（${o.series.length}週）`;
  // 12週移動平均（赤折れ線）
  const ma=vals.map((_,i)=>{const s=Math.max(0,i-11),w=vals.slice(s,i+1);return +(w.reduce((a,b)=>a+b,0)/w.length).toFixed(1);});
  const unit=o['単位']?`(${o['単位']})`:'';
  const ctx=document.getElementById('chart');
  if(chart) chart.destroy();
  // 元グラフ準拠：週次の実数=棒グラフ(青) ＋ 12週移動平均=赤の折れ線。レスポンシブ
  chart=new Chart(ctx,{type:'bar',
    data:{labels,datasets:[
      {type:'bar',label:m+unit,data:vals,order:2,
        backgroundColor:'rgba(0,104,196,.55)',borderColor:'#0068c4',borderWidth:1},
      {type:'line',label:'12週移動平均',data:ma,order:1,
        borderColor:'#e2001a',backgroundColor:'transparent',borderWidth:2,pointRadius:0,tension:.2}
    ]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:true}},
      scales:{x:{ticks:{maxTicksLimit:12,autoSkip:true}},y:{beginAtZero:true}}}});
}

boot();
