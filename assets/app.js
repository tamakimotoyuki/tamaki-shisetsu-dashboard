'use strict';
let AUTH=null, HAIFU=null, GRAPHS=null, GIDX=[], charts=[], curFac=null, curDept=null;

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
// タブ表示名を短く（データキーは変えない）。()注記は除去、衝突するものだけ短い識別子を残す
const SHORT={
  '藍住 たまき青空クリニック':'藍住クリニック','ハート徳島クリニック（別法人・メディエンス）':'ハート徳島クリニック',
  '特養あおぞら（①②③いずれか該当）':'特養あおぞら','たまき青空 居宅支援':'居宅支援',
  '藍住たまき青空 居宅支援':'藍住居宅支援','たまき青空 訪問看護':'訪問看護',
  '一般病棟（地域包括ケア）':'地域包括ケア','地域包括医療 (60床) ※毎月10日以降':'地域包括医療 ※毎月10日以降',
  '透析室（本館）':'透析室 本館','透析室（健診センター）':'透析室 健診','リハビリ（病院）':'リハビリ'
};
function shortLabel(s){ if(SHORT[s])return SHORT[s]; return String(s).replace(/（[^）]*）/g,'').replace(/\([^)]*\)/g,'').trim()||s; }
// 病院の部署→dashboardのグラフ部署キー（確定マッピング・誤施設マッチ防止）
const GRAPH_HINT={
  // ★地域包括ケア病棟(60床)と地域包括医療病棟(60床)は同じ物理病棟（移行中の旧名/新名・施設台帳で確認）→同じ60床グラフ
  '一般病棟（地域包括ケア）':'地域包括ケア病棟','地域包括医療 (60床) ※毎月10日以降':'地域包括ケア病棟','療養病棟':'療養病棟',
  '緊急入院':'入退院・救急','入退院報告':'入退院・救急','手術室':'手術室','アンギオ室':'手術室',
  '透析室（本館）':'透析室','透析室（健診センター）':'透析室','放射線':'放射線部','健診':'健診センター',
  '検査':'検査部','薬剤':'薬剤部','栄養':'栄養部','リハビリ（病院）':'リハビリ部','訪問リハビリ':'リハビリ部',
  'リハビリ強化デイケア':'リハビリ部','連携室':'連携室','外来':'外来'
};
// 施設内に限定してグラフを探す（全施設横断で別施設のグラフを拾わないため）
function findGraphInFac(itemName, fac){
  const gd=GRAPHS[fac]; if(!gd) return null;
  const n=norm(itemName).replace(/除透析|今月|当月|先月|前月|のべ/g,''); if(n.length<3) return null;
  for(const d in gd) for(const m in gd[d]){ const gn=norm(m).replace(/名週|件週|名月|件月|週|月|除透析|のべ/g,''); if(gn && (gn.includes(n)||n.includes(gn))) return {name:m,o:gd[d][m]}; }
  return null;
}
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
// 配布資料の部署名 → dashboardの部署キー を対応づける（括弧内の語は残し、床/数字/室/部/センター等は無視）
function normDept(s){ return String(s).replace(/※.*$/,'').replace(/[（）()\s　]/g,'').replace(/[0-9０-９]+/g,'').replace(/床|病棟|センター|室|部/g,''); }
function matchGraphDept(haifuDept, graphKeys){
  const hn=normDept(haifuDept); if(!hn) return null;
  for(const gk of graphKeys){ const gn=normDept(gk); if(gn && (gn.includes(hn)||hn.includes(gn))) return gk; }
  return null;
}

async function enter(){
  if(!HAIFU) HAIFU=await (await fetch('data/haifu.json')).json();
  if(!GRAPHS){ GRAPHS=(await (await fetch('data/dashboard.json')).json())['施設']; buildGraphIndex(); }
  show('dash');
  let latest=''; for(const g of GIDX){ if(g.o.series&&g.o.series.length){ latest=g.o.series[g.o.series.length-1][0]; break; } }
  document.getElementById('week-label').textContent='最新: '+latest;
  const ft=document.getElementById('fac-tabs'); ft.innerHTML='';
  Object.keys(HAIFU).forEach((f)=>{ const b=document.createElement('button'); b.textContent=shortLabel(f); b.dataset.key=f; b.onclick=()=>selFac(f); ft.appendChild(b); });
  selFac(Object.keys(HAIFU)[0]);
}
function selFac(f){
  curFac=f;
  document.querySelectorAll('#fac-tabs button').forEach(b=>b.classList.toggle('active', b.dataset.key===f));
  const dt=document.getElementById('dept-tabs'); dt.innerHTML='';
  Object.keys(HAIFU[f]).forEach((d)=>{ const b=document.createElement('button'); b.textContent=shortLabel(d); b.dataset.key=d; b.onclick=()=>selDept(d); dt.appendChild(b); });
  selDept(Object.keys(HAIFU[f])[0]);
}
function selDept(d){
  curDept=d;
  document.querySelectorAll('#dept-tabs button').forEach(b=>b.classList.toggle('active', b.dataset.key===d));
  renderDept();
}

function clearCharts(){ charts.forEach(c=>c.destroy()); charts=[]; }

function renderDept(){
  const items=HAIFU[curFac][curDept];
  // 左：配布資料を2列グリッドで（区分なし・基準はタイトル下に小さく）
  const grid=document.getElementById('metric-grid'); grid.innerHTML='';
  items.forEach(it=>{
    const cell=document.createElement('div'); cell.className='mcell';
    const hasG=!!findGraphInFac(it['項目'], curFac);
    const lab=document.createElement('div'); lab.className='mlab';
    lab.innerHTML=`<span class="mt">${it['項目']}${hasG?' 📈':''}</span>`+(it['基準']?`<span class="mk">基準: ${it['基準']}</span>`:'');
    const val=document.createElement('div'); val.className='mv';
    val.textContent=(it['値表示']??'-')+(it['単位']?' '+it['単位']:'');
    cell.appendChild(lab); cell.appendChild(val); grid.appendChild(cell);
  });
  document.getElementById('table-title').textContent=`配布資料（${shortLabel(curDept)}）`;
  // 右：この部署のグラフをまとめて縦に並べる（クリック不要）
  clearCharts();
  const wrap=document.getElementById('charts'); wrap.innerHTML='';
  // 基準線用に「グラフ名→配布資料項目」を作る（施設内に限定）
  const itemByGraph={};
  items.forEach(it=>{ const g=findGraphInFac(it['項目'], curFac); if(g && !itemByGraph[g.name]) itemByGraph[g.name]=it; });
  // ①部署キー直引き（dashboardは部署ごとにグラフを束ねている）。グラフのタイトルに部署名が入っているので
  //   GRAPH_HINTで確定対応→無ければ正規化照合。見つかればそれが完全集合（item照合はしない＝過剰/誤施設防止）。
  //   直引きが空のときだけ②同一施設内のitem照合でフォールバック。
  const found=new Map();
  const gdepts=GRAPHS[curFac];
  if(gdepts){
    let gk=(GRAPH_HINT[curDept] && gdepts[GRAPH_HINT[curDept]]) ? GRAPH_HINT[curDept] : matchGraphDept(curDept, Object.keys(gdepts));
    if(gk){ for(const m in gdepts[gk]) found.set(m, gdepts[gk][m]); }
  }
  if(!found.size){ items.forEach(it=>{ const g=findGraphInFac(it['項目'], curFac); if(g && !found.has(g.name)) found.set(g.name, g.o); }); }
  found.forEach((o,name)=>{
    const card=document.createElement('div'); card.className='chartcard';
    const h=document.createElement('h3'); h.textContent=name; card.appendChild(h);
    const box=document.createElement('div'); box.className='chartbox';
    const cv=document.createElement('canvas'); box.appendChild(cv); card.appendChild(box);
    wrap.appendChild(card);
    charts.push(buildChart(cv, {name,o}, itemByGraph[name]||{}));
  });
  document.getElementById('charts-title').textContent=`グラフ（週次推移）${found.size?`　${found.size}件`:''}`;
  if(!found.size){ wrap.innerHTML='<p class="nochart">この部署の週次グラフはありません（表の値のみ）。</p>'; }
}

function buildChart(cv, g, it){
  const o=g.o, labels=o.series.map(x=>x[0]), vals=o.series.map(x=>x[1]);
  const ma=vals.map((_,i)=>{const s=Math.max(0,i-11),w=vals.slice(s,i+1);return +(w.reduce((a,b)=>a+b,0)/w.length).toFixed(1);});
  const ds=[
    {type:'bar',label:'週次',data:vals,order:2,backgroundColor:'rgba(0,104,196,.55)',borderColor:'#0068c4',borderWidth:1},
    {type:'line',label:'3か月平均',data:ma,order:1,borderColor:'#e2001a',backgroundColor:'transparent',borderWidth:2,pointRadius:0,tension:.2}
  ];
  const kn=kijunNum(it['基準']);
  if(kn!=null){ ds.push({type:'line',label:'基準('+it['基準']+')',data:labels.map(()=>kn),order:0,borderColor:'rgba(226,0,26,.5)',borderDash:[5,4],borderWidth:1,pointRadius:0,fill:false}); }
  return new Chart(cv,{type:'bar',data:{labels,datasets:ds},
    options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:true,labels:{boxWidth:12,font:{size:10}}}},
      scales:{x:{ticks:{maxTicksLimit:12,autoSkip:true,font:{size:9}}},y:{beginAtZero:true,ticks:{font:{size:9}}}}}});
}
boot();
