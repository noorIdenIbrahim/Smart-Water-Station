/* Maintain dated bookings and the station's explicit operating settings. */
(function(){
'use strict';
document.addEventListener('DOMContentLoaded',()=>{
  const form=document.getElementById('deliveryForm');if(!form)return;
  let schedule={},partners=[];
  const notify=message=>{document.getElementById('scheduleStatus').textContent=message;};
  const perform=async action=>{try{await action();notify('تم الحفظ؛ يعيد برنامج التحليل الحساب تلقائيًا.');}catch(e){notify('تعذّر الحفظ: '+e.message);}};
  function render(){
    const body=document.getElementById('scheduleRows');body.replaceChildren();
    Object.entries(schedule.entries||{}).sort((a,b)=>a[1].delivery_date.localeCompare(b[1].delivery_date)).forEach(([id,b])=>{
      const row=document.createElement('tr');
      [partners.find(p=>p.id===b.partner_id)?.name||b.partner_id,b.delivery_date,b.quantity_m3,b.delivered_m3||0].forEach(v=>{const td=document.createElement('td');td.textContent=v;row.append(td);});
      const td=document.createElement('td');td.textContent=b.status==='cancelled'?'ملغى ':'';
      if(b.status!=='cancelled'){
        const done=document.createElement('button');done.type='button';done.textContent='تحديث المنفذ';
        done.onclick=async()=>{const r=await U.dialog({title:'الكمية المنفذة لهذا الموعد',body:`<label>المنفذ الفعلي (م³)<input name="done" type="number" min="0" max="${Number(b.quantity_m3)}" step="0.001" value="${Number(b.delivered_m3)||0}" required></label>`,buttons:[{text:'إلغاء',value:false},{text:'حفظ',value:true,submit:true}]});if(r.value)perform(async()=>{await DB.update('delivery_schedule/entries/'+id,{delivered_m3:Number(r.data.done)});});};
        const cancel=document.createElement('button');cancel.type='button';cancel.textContent='إلغاء الموعد';cancel.onclick=async()=>{if(await U.confirm({title:'إلغاء الموعد',text:'إلغاء هذا الموعد من خطة السحب؟'}))perform(()=>DB.update('delivery_schedule/entries/'+id,{status:'cancelled'}));};td.append(done,cancel);
      }row.append(td);body.append(row);
    });
  }
  Store.on('partners',list=>{partners=list;const select=document.getElementById('schedulePartner'),old=select.value;select.replaceChildren();for(const p of list.filter(x=>x.status==='paid')){const o=document.createElement('option');o.value=p.id;o.textContent=p.name;select.append(o);}if([...select.options].some(o=>o.value===old))select.value=old;render();});
  DB.listen('delivery_schedule',v=>{schedule=v||{};notify(schedule.schema_version===1?'الجدول مُراجع':'راجع مواعيد العقود وأكد الجدول');render();},5000);
  const settings=document.getElementById('planningSettings');settings.elements.capacity.value=Tank.VOLUME_M3.toFixed(3);settings.elements.reserve.value=CFG.TANK_RESERVE_PCT;
  DB.get('station_settings').then(v=>{if(v){settings.elements.capacity.value=v.tank_capacity_m3;settings.elements.reserve.value=v.reserve_percent;settings.elements.linear.checked=v.level_volume_relation==='linear';}}).catch(()=>notify('تعذّر قراءة إعدادات الخزان'));
  settings.onsubmit=e=>{e.preventDefault();perform(()=>DB.set('station_settings',{tank_capacity_m3:Number(settings.elements.capacity.value),reserve_percent:Number(settings.elements.reserve.value),level_volume_relation:'linear',updated_at:Date.now()}));};
  document.getElementById('confirmSchedule').onclick=()=>perform(()=>DB.update('delivery_schedule',{schema_version:1,reviewed_at:Date.now()}));
  form.onsubmit=e=>{e.preventDefault();perform(async()=>{const d=new FormData(form);await DB.push('delivery_schedule/entries',{partner_id:d.get('partner'),delivery_date:d.get('date'),quantity_m3:Number(d.get('quantity')),delivered_m3:0,status:'scheduled',created_at:Date.now()});});};
});
})();
