'use strict';
let AUTH=null, SCHEMA=null, curFac=null, curDept=null, RANGES={};
// GAS Web App の /exec URL（input_receiver.gs をデプロイしたもの・2026-05-24設定）。
const SAVE_ENDPOINT='https://script.google.com/macros/s/AKfycbwTUeX5KOi_QIm-c8xgbKvz65FXd6cbhX7ZcNGk5-9mAMeyvLP3rBoFUeS1rRzSiiKCyQ/exec';

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
  'リハビリ（病院）':'リハビリ'
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
// 週セレクトを「今週の月曜／次回の月曜」の2択に（過去週は選ばせない＝過去の修正はClaude Codeで原本修正）
function nextMonday(){ const d=new Date(thisMonday()+'T00:00:00'); d.setDate(d.getDate()+7); return fmtLocal(d); }
function populateWeekOptions(sel){
  const fmtJ=iso=>{ const [y,m,d]=iso.split('-'); return `${y}/${m}/${d}`; };
  const tw=thisMonday(), nx=nextMonday();
  sel.innerHTML='';
  [['今週の月曜',tw],['次回の月曜',nx]].forEach(([lab,iso])=>{
    const o=document.createElement('option'); o.value=iso; o.textContent=`${lab}（${fmtJ(iso)}）`; sel.appendChild(o);
  });
  sel.value=tw;
}

/* ---- localStorage（週ごと）---- */
function storeKey(){ return 'irakai:'+curWeek(); }
function loadStore(){ try{ return JSON.parse(localStorage.getItem(storeKey()))||{}; }catch(e){ return {}; } }
function saveStore(s){ localStorage.setItem(storeKey(), JSON.stringify(s)); }
function cellKey(f,d){ return f+'||'+d; }
function deptData(f,d){ const s=loadStore(); return s[cellKey(f,d)]||{values:{},dates:{}}; }
function setDeptData(f,d,obj){ const s=loadStore(); s[cellKey(f,d)]=obj; saveStore(s); }
function deptHasInput(f,d){ const dd=deptData(f,d); return Object.values(dd.values||{}).some(v=>v!=='' && v!=null) || Object.values(dd.dates||{}).some(a=>a&&a.length); }
/* ---- 提出済み記録（週ごと・サーバー提出した部署を覚えて可視化）---- */
function subKey(){ return 'irakai:sub:'+curWeek(); }
function loadSub(){ try{ return JSON.parse(localStorage.getItem(subKey()))||{}; }catch(e){ return {}; } }
function isSubmitted(f,d){ return !!loadSub()[cellKey(f,d)]; }
function markSubmitted(f,d){ const s=loadSub(); s[cellKey(f,d)]=new Date().toISOString().slice(0,16); localStorage.setItem(subKey(), JSON.stringify(s)); }

/* ---- サーバー受領値の読み戻し（#4）：その週の受領値＋看取り等の直近1年日付を取得し、
   空欄のみプレ表示する（自分の既入力は上書きしない）。看取り日付は前週からの引き継ぎになる。 ---- */
async function fetchReceived(week){
  if(!SAVE_ENDPOINT) return {};
  try{
    const r=await fetch(SAVE_ENDPOINT+'?week='+encodeURIComponent(week));
    const j=await r.json().catch(()=>({}));
    return (j&&j.ok)?(j.data||{}):{};
  }catch(e){ return {}; }
}
function applyReceived(received){
  const store=loadStore();
  Object.keys(received||{}).forEach(k=>{
    const sv=received[k]||{}; const cur=store[k]||{values:{},dates:{}};
    cur.values=cur.values||{}; cur.dates=cur.dates||{};
    // 値：現在空のものだけサーバー値で埋める（入力中/入力済は保持）
    Object.keys(sv.values||{}).forEach(it=>{ const c=cur.values[it]; if(c===undefined||c===null||c==='') cur.values[it]=sv.values[it]; });
    // 日付(看取り等)：現在空ならサーバーの直近1年unionで埋める＝前週からの引き継ぎ
    Object.keys(sv.dates||{}).forEach(it=>{ const c=cur.dates[it]; if(!c||!c.length) cur.dates[it]=sv.dates[it]; });
    store[k]=cur;
  });
  saveStore(store);
}
async function loadReceivedAndRender(label){
  if(typeof setBusy==='function') setBusy(true, label||'サーバーから取得中…');
  try{ applyReceived(await fetchReceived(curWeek())); }
  finally{ if(typeof setBusy==='function') setBusy(false); }
  buildDeptTabs(); renderForm();
}

/* ---- 起動（ログイン不要・入力フォームを直接表示）---- */
async function boot(){
  populateWeekOptions(document.getElementById('week'));
  document.getElementById('week').addEventListener('change', ()=>{ loadReceivedAndRender('週を切替中…'); });
  document.getElementById('save').addEventListener('click', ()=>{ persistForm(); flash('保存しました'); buildDeptTabs(); });
  document.getElementById('export').addEventListener('click', exportDept);
  document.getElementById('export-all').addEventListener('click', exportAll);
  document.getElementById('send').addEventListener('click', sendToServer);
  const sa=document.getElementById('send-all'); if(sa) sa.addEventListener('click', sendAllToServer);
  // 緑「更新」：現在の入力を保存→サーバー受領値を再取得して空欄に反映＋自動計算を再計算（#4/#8）
  const up=document.getElementById('update'); if(up) up.addEventListener('click', async ()=>{ persistForm(); await loadReceivedAndRender('更新中…'); flash('サーバーの受領値を反映しました'); });
  await enter();
}
async function enter(){
  if(!SCHEMA) SCHEMA=await (await fetch('data/input_schema.json?v=20260525zj')).json();
  try{ RANGES=await (await fetch('data/input_ranges.json?v=20260525zj')).json(); }catch(e){ RANGES={}; }
  show('app');
  applyReceived(await fetchReceived(curWeek()));  // サーバー受領値を空欄にプレ表示（看取り日付は前週引き継ぎ）
  const ft=document.getElementById('fac-tabs'); ft.innerHTML='';
  Object.keys(SCHEMA).forEach((f)=>{ const b=document.createElement('button'); b.textContent=shortLabel(f); b.dataset.key=f; b.onclick=()=>selFac(f); ft.appendChild(b); });
  selFac(Object.keys(SCHEMA)[0]);
  applyEntryMode();
}
// URLパラメータでの表示モード切替：
//  ?admin=1        → 「書き出す」ボタンを表示（既定は職員に不要なので非表示）
//  ?dept=透析&fac=… → その1部署だけ表示（職員が自分の部署に直行・全タブで迷わない）
function applyEntryMode(){
  const p=new URLSearchParams(location.search);
  if(p.get('admin')!=='1'){
    // 書き出し＋「全部署提出」は管理者運用→職員には出さない（自分の1部署は「この部署を提出」）
    ['export','export-all','send-all'].forEach(id=>{ const b=document.getElementById(id); if(b) b.style.display='none'; });
  }
  const dq=p.get('dept'); if(!dq) return;
  const dd=decodeURIComponent(dq), fd=p.get('fac')?decodeURIComponent(p.get('fac')):null;
  const m=(s,q)=>s===q||shortLabel(s)===q||s.includes(q)||shortLabel(s).includes(q);
  let hit=null;
  for(const f of Object.keys(SCHEMA)){
    if(fd && !m(f,fd)) continue;
    for(const d of Object.keys(SCHEMA[f])){ if(m(d,dd)){ hit={f,d}; break; } }
    if(hit) break;
  }
  if(!hit) return;
  selFac(hit.f); selDept(hit.d);
  document.getElementById('fac-tabs').style.display='none';
  document.getElementById('dept-tabs').style.display='none';
  document.querySelector('.brand').textContent='入力：'+shortLabel(hit.f)+'｜'+shortLabel(hit.d);
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
    const mark = isSubmitted(curFac,d) ? ' ✅提出済' : (deptHasInput(curFac,d) ? ' ✓入力' : '');
    b.textContent=shortLabel(d)+mark;
    if(isSubmitted(curFac,d)) b.classList.add('submitted');
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

/* ---- 部署内で完結する自動計算（合計/比）をブラウザでその場計算して見せる（#8） ----
   出せない項目（外部報告値・取込時計算）は null を返し「自動計算」バッジ表示にする。 */
function computeAuto(it, vals){
  const nm = it['項目'];
  const num = k => { const v = vals[k]; const f = parseFloat(v); return isNaN(f) ? null : f; };
  const sumPrefix = pre => {
    let s = 0, any = false;
    for (const k in vals) { if (k.startsWith(pre)) { const f = parseFloat(vals[k]); if (!isNaN(f)) { s += f; any = true; } } }
    return any ? s : null;
  };
  if (nm === '合計 外来') return sumPrefix('外来 ');     // リハビリ：外来7疾患の和
  if (nm === '合計 入院') return sumPrefix('入院 ');     // リハビリ：入院7疾患の和
  if (nm.includes('一人あたりの訪問件数')) {            // 訪問リハ：のべ÷出勤
    const a = num('訪問件数（のべ）'), b = num('出勤者数（のべ）');
    return (a != null && b) ? Math.round(a / b * 10) / 10 : null;
  }
  return null;  // それ以外（栄養一人あたり・稼働率・期間集計・外部報告値）は取込時計算＝バッジ表示
}
// 入力変更時に自動計算行の値を更新（その場計算できるものだけ）
function refreshAutoValues(){
  const vals = collectForm().values;
  document.querySelectorAll('#form .auto-row[data-autoitem]').forEach(row => {
    const it = JSON.parse(row.dataset.autoitem);
    const v = computeAuto(it, vals);
    const vs = row.querySelector('.auto-val');
    if (vs) vs.textContent = (v != null) ? (v + (it['単位'] ? ' ' + it['単位'] : '')) : '—';
  });
}

/* ---- フォーム描画 ---- */
function renderForm(){
  const items=SCHEMA[curFac][curDept];
  const dd=deptData(curFac,curDept);
  const form=document.getElementById('form'); form.innerHTML='';
  const inputs=items.filter(x=>x.mode==='input'), notInputs=items.filter(x=>x.mode!=='input');

  // 不足バナー（この部署で未入力の必須項目を目立たせる）
  const banner=document.createElement('div'); banner.id='miss-banner'; form.appendChild(banner);

  const h1=document.createElement('div'); h1.className='sec-h'; h1.textContent='① 入力が必要な項目（先週1週間の実数）'; form.appendChild(h1);
  if(!inputs.length){ const p=document.createElement('div'); p.style.cssText='color:#889;font-size:13px;padding:6px'; p.textContent='（この部署は手入力項目がありません）'; form.appendChild(p); }
  const renderInputRow=(it)=>{
    const row=document.createElement('div'); row.className='inp-row';
    const lbl=document.createElement('span'); lbl.className='lbl'; lbl.textContent=it['項目'];
    if(it['基準']){ const k=document.createElement('span'); k.className='kij'; k.textContent='基準:'+it['基準']; lbl.appendChild(k); }
    row.appendChild(lbl);
    if(it.type==='datelist'){
      row.appendChild(buildDatelist(it));
    }else{
      const inp=document.createElement('input'); inp.type='number'; inp.step='any'; inp.dataset.item=it['項目']; inp.placeholder='先週の実数';
      if(it['区分']==='前月末') inp.dataset.optional='1';  // 前月末は必須でない＝薄赤対象外
      inp.value=(dd.values&&dd.values[it['項目']]!=null)?dd.values[it['項目']]:'';
      const warn=document.createElement('div'); warn.className='val-warn';
      const chk=()=>{ warn.textContent=anomalyMsg(it['項目'], inp.value, it['単位']); };
      inp.addEventListener('change', ()=>{ persistForm(); });
      inp.addEventListener('input', ()=>{ chk(); updateMissingBanner(); refreshAutoValues(); });
      row.appendChild(inp);
      const u=document.createElement('span'); u.className='unit'; u.textContent=it['単位']||''; row.appendChild(u);
      row.appendChild(warn); chk();
    }
    form.appendChild(row);
  };
  // 病棟は先週分(毎週)/前月末(毎月10日以降)に分ける。区分が無い部署は従来どおり一覧
  if(inputs.some(it=>it['区分'])){
    const wk=inputs.filter(it=>it['区分']!=='前月末');  // 先週分＋区分なし
    const mo=inputs.filter(it=>it['区分']==='前月末');
    if(wk.length){ const s=document.createElement('div'); s.className='sub-h'; s.textContent='■ 先週分（毎週入力）'; form.appendChild(s); wk.forEach(renderInputRow); }
    if(mo.length){ const s=document.createElement('div'); s.className='sub-h mo'; s.textContent='■ 前月末報告（毎月10日以降に入力／毎週は不要）'; form.appendChild(s); mo.forEach(renderInputRow); }
  } else {
    inputs.forEach(renderInputRow);
  }

  const h2=document.createElement('div'); h2.className='sec-h auto'; h2.textContent='② 自動計算・入力不要（グレーの項目は入力できません）'; form.appendChild(h2);
  notInputs.forEach(it=>{
    const row=document.createElement('div'); row.className='auto-row';
    const lbl=document.createElement('span'); lbl.className='lbl'; lbl.textContent=it['項目']; row.appendChild(lbl);
    if(it.mode==='file'){
      const b=document.createElement('span'); b.className='badge';
      b.textContent='📄 入力不要：「'+(it.file||'記録ファイル')+'」を総務・DX推進室に渡してください';
      b.style.cssText='background:#fff4e5;color:#a05a00;border-color:#f0c890;';
      row.appendChild(b);
    }else{
      const tag=document.createElement('span'); tag.className='auto-tag'; tag.textContent='自動計算';
      tag.title=it.reason||'自動計算'; row.appendChild(tag);
      const vs=document.createElement('span'); vs.className='auto-val';
      row.dataset.autoitem=JSON.stringify(it);   // ★常にタグ付け→入力に応じてrefreshAutoValuesが更新
      const v=computeAuto(it, dd.values||{});
      vs.textContent=(v!=null)?(v+(it['単位']?' '+it['単位']:'')):'—';
      if(v==null) vs.title=it.reason||'取込時に計算';
      row.appendChild(vs);
    }
    form.appendChild(row);
  });
  updateMissingBanner();
  refreshAutoValues();
}
// この部署の未入力の必須項目を、フォーム先頭に目立つバナーで表示（入力に応じてリアルタイム更新）
function updateMissingBanner(){
  const el=document.getElementById('miss-banner'); if(!el) return;
  const miss=requiredMissing();
  // 未入力の必須欄を薄赤に（前月末＝任意は対象外）。入力されたら外れる
  const missSet=new Set(miss);
  document.querySelectorAll('#form .inp-row input[type=number]').forEach(inp=>{
    inp.classList.toggle('miss', !inp.dataset.optional && missSet.has(inp.dataset.item));
  });
  if(!miss.length){
    el.className='miss-ok';
    el.innerHTML='✅ この部署の必須項目はすべて入力済みです。「この部署を提出」できます。';
    return;
  }
  el.className='miss-warn';
  const head=`⚠️ この部署は <b>${miss.length}件</b> の入力が必要です（提出するには全て埋めてください。0でもOK）`;
  const list=miss.slice(0,12).map(m=>`<span class="miss-chip">${m}</span>`).join('')+(miss.length>12?` …ほか${miss.length-12}件`:'');
  el.innerHTML=head+'<div class="miss-list">'+list+'</div>';
}
// 異常値チェック（ソフト警告・提出はブロックしない）：負値／％>100／過去実績から大きく外れた値
function anomalyMsg(item, val, unit){
  if(val===''||val==null) return '';
  const v=parseFloat(val); if(isNaN(v)) return '';
  if(v<0) return '⚠️ 負の値です。入力値を確認してください';
  if((unit==='％'||unit==='%')&&v>100) return '⚠️ ％が100を超えています。入力値を確認してください';
  const r=RANGES[curFac+'||'+curDept+'||'+item];
  if(r){
    const hi=Math.max((r.max||0)*2,(r.p90||0)*3);
    const lo=(r.p10>0)?r.p10/5:-1;
    if(v>hi || (v>0 && lo>0 && v<lo))
      return `⚠️ 入力値を確認してください（例年 ${r.p10}〜${r.p90} 程度）`;
  }
  return '';
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
// 送信中スピナー＋ボタン無効化（二重送信防止）
function setBusy(on, label){
  let ov=document.getElementById('busy-overlay');
  if(on){
    if(!ov){ ov=document.createElement('div'); ov.id='busy-overlay';
      ov.innerHTML='<div class="busy-box"><span class="spinner"></span><span class="busy-label"></span></div>';
      document.body.appendChild(ov); }
    ov.querySelector('.busy-label').textContent=label||'処理中…';
    ov.style.display='flex';
  }else if(ov){ ov.style.display='none'; }
  ['send','send-all','save','update'].forEach(id=>{ const b=document.getElementById(id); if(b) b.disabled=!!on; });
}

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
// この部署の未入力の必須項目（入力モードの数値欄で空のもの）を返す。0はOK・日付リストは任意。
function requiredMissing(){
  const items=(SCHEMA[curFac]&&SCHEMA[curFac][curDept])||[];
  const cur=collectForm().values;
  const miss=[];
  items.forEach(it=>{
    // 前月末（毎月10日以降）の項目は毎週の提出では必須にしない
    if(it.mode==='input' && it.type!=='datelist' && it['区分']!=='前月末'){
      const v=cur[it['項目']];
      if(v===undefined||v===null||v==='') miss.push(it['項目']);
    }
  });
  return miss;
}
// ★提出（サーバー保存）：必須項目が全部埋まっていなければ提出不可。一時保存は別途いつでも可。
async function sendToServer(){
  persistForm();
  if(!SAVE_ENDPOINT){ alert('サーバー保存先が未設定です。当面は「書き出す」でJSONを保存して送ってください。'); return; }
  const miss=requiredMissing();
  if(miss.length){
    alert(`未入力の必須項目が ${miss.length}件 あるため提出できません。\n（0でもよいので数値を入れてください。途中なら「一時保存」を使ってください）\n\n・`+miss.slice(0,20).join('\n・')+(miss.length>20?'\n・…ほか':''));
    return;
  }
  // この部署のみ提出
  const payload={week:curWeek(), data:{[cellKey(curFac,curDept)]:deptData(curFac,curDept)}};
  setBusy(true,'送信中…');
  try{
    const r=await fetch(SAVE_ENDPOINT,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
    const j=await r.json().catch(()=>({}));
    if(j.ok){ markSubmitted(curFac,curDept); buildDeptTabs(); updateMissingBanner(); flash(`提出しました（${shortLabel(curDept)}・${j.rows||0}行）`); }
    else { flash('提出に失敗しました'); alert('提出に失敗しました。もう一度「この部署を提出」を押してください。\n入力した数値は保持されています。'); }
  }catch(e){ flash('送信エラー'); alert('送信に失敗しました（ネットワークをご確認ください）。もう一度提出してください。\n入力した数値は保持されています。'); }
  finally{ setBusy(false); }
}
// ★全部署まとめて提出：今週 入力のある全部署を1リクエストで提出（1人が複数部署を入れた時・管理者運用）。
//   必須未入力がある部署はスキップし、最後に結果を表示。
async function sendAllToServer(){
  persistForm();
  if(!SAVE_ENDPOINT){ alert('サーバー保存先が未設定です。'); return; }
  const store=loadStore();
  const keys=Object.keys(store).filter(k=>{ const d=store[k]; return Object.values(d.values||{}).some(v=>v!==''&&v!=null)||Object.values(d.dates||{}).some(a=>a&&a.length); });
  if(!keys.length){ alert('入力済みの部署がありません。'); return; }
  if(!confirm(`入力済みの ${keys.length}部署 をまとめて提出します。よろしいですか？\n（各部署の必須チェックは個別提出時に行ってください。ここは入力済みデータをそのまま送ります）`)) return;
  const data={}; keys.forEach(k=>{ data[k]=store[k]; });
  setBusy(true,'全部署を送信中…');
  try{
    const r=await fetch(SAVE_ENDPOINT,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({week:curWeek(), data})});
    const j=await r.json().catch(()=>({}));
    if(j.ok){ keys.forEach(k=>{ const [f,d]=k.split('||'); markSubmitted(f,d); }); buildDeptTabs(); flash(`全部署を提出しました（${keys.length}部署・${j.rows||0}行）`); }
    else { flash('提出に失敗しました'); alert('提出に失敗しました。もう一度押してください。\n入力した数値は保持されています。'); }
  }catch(e){ flash('送信エラー'); alert('送信に失敗しました（ネットワークをご確認ください）。もう一度提出してください。\n入力した数値は保持されています。'); }
  finally{ setBusy(false); }
}
boot();
