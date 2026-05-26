'use strict';
let AUTH=null, HAIFU=null, GRAPHS=null, GIDX=[], charts=[], curFac=null, curDept=null, MULTILINE=null;

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
// 追従ヘッダーの高さを CSS変数 --navh に反映（左ペインstickyのtop計算に使う）
function fixNav(){ const h=document.getElementById('stickyhead'); if(h) document.documentElement.style.setProperty('--navh', h.offsetHeight+'px'); }
window.addEventListener('resize', ()=>{ clearTimeout(window._nvT); window._nvT=setTimeout(fixNav,120); });

const norm=s=>String(s).replace(/[\s　（）()／\/、%％・,，。:：]/g,'');
// タブ表示名を短く（データキーは変えない）。()注記は除去、衝突するものだけ短い識別子を残す
const SHORT={
  '藍住 たまき青空クリニック':'藍住クリニック','ハート徳島クリニック（別法人・メディエンス）':'ハート徳島クリニック',
  '特養あおぞら（①②③いずれか該当）':'特養あおぞら','たまき青空 居宅支援':'居宅支援',
  '藍住たまき青空 居宅支援':'藍住居宅支援','たまき青空 訪問看護':'訪問看護',
  '一般病棟（地域包括ケア）':'地域包括ケア','地域包括医療 (60床) ※毎月10日以降':'地域包括医療 ※毎月10日以降',
  'リハビリ（病院）':'リハビリ'
};
function shortLabel(s){ if(SHORT[s])return SHORT[s]; return String(s).replace(/（[^）]*）/g,'').replace(/\([^)]*\)/g,'').trim()||s; }
// 配布資料の項目名を見やすく：内訳（「、」区切りの複数項目を含む（））を字下げの箇条書きに。
// ★複合カッコ対応：「入院（のべ）（新規0、外来57、入院13）」のような“修飾（のべ）＋内訳（…）”でも、
//   内訳＝「top-level『、』を2個以上含む最後の（）グループ」だけを箇条書き化し、修飾は見出しに残す。
// 例 契約者数（医療7名(内自院2)、介護56名(内自院43)）→ 契約者数／・医療7名（内自院2）／・介護56名（内自院43）
function fmtMetricName(name){
  const s=String(name);
  const groups=[]; let depth=0, start=-1;                 // top-levelの全角（）グループ範囲を列挙
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(ch==='（'){ if(depth===0) start=i; depth++; }
    else if(ch==='）'){ if(depth>0){ depth--; if(depth===0) groups.push([start,i]); } }
  }
  let bg=null;                                            // 内訳＝top-level区切りで2個以上に割れる最後の（）
  for(const [a,b] of groups){
    const inner=s.slice(a+1,b);
    let d=0, buf='', parts=[];                             // ①「、」区切り優先
    for(const ch of inner){
      if(ch==='('||ch==='（') d++; else if(ch===')'||ch==='）') d--;
      if(ch==='、' && d===0){ parts.push(buf); buf=''; } else buf+=ch;
    }
    parts.push(buf);
    if(parts.length<2){                                   // ②「、」で割れない時は「/」区切り（栄養の 外来87/入院0/… 等）
      let d2=0, b2='', p2=[];                              //   分数(10/12)・単位(件/人/日)を誤分割しないため ≥3個 かつ 各部に"文字+数字"
      for(const ch of inner){
        if(ch==='('||ch==='（') d2++; else if(ch===')'||ch==='）') d2--;
        if(ch==='/' && d2===0){ p2.push(b2); b2=''; } else b2+=ch;
      }
      p2.push(b2);
      if(p2.length>=3 && p2.every(x=>/\d/.test(x) && /[^\d\s.\/]/.test(x))) parts=p2;
    }
    if(parts.length>=2) bg={a,b,parts};
  }
  if(!bg) return s;                                       // 内訳なし＝そのまま
  const head=(s.slice(0,bg.a)+s.slice(bg.b+1)).trim();    // 内訳以外＝見出し（修飾 のべ/前月計・国府/藍住 は残す）
  const subs=bg.parts.map(p=>{
    const txt=p.trim().replace(/\(/g,'（').replace(/\)/g,'）')
                      .replace(/(\d+(?:[\/.]\d+)?)/g,'<b style="color:#111">$1</b>');  // 数値を強調
    return `<span style="display:block;padding-left:1.1em;font-size:1em;color:#445;line-height:1.45;text-indent:-.7em">・${txt}</span>`;
  }).join('');
  return `<span>${head}</span>${subs}`;
}
// 複数折れ線グラフが単系列ダッシュボードを代替する部署（単系列は出さない）
// ※透析は2026-05-25に全体/本館/センターの単系列3枚(棒+3か月平均)へ移行＝抑制しない
// ※放射線は総件数/MRI/CTを個別グラフ(復元)＋一般撮影/透視/マンモ/骨密度だけ一括折れ線＝抑制しない（重複なし）
const SUPPRESS_DASHBOARD=new Set([]);
// 病院の部署→dashboardのグラフ部署キー（確定マッピング・誤施設マッチ防止）
const GRAPH_HINT={
  // ★地域包括ケア病棟(60床)と地域包括医療病棟(60床)は同じ物理病棟（移行中の旧名/新名・施設台帳で確認）→同じ60床グラフ
  '一般病棟（地域包括ケア）':'地域包括ケア病棟','地域包括医療 (60床) ※毎月10日以降':'地域包括ケア病棟','療養病棟':'療養病棟',
  '緊急入院':'入退院・救急','手術室':'手術室',
  '放射線':'放射線部','健診':'健診センター',
  '検査':'検査部','薬剤':'薬剤部','栄養':'栄養部','リハビリ（病院）':'リハビリ部','訪問リハビリ':'リハビリ部',
  'リハビリ強化デイケア':'リハビリ部','連携室':'連携室','外来':'外来','リハビリ':'リハビリ部'
};
// ★表示専用：複数のhaifu部署キーを1タブに束ねる（データ層は3キーのまま＝ingest/自動追記が部署名で一致するため統合しない）
const DEPT_GROUPS={'リハビリ':['リハビリ（病院）','訪問リハビリ','リハビリ強化デイケア']};
const GROUP_OF={}; for(const g in DEPT_GROUPS) DEPT_GROUPS[g].forEach(d=>GROUP_OF[d]=g);
function realDepts(fac,dep){ return DEPT_GROUPS[dep] ? DEPT_GROUPS[dep].filter(d=>HAIFU[fac]&&HAIFU[fac][d]) : [dep]; }
function deptItems(fac,dep){ return realDepts(fac,dep).flatMap(d=>(HAIFU[fac]&&HAIFU[fac][d])||[]); }
// ★グラフ表示順ルール（2026-05-25 ルール化）：総数を先頭→区分別の総数→区分別の内訳→率→サブ部署。
//   リハビリ＝のべ(全体総)→外来総→入院総→外来疾患別→入院疾患別→PT/OT/ST稼働率→強化デイケア(総単位/実施/稼働)→訪問(総単位/件数/平均)。
//   ※rehabRankは部分一致includes()。「外来リハビリ総単位数」(総あり)と「外来リハビリ単位数」(疾患別・総なし)は別文字列＝衝突しない。総トークンを先に置く。
const REHAB_ORDER=['のべリハビリ単位数','外来リハビリ総単位数','入院リハビリ総単位数','外来リハビリ単位数','入院リハビリ単位数','PT稼働率','OT稼働率','ST稼働率','強化デイケア　総単位数','のべ実施回数','強化デイケア　稼働率','訪問リハビリ総単位数','のべ訪問リハビリ件数','平均訪問リハビリ件数'];
function rehabRank(t){ for(let i=0;i<REHAB_ORDER.length;i++){ if(String(t).includes(REHAB_ORDER[i])) return i; } return 99; }
// ★★★ グラフ表示順ルール（全部署共通・2026-05-25 統一）。これが「並び順の正」。
//   ① 総数（のべ〇〇/総〇〇/合計/総件数/受診者数/患者数/利用者数/入居者数/訪問総数 等）を先頭
//   ② 年度別累積など総数派生
//   ③ その他の個別指標（CT/MRI/初診数 等）
//   ④ 内訳＝一括折れ線（疾患別/項目別/施設別）
//   ⑤ 率・平均（稼働率/復帰率/割合/回転率/平均/読影率）は最後
//   ※リハビリ統合タブのみ REHAB_ORDER で詳細指定。安定sortなので同順位内は元の並びを維持。
//   ※「内訳(ml)」判定を総数判定より先に行う＝総数語を含む一括折れ線(例 グループホーム訪問人数の内訳)を総数扱いしない。
function gGraphRank(spec){
  const t=String(spec.title||'');
  if(/稼働率|復帰率|占床率|病床利用率|割合|回転率|平均|読影率|達成率|出席率/.test(t)) return 5;     // 率・平均＝最後
  if(spec.kind==='ml' || /内訳|疾患別|項目別|施設別/.test(t)) return 4;                              // 内訳(一括折れ線)
  if(spec.kind==='kenshincum') return 1;                                                            // 年度別累積＝総数の直後
  if(/のべ|総数|総件数|総単位数|総訪問|合計|検査総|受診者数|利用者数|入所者数|入居者数|訪問総数|患者数|総人数/.test(t)) return 0;  // 総数＝先頭
  return 3;                                                                                          // その他の個別指標
}
// グラフタイトルの表示用短縮：先頭の施設名・部署名（タブで分かる冗長分）を1回だけ落とす。データ・並び替えキーは不変（表示のみ）。
function shortTitle(t){
  var s=String(t||'');
  var PREF=['サービス付き高齢者向け住宅　阿波っ子','ショートステイ　阿波っ子','デイサービス　阿波っ子','ヘルパーステーション　阿波っ子',
   'たまき青空居宅介護支援事業所','藍住たまき青空居宅介護支援事業所',
   'リハビリテーション部','放射線部','検査部','薬剤部','栄養部','連携室','健診センター',
   '老健フェニックス','特養　あおぞら','特養あおぞら','ハート徳島','デイケアあいそら','GHふれあい','GHフェニックス',
   'たまき青空　訪問看護','まごころ　訪問介護','たまき青空'];
  for(var i=0;i<PREF.length;i++){ if(s.indexOf(PREF[i])===0){ s=s.slice(PREF[i].length).replace(/^[\s　]+/,''); break; } }
  return s;
}
// 施設キーの正規化（haifuとdashboardで表記差：スペース/（注記）/介護 等を吸収）
function normFac(s){ return String(s).replace(/[\s　]/g,'').replace(/（[^）]*）/g,'').replace(/\([^)]*\)/g,'').replace(/介護/g,''); }
function graphsForFac(fac){
  if(!GRAPHS) return null;
  if(GRAPHS[fac]) return GRAPHS[fac];
  const nf=normFac(fac);
  for(const k in GRAPHS){ if(normFac(k)===nf) return GRAPHS[k]; }
  return null;
}
// 施設内に限定してグラフを探す（全施設横断で別施設のグラフを拾わないため）
function findGraphInFac(itemName, fac){
  const gd=graphsForFac(fac); if(!gd) return null;
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
  if(!HAIFU) HAIFU=await (await fetch('data/haifu.json?v=20260525zz')).json();
  if(!GRAPHS){ GRAPHS=(await (await fetch('data/dashboard.json?v=20260525zz')).json())['施設']; buildGraphIndex(); }
  if(!MULTILINE){ try{ MULTILINE=(await (await fetch('data/multiline_series.json?v=20260525zz')).json())['施設']||{}; }catch(e){ MULTILINE={}; } }
  show('dash');
  // 最新ラベル＝全グラフ系列の末尾ラベルのうち最大の週次日付(YYYY/MM/DD)。最初の1本ではなく全体の最大を見る。
  let latest=''; for(const g of GIDX){ const s=g.o&&g.o.series; if(s&&s.length){ const l=String(s[s.length-1][0]); if(/^\d{4}\/\d{2}\/\d{2}$/.test(l) && l>latest) latest=l; } }
  document.getElementById('week-label').textContent='最新: '+latest;
  const ft=document.getElementById('fac-tabs'); ft.innerHTML='';
  Object.keys(HAIFU).forEach((f)=>{ const b=document.createElement('button'); b.textContent=shortLabel(f); b.dataset.key=f; b.onclick=()=>selFac(f); ft.appendChild(b); });
  selFac(Object.keys(HAIFU)[0]);
}
function selFac(f){
  curFac=f;
  document.querySelectorAll('#fac-tabs button').forEach(b=>b.classList.toggle('active', b.dataset.key===f));
  const dt=document.getElementById('dept-tabs'); dt.innerHTML='';
  const emitted=new Set(); let firstKey=null;
  Object.keys(HAIFU[f]).forEach((d)=>{
    const key=GROUP_OF[d]||d;                 // グループ所属部署は束ねたタブ名に
    if(GROUP_OF[d]){ if(emitted.has(key)) return; emitted.add(key); }
    if(firstKey===null) firstKey=key;
    const b=document.createElement('button'); b.textContent=shortLabel(key); b.dataset.key=key; b.onclick=()=>selDept(key); dt.appendChild(b);
  });
  selDept(firstKey);
  fixNav();  // 部署タブの行数が施設で変わる→追従ヘッダー高さを再計算
}
function selDept(d){
  curDept=d;
  document.querySelectorAll('#dept-tabs button').forEach(b=>b.classList.toggle('active', b.dataset.key===d));
  renderDept();
}

function clearCharts(){ charts.forEach(c=>c.destroy()); charts=[]; }

function renderDept(){
  const items=deptItems(curFac,curDept);   // グループタブは構成3部署の項目を結合
  // 左：配布資料を2列グリッドで（区分なし・基準はタイトル下に小さく）
  const grid=document.getElementById('metric-grid'); grid.innerHTML='';
  const renderCell=(it)=>{
    const cell=document.createElement('div'); cell.className='mcell';
    const hasG=!!findGraphInFac(it['項目'], curFac);
    const lab=document.createElement('div'); lab.className='mlab';
    lab.innerHTML=`<span class="mt">${fmtMetricName(it['項目'])}</span>`+(it['基準']?`<span class="mk">基準: ${it['基準']}</span>`:'')
      +(it['dates']&&it['dates'].length?`<span class="mk dates">日付: ${it['dates'].join('、')}</span>`:'');
    const val=document.createElement('div'); val.className='mv';
    val.textContent=(it['値表示']??'-')+(it['単位']?' '+it['単位']:'');
    cell.appendChild(lab); cell.appendChild(val); grid.appendChild(cell);
  };
  // 栄養：国府／藍住を緑見出しで明確に仕切る（項目名の接頭辞で判定・接頭辞は見出しに出すので項目名から除去）
  if(curDept==='栄養'){
    const grp={'国府':[],'藍住':[],'その他':[]};
    items.forEach(it=>{ const n=it['項目']||''; grp[n.startsWith('国府')?'国府':n.startsWith('藍住')?'藍住':'その他'].push(it); });
    ['国府','藍住','その他'].forEach(k=>{
      if(!grp[k].length) return;
      const hd=document.createElement('div'); hd.className='mkubun'; hd.textContent=k; grid.appendChild(hd);
      grp[k].forEach(it=>{ const it2=(k==='その他')?it:Object.assign({},it,{'項目':(it['項目']||'').replace(/^(国府|藍住)[\s　]*/,'')}); renderCell(it2); });
    });
    renderDeptCharts(items); return;
  }
  // 区分ブロック表示（左右に並べる）：手術＝先週/今週、透析＝本館/センター
  const BLOCKS=['先週の手術','今週の手術予定','本館透析室','センター透析室','リハビリ','リハビリ強化デイケア','訪問リハビリ','その他'];
  if(items.some(it=>BLOCKS.includes(it['区分']))){
    const present=BLOCKS.filter(k=>items.some(it=>it['区分']===k));
    const wrap=document.createElement('div'); wrap.className='surg-wrap';
    present.forEach(kbn=>{
      const col=document.createElement('div'); col.className='surg-col';
      const gi=items.filter(it=>it['区分']===kbn); if(!gi.length) return;
      const sum=gi.find(it=>it['合計']);
      const hd=document.createElement('div'); hd.className='mkubun';
      hd.textContent=kbn+(sum?`　合計 ${sum['値表示']}${sum['単位']||''}`:''); col.appendChild(hd);
      gi.filter(it=>!it['合計']).forEach(it=>{
        const cell=document.createElement('div');
        cell.className='mcell'+(it['レベル']===2?' sub':'')+(it['注記']?' note':'');
        const lab=document.createElement('div'); lab.className='mlab';
        lab.innerHTML=`<span class="mt">${it['注記']?'（'+it['項目']+'）':it['項目']}</span>`;
        const val=document.createElement('div'); val.className='mv';
        val.textContent=(it['値表示']??'-')+(it['単位']?' '+it['単位']:'');
        cell.appendChild(lab); cell.appendChild(val); col.appendChild(cell);
      });
      wrap.appendChild(col);
    });
    grid.appendChild(wrap);
    renderDeptCharts(items); return;  // 表の描画はここで完了（グラフは共通処理へ）
  }
  // 「先週分/前月末/稼働率」の区分があれば原本どおり見出し分け。
  // ※haifuの区分には「計算/入力」等のカテゴリ値も混在するので、その3値のときだけグループ化する。
  const KUBUN=['先週分','前月末','稼働率'];
  if(items.some(it=>KUBUN.includes(it['区分']))){
    const groups={}; items.forEach(it=>{ const k=KUBUN.includes(it['区分'])?it['区分']:'その他'; (groups[k]=groups[k]||[]).push(it); });
    const keys=[...KUBUN.filter(k=>groups[k]), ...(groups['その他']?['その他']:[])];
    keys.forEach(k=>{
      const hd=document.createElement('div'); hd.className='mkubun'; hd.textContent=(k==='稼働率'?'稼働率':k==='その他'?'その他':k+'報告'); grid.appendChild(hd);
      groups[k].forEach(renderCell);
    });
  } else {
    items.forEach(renderCell);
  }
  renderDeptCharts(items);
}
function renderDeptCharts(items){
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
  const gdepts=graphsForFac(curFac);
  if(gdepts){
    if(curDept==='全般' || Object.keys(HAIFU[curFac]).length<=1){
      // 単一部署「全般」の施設（サテライト等）はその施設の全グラフを表示
      for(const d in gdepts) for(const m in gdepts[d]) found.set(m, gdepts[d][m]);
    } else {
      const gk=(GRAPH_HINT[curDept] && gdepts[GRAPH_HINT[curDept]]) ? GRAPH_HINT[curDept] : matchGraphDept(curDept, Object.keys(gdepts));
      if(gk){ for(const m in gdepts[gk]) found.set(m, gdepts[gk][m]); }
    }
  }
  if(!found.size){ items.forEach(it=>{ const g=findGraphInFac(it['項目'], curFac); if(g && !found.has(g.name)) found.set(g.name, g.o); }); }
  // 複数折れ線が代替する部署は単系列ダッシュボードを出さない（透析＝合計/本館/健診センターの3系列で表示）
  if(SUPPRESS_DASHBOARD.has(curDept)) found.clear();
  // グラフ仕様を1リストに集約（複数折れ線＝健診/部屋別手術/透析/リハ疾患別 ＋ 単系列ダッシュボード）。
  // グループタブ（リハビリ）は構成部署すべての複数折れ線を集め、表示順をREHAB_ORDERで整える。
  const mlTitles=new Set(); const specs=[];
  realDepts(curFac, curDept).forEach(d=> multilineFor(curFac, d).forEach(g=>{
    if(g['系列']){ specs.push({kind:'ml', title:g.title, g}); mlTitles.add(norm(g.title)); }
  }));
  found.forEach((o,name)=>{ if(!mlTitles.has(norm(name))) specs.push({kind:'bar', title:name, name, o}); });
  // 健診：のべ受診者数のweekly系列から「年度別累積（4月起点・単月/累積）」チャートを追加（季節変動対策）
  if(curDept==='健診'){
    const nobe=[...found.entries()].find(([n])=>/受診者|健診/.test(n));
    if(nobe) specs.push({kind:'kenshincum', title:'健診受診者数 年度別（4月起点・単月/累積）', series:nobe[1].series});
  }
  // 表示順：リハビリ統合タブのみ専用順、それ以外は全部署共通ルール（総数を先頭→個別→内訳→率/平均）。安定sortで同順位は元の並び維持。
  if(DEPT_GROUPS[curDept]) specs.sort((a,b)=>rehabRank(a.title)-rehabRank(b.title));
  else specs.sort((a,b)=>gGraphRank(a)-gGraphRank(b));
  specs.forEach(s=>{
    const card=document.createElement('div'); card.className='chartcard';
    const h=document.createElement('h3'); h.textContent=shortTitle(s.title); card.appendChild(h);
    if(s.kind==='kenshincum'){   // 年度別ビュー＋単月/累積トグル
      const tg=document.createElement('div'); tg.style.cssText='display:flex;gap:6px;margin:0 0 6px';
      const box=document.createElement('div'); box.className='chartbox'; box.style.height='320px';
      const cv=document.createElement('canvas'); box.appendChild(cv);
      let cur=null, mode='cumulative';
      const draw=()=>{ if(cur){const i=charts.indexOf(cur); if(i>=0)charts.splice(i,1); cur.destroy();} cur=buildKenshinYear(cv, s.series, mode); charts.push(cur); };
      [['累積','cumulative'],['単月','monthly']].forEach(([lbl,m])=>{
        const b=document.createElement('button'); b.textContent=lbl;
        b.style.cssText='padding:3px 12px;border:1px solid #0068c4;border-radius:4px;background:'+(m===mode?'#0068c4':'#fff')+';color:'+(m===mode?'#fff':'#0068c4')+';cursor:pointer;font-size:12px';
        b.onclick=()=>{ mode=m; [...tg.children].forEach(x=>{const on=x===b; x.style.background=on?'#0068c4':'#fff'; x.style.color=on?'#fff':'#0068c4';}); draw(); };
        tg.appendChild(b);
      });
      card.appendChild(tg); card.appendChild(box); wrap.appendChild(card); draw();
      return;
    }
    const box=document.createElement('div'); box.className='chartbox'; if(s.kind==='ml') box.style.height='320px';
    const cv=document.createElement('canvas'); box.appendChild(cv); card.appendChild(box);
    wrap.appendChild(card);
    if(s.kind==='ml') charts.push(buildLineChart(cv, s.g['週ラベル'], s.g['系列'], s.g['右軸']||[]));
    else charts.push(buildChart(cv, {name:s.name, o:s.o}, itemByGraph[s.name]||{}));
  });
  const total=specs.length;
  document.getElementById('charts-title').textContent=`グラフ（週次推移）${total?`　${total}件`:''}`;
  if(!total){ wrap.innerHTML='<p class="nochart">この部署の週次グラフはありません（表の値のみ）。</p>'; }
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
  // 稼働率・復帰率など「100%が上限」の指標はグラフ上限も100%に固定（高止まりの余白で天井が見える）
  const unit=(it&&it['単位'])||'', kj=String((it&&it['基準'])||''), nm=((it&&it['項目'])||'')+'|'+(g.name||'');
  const isPct=/[%％]/.test(unit)||/[%％]/.test(kj)||/稼働率|復帰率|占床率|病床利用率|出席率|達成率/.test(nm);
  const dataMax=Math.max(...vals.filter(v=>typeof v==='number'&&!isNaN(v)));
  // 入居者数・入所者数など「定員が上限」のcount系は Y軸上限=定員（グラフ基準の値）に固定（空き＝余白で見える）
  const gcap=(o.基準 && typeof o.基準.値==='number')?o.基準.値:null;
  const isCapCount=(gcap!=null && !isPct && /入居者数|入所者数|入居|入所/.test(g.name||''));
  const capMax=(isPct && dataMax>=50)?100:(isCapCount ? gcap : null);   // 看護必要度割合(~30%)等の小さい率は対象外
  const nb=niceBounds(vals, kn, capMax);  // 綺麗な下限/上限/目盛り幅（高止まり指標の動きを可視化）
  const yScale=nb?{min:nb.min,max:nb.max,ticks:{stepSize:nb.step,font:{size:9}}}:{beginAtZero:true,ticks:{font:{size:9}}};
  return new Chart(cv,{type:'bar',data:{labels,datasets:ds},
    options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:true,labels:{boxWidth:12,font:{size:10}}}},
      scales:{x:{ticks:{maxTicksLimit:12,autoSkip:true,font:{size:9}}},y:yScale}}});
}
// ★毎回、データ(と基準)の最低値ギリギリを綺麗な数字でY軸下限に。上限にも余白を作る。
// 目盛り幅(step)を 1/2/5×10^n の「いい感じ」値にし、下限=最低値以下の倍数、上限=最大値超の倍数。
// 0を避けない（最低値が0近辺なら下限0）。基準線が隠れないよう基準も範囲に含める。
function niceBounds(vals, kijun, capMax){
  const nums=vals.filter(v=>typeof v==='number' && !isNaN(v));
  if(!nums.length) return null;
  let lo=Math.min(...nums), hi=Math.max(...nums);
  if(kijun!=null){ lo=Math.min(lo,kijun); hi=Math.max(hi,kijun); }
  if(hi===lo) hi=lo+1;
  const niceStep=range=>{ const mag=Math.pow(10,Math.floor(Math.log10(range/4))); const n=(range/4)/mag; return (n<1.5?1:n<3?2:n<7?5:10)*mag; };
  // capMax指定（稼働率等の100%上限）かつ実データが上限以内なら、上限を固定して下限だけ綺麗に丸める
  if(capMax!=null && hi<=capMax){
    const step=niceStep(capMax-lo);
    let min=Math.floor(lo/step)*step; if(min<0) min=0;
    return {min, max:capMax, step};
  }
  const step=niceStep(hi-lo);
  let min=Math.floor(lo/step)*step;
  let max=Math.ceil(hi/step)*step;
  if(max<=hi) max+=step;                 // 上限に必ず余白（上限ギリギリ回避）
  if(min<0) min=0;
  return {min, max, step};
}
// 複数折れ線グループの解決（施設キーの空白差を吸収）→ [{title,週ラベル,系列}, ...]
function multilineFor(fac, dep){
  if(!MULTILINE) return [];
  let facObj=MULTILINE[fac];
  if(!facObj){ const nf=fac.replace(/\s|　/g,''); const k=Object.keys(MULTILINE).find(x=>x.replace(/\s|　/g,'')===nf); facObj=k?MULTILINE[k]:null; }
  return (facObj && facObj[dep]) ? facObj[dep] : [];
}
// 複数折れ線（健診の内訳：各項目を1本の線で・棒や移動平均なし）。
// 系列の大小が混在する時は小さい系列を第2Y軸(右)に振り分けて潰れを防ぐ。
const PALETTE=['#0068c4','#e2001a','#5BA640','#f39c12','#8e44ad','#16a085','#d35400','#2c3e50','#c0392b','#2980b9'];
function buildLineChart(cv, labels, series, rightAxis){
  rightAxis = rightAxis || [];               // 明示指定の第2Y軸系列名（例：運動器）
  const entries=Object.entries(series);
  const maxes=entries.map(([,v])=>Math.max(0,...v.filter(x=>typeof x==='number')));
  const gMax=Math.max(1,...maxes), thr=gMax*0.25;
  const explicit=rightAxis.length>0;
  const autoRight=maxes.some(m=>m<thr) && maxes.some(m=>m>=thr); // 大小混在時のみ自動2軸
  const isRight=(name,i)=> explicit ? rightAxis.includes(name) : (autoRight && maxes[i]<thr);
  const useRight = explicit ? entries.some(([n],i)=>isRight(n,i)) : autoRight;
  const ds=entries.map(([name,vals],i)=>{
    const r=isRight(name,i);
    return {label:name+(r?'（右軸）':''),data:vals,yAxisID:r?'y1':'y',
      borderColor:PALETTE[i%PALETTE.length],backgroundColor:'transparent',
      borderWidth:1.5,pointRadius:0,cubicInterpolationMode:'monotone',tension:.4,spanGaps:true,borderDash:r?[4,3]:[]};
  });
  // 左軸＝綺麗な下限/上限/目盛り（右軸の系列は左軸スケール計算から除外）
  const leftVals=[].concat(...entries.filter(([n],i)=>!isRight(n,i)).map(([,v])=>v));
  const nb=niceBounds(leftVals, null);
  const scales={x:{ticks:{maxTicksLimit:12,autoSkip:true,font:{size:9}}},
    y:nb?{min:nb.min,max:nb.max,position:'left',ticks:{stepSize:nb.step,font:{size:9}}}:{beginAtZero:true,position:'left',ticks:{font:{size:9}}}};
  if(useRight) scales.y1={beginAtZero:true,position:'right',grid:{drawOnChartArea:false},ticks:{font:{size:9}}};
  return new Chart(cv,{type:'line',data:{labels,datasets:ds},
    options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:true,labels:{boxWidth:10,font:{size:9}}}}, scales}});
}
// 健診受診者数の年度別ビュー（4月起点・月次・単月/累積切替）。
// 試算表ダッシュボードの「年度別比較＋単月/累積トグル」概念を健診に適用＝季節変動を年度内累積で吸収し前年同月比を見やすく。
// 各年度=1系列の集合縦棒・青グラデーション（最新濃→最古淡）。mode='cumulative'(累積)/'monthly'(単月)。
function buildKenshinYear(cv, series, mode){
  const byFY={};                                   // fy -> [4月..3月] の月次合計（週次を月集約）
  for(const [lab,v] of series){
    if(typeof v!=='number'||isNaN(v)) continue;
    const p=String(lab).split('/'); if(p.length<2) continue;
    const y=+p[0], m=+p[1]; if(!y||!m) continue;
    const fy=(m>=4)?y:y-1, idx=(m>=4)?m-4:m+8;     // 年度=4月起点・idx 0..11
    (byFY[fy]=byFY[fy]||new Array(12).fill(0))[idx]+=v;
  }
  const fys=Object.keys(byFY).map(Number).sort((a,b)=>b-a).slice(0,6);  // 最新6年度
  const labels=['4月','5月','6月','7月','8月','9月','10月','11月','12月','1月','2月','3月'];
  const ds=fys.map((fy,idx)=>{
    const raw=byFY[fy]; let last=-1; for(let i=0;i<12;i++) if(raw[i]>0) last=i;  // データのある最終月
    let arr;
    if(mode==='cumulative'){ let acc=0; arr=raw.map((v,i)=>{acc+=v; return i<=last?acc:null;}); }
    else { arr=raw.map((v,i)=> i<=last? v : null); }                     // 未到来月はnull（0で誤解させない）
    const t=fys.length<=1?0:idx/(fys.length-1);
    const col=`hsl(210,${70-t*35}%,${25+t*63}%)`;
    return {label:`R${fy-2018}年度`, data:arr, backgroundColor:col, borderColor:col, borderWidth:1};
  });
  return new Chart(cv,{type:'bar',data:{labels,datasets:ds},
    options:{responsive:true,maintainAspectRatio:false,animation:false,spanGaps:true,
      plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:12,font:{size:10}}}},
      scales:{x:{ticks:{font:{size:10}}},y:{beginAtZero:true,ticks:{font:{size:9}}}}}});
}
boot();
