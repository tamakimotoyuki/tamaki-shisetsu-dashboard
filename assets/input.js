'use strict';
let AUTH=null, SCHEMA=null, curFac=null, curDept=null;
// GAS Web App の /exec URL（デプロイ後に設定）。空なら「サーバー保存」は書き出しを案内。
const SAVE_ENDPOINT='';

async function sha256(s){
  const b=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function show(id){ document.querySelectorAll('.page').forEach(p=>p.classList.remove('active')); document.getElementById(id).classList.add('active'); }
// タブ表示名を短く（データキーは変えない）
const SHORT={
  '藍住 たまき青空クリニック':'藍住クリニック','ハート徳島クリニック（別法人・メディエンス）':'ハート徳島クリニック',
  '特養あおぞら（①②③いずれか該当）':'特養あおぞら','たまき青空 居宅支援':'居宅支援',
  '藍住たまき青空 居宅支援':'藍住居宅支援','たまき青空 訪問看護':'訪問看護',
  '一般病棟（地域包括ケア）':'地域包括ケア','地域包括医療 (60床) ※毎月10日以降':'地域包括医療',
  '透析室（本館）':'透析室 本館','透析室（健診センター）':'透析室 健診','リハビリ（病院）':'リハビリ'
};
function shortLabel(s){ if(SHORT[s])return SHORT[s]; return String(s).replace(/※.*$/,'').replace(/（[^）]*）/g,'').replace(/\([^)]*\)/g,'').trim()||s; }

/* ---- 対象週（月曜）---- */
function fmtLocal(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function thisMonday(){
  const d=new Date(); const dow=(d.getDay()+6)%7; // Mon=0..Sun=6
  d.setDate(d.getDate()-dow);
  return fmtLocal(d); // ローカル日付（toISOStringはUTCずれで前日になる）
}
function curWeek(){ return document.getElementById('week').value || thisMonday(); }

/* ---- localStorage（週ごと）---- */
function storeKey(){ return 'irakai:'+curWeek(); }
function loadStore(){ try{ return JSON.parse(localStorage.getItem(storeKey()))||{}; }catch(e){ return {}; } }
function saveStore(s){ localStorage.setItem(storeKey(), JSON.stringify(s)); }
function cellKey(f,d){ return f+'||'+d; }
function deptData(f,d){ const s=loadStore(); return s[cellKey(f,d)]||{values:{},dates:{}}; }
function setDeptData(f,d,obj){ const s=loadStore(); s[cellKey(f,d)]=obj; saveStore(s); }
function deptHasInput(f,d){ const dd=deptData(f,d); return Object.values(dd.values||{}).some(v=>v!=='' && v!=null) || Object.values(dd.dates||{}).some(a=>a&&a.length); }

/* ---- 起動 ---- */
async function boot(){
  AUTH=await (await fetch('data/auth.json')).json();
  document.getElementById('login-form').addEventListener('submit', onLogin);
  document.getElementById('logout').addEventListener('click', ()=>{ sessionStorage.removeItem('ok'); show('login'); });
  document.getElementById('week').value=thisMonday();
  document.getElementById('week').addEventListener('change', ()=>{ buildDeptTabs(); renderForm(); });
  document.getElementById('save').addEventListener('click', ()=>{ persistForm(); flash('保存しました'); buildDeptTabs(); });
  document.getElementById('export').addEventListener('click', exportDept);
  document.getElementById('export-all').addEventListener('click', exportAll);
  document.getElementById('send').addEventListener('click', sendToServer);
  if(sessionStorage.getItem('ok')==='1') await enter();
}
async function onLogin(e){
  e.preventDefault();
  const id=document.getElementById('uid').value.trim(), pw=document.getElementById('upw').value;
  if(id===AUTH.id && (await sha256(pw))===AUTH.pw_sha256){ sessionStorage.setItem('ok','1'); await enter(); }
  else document.getElementById('login-err').textContent='ID または パスワードが違います';
}
async function enter(){
  if(!SCHEMA) SCHEMA=await (await fetch('data/input_schema.json')).json();
  show('app');
  const ft=document.getElementById('fac-tabs'); ft.innerHTML='';
  Object.keys(SCHEMA).forEach((f)=>{ const b=document.createElement('button'); b.textContent=shortLabel(f); b.dataset.key=f; b.onclick=()=>selFac(f); ft.appendChild(b); });
  selFac(Object.keys(SCHEMA)[0]);
}
function selFac(f){
  curFac=f;
  document.querySelectorAll('#fac-tabs button').forEach(b=>b.classList.toggle('active', b.dataset.key===f));
  buildDeptTabs();
  selDept(Object.keys(SCHEMA[f])[0]);
}
function buildDeptTabs(){
  const dt=document.getElementById('dept-tabs'); dt.innerHTML='';
  Object.keys(SCHEMA[curFac]).forEach(d=>{
    const b=document.createElement('button');
    b.textContent=shortLabel(d)+(deptHasInput(curFac,d)?' ✓':'');
    b.dataset.dept=d;
    b.onclick=()=>selDept(d); dt.appendChild(b);
    if(d===curDept) b.classList.add('active');
  });
}
function selDept(d){
  if(curDept) persistForm(); // 切替時に現在の入力を保存
  curDept=d;
  document.querySelectorAll('#dept-tabs button').forEach(b=>b.classList.toggle('active', b.dataset.dept===d));
  renderForm();
}

/* ---- フォーム描画 ---- */
function renderForm(){
  const items=SCHEMA[curFac][curDept];
  const dd=deptData(curFac,curDept);
  const form=document.getElementById('form'); form.innerHTML='';
  const inputs=items.filter(x=>x.mode==='input'), autos=items.filter(x=>x.mode==='auto');

  const h1=document.createElement('div'); h1.className='sec-h'; h1.textContent='① 入力が必要な項目（先週1週間の実数）'; form.appendChild(h1);
  if(!inputs.length){ const p=document.createElement('div'); p.style.cssText='color:#889;font-size:13px;padding:6px'; p.textContent='（この部署は手入力項目がありません）'; form.appendChild(p); }
  inputs.forEach(it=>{
    const row=document.createElement('div'); row.className='inp-row';
    const lbl=document.createElement('span'); lbl.className='lbl'; lbl.textContent=it['項目'];
    if(it['基準']){ const k=document.createElement('span'); k.className='kij'; k.textContent='基準:'+it['基準']; lbl.appendChild(k); }
    row.appendChild(lbl);
    if(it.type==='datelist'){
      row.appendChild(buildDatelist(it));
    }else{
      const inp=document.createElement('input'); inp.type='number'; inp.step='any'; inp.dataset.item=it['項目'];
      inp.value=(dd.values&&dd.values[it['項目']]!=null)?dd.values[it['項目']]:'';
      inp.addEventListener('change', persistForm);
      row.appendChild(inp);
      const u=document.createElement('span'); u.className='unit'; u.textContent=it['単位']||''; row.appendChild(u);
    }
    form.appendChild(row);
  });

  const h2=document.createElement('div'); h2.className='sec-h auto'; h2.textContent='② 入力不要（自動で入ります）'; form.appendChild(h2);
  autos.forEach(it=>{
    const row=document.createElement('div'); row.className='auto-row';
    const lbl=document.createElement('span'); lbl.className='lbl'; lbl.textContent=it['項目']; row.appendChild(lbl);
    const b=document.createElement('span'); b.className='badge'; b.textContent='入力不要（'+(it.reason||'自動')+'）'; row.appendChild(b);
    form.appendChild(row);
  });
}
function buildDatelist(it){
  const wrap=document.createElement('div'); wrap.className='datelist'; wrap.dataset.item=it['項目'];
  const dd=deptData(curFac,curDept); const arr=(dd.dates&&dd.dates[it['項目']])||[];
  const render=()=>{
    wrap.querySelectorAll('.chip').forEach(c=>c.remove());
    arr.forEach((dval,idx)=>{ const c=document.createElement('span'); c.className='chip'; c.textContent=dval+' ×'; c.title='クリックで削除'; c.onclick=()=>{arr.splice(idx,1);persistForm();render();}; wrap.insertBefore(c, addInp); });
    cnt.textContent=arr.length+'件';
  };
  const addInp=document.createElement('input'); addInp.type='date';
  addInp.addEventListener('change',()=>{ if(addInp.value){ arr.push(addInp.value); addInp.value=''; persistForm(); render(); } });
  wrap.appendChild(addInp);
  const cnt=document.createElement('span'); cnt.className='unit'; wrap.appendChild(cnt);
  wrap._arr=arr;
  render();
  return wrap;
}

/* ---- 保存・書き出し ---- */
function collectForm(){
  const values={}, dates={};
  document.querySelectorAll('#form .inp-row input[type=number]').forEach(inp=>{ if(inp.value!=='') values[inp.dataset.item]=parseFloat(inp.value); });
  document.querySelectorAll('#form .datelist').forEach(w=>{ if(w._arr&&w._arr.length) dates[w.dataset.item]=w._arr.slice(); });
  return {values,dates};
}
function persistForm(){ if(!curFac||!curDept) return; setDeptData(curFac,curDept,collectForm()); }
function flash(msg){ const n=document.getElementById('saved-note'); n.textContent=msg; setTimeout(()=>n.textContent='',2000); }

function download(name,obj){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href);
}
function exportDept(){
  persistForm();
  const dd=deptData(curFac,curDept);
  download(`${curFac}_${curDept}_${curWeek()}.json`, {week:curWeek(),施設:curFac,部署:curDept,...dd});
  flash('書き出しました');
}
function exportAll(){
  persistForm();
  download(`全体会議入力_${curWeek()}.json`, {week:curWeek(),data:loadStore()});
  flash('入力済み全部署を書き出しました');
}
async function sendToServer(){
  persistForm();
  if(!SAVE_ENDPOINT){ alert('サーバー保存先が未設定です。当面は「書き出す」でJSONを保存して送ってください。'); return; }
  const payload={week:curWeek(), data:loadStore()};
  try{
    // GASのCORSプリフライト回避のため text/plain で送る（GASは postData.contents で受ける）
    const r=await fetch(SAVE_ENDPOINT,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
    const j=await r.json().catch(()=>({}));
    flash(j.ok?`サーバーに保存しました（${j.rows||0}行）`:'保存に失敗しました');
  }catch(e){ flash('送信エラー（ネットワーク/エンドポイント要確認）'); }
}
boot();
