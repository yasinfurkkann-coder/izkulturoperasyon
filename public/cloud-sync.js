// Aşık Veysel 2027 Takvimi - Canlı bulut senkronizasyonu (Netlify Sync API)
// Tüm cihazlar tek bir belgeyi (takvim/2027) paylaşır; değişiklikler anında herkese yansır.
(async () => {
  const badge = document.getElementById('cloudSyncStatusBadge');
  const setBadge = (text, tone) => {
    if (!badge) return;
    const tones = {
      ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      warn: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
      off: 'bg-slate-600/40 text-slate-300 border-slate-500/40',
      err: 'bg-rose-500/15 text-rose-300 border-rose-500/30'
    };
    badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] sm:text-xs font-semibold border ' + (tones[tone] || tones.off);
    badge.textContent = text;
  };

  const API = '/api/state';
  const clientId = 'c_' + Math.random().toString(36).slice(2, 10);

  const origSaveEvents = window.saveEventsToStorage;
  const origSaveStamp = window.saveStampRateToStorage;
  let applyingRemote = false;
  let lastRevision = 0;
  const timers = {};

  async function apiGet() {
    const res = await fetch(API, { cache: 'no-store' });
    if (!res.ok) throw new Error('Durum alınamadı');
    return res.json();
  }

  async function apiPut(body) {
    const res = await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, updatedBy: currentActor, updatedAtMs: Date.now(), ...body })
    });
    if (!res.ok) throw new Error('Kaydedilemedi');
    return res.json();
  }

  function eventsPayload() {
    return JSON.stringify(currentEvents.map(ev => ({
      id: ev.id, date: ev.date, name: ev.name, category: ev.category,
      feeRaw: ev.feeRaw, feeValue: ev.feeValue, status: ev.status,
      bookingStatus: ev.bookingStatus || 'Normal', optionColor: ev.optionColor || 'fuchsia',
      stampDutyExempt: Boolean(ev.stampDutyExempt), depositAmount: Number(ev.depositAmount) || 0,
      interimPayment: Number(ev.interimPayment) || 0, invoiceStatus: ev.invoiceStatus || 'Beklemede',
      dueDate: ev.dueDate || '', isFree: ev.isFree,
      // PDF dosyalarının kendisi cihazda kalır; buluta yalnızca bilgisi gider
      invoiceFiles: (Array.isArray(ev.invoiceFiles) ? ev.invoiceFiles : []).map(f => ({
        fileId: f.fileId, name: f.name, size: f.size, uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy
      })),
      updatedBy: ev.updatedBy || currentActor, updatedAt: ev.updatedAt || null
    })));
  }

  function buildPart(part) {
    if (part === 'events') return { eventsJson: eventsPayload() };
    if (part === 'stamp') return { stampRate: stampDutyRatePermille };
    if (part === 'users') return { usersJson: JSON.stringify(managedUsers) };
    if (part === 'note') return { noteText: document.getElementById('teamNoteTextarea').value };
    return {};
  }

  function push(part, delay = 400) {
    if (applyingRemote) return;
    clearTimeout(timers[part]);
    timers[part] = setTimeout(() => {
      apiPut(buildPart(part))
        .then(d => { if (d && d.rev) lastRevision = d.rev; })
        .catch(() => setBadge('Kaydedilemedi • Bağlantıyı kontrol edin', 'err'));
    }, delay);
  }

  window.saveEventsToStorage = function (list) { origSaveEvents(list); push('events'); };
  window.saveStampRateToStorage = function (rate) { origSaveStamp(rate); push('stamp'); };
  window.__syncAccessConfigToCloud = function () { push('users'); };
  const noteBtn = document.getElementById('saveTeamNoteBtn');
  if (noteBtn) noteBtn.addEventListener('click', () => { if (canEditSchedule()) push('note', 50); });

  function hasData(d) {
    return Boolean(d && (d.eventsJson || d.stampRate != null || d.usersJson || d.noteText != null));
  }

  function applyRemote(d) {
    applyingRemote = true;
    try {
      if (d.eventsJson) {
        const localFiles = {};
        currentEvents.forEach(e => (e.invoiceFiles || []).forEach(f => { localFiles[f.fileId] = f; }));
        const arr = JSON.parse(d.eventsJson).map(ev => ({
          ...ev,
          invoiceFiles: (ev.invoiceFiles || []).map(f => localFiles[f.fileId] ? { ...f, inlineDataUrl: localFiles[f.fileId].inlineDataUrl || '' } : f)
        }));
        if (arr.length) {
          currentEvents = arr.map((it, i) => hydrateEvent(it, i + 1));
          origSaveEvents(currentEvents);
        }
      }
      if (typeof d.stampRate === 'number' && d.stampRate > 0) {
        stampDutyRatePermille = d.stampRate;
        origSaveStamp(d.stampRate);
      }
      if (d.usersJson) {
        const u = JSON.parse(d.usersJson);
        if (Array.isArray(u)) {
          managedUsers = u;
          try { localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(u)); } catch (e) {}
        }
      }
      if (typeof d.noteText === 'string') {
        const ta = document.getElementById('teamNoteTextarea');
        if (ta && document.activeElement !== ta) ta.value = d.noteText;
        try { localStorage.setItem('asik_veysel_2027_ekip_notu', d.noteText); } catch (e) {}
      }
      if (d.updatedBy) lastGlobalEditor = { name: d.updatedBy, updatedAt: d.updatedAtMs || Date.now() };
      renderApp();
    } catch (err) {
      console.error('Bulut verisi uygulanamadı', err);
    } finally {
      applyingRemote = false;
    }
  }

  async function pollOnce() {
    let d;
    try { d = await apiGet(); } catch (e) { return; }
    if (!d || typeof d.rev !== 'number') return;
    if (d.rev === lastRevision) return;
    lastRevision = d.rev;
    if (hasData(d)) {
      applyingRemote = false;
      applyRemote(d);
      setBadge('Canlı Senkron Aktif', 'ok');
    }
  }

  try {
    const d = await apiGet();
    if (hasData(d)) {
      lastRevision = (d && d.rev) || 0;
      applyingRemote = false;
      applyRemote(d);
      setBadge('Canlı Senkron Aktif', 'ok');
    } else {
      // İlk kurulum: bu cihazdaki mevcut veriyi buluta yükle
      const merged = { ...buildPart('events'), ...buildPart('stamp'), ...buildPart('users'), ...buildPart('note') };
      const resp = await apiPut(merged);
      lastRevision = (resp && resp.rev) || 0;
      setBadge('Canlı Senkron Aktif', 'ok');
    }
    setInterval(pollOnce, 4000);
  } catch (e) {
    setBadge('Buluta bağlanılamadı • Yerel Mod', 'err');
  }
})();
