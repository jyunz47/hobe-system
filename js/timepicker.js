// ══════════════════════════════════════════════════════════════
// 共用時間選擇器（2026-08-27）
// ══════════════════════════════════════════════════════════════
// 【第一版做錯了，記在這裡免得有人又改回去】
// 一開始照日期月曆的邏輯做成「先點小時、再點分鐘」的兩段式格子。老闆的反應是
// 「時間是這樣子選很怪」——**日期需要「月曆」這個空間概念，時間不需要**。
// 而且 0~8 點那幾格補習班永遠用不到，中間還多一個「選一半」的狀態。
//
// 【現在的做法：直接把時間列出來，點一下就選完】
// 營業時間內每 30 分鐘一格（9:00–21:30，26 格）。課的起訖幾乎都落在整點或半點，
// 所以這個粒度一次涵蓋絕大多數情況，而且一頁看得完、不用捲。
// 真的要 18:15 這種再按「更細的時間」切成 15 分鐘一格。
//
// 【一顆面板、很多個入口】
// 跟月曆一樣，整個系統只有一顆 #tp-pop（掛在 body 底下），誰要用就貼到自己旁邊。
// 定位邏輯（pickerPlace／pickerOffScreen）跟月曆共用，邊界行為才會一致。

var tpState={open:false,fine:false,ctx:null};

var TP_START=9*60, TP_END=21*60+30;   // 面板涵蓋的範圍：9:00–21:30（營業時間的聯集）

// 'HH:MM' → 分鐘數；給不出合法值就回 null
function tpToMin(v){
  const m=/^(\d{1,2}):(\d{2})$/.exec(String(v||'').trim());
  if(!m)return null;
  const h=+m[1],mi=+m[2];
  if(h<0||h>23||mi<0||mi>59)return null;
  return h*60+mi;
}
function tpFromMin(t){return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');}

// ── 開在某個錨點旁邊 ──
// opt = {get, pick, clearable}
//   get       ＝ ()=>'HH:MM'，目前選的時間
//   pick      ＝ v=>void，選了之後做什麼
//   clearable ＝ 這個欄位可以留白（例：今日重點的手寫提醒，不填＝整天）→ 多一顆清除鈕
function tpOpenAt(anchor,opt){
  const pop=document.getElementById('tp-pop');
  if(!pop||!anchor||!opt)return;
  tpState.open=true;
  tpState.ctx={get:opt.get,pick:opt.pick,clearable:!!opt.clearable,anchor};
  // 目前的值不是整半點（例：18:15）→ 直接用細格開，不然使用者會看不到自己現在選的是哪一格
  const cur=tpToMin(opt.get&&opt.get());
  tpState.fine=cur!=null&&cur%30!==0;
  pop.classList.add('open');
  tpRender();
  pickerPlace(pop,anchor);
}

// 表單裡的時間欄位
// 用法：<input class="tp-input" readonly value="…" onclick="tpForInput(this)" onchange="…">
// 可留白的欄位加 data-tp-clear（例：今日重點的手寫提醒）
function tpForInput(el){
  if(!el)return;
  if(tpState.open&&tpState.ctx&&tpState.ctx.anchor===el){tpClose();return;}   // 再點一次收起來
  tpOpenAt(el,{clearable:el.hasAttribute('data-tp-clear'),get:()=>el.value,pick:v=>{
    el.value=v;
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.dispatchEvent(new Event('input',{bubbles:true}));   // 有些欄位聽的是 input
  }});
}

function tpClose(){
  const pop=document.getElementById('tp-pop');
  tpState.open=false;tpState.ctx=null;tpState.fine=false;
  if(pop)pop.classList.remove('open');
}

// 點一格＝選完了，直接寫回去並收起來
function tpPick(t){
  const ctx=tpState.ctx;
  tpClose();
  if(ctx&&ctx.pick)ctx.pick(tpFromMin(t));
}

// 清掉（回到「沒指定時間」）
function tpClear(){
  const ctx=tpState.ctx;
  tpClose();
  if(ctx&&ctx.pick)ctx.pick('');
}

// 30 分 ↔ 15 分切換
function tpToggleFine(){tpState.fine=!tpState.fine;tpRender();}

function tpRender(){
  const pop=document.getElementById('tp-pop');
  if(!pop||!tpState.ctx)return;
  const cur=tpToMin(tpState.ctx.get&&tpState.ctx.get());
  const lbl=document.getElementById('tp-cur');
  if(lbl)lbl.textContent=cur!=null?tpFromMin(cur):'未指定';

  // 那一天的營業時段（平日暑假 12:30 開、學期 16:00 開、週末 9:00 開）淡淡標出來當引導
  let biz=null;
  try{
    if(typeof bizHoursOn==='function')biz=bizHoursOn(typeof currentDate!=='undefined'?currentDate:new Date());
  }catch(_){}

  const step=tpState.fine?15:30;
  // 目前的值落在 9:00–21:30 之外（很少見，但別讓它從畫面上消失）→ 把範圍撐開到涵蓋它
  let from=TP_START,to=TP_END;
  if(cur!=null){from=Math.min(from,Math.floor(cur/step)*step);to=Math.max(to,cur);}

  const cells=[];
  for(let t=from;t<=to;t+=step){
    const on=cur===t;
    const inBiz=biz&&t>=biz.start&&t<=biz.end;
    cells.push(`<button type="button" class="tp-cell${on?' sel':''}${inBiz?' biz':''}" onclick="tpPick(${t})">${tpFromMin(t)}</button>`);
  }
  const box=document.getElementById('tp-grid');
  if(box)box.innerHTML=cells.join('');

  const fine=document.getElementById('tp-fine');
  if(fine)fine.textContent=tpState.fine?'回到每 30 分鐘':'更細的時間（每 15 分）';
  const clr=document.getElementById('tp-clear');
  if(clr)clr.style.display=tpState.ctx.clearable?'':'none';
}

// 點面板外面就收起來。錨點自己要放行，不然「點欄位」會變成開了又立刻關
document.addEventListener('click',e=>{
  if(!tpState.open)return;
  const pop=document.getElementById('tp-pop');
  const a=tpState.ctx&&tpState.ctx.anchor;
  if(pop&&pop.contains(e.target))return;
  if(a&&(a===e.target||(a.contains&&a.contains(e.target))))return;
  tpClose();
});

window.addEventListener('keydown',e=>{
  if(!tpState.open)return;
  if(e.key==='Escape'){e.preventDefault();tpClose();}
});

window.addEventListener('scroll',()=>{
  if(!tpState.open)return;
  if(pickerOffScreen(tpState.ctx&&tpState.ctx.anchor)){tpClose();return;}
  pickerPlace(document.getElementById('tp-pop'),tpState.ctx.anchor);
},true);
window.addEventListener('resize',()=>{
  if(tpState.open)pickerPlace(document.getElementById('tp-pop'),tpState.ctx.anchor);
});
