// Aşık Veysel 2027 Takvimi - Canlı bulut senkronizasyonu (Firebase Firestore)
// Tüm cihazlar tek bir belgeyi (takvim/2027) paylaşır; değişiklikler anında herkese yansır.
(async () => {
  const cfg = window.FIREBASE_CONFIG;
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

  if (!cfg || !cfg.apiKey || String(cfg.apiKey).startsWith('BURAYA')) {
    setBadge('Yerel Mod • Bulut kapalı', 'off');
    return;
  }

  let appMod, fsMod;
  try {
    [appMod, fsMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
    ]);
  } catch (e) {
    setBadge('Bulut yüklenemedi • Yerel Mod', 'err');
    return;
  }

  const { initializeApp } = appMod;
  const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, onSnapshot, setDoc, getDoc, deleteDoc } = fsMod;

  const app = initializeApp(cfg);
  let db;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = initializeFirestore(app, {});
  }
  const ref = doc(db, 'takvim', '2027');
  const clientId = 'c_' + Math.random().toString(36).slice(2, 10);

  // ---- Operasyon dosyaları (sözleşme PDF / fotoğraf): Firestore'da parçalı (chunk) saklanır ----
  // Firebase Storage (kredi kartı gerektirir) yerine ücretsiz Spark planda çalışır.
  const FILE_COL = 'takvim_dosyalar';
  const CHUNK = 700000; // karakter (base64); Firestore belge sınırı 1 MiB
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('zaman aşımı')), ms))]);
  window.__cloudFiles = {
    async upload(fileId, base64, onProgress) {
      const total = Math.max(1, Math.ceil(base64.length / CHUNK));
      for (let i = 0; i < total; i++) {
        await withTimeout(setDoc(doc(db, FILE_COL, `${fileId}__${i}`), {
          fileId, n: i, total, data: base64.slice(i * CHUNK, (i + 1) * CHUNK), updatedAtMs: Date.now()
        }), 60000);
        if (onProgress) onProgress(i + 1, total);
      }
    },
    async download(fileId) {
      const first = await withTimeout(getDoc(doc(db, FILE_COL, `${fileId}__0`)), 30000);
      if (!first.exists()) return null;
      const total = first.data().total || 1;
      const parts = [first.data().data];
      for (let i = 1; i < total; i++) {
        const d = await withTimeout(getDoc(doc(db, FILE_COL, `${fileId}__${i}`)), 30000);
        if (!d.exists()) return null;
        parts.push(d.data().data);
      }
      return parts.join('');
    },
    async remove(fileId) {
      try {
        const first = await withTimeout(getDoc(doc(db, FILE_COL, `${fileId}__0`)), 15000);
        const total = first.exists() ? (first.data().total || 1) : 1;
        for (let i = 0; i < total; i++) await deleteDoc(doc(db, FILE_COL, `${fileId}__${i}`));
      } catch (e) {}
    }
  };
  window.dispatchEvent(new Event('cloud-files-ready'));

  const origSaveEvents = window.saveEventsToStorage;
  const origSaveStamp = window.saveStampRateToStorage;
  let applyingRemote = false;
  const timers = {};

  function eventsPayload() {
    return JSON.stringify(currentEvents.map(ev => ({
      id: ev.id, date: ev.date, name: ev.name, category: ev.category,
      feeRaw: ev.feeRaw, feeValue: ev.feeValue, status: ev.status,
      bookingStatus: ev.bookingStatus || 'Normal', optionColor: ev.optionColor || 'fuchsia',
      stampDutyExempt: Boolean(ev.stampDutyExempt), depositAmount: Number(ev.depositAmount) || 0,
      interimPayment: Number(ev.interimPayment) || 0, invoiceStatus: ev.invoiceStatus || 'Beklemede',
      dueDate: ev.dueDate || '', isFree: ev.isFree,
      // PDF dosyalarının kendisi cihazda kalır; buluta yalnızca bilgisi gider (Firestore 1 MB sınırı)
      invoiceFiles: (Array.isArray(ev.invoiceFiles) ? ev.invoiceFiles : []).map(f => ({
        fileId: f.fileId, name: f.name, size: f.size, uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy
      })),
      opStatus: ev.opStatus || 'Bekliyor', opNote: ev.opNote || '', opChecks: ev.opChecks || {},
      opFiles: (Array.isArray(ev.opFiles) ? ev.opFiles : []).map(f => ({ fileId: f.fileId, name: f.name, size: f.size, mime: f.mime, kind: f.kind, uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy, cloud: Boolean(f.cloud) })),
      updatedBy: ev.updatedBy || currentActor, updatedAt: ev.updatedAt || null
    })));
  }

  function buildPart(part) {
    const base = { clientId, updatedBy: currentActor, updatedAtMs: Date.now() };
    if (part === 'events') return { ...base, eventsJson: eventsPayload() };
    if (part === 'stamp') return { ...base, stampRate: stampDutyRatePermille };
    if (part === 'users') return { ...base, usersJson: JSON.stringify(managedUsers) };
    if (part === 'note') return { ...base, noteText: document.getElementById('teamNoteTextarea').value };
    return base;
  }

  function push(part, delay = 350) {
    if (applyingRemote) return;
    clearTimeout(timers[part]);
    timers[part] = setTimeout(() => {
      setDoc(ref, buildPart(part), { merge: true }).catch(() => setBadge('Kaydedilemedi • Bağlantıyı kontrol edin', 'err'));
    }, delay);
  }

  window.saveEventsToStorage = function (list) { origSaveEvents(list); push('events'); };
  window.saveStampRateToStorage = function (rate) { origSaveStamp(rate); push('stamp'); };
  window.__syncAccessConfigToCloud = function () { push('users'); };
  const noteBtn = document.getElementById('saveTeamNoteBtn');
  if (noteBtn) noteBtn.addEventListener('click', () => { if (canEditSchedule()) push('note', 50); });

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
      if (typeof d.stampRate === 'number') {
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

  let seeded = false;
  onSnapshot(ref, { includeMetadataChanges: true }, snap => {
    if (snap.metadata.fromCache && !snap.exists()) { setBadge('Bağlanıyor…', 'warn'); return; }
    if (!snap.exists()) {
      if (!seeded) {
        seeded = true;
        // İlk kurulum: bu cihazdaki mevcut veriyi buluta yükle
        setDoc(ref, { ...buildPart('events'), ...buildPart('stamp'), ...buildPart('users'), ...buildPart('note') }, { merge: true });
      }
      return;
    }
    seeded = true;
    setBadge(snap.metadata.fromCache ? 'Çevrimdışı • Bağlanınca eşitlenecek' : 'Canlı Senkron Aktif', snap.metadata.fromCache ? 'warn' : 'ok');
    if (snap.metadata.hasPendingWrites) return;
    const d = snap.data();
    if (d.clientId === clientId) return;
    applyRemote(d);
  }, () => setBadge('Bulut hatası • Kuralları kontrol edin', 'err'));
})();
