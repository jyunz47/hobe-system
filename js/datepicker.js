// ══════════════════════════════════════════════════════════════
// 共用日期選擇器（2026-08-27）
// ══════════════════════════════════════════════════════════════
// 【在解什麼】
// 原本全系統的日期都用原生 <input type="date">：長相與點擊手感完全由瀏覽器決定，
// iPad Safari 給的是滾輪式的，一次只看得到一個日期、要轉到定位。老闆的原話是「不好點選」。
//
// 改成自己畫的月曆格 —— 一格一天、標今天、標選中那天，主頁那顆另外標「哪天有課」。
// 互動邏輯照抄桌面日曆側欄那個迷你月曆（dayview.js dvRenderMini，已經用了三個月、
// 手感驗證過），CSS 另寫一份吃 tokens.css（那邊吃的是日曆專屬的深／亮兩套變數）。
//
// 【一顆月曆，很多個入口】
// 整個系統只有一顆 #dp-pop（掛在 body 底下），誰要用就把它「貼」到自己旁邊：
//   · 主頁「📅 選日期」→ dpToggle()：綁 currentDate，選了走 pickDate
//   · 表單欄位         → dpForInput(el)：綁那顆 input 的值，選了寫回去並發 change
// 這樣不管開幾個表單都不會有兩顆月曆在搶，關掉的邏輯也只有一份。
//
// 【錨點定位】
// popover 是 position:fixed，開的時候用 getBoundingClientRect 算位置：預設貼在錨點下方，
// 右邊放不下就往左靠、下面放不下就翻到上方——表單在畫面底部時才不會被切掉。

var dpState={open:false,view:null,ctx:null};

function dpTodayStr(){return toDateStr(new Date());}

// 'YYYY-MM-DD' → Date（給不出合法值就用今天，月曆至少要開得起來）
function dpParse(ds){
  const m=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ds||'').trim());
  return m?new Date(+m[1],+m[2]-1,+m[3]):new Date();
}

// ── 開在某個錨點旁邊 ──
// opt = {get, pick, dots}
//   get  ＝ ()=>'YYYY-MM-DD'，目前選中哪天（決定月曆開在哪個月、哪格標選中）
//   pick ＝ ds=>void，選了之後做什麼
//   dots ＝ 要不要標「那天有幾堂課」（主頁要，表單欄位不需要）
function dpOpenAt(anchor,opt){
  const pop=document.getElementById('dp-pop');
  if(!pop||!anchor||!opt)return;                 // 桌面日曆獨立視窗沒有這塊，直接不理
  dpState.open=true;
  dpState.ctx={get:opt.get,pick:opt.pick,dots:!!opt.dots,anchor};
  const cur=dpParse(opt.get&&opt.get());
  dpState.view=new Date(cur.getFullYear(),cur.getMonth(),1);
  pop.classList.add('open');
  dpRender();
  dpPlace();                                     // 先畫再定位：要拿到真實高度才翻得準
}

// 把一顆浮動面板貼在錨點下方；右邊放不下往左靠，下面放不下翻到上方。
// 日期月曆與時間面板（js/timepicker.js）共用這一支，兩邊的邊界行為才會一致。
function pickerPlace(pop,a){
  if(!pop||!a||!a.getBoundingClientRect)return;
  const r=a.getBoundingClientRect();
  const w=pop.offsetWidth,h=pop.offsetHeight,gap=8,edge=8;
  let left=r.left;
  if(left+w>window.innerWidth-edge)left=r.right-w;      // 靠右對齊錨點
  if(left<edge)left=edge;
  let top=r.bottom+gap;
  if(top+h>window.innerHeight-edge&&r.top-gap-h>edge)top=r.top-gap-h;
  if(top<edge)top=edge;
  pop.style.left=Math.round(left)+'px';
  pop.style.top=Math.round(top)+'px';
}
// 錨點捲出畫面了沒（捲動時要不要把面板收掉）
function pickerOffScreen(a){
  if(!a||!a.getBoundingClientRect)return false;
  const r=a.getBoundingClientRect();
  return r.bottom<0||r.top>window.innerHeight;
}

function dpPlace(){
  pickerPlace(document.getElementById('dp-pop'),dpState.ctx&&dpState.ctx.anchor);
}

// ── 主頁那顆「📅 選日期」──
function dpToggle(){
  if(dpState.open){dpClose();return;}
  const btn=document.getElementById('dp-btn');
  if(!btn)return;
  dpOpenAt(btn,{dots:true,get:()=>toDateStr(currentDate),pick:ds=>pickDate(ds)});
  btn.setAttribute('aria-expanded','true');
  btn.classList.add('on');
}

// ── 表單裡的日期欄位 ──
// 用法：<input class="dp-input" readonly value="…" onclick="dpForInput(this)" onchange="…">
// 選完會把值寫回去並發一個 change 事件，所以原本掛在 onchange 的處理照舊會跑。
function dpForInput(el){
  if(!el)return;
  if(dpState.open&&dpState.ctx&&dpState.ctx.anchor===el){dpClose();return;}   // 再點一次收起來
  dpOpenAt(el,{dots:false,get:()=>el.value,pick:ds=>{
    el.value=ds;
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }});
}

function dpClose(){
  const pop=document.getElementById('dp-pop');
  dpState.open=false;dpState.ctx=null;
  if(pop)pop.classList.remove('open');
  const btn=document.getElementById('dp-btn');
  if(btn){btn.setAttribute('aria-expanded','false');btn.classList.remove('on');}
}

function dpShiftMonth(n){
  if(!dpState.view)return;
  dpState.view=new Date(dpState.view.getFullYear(),dpState.view.getMonth()+n,1);
  dpRender();
}

// 選了就關：一個欄位只挑一天，挑完沒有第二件事要在這裡做
function dpPick(ds){
  const ctx=dpState.ctx;
  dpClose();
  if(ctx&&ctx.pick)ctx.pick(ds);
}

// 主頁的 setDateDisplay() 每次換日期都會呼叫這支。開著的時候要跟著移動到那個月，
// 否則關掉再開會停在舊月份（跟畫面上的日期對不起來）。表單欄位不受影響。
function dpSync(d){
  if(!dpState.open||!dpState.ctx||dpState.ctx.dots!==true)return;
  dpState.view=new Date(d.getFullYear(),d.getMonth(),1);
  dpRender();
}

// 這個月哪幾天有課 → 日期格底下一顆點。資料源跟桌面日曆同一份。
// 未登入、課表還沒載進來、展開器出錯時整段跳過：月曆照樣點得動，只是沒有點。
function dpCountsFor(view){
  const out={};
  if(typeof expandCoursesForRange!=='function')return out;
  try{
    const start=new Date(view.getFullYear(),view.getMonth(),1);
    const end=new Date(view.getFullYear(),view.getMonth()+1,0);
    end.setHours(23,59,59,999);
    const evs=[
      ...expandCoursesForRange(start,end),
      ...(typeof expandMakeupForRange==='function'?expandMakeupForRange(start,end):[]),
    ];
    evs.forEach(e=>{
      if(!e||!e.startDt)return;
      const k=toDateStr(e.startDt);
      if(k)out[k]=(out[k]||0)+1;
    });
  }catch(err){console.warn('[datepicker] 課量統計失敗，月曆照常顯示',err);}
  return out;
}

var DP_DOW=['日','一','二','三','四','五','六'];

function dpRender(){
  const box=document.getElementById('dp-grid');
  if(!box||!dpState.view||!dpState.ctx)return;
  const v=dpState.view,year=v.getFullYear(),month=v.getMonth();
  const lbl=document.getElementById('dp-mon');
  if(lbl)lbl.textContent=`${year} 年 ${month+1} 月`;

  const startDow=new Date(year,month,1).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const prevDays=new Date(year,month,0).getDate();
  const todayStr=dpTodayStr();
  const selStr=toDateStr(dpParse(dpState.ctx.get&&dpState.ctx.get()));
  const counts=dpState.ctx.dots?dpCountsFor(v):{};

  // 固定 6 列 × 7 欄：格數不隨月份長短跳動，換月時面板不會忽高忽低（也不用重新定位）
  const cells=[];
  for(let i=0;i<startDow;i++)cells.push({n:prevDays-startDow+1+i,mute:1,date:new Date(year,month-1,prevDays-startDow+1+i)});
  for(let n=1;n<=daysInMonth;n++)cells.push({n,date:new Date(year,month,n)});
  let tn=1;while(cells.length<42)cells.push({n:tn,mute:1,date:new Date(year,month+1,tn++)});

  const dows=DP_DOW.map(x=>`<div class="dp-dow">${x}</div>`).join('');
  const days=cells.map(c=>{
    const ds=toDateStr(c.date),n=counts[ds]||0;
    const cls='dp-day'+(c.mute?' mute':'')+(ds===selStr?' sel':'')+(ds===todayStr?' today':'');
    const md=`${c.date.getMonth()+1}/${c.date.getDate()}`;
    const tip=dpState.ctx.dots?`${md}${n?`・${n} 堂課`:'・沒有課'}`:md;
    return`<button type="button" class="${cls}" title="${tip}" onclick="dpPick('${ds}')">`
      +`<span class="dp-n">${c.n}</span>${n?'<span class="dp-dot"></span>':''}</button>`;
  }).join('');
  box.innerHTML=dows+days;

  const lg=document.getElementById('dp-legend');
  if(lg)lg.style.display=dpState.ctx.dots?'':'none';   // 表單欄位沒有課量點，圖例也不用出現
}

// 點面板外面就收起來。錨點自己要放行，不然「點按鈕」會變成開了又立刻關
document.addEventListener('click',e=>{
  if(!dpState.open)return;
  const pop=document.getElementById('dp-pop');
  const a=dpState.ctx&&dpState.ctx.anchor;
  if(pop&&pop.contains(e.target))return;
  if(a&&(a===e.target||(a.contains&&a.contains(e.target))))return;
  dpClose();
});

// Esc 收起來。其他 Esc 處理各自有守衛條件，不會互搶
window.addEventListener('keydown',e=>{
  if(!dpState.open)return;
  if(e.key==='Escape'){e.preventDefault();dpClose();}
});

// 捲動／改變視窗大小時跟著錨點走（表單很長時尤其明顯）。錨點捲出畫面就收起來。
window.addEventListener('scroll',()=>{
  if(!dpState.open)return;
  if(pickerOffScreen(dpState.ctx&&dpState.ctx.anchor)){dpClose();return;}
  dpPlace();
},true);
window.addEventListener('resize',()=>{if(dpState.open)dpPlace();});
