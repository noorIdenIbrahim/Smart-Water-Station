/* ===== الاتصال مع Firebase Realtime Database عبر REST ===== */
(function () {
  const base = CFG.FIREBASE_URL.replace(/\/$/, '');
  let online = null;

  function setOnline(v) {
    if (online !== v) {
      online = v;
      window.dispatchEvent(new CustomEvent('db-status', { detail: v }));
    }
    if (v) window.dispatchEvent(new CustomEvent('db-sync', { detail: Date.now() }));
  }

  async function req(method, path, body, query) {
    const url = `${base}/${path}.json${query || ''}`;
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    setOnline(true);
    return res.json();
  }

  window.DB = {
    get: (path, query) => req('GET', path, undefined, query),
    set: (path, value) => req('PUT', path, value),
    update: (path, value) => req('PATCH', path, value),
    remove: (path) => req('DELETE', path),
    async push(path, value) {
      const r = await req('POST', path, value);
      return r.name;
    },

    /** مراقبة مسار بتحديث دوري؛ تُستدعى cb فقط عند تغيّر القيمة */
    listen(path, cb, ms, query) {
      let stop = false, last = null, timer;
      const tick = async () => {
        if (stop) return;
        try {
          const v = await req('GET', path, undefined, query);
          const s = JSON.stringify(v);
          if (s !== last) { last = s; cb(v); }
        } catch (e) {
          setOnline(false);
        }
        timer = setTimeout(tick, ms || CFG.POLL_NORMAL);
      };
      tick();
      return () => { stop = true; clearTimeout(timer); };
    },

    /** آخر N عنصر حسب المفتاح */
    lastN: (n) => `?orderBy=%22%24key%22&limitToLast=${n}`
  };
})();
