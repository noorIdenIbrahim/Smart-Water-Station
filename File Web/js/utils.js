/* ===== أدوات مشتركة ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/** مخزن بيانات بسيط: الأقسام تشترك فيه وتتحدث عند وصول بيانات جديدة */
const Store = {
  data: {},
  subs: {},
  set(k, v) {
    this.data[k] = v;
    (this.subs[k] || []).forEach(f => { try { f(v); } catch (e) { console.error('[' + k + ']', e); } });
  },
  on(k, f) {
    (this.subs[k] = this.subs[k] || []).push(f);
    if (this.data[k] !== undefined) { try { f(this.data[k]); } catch (e) { console.error('[' + k + ']', e); } }
  },
  get(k, d) { return this.data[k] !== undefined ? this.data[k] : d; }
};

const U = {
  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  num(v, d = 0) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
  pad: n => String(n).padStart(2, '0'),
  nowSec: () => Math.floor(Date.now() / 1000),
  startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); },
  fmtDate(ms) { const d = new Date(ms); return `${U.pad(d.getDate())}/${U.pad(d.getMonth() + 1)}/${d.getFullYear()}`; },
  fmtTime(ms) { const d = new Date(ms); return `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`; },
  fmtDateTime(ms) { return ms ? `${U.fmtDate(ms)} ${U.fmtTime(ms)}` : '—'; },
  toInputDT(ms) { const d = new Date(ms); return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}T${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`; },

  /** كائن Firebase {id: {...}} إلى مصفوفة */
  toList(o) {
    if (!o || typeof o !== 'object') return [];
    return Object.entries(o)
      .filter(([, v]) => v && typeof v === 'object')
      .map(([id, v]) => ({ ...v, id }));
  },

  /** استيفاء خطي بين نقاط [[x,y],...] مرتبة تصاعدياً */
  piece(x, pts) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    return pts[pts.length - 1][1];
  },

  toast(msg, type = 'info') {
    const root = $('#toastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 4200);
  },

  /**
   * نافذة منبثقة. تُرجع Promise بالشكل {value, data}
   * buttons: [{text, value, cls, submit}] — submit:true يتحقق من صحة الحقول قبل الإغلاق
   */
  dialog({ title, body = '', buttons, wide = false }) {
    buttons = buttons || [{ text: 'إغلاق', value: false, cls: 'btn-ghost' }];
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'modal-overlay';
      ov.innerHTML = `
        <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
          <div class="modal-head"><h3>${U.esc(title)}</h3><button type="button" class="modal-x" aria-label="إغلاق">×</button></div>
          <form class="modal-body">${body}</form>
          <div class="modal-foot"></div>
        </div>`;
      const form = $('form', ov);
      const foot = $('.modal-foot', ov);
      let primary = null;

      const onKey = e => { if (e.key === 'Escape') close(false); };
      function close(value) {
        const data = Object.fromEntries(new FormData(form).entries());
        document.removeEventListener('keydown', onKey);
        ov.remove();
        resolve({ value, data });
      }
      buttons.forEach(b => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'btn ' + (b.cls || 'btn-ghost');
        el.textContent = b.text;
        el.onclick = () => {
          if (b.submit && !form.reportValidity()) return;
          close(b.value);
        };
        if (b.submit && !primary) primary = el;
        foot.appendChild(el);
      });
      form.addEventListener('submit', e => { e.preventDefault(); if (primary) primary.click(); });
      $('.modal-x', ov).onclick = () => close(false);
      document.addEventListener('keydown', onKey);
      document.body.appendChild(ov);
      const first = $('input,select,textarea', form);
      (first || foot.lastElementChild).focus();
    });
  },

  async confirm({ title, text, okText = 'تأكيد', danger = false }) {
    const r = await U.dialog({
      title,
      body: `<p>${text}</p>`,
      buttons: [
        { text: 'إلغاء', value: false, cls: 'btn-ghost' },
        { text: okText, value: true, cls: danger ? 'btn-danger' : 'btn-primary' }
      ]
    });
    return r.value === true;
  },

  downloadCSV(filename, rows) {
    const csv = rows.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
};
