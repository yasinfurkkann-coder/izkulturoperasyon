// Aşık Veysel Takvimi - Etkinlik bazlı OPERASYON DOSYASI
// Her etkinliğin kendi klasörü: sözleşmeler (PDF), fotoğraflar (JPEG), durum, kontrol listesi ve operasyon notu.
// Dosya içeriği bu cihazda IndexedDB'de tutulur; Firebase bağlıysa parçalı olarak buluta da yüklenir
// ve diğer cihazlar açtıkça buluttan indirir.
(function () {
  const DB_NAME = 'AsikVeysel_OperasyonDB';
  const STORE = 'ops_files';
  const MAX_PDF = 8 * 1024 * 1024;       // 8 MB
  const MAX_IMG_EDGE = 1800;             // px
  const KEEP_ORIGINAL_BELOW = 900 * 1024; // bu boyutun altındaki JPEG aynen saklanır
  const STATUSES = ['Bekliyor', 'Hazırlanıyor', 'Hazır', 'Tamamlandı'];
  const STATUS_STYLE = {
    'Bekliyor': 'bg-slate-100 text-slate-700 border-slate-300',
    'Hazırlanıyor': 'bg-amber-100 text-amber-900 border-amber-300',
    'Hazır': 'bg-sky-100 text-sky-900 border-sky-300',
    'Tamamlandı': 'bg-emerald-100 text-emerald-900 border-emerald-300'
  };
  const CHECKS = [
    ['sozlesme', 'Sözleşme imzalatılıp tarafımıza iletildi'],
    ['tutanak', 'Salon teslim tutanağı eksiksiz imzalandı'],
    ['temizTeslim', 'Salon temiz teslim edildi'],
    ['temizAlim', 'Salon temiz alındı'],
    ['ekKoltuk', 'Ek koltuk fotoğrafları çekildi']
  ];

  let activeId = null;
  let activeViewer = null;
  const urlCache = {};   // fileId -> blob URL
  const syncState = {};  // fileId -> 'uploading' | 'error'
  const fetching = new Set();

  const esc = v => (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const getEv = id => currentEvents.find(e => e.id === id);
  const cloud = () => window.__cloudFiles || null;
  const sizeText = b => (typeof formatFileSizeKB === 'function' ? formatFileSizeKB(b) : Math.round(b / 1024) + ' KB');

  // ---------------- IndexedDB ----------------
  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB yok'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        if (!e.target.result.objectStoreNames.contains(STORE)) e.target.result.createObjectStore(STORE, { keyPath: 'fileId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idb(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  }
  const dbPut = rec => idb('readwrite', s => s.put(rec)).catch(() => null);
  const dbGet = id => idb('readonly', s => s.get(id)).catch(() => null);
  const dbDel = id => idb('readwrite', s => s.delete(id)).catch(() => null);

  // ---------------- Yardımcılar ----------------
  const blobToBase64 = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  const uid = () => `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const fmtDateTime = ts => { try { return new Date(ts).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } };

  async function prepareImage(file) {
    const isJpeg = /jpe?g$/i.test(file.name) || file.type === 'image/jpeg';
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('görsel okunamadı'));
        im.src = url;
      });
      const w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, MAX_IMG_EDGE / Math.max(w, h));
      if (isJpeg && scale === 1 && file.size <= KEEP_ORIGINAL_BELOW) {
        return { blob: file, mime: 'image/jpeg', name: file.name };
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
      if (!blob) throw new Error('sıkıştırılamadı');
      const base = file.name.replace(/\.[^.]+$/, '') || 'fotograf';
      return { blob, mime: 'image/jpeg', name: `${base}.jpg` };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------------- Durum güncelleme ----------------
  function updateEvent(evId, mutator, rerender = true) {
    currentEvents = currentEvents.map(ev => {
      if (ev.id !== evId) return ev;
      const draft = { ...ev, opFiles: [...(ev.opFiles || [])], opChecks: { ...(ev.opChecks || {}) } };
      mutator(draft);
      return hydrateEvent({ ...draft, updatedBy: currentActor, updatedAt: Date.now() }, evId);
    });
    saveEventsToStorage(currentEvents);
    renderApp();
    if (rerender) renderModal();
  }

  function patchFile(evId, fileId, patch) {
    updateEvent(evId, d => { d.opFiles = d.opFiles.map(f => f.fileId === fileId ? { ...f, ...patch } : f); }, true);
  }

  function requireEdit() {
    if (canEditSchedule()) return true;
    showToast('Dosya eklemek/değiştirmek için yetkili kullanıcı girişi gereklidir.');
    if (typeof openUserAccessModal === 'function') openUserAccessModal();
    return false;
  }

  // ---------------- Bulut eşitleme ----------------
  async function uploadToCloud(evId, fileId) {
    const c = cloud();
    if (!c || syncState[fileId] === 'uploading') return;
    const rec = await dbGet(fileId);
    if (!rec || !rec.blob) return;
    syncState[fileId] = 'uploading';
    renderModal();
    try {
      const b64 = await blobToBase64(rec.blob);
      await c.upload(fileId, b64);
      delete syncState[fileId];
      patchFile(evId, fileId, { cloud: true });
    } catch (e) {
      syncState[fileId] = 'error';
      renderModal();
    }
  }

  async function ensureLocal(meta) {
    const have = await dbGet(meta.fileId);
    if (have && have.blob) return have;
    const c = cloud();
    if (!c || !meta.cloud) return null;
    if (fetching.has(meta.fileId)) return null;
    fetching.add(meta.fileId);
    try {
      const b64 = await c.download(meta.fileId);
      if (!b64) return null;
      const rec = { fileId: meta.fileId, name: meta.name, mime: meta.mime, blob: base64ToBlob(b64, meta.mime) };
      await dbPut(rec);
      return rec;
    } catch (e) {
      return null;
    } finally {
      fetching.delete(meta.fileId);
    }
  }

  async function blobUrlFor(meta) {
    if (urlCache[meta.fileId]) return urlCache[meta.fileId];
    const rec = await ensureLocal(meta);
    if (!rec) return null;
    urlCache[meta.fileId] = URL.createObjectURL(rec.blob);
    return urlCache[meta.fileId];
  }

  // ---------------- Dosya ekleme / silme ----------------
  async function addFiles(evId, fileList, kind) {
    if (!requireEdit()) return;
    const added = [];
    for (const file of Array.from(fileList || [])) {
      try {
        let blob, mime, name;
        if (kind === 'pdf') {
          const ok = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
          if (!ok) { showToast(`"${file.name}" PDF değil, atlandı.`); continue; }
          if (file.size > MAX_PDF) { showToast(`"${file.name}" 8 MB sınırını aşıyor, atlandı.`); continue; }
          blob = file; mime = 'application/pdf'; name = file.name;
        } else {
          if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) { showToast(`"${file.name}" fotoğraf değil, atlandı.`); continue; }
          ({ blob, mime, name } = await prepareImage(file));
        }
        const fileId = uid();
        await dbPut({ fileId, name, mime, blob });
        added.push({ fileId, name, size: blob.size, mime, kind, uploadedAt: Date.now(), uploadedBy: currentActor, cloud: false });
      } catch (e) {
        showToast(`"${file.name}" eklenemedi (${e.message || 'hata'}). iPhone'da HEIC ise "En Uyumlu" biçimi seçin.`);
      }
    }
    if (!added.length) return;
    updateEvent(evId, d => { d.opFiles = [...d.opFiles, ...added]; });
    showToast(`${added.length} dosya operasyon dosyasına eklendi.`);
    if (cloud()) added.forEach(f => uploadToCloud(evId, f.fileId));
  }

  async function removeFile(evId, fileId) {
    if (!requireEdit()) return;
    if (!window.confirm('Bu dosya operasyon dosyasından silinsin mi? (Tüm cihazlardan kaldırılır)')) return;
    await dbDel(fileId);
    if (urlCache[fileId]) { URL.revokeObjectURL(urlCache[fileId]); delete urlCache[fileId]; }
    if (cloud()) cloud().remove(fileId);
    updateEvent(evId, d => { d.opFiles = d.opFiles.filter(f => f.fileId !== fileId); });
    showToast('Dosya silindi.');
  }

  function purgeEventFiles(ev) {
    (ev.opFiles || []).forEach(f => {
      dbDel(f.fileId);
      if (cloud()) cloud().remove(f.fileId);
    });
  }

  // ---------------- Görüntüleyici ----------------
  function ensureViewer() {
    if (document.getElementById('opsViewer')) return;
    const el = document.createElement('div');
    el.id = 'opsViewer';
    el.className = 'fixed inset-0 z-[80] hidden flex-col bg-slate-950/95 no-print';
    el.innerHTML = `
      <div class="flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-900 text-white">
        <div id="opsViewerTitle" class="min-w-0 truncate text-sm font-semibold"></div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" id="opsViewerPrev" class="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-700 hover:bg-slate-600 cursor-pointer">‹</button>
          <button type="button" id="opsViewerNext" class="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-700 hover:bg-slate-600 cursor-pointer">›</button>
          <a id="opsViewerDownload" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 cursor-pointer">İndir</a>
          <a id="opsViewerNewTab" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-700 hover:bg-slate-600 cursor-pointer">Yeni sekme</a>
          <button type="button" id="opsViewerClose" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 cursor-pointer">Kapat</button>
        </div>
      </div>
      <div id="opsViewerBody" class="flex-1 min-h-0 flex items-center justify-center p-2 overflow-auto"></div>`;
    document.body.appendChild(el);
    el.querySelector('#opsViewerClose').addEventListener('click', closeViewer);
    el.querySelector('#opsViewerPrev').addEventListener('click', () => stepViewer(-1));
    el.querySelector('#opsViewerNext').addEventListener('click', () => stepViewer(1));
    document.addEventListener('keydown', e => {
      if (!activeViewer) return;
      if (e.key === 'Escape') closeViewer();
      if (e.key === 'ArrowLeft') stepViewer(-1);
      if (e.key === 'ArrowRight') stepViewer(1);
    });
  }

  async function openViewer(evId, fileId) {
    const ev = getEv(evId);
    if (!ev) return;
    const list = (ev.opFiles || []).filter(f => f.kind === (ev.opFiles.find(x => x.fileId === fileId) || {}).kind);
    const idx = list.findIndex(f => f.fileId === fileId);
    if (idx < 0) return;
    activeViewer = { evId, list, idx };
    ensureViewer();
    await showViewerItem();
  }

  async function showViewerItem() {
    const { list, idx } = activeViewer;
    const meta = list[idx];
    const root = document.getElementById('opsViewer');
    const body = root.querySelector('#opsViewerBody');
    root.querySelector('#opsViewerTitle').textContent = `${meta.name}  (${idx + 1}/${list.length})`;
    root.querySelector('#opsViewerPrev').style.display = list.length > 1 ? '' : 'none';
    root.querySelector('#opsViewerNext').style.display = list.length > 1 ? '' : 'none';
    body.innerHTML = '<div class="text-sm text-slate-300">Yükleniyor…</div>';
    root.classList.remove('hidden'); root.classList.add('flex');
    const url = await blobUrlFor(meta);
    if (!activeViewer || list[activeViewer.idx] !== meta) return;
    if (!url) {
      body.innerHTML = `<div class="max-w-sm text-center text-sm text-slate-200 space-y-2"><p>Bu dosya bu cihazda bulunamadı${meta.cloud ? ' ve buluttan indirilemedi.' : '. Yüklendiği cihazda bulut bağlantısı yoksa diğer cihazlara aktarılamaz.'}</p><p class="text-slate-400">İnternet bağlantınızı kontrol edip tekrar deneyin.</p></div>`;
      return;
    }
    const dl = root.querySelector('#opsViewerDownload');
    dl.href = url; dl.download = meta.name;
    root.querySelector('#opsViewerNewTab').href = url;
    if (meta.kind === 'image') {
      body.innerHTML = `<img src="${url}" alt="${esc(meta.name)}" class="max-w-full max-h-full object-contain rounded-lg" />`;
    } else if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '')) {
      body.innerHTML = `<div class="max-w-sm text-center space-y-3 text-slate-100"><p class="text-sm font-semibold break-words">${esc(meta.name)}</p><p class="text-xs text-slate-400">Telefonda PDF'i görmek için "Yeni sekme" veya "İndir" düğmesini kullanın.</p></div>`;
    } else {
      body.innerHTML = `<iframe src="${url}" class="w-full h-full bg-white rounded-lg" title="${esc(meta.name)}"></iframe>`;
    }
  }

  function stepViewer(d) {
    if (!activeViewer || activeViewer.list.length < 2) return;
    activeViewer.idx = (activeViewer.idx + d + activeViewer.list.length) % activeViewer.list.length;
    showViewerItem();
  }
  function closeViewer() {
    const root = document.getElementById('opsViewer');
    if (root) { root.classList.add('hidden'); root.classList.remove('flex'); root.querySelector('#opsViewerBody').innerHTML = ''; }
    activeViewer = null;
  }

  // ---------------- Ana pencere ----------------
  function ensureModal() {
    if (document.getElementById('opsModal')) return;
    const el = document.createElement('div');
    el.id = 'opsModal';
    el.className = 'fixed inset-0 z-[60] hidden items-end sm:items-center justify-center sm:p-4 bg-slate-900/60 backdrop-blur-xs no-print';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="bg-white sm:rounded-2xl rounded-t-2xl max-w-3xl w-full max-h-[94vh] flex flex-col shadow-card border border-slate-200 overflow-hidden">
        <div class="px-5 py-4 bg-slate-900 text-white flex items-start justify-between gap-3">
          <div class="min-w-0">
            <span class="text-[11px] font-bold uppercase tracking-wider text-indigo-300">Operasyon Dosyası</span>
            <h3 id="opsTitle" class="text-lg font-display font-bold mt-0.5 truncate"></h3>
            <div id="opsSub" class="text-xs text-slate-300 mt-0.5"></div>
          </div>
          <button type="button" id="opsCloseBtn" aria-label="Kapat" class="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div id="opsBody" class="p-4 sm:p-5 overflow-y-auto space-y-5"></div>
        <div class="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button type="button" id="opsCloseFooterBtn" class="px-4 py-2 rounded-xl text-sm font-semibold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer">Kapat</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#opsCloseBtn').addEventListener('click', closeModal);
    el.querySelector('#opsCloseFooterBtn').addEventListener('click', closeModal);
    el.addEventListener('click', e => { if (e.target === el) closeModal(); });
    el.querySelector('#opsBody').addEventListener('click', onBodyClick);
    el.querySelector('#opsBody').addEventListener('change', onBodyChange);
    el.querySelector('#opsBody').addEventListener('focusout', onBodyBlur);
  }

  function openModal(evId) {
    const ev = getEv(evId);
    if (!ev) return;
    ensureModal();
    activeId = evId;
    if (typeof closeDetailModal === 'function') closeDetailModal();
    const m = document.getElementById('opsModal');
    m.classList.remove('hidden'); m.classList.add('flex');
    renderModal();
    // Bulutta olup bu cihazda olmayan fotoğrafları arka planda indir; yüklenmemişleri yükle
    prefetch(evId);
  }
  function closeModal() {
    closeViewer();
    const m = document.getElementById('opsModal');
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    activeId = null;
  }

  async function prefetch(evId) {
    const ev = getEv(evId);
    if (!ev) return;
    for (const f of ev.opFiles || []) {
      if (activeId !== evId) return;
      const have = await dbGet(f.fileId);
      if (have && have.blob) {
        if (!f.cloud && cloud() && canEditSchedule()) uploadToCloud(evId, f.fileId);
      } else if (f.cloud && f.kind === 'image' && cloud()) {
        const rec = await ensureLocal(f);
        if (rec && activeId === evId) renderModal();
      }
    }
  }

  function badge(f) {
    if (syncState[f.fileId] === 'uploading') return '<span class="text-[10px] font-semibold text-amber-700">⏳ Yükleniyor…</span>';
    if (syncState[f.fileId] === 'error') return '<span class="text-[10px] font-semibold text-rose-700">⚠ Buluta yüklenemedi (yeniden denenecek)</span>';
    if (f.cloud) return '<span class="text-[10px] font-semibold text-emerald-700">☁ Tüm cihazlarda</span>';
    return `<span class="text-[10px] font-semibold text-slate-500">${cloud() ? 'Bu cihazda' : 'Yalnızca bu cihazda'}</span>`;
  }

  async function renderModal() {
    const m = document.getElementById('opsModal');
    if (!m || m.classList.contains('hidden')) return;
    const ev = getEv(activeId);
    if (!ev) { closeModal(); return; }
    const canEdit = canEditSchedule();
    const dis = canEdit ? '' : 'disabled';
    const body = m.querySelector('#opsBody');
    const scrollTop = body.scrollTop;
    const activeEl = document.activeElement;
    const keepNote = activeEl && activeEl.id === 'opsNoteArea' ? { v: activeEl.value, s: activeEl.selectionStart } : null;

    m.querySelector('#opsTitle').textContent = ev.name;
    m.querySelector('#opsSub').textContent = `${ev.date} ${ev.weekdayName} • ${ev.category} • ${ev.status}`;

    const checks = ev.opChecks || {};
    const done = CHECKS.filter(([k]) => checks[k]).length;
    const pdfs = (ev.opFiles || []).filter(f => f.kind === 'pdf');
    const imgs = (ev.opFiles || []).filter(f => f.kind === 'image');
    const cloudNote = cloud()
      ? '<div class="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800">☁ Bulut bağlı: eklediğiniz dosyalar diğer cihazlarda da açılır.</div>'
      : '<div class="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">Bulut bağlı değil: dosyalar yalnızca bu cihazda saklanır. Tüm cihazlarda görünmesi için Firebase bağlantısı gerekir.</div>';

    body.innerHTML = `
      ${cloudNote}
      ${canEdit ? '' : '<div class="px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-[11px] text-slate-600">İzleyici modundasınız: dosyaları görebilirsiniz, değiştirmek için kullanıcı girişi yapın.</div>'}

      <section class="grid sm:grid-cols-2 gap-4">
        <div class="space-y-2">
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-700">Operasyon Durumu</label>
          <select id="opsStatusSel" ${dis} class="w-full px-3 py-2 rounded-xl border text-sm font-bold ${STATUS_STYLE[ev.opStatus]} outline-none">
            ${STATUSES.map(s => `<option value="${s}" ${s === ev.opStatus ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 pt-1">Operasyon Notları</label>
          <textarea id="opsNoteArea" ${dis} rows="6" placeholder="Sahne, ses-ışık, kontak kişiler, giriş saatleri, özel istekler…" class="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-indigo-400">${esc(ev.opNote)}</textarea>
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-700">Kontrol Listesi</label>
            <span class="text-xs font-bold text-indigo-700">${done}/${CHECKS.length}</span>
          </div>
          <div class="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div class="h-full bg-indigo-500" style="width:${Math.round(done / CHECKS.length * 100)}%"></div></div>
          <div class="space-y-1.5 pt-1">
            ${CHECKS.map(([k, label]) => `
              <label class="flex items-center gap-2 px-3 py-2 rounded-xl border ${checks[k] ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'} text-sm ${canEdit ? 'cursor-pointer' : ''}">
                <input type="checkbox" data-check="${k}" ${checks[k] ? 'checked' : ''} ${dis} class="w-4 h-4 accent-emerald-600" />
                <span class="${checks[k] ? 'text-emerald-900 font-semibold' : 'text-slate-700'}">${label}</span>
              </label>`).join('')}
          </div>
        </div>
      </section>

      <section class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h4 class="text-sm font-display font-bold text-slate-900">Sözleşmeler ve Belgeler <span class="text-xs font-medium text-slate-400">(PDF • ${pdfs.length})</span></h4>
          ${canEdit ? `<label class="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer">+ PDF Ekle<input type="file" id="opsPdfInput" accept="application/pdf,.pdf" multiple class="hidden" /></label>` : ''}
        </div>
        ${pdfs.length ? pdfs.map(f => `
          <div class="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white">
            <div class="min-w-0">
              <div class="text-sm font-bold text-slate-800 truncate">📄 ${esc(f.name)}</div>
              <div class="text-[11px] text-slate-400">${esc(sizeText(f.size))} • ${esc(f.uploadedBy || '')} • ${esc(fmtDateTime(f.uploadedAt))} • ${badge(f)}</div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button type="button" data-open-file="${f.fileId}" class="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-sky-50 text-sky-800 border border-sky-200 cursor-pointer">Aç</button>
              ${canEdit ? `<button type="button" data-del-file="${f.fileId}" class="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 cursor-pointer">Sil</button>` : ''}
            </div>
          </div>`).join('') : '<div class="p-4 text-center text-xs text-slate-400 rounded-xl border border-dashed border-slate-200">Henüz sözleşme eklenmedi.</div>'}
      </section>

      <section class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h4 class="text-sm font-display font-bold text-slate-900">Fotoğraflar <span class="text-xs font-medium text-slate-400">(JPEG • ${imgs.length})</span></h4>
          ${canEdit ? `<div class="flex items-center gap-1.5">
            <label class="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer">+ Fotoğraf Ekle<input type="file" id="opsImgInput" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg" multiple class="hidden" /></label>
            <label class="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold bg-white hover:bg-indigo-50 text-indigo-800 border border-indigo-200 cursor-pointer">📷 Çek<input type="file" id="opsCamInput" accept="image/*" capture="environment" class="hidden" /></label>
          </div>` : ''}
        </div>
        ${imgs.length ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">${imgs.map(f => `
          <div class="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <button type="button" data-open-file="${f.fileId}" data-thumb="${f.fileId}" class="block w-full aspect-[4/3] bg-slate-100 flex items-center justify-center text-slate-400 text-xs cursor-pointer">${f.cloud ? '☁ Yükleniyor…' : 'Önizleme'}</button>
            <div class="px-2 py-1.5">
              <div class="text-[11px] font-bold text-slate-700 truncate">${esc(f.name)}</div>
              <div class="flex items-center justify-between gap-1">
                <div class="text-[10px] text-slate-400 truncate">${esc(sizeText(f.size))} • ${badge(f)}</div>
                ${canEdit ? `<button type="button" data-del-file="${f.fileId}" class="text-[10px] font-bold text-rose-600 cursor-pointer">Sil</button>` : ''}
              </div>
            </div>
          </div>`).join('')}</div>` : '<div class="p-4 text-center text-xs text-slate-400 rounded-xl border border-dashed border-slate-200">Henüz fotoğraf eklenmedi.</div>'}
      </section>
      <p class="text-[10px] text-slate-400">Fotoğraflar otomatik küçültülür (en fazla ${MAX_IMG_EDGE}px). PDF için sınır 8 MB. Dosyayı yükleyen cihazdan silmek tüm cihazlardan kaldırır.</p>
    `;
    body.scrollTop = scrollTop;
    if (keepNote) {
      const ta = body.querySelector('#opsNoteArea');
      if (ta) { ta.value = keepNote.v; ta.focus(); try { ta.setSelectionRange(keepNote.s, keepNote.s); } catch (e) {} }
    }

    // Küçük resimleri doldur
    for (const f of imgs) {
      const btn = body.querySelector(`[data-thumb="${f.fileId}"]`);
      if (!btn) continue;
      const rec = await dbGet(f.fileId);
      if (rec && rec.blob) {
        if (!urlCache[f.fileId]) urlCache[f.fileId] = URL.createObjectURL(rec.blob);
        btn.innerHTML = `<img src="${urlCache[f.fileId]}" alt="" class="w-full h-full object-cover" />`;
      }
    }
  }

  function onBodyClick(e) {
    const open = e.target.closest('[data-open-file]');
    if (open) { openViewer(activeId, open.dataset.openFile); return; }
    const del = e.target.closest('[data-del-file]');
    if (del) { removeFile(activeId, del.dataset.delFile); }
  }
  function onBodyChange(e) {
    const t = e.target;
    if (t.id === 'opsPdfInput') { addFiles(activeId, t.files, 'pdf'); t.value = ''; return; }
    if (t.id === 'opsImgInput' || t.id === 'opsCamInput') { addFiles(activeId, t.files, 'image'); t.value = ''; return; }
    if (t.id === 'opsStatusSel') {
      if (!requireEdit()) return renderModal();
      updateEvent(activeId, d => { d.opStatus = t.value; });
      return;
    }
    if (t.dataset && t.dataset.check) {
      if (!requireEdit()) return renderModal();
      const key = t.dataset.check;
      updateEvent(activeId, d => { d.opChecks = { ...d.opChecks, [key]: t.checked }; });
    }
  }
  function onBodyBlur(e) {
    if (e.target.id !== 'opsNoteArea' || !canEditSchedule()) return;
    const ev = getEv(activeId);
    if (!ev || ev.opNote === e.target.value) return;
    const val = e.target.value;
    updateEvent(activeId, d => { d.opNote = val; }, false);
    showToast('Operasyon notu kaydedildi.');
  }

  // ---------------- Dışarıya açılan yardımcılar ----------------
  function summaryText(ev) {
    const files = (ev.opFiles || []).length;
    const done = CHECKS.filter(([k]) => (ev.opChecks || {})[k]).length;
    return `${ev.opStatus || 'Bekliyor'} • ${done}/${CHECKS.length} • ${files} dosya`;
  }
  function hasActivity(ev) {
    return (ev.opFiles || []).length > 0 || CHECKS.some(([k]) => (ev.opChecks || {})[k]) || (ev.opStatus && ev.opStatus !== 'Bekliyor') || Boolean(ev.opNote);
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('.open-ops-btn');
    if (b) { e.stopPropagation(); openModal(Number(b.dataset.opsEvId)); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && activeId && !activeViewer) closeModal();
  });
  // Bulut hazır olunca / başka cihazdan veri gelince açık pencereyi tazele
  window.addEventListener('cloud-files-ready', () => { if (activeId) { renderModal(); prefetch(activeId); } });

  const _renderApp = window.renderApp;
  if (typeof _renderApp === 'function') {
    window.renderApp = function () {
      const r = _renderApp.apply(this, arguments);
      if (activeId && document.getElementById('opsModal') && !document.getElementById('opsModal').classList.contains('hidden')) {
        const ae = document.activeElement;
        if (!(ae && ae.id === 'opsNoteArea')) renderModal();
      }
      return r;
    };
  }

  window.__ops = { openModal, summaryText, hasActivity, purgeEventFiles };
  if (typeof window.renderApp === 'function') window.renderApp();
})();
