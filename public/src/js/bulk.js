// Bulk AI Generator, schedule calculation
import state from './state.js';
import { toast, insEsc, showNotify, showProgress, hideProgress } from './utils.js';

// Bulk Schedule from Drafts
export async function loadBulkDrafts() {
  const el = document.getElementById('bulkDraftList');
  try {
    const r = await fetch('/api/drafts', {credentials:'include'});
    const d = await r.json();
    if (!d.drafts || d.drafts.length === 0) {
      el.innerHTML = '<div class="empty-state">ไม่มีฉบับร่าง — เขียนฉบับร่างก่อน</div>';
      return;
    }
    el.innerHTML = d.drafts.map(dr => '<label style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:var(--bg-input);border-radius:8px;margin-bottom:4px;border:1px solid var(--border);cursor:pointer">' +
      '<input type="checkbox" class="bulk-draft-check" value="' + dr.id + '" data-msg="' + (dr.message || '').replace(/"/g, '&quot;').slice(0, 200) + '" style="margin-top:3px">' +
      '<div style="flex:1;min-width:0"><div style="font-size:0.82rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (dr.message || '').slice(0, 60) + '</div>' +
      '<div style="font-size:0.7rem;color:var(--text-muted)">' + new Date(dr.updated_at).toLocaleString('th-TH',{hour12:false}) + '</div></div></label>').join('');
  } catch(e) { el.innerHTML = '<div class="empty-state">Error</div>'; }
}

// Bulk AI Generator
export function initBulk() {
  // Sync Timer — real-time clock
  var _bulkTimerInterval=null;
  function startBulkSyncTimer(){
    var el=document.getElementById('bulkSyncTimer');
    if(!el)return;
    function tick(){
      var now=new Date();
      el.textContent='🕐 เวลาระบบ: '+now.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    }
    tick();
    if(_bulkTimerInterval)clearInterval(_bulkTimerInterval);
    _bulkTimerInterval=setInterval(tick,1000);
  }
  startBulkSyncTimer();

  // Populate time dropdowns
  var ts=document.getElementById('bulkTimeStart'), te=document.getElementById('bulkTimeEnd');
  for(var h=0;h<24;h++){var v=String(h).padStart(2,'0')+':00'; ts.innerHTML+='<option value="'+v+'">'+v+'</option>'; te.innerHTML+='<option value="'+v+'">'+v+'</option>';}
  ts.value='08:00'; te.value='20:00';
  // Default dates: tomorrow + 7 days
  var tmr=new Date();tmr.setDate(tmr.getDate()+1);
  var end=new Date();end.setDate(end.getDate()+8);
  document.getElementById('bulkDateStart').value=tmr.toISOString().split('T')[0];
  document.getElementById('bulkDateEnd').value=end.toISOString().split('T')[0];
  // Keyword counter
  document.getElementById('bulkKeywords').addEventListener('input',function(){
    var lines=this.value.trim().split('\n').filter(Boolean);
    document.getElementById('bulkKeywordCount').textContent=Math.min(lines.length,10);
  });
  // Frequency detail toggle
  document.querySelectorAll('input[name="bulkFreq"]').forEach(function(r){
    r.addEventListener('change',function(){
      var det=document.getElementById('bulkFreqDetail');
      var unit=document.getElementById('bulkFreqUnit');
      if(this.value==='many'){det.style.display='';unit.textContent='โพส/วัน';document.getElementById('bulkFreqValue').value=3;}
      else if(this.value==='interval'){det.style.display='';unit.textContent='ชม.';document.getElementById('bulkFreqValue').value=3;}
      else{det.style.display='none';}
    });
  });
  // Radio highlight
  document.querySelectorAll('input[name="bulkType"],input[name="bulkFreq"]').forEach(function(r){
    r.addEventListener('change',function(){
      this.closest('div').querySelectorAll('label').forEach(function(l){l.style.borderColor='var(--border)';});
      this.closest('label').style.borderColor='var(--accent)';
    });
  });
}

// _bulkResults stored in state.js
export async function bulkGenerate() {
  var keywords = document.getElementById('bulkKeywords').value.trim().split('\n').filter(Boolean).slice(0,10);
  if(!keywords.length){toast('err','ใส่ keyword อย่างน้อย 1 อัน');return;}
  if(!selectedPage){toast('err','กรุณาเลือกเพจก่อน');return;}
  var type=document.querySelector('input[name="bulkType"]:checked').value;
  var freq=document.querySelector('input[name="bulkFreq"]:checked').value;
  var freqValue=parseInt(document.getElementById('bulkFreqValue').value)||3;
  var dateStart=document.getElementById('bulkDateStart').value;
  var dateEnd=document.getElementById('bulkDateEnd').value;
  var timeStart=document.getElementById('bulkTimeStart').value;
  var timeEnd=document.getElementById('bulkTimeEnd').value;
  if(!dateStart||!dateEnd){toast('err','กรุณาเลือกวันเริ่ม-จบ');return;}
  var statusEl=document.getElementById('bulkGenStatus');
  statusEl.style.display='block';
  // Bulk ใช้ manual progress ตามจำนวน keyword
  var progressEl=document.getElementById('bulkProgress');
  progressEl.classList.add('active');
  var progressBar=progressEl.querySelector('.bar');
  if(progressBar){progressBar.classList.remove('done');progressBar.style.width='0%';}
  _bulkResults=[];
  var previewEl=document.getElementById('bulkPreviewList');
  previewEl.innerHTML='';
  document.getElementById('bulkPreview').style.display='none';
  for(var i=0;i<keywords.length;i++){
    // อัพเดต progress ตามจำนวนที่เสร็จ
    var pct=Math.round(((i)/keywords.length)*100);
    if(progressBar)progressBar.style.width=pct+'%';
    statusEl.textContent='⏳ กำลังสร้าง '+(i+1)+'/'+keywords.length+': '+keywords[i]+'...';
    try{
      // Generate text
      var text='';
      if(type==='text'||type==='text_image'){
        var r=await fetch('/api/ai-write',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:keywords[i],tone:document.getElementById('aiTone')?document.getElementById('aiTone').value:'general',format:'ปานกลาง'})});
        var d=await r.json();
        text=(d.text||'')+((d.hashtags||[]).length?'\n\n'+(d.hashtags||[]).join(' '):'');
      }
      // Generate image
      var imageUrl=null;
      if(type==='text_image'||type==='image'){
        var ir=await fetch('/api/ai-image/generate',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:keywords[i],aspect_ratio:'9:16',mode:'auto'})});
        var id=await ir.json();
        if(id.ok&&id.image_url)imageUrl=id.image_url;
      }
      _bulkResults.push({keyword:keywords[i],text:text,image_url:imageUrl,scheduled_at:null});
    }catch(e){_bulkResults.push({keyword:keywords[i],text:'Error: '+e.message,image_url:null,scheduled_at:null});}
  }
  // Calculate schedule
  var schedules=calculateBulkSchedule(_bulkResults.length,dateStart,dateEnd,timeStart,timeEnd,freq,freqValue);
  for(var j=0;j<_bulkResults.length;j++){_bulkResults[j].scheduled_at=schedules[j]||null;}
  if(progressBar){progressBar.style.width='100%';progressBar.classList.add('done');setTimeout(function(){progressEl.classList.remove('active');progressBar.style.width='0%';progressBar.classList.remove('done');},2000);}
  statusEl.textContent='✅ สร้างเสร็จ '+_bulkResults.length+' โพส!';
  // Render preview
  document.getElementById('bulkPreview').style.display='';
  bulkRenderPreview();
}
export function bulkRenderPreview(){
  var el=document.getElementById('bulkPreviewList');
  var tone=document.querySelector('input[name="bulkFreq"]:checked')?'':'';
  var toneEl=document.getElementById('aiTone');
  var toneName=toneEl?({'general':'ทั่วไป','professional':'ให้ความรู้'}[toneEl.value]||'ทั่วไป'):'ทั่วไป';
  var typeVal=document.querySelector('input[name="bulkType"]:checked');
  var typeName=typeVal?({'text':'Text only','text_image':'Text+Image','image':'Image only'}[typeVal.value]||''):'';
  el.innerHTML=_bulkResults.map(function(r,idx){
    var thumb=r.image_url?'<img src="'+insEsc(r.image_url)+'" style="width:50px;height:50px;border-radius:6px;object-fit:cover;flex-shrink:0;cursor:pointer" onclick="if(this.style.width===\'50px\'){this.style.width=\'200px\';this.style.height=\'auto\';}else{this.style.width=\'50px\';this.style.height=\'50px\';}">':'';
    var preview=insEsc((r.text||'').slice(0,120));
    var full=insEsc(r.text||'');
    // Editable date + time inputs
    var schedDate='',schedTime='';
    if(r.scheduled_at){
      var d=new Date(r.scheduled_at);
      schedDate=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      var roundedMin=Math.round(d.getMinutes()/30)*30;
      if(roundedMin>=60)roundedMin=0;
      schedTime=String(d.getHours()).padStart(2,'0')+':'+String(roundedMin).padStart(2,'0');
    }
    var schedEdit='<div style="display:flex;gap:4px;align-items:center;margin-top:4px;flex-wrap:wrap" onclick="event.stopPropagation()">'+
      '<span style="font-size:0.65rem;color:var(--text-muted)">⏰</span>'+
      '<input type="date" value="'+schedDate+'" onchange="window._bulkUpdateSchedule('+idx+',this.value,null)" style="padding:2px 6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:0.65rem;font-family:inherit;color-scheme:dark">'+
      '<select onchange="window._bulkUpdateSchedule('+idx+',null,this.value)" style="padding:2px 6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:0.65rem;font-family:inherit;color-scheme:dark">'+
      (function(){var opts='';for(var h=0;h<24;h++){for(var m=0;m<60;m+=30){var v=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');opts+='<option value="'+v+'"'+(v===schedTime?' selected':'')+'>'+v+'</option>';}}return opts;})()+
      '</select>'+
      '</div>';
    return '<div style="padding:10px;border-bottom:1px solid var(--border);cursor:pointer" onclick="var f=this.querySelector(\'.bulk-full\');if(f)f.style.display=f.style.display===\'block\'?\'none\':\'block\'">'+
      '<div style="display:flex;gap:8px;align-items:start">'+thumb+
      '<div style="flex:1;min-width:0">'+
      '<div style="display:flex;gap:6px;align-items:center;margin-bottom:2px">'+
      '<span style="font-size:0.72rem;color:var(--accent);font-weight:600">'+insEsc(r.keyword)+'</span>'+
      '<span style="font-size:0.6rem;padding:1px 6px;border-radius:4px;background:rgba(99,102,241,0.15);color:#818cf8">'+toneName+'</span>'+
      '<span style="font-size:0.6rem;padding:1px 6px;border-radius:4px;background:rgba(34,197,94,0.15);color:#4ade80">'+typeName+'</span>'+
      '</div>'+
      '<div style="font-size:0.7rem;color:var(--text-secondary);margin-top:2px">'+preview+(r.text&&r.text.length>120?' <span style="color:var(--accent)">[กดเพื่อดูเต็ม]</span>':'')+'</div>'+
      '<div class="bulk-full" style="display:none;font-size:0.72rem;color:var(--text);margin-top:6px;padding:8px;background:var(--bg);border-radius:6px;white-space:pre-wrap;max-height:200px;overflow-y:auto">'+full+'</div>'+
      schedEdit+
      '</div>'+
      '<button onclick="event.stopPropagation();_bulkResults.splice('+idx+',1);bulkRenderPreview()" style="padding:4px 8px;border:1px solid rgba(239,68,68,0.3);border-radius:4px;background:none;color:#ef4444;font-size:0.65rem;cursor:pointer;flex-shrink:0">✕</button>'+
      '</div></div>';
  }).join('');
  if(!_bulkResults.length)document.getElementById('bulkPreview').style.display='none';
}
// Update schedule for individual bulk preview post
window._bulkUpdateSchedule=function(idx,newDate,newTime){
  if(idx<0||idx>=_bulkResults.length)return;
  var r=_bulkResults[idx];
  var d=r.scheduled_at?new Date(r.scheduled_at):new Date();
  if(newDate){var parts=newDate.split('-');d.setFullYear(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2]));}
  if(newTime){var tp=newTime.split(':');d.setHours(parseInt(tp[0]),parseInt(tp[1]),0,0);}
  r.scheduled_at=d.toISOString();
};
export function calculateBulkSchedule(count,dateStart,dateEnd,timeStart,timeEnd,freq,freqValue){
  var start=new Date(dateStart+'T'+timeStart+':00');
  var end=new Date(dateEnd+'T'+timeEnd+':00');
  // ถ้าวันเริ่มเป็นวันนี้ + เวลาเริ่มผ่านไปแล้ว → เริ่มจาก now + 30 นาที
  var now=new Date();
  var minStart=new Date(now.getTime()+30*60000);
  if(start<minStart) start=minStart;
  if(start>=end){toast('err','เวลาเริ่มต้นผ่านไปแล้ว กรุณาเลือกวัน/เวลาในอนาคต');return[];}
  var results=[];
  if(freq==='1perday'){
    var curDate=new Date(start);
    for(var i=0;i<count;i++){
      var minH=i===0?start.getHours():parseInt(timeStart.split(':')[0]);
      var maxH=parseInt(timeEnd.split(':')[0]);
      var h=minH+Math.floor(Math.random()*(maxH-minH));
      var m=Math.floor(Math.random()*6)*10;
      var day=new Date(curDate);
      day.setHours(h,m,0,0);
      results.push(day.toISOString());
      curDate.setDate(curDate.getDate()+1);
    }
  }else if(freq==='auto'){
    // Thailand peak hours: 07-09, 11-13, 17-20
    var peakHours=[7,8,9,11,12,13,17,18,19,20];
    var minH=start.getHours(); // start ถูกเลื่อนเป็น now+30min แล้ว
    var endH=parseInt(timeEnd.split(':')[0]);
    // วันแรก: filter เฉพาะ peak hours ที่ยังไม่ผ่าน
    var todayPeaks=peakHours.filter(function(h){return h>=minH&&h<endH;});
    var allPeaks=peakHours.filter(function(h){return h>=parseInt(timeStart.split(':')[0])&&h<endH;});
    if(!allPeaks.length)allPeaks=[minH];
    var startDate=new Date(start);startDate.setHours(0,0,0,0);
    var endDate=new Date(end);endDate.setHours(0,0,0,0);
    var isFirstDay=true;
    var curDate=new Date(startDate);
    while(results.length<count&&curDate<=endDate){
      var peaks=isFirstDay?todayPeaks:allPeaks;
      for(var p=0;p<peaks.length&&results.length<count;p++){
        var day=new Date(curDate);
        day.setHours(peaks[p],Math.floor(Math.random()*6)*10,0,0);
        if(day>now)results.push(day.toISOString());
      }
      curDate.setDate(curDate.getDate()+1);
      isFirstDay=false;
    }
  }else if(freq==='many'){
    var perDay=freqValue;
    var curDate=new Date(start);
    var endH=parseInt(timeEnd.split(':')[0]);
    for(var i=0;i<count;i++){
      var slot=i%perDay;
      var dayOffset=Math.floor(i/perDay);
      var d=new Date(curDate.getTime()+dayOffset*86400000);
      var minH=dayOffset===0?start.getHours():parseInt(timeStart.split(':')[0]);
      var h=minH+Math.floor(slot*(endH-minH)/perDay);
      d.setHours(h,0,0,0);
      if(d>now)results.push(d.toISOString());
    }
  }else if(freq==='interval'){
    var intervalMs=freqValue*3600000;
    for(var i=0;i<count;i++){
      results.push(new Date(start.getTime()+i*intervalMs).toISOString());
    }
  }
  return results.sort();
}
export async function bulkConfirmSchedule(){
  if(!_bulkResults.length){toast('err','ไม่มีโพสให้ตั้งเวลา');return;}
  if(!selectedPage){toast('err','กรุณาเลือกเพจก่อน');return;}
  // เตือนถ้ามีเวลาย้อนหลัง
  var now=new Date();
  var pastCount=_bulkResults.filter(function(r){return r.scheduled_at&&new Date(r.scheduled_at)<=now;}).length;
  if(pastCount>0){toast('err','มี '+pastCount+' โพสที่เวลาผ่านไปแล้ว กรุณาเลือกวัน/เวลาที่ยังไม่ผ่าน');return;}
  var posts=_bulkResults.filter(function(r){return r.scheduled_at;}).map(function(r){
    return{message:r.text||'',image_url:r.image_url||null,scheduled_at:r.scheduled_at};
  });
  try{
    var r=await fetch('/api/schedule/bulk',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({posts:posts,page_id:selectedPage.id})});
    var d=await r.json();
    if(d.ok){toast('ok','ตั้งเวลา '+d.scheduled+' โพสสำเร็จ!');_bulkResults=[];document.getElementById('bulkPreview').style.display='none';window.loadSchedule();}
    else{toast('err',d.error||'Error');}
  }catch(e){toast('err','Error: '+e.message);}
}

export async function bulkSchedule() {
  const checks = document.querySelectorAll('.bulk-draft-check:checked');
  const st = document.getElementById('bulkStatus');
  if (!selectedPage) { st.textContent = 'กรุณาเลือกเพจก่อน'; st.className = 'toast err'; return; }
  if (checks.length === 0) { st.textContent = 'เลือกฉบับร่างก่อน'; st.className = 'toast err'; return; }
  const startInput = document.getElementById('bulkStartTime').value;
  if (!startInput) { st.textContent = 'กรุณาเลือกเวลาเริ่มต้น'; st.className = 'toast err'; return; }
  const interval = parseInt(document.getElementById('bulkInterval').value);
  const startTime = new Date(startInput);
  const posts = [];
  checks.forEach((cb, i) => {
    const schedAt = new Date(startTime.getTime() + i * interval * 60000);
    posts.push({ message: cb.dataset.msg, scheduled_at: schedAt.toISOString() });
  });
  try {
    const r = await fetch('/api/schedule/bulk', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ posts, page_id: selectedPage.id }) });
    const d = await r.json();
    if (d.ok) { st.textContent = 'ตั้งเวลา ' + d.scheduled + ' โพสสำเร็จ!'; st.className = 'toast ok'; window.loadSchedule(); window.loadBulkDrafts(); }
    else { st.textContent = d.error || 'Error'; st.className = 'toast err'; }
  } catch(e) { st.textContent = 'Error: ' + e.message; st.className = 'toast err'; }
}
