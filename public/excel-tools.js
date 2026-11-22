// Aşık Veysel 2027 Takvimi - Excel (.xlsx) entegrasyonu
// Dışa aktarma: güncel takvimi formüllü Excel dosyası olarak indirir.
// İçe aktarma: düzenlenmiş Excel'i okuyup kayıtları günceller / yeni kayıt ekler.
(function () {
  const COLS = {
    id: 'ID',
    date: 'Tarih',
    day: 'Gün',
    name: 'Etkinlik / Sanatçı',
    cat: 'Kategori',
    note: 'Not',
    booking: 'Rezervasyon Durumu',
    fee: 'Etkinlik Tutarı (TL)',
    deposit: 'Alınan Teminat (TL)',
    interim: 'Ara Ödemeler (TL)',
    collected: 'Tahsil Edilen (TL)',
    remaining: 'Kalan Tahsilat (TL)',
    rate: 'DV Oranı (‰)',
    stamp: 'Damga Vergisi (TL)',
    net: 'Net Tutar (TL)',
    exempt: 'DV Muaf',
    invoice: 'Fatura Durumu',
    due: 'Ödeme Vadesi',
    pdf: 'PDF Fatura Adedi'
  };
  const ORDER = ['id', 'date', 'day', 'name', 'cat', 'note', 'booking', 'fee', 'deposit', 'interim', 'collected', 'remaining', 'rate', 'stamp', 'net', 'exempt', 'invoice', 'due', 'pdf'];
  const CATS = ['Konser', 'Tiyatro', 'Mezuniyet', 'Kurulum', 'Etkinlik'];
  const BOOKINGS = ['Normal', 'Teminat Alındı', 'Ödeme Alındı', 'Tarih Opsiyonlu'];
  const INVOICES = ['Beklemede', 'Kesildi', 'Muaf'];
  const NUM_FMT = '#,##0.00';
  const MAX_ROW = 500;

  const pad = n => String(n).padStart(2, '0');
  const isoToDot = iso => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) ? iso.split('-').reverse().join('.') : '';

  function colLetter(i) { return String.fromCharCode(65 + i); }
  const L = key => colLetter(ORDER.indexOf(key));

  function setCell(ws, r, c, cell) {
    ws[window.XLSX.utils.encode_cell({ r, c })] = cell;
  }
  const S = v => ({ t: 's', v: String(v == null ? '' : v) });
  const N = (v, z) => ({ t: 'n', v: Number(v) || 0, z: z || undefined });
  const F = (f, v, z) => ({ t: 'n', f, v: Number(v) || 0, z: z || undefined });

  function buildWorkbook(rows) {
    const X = window.XLSX;
    const rate = Number(stampDutyRatePermille) || 0;
    const n = rows.length;
    const ws = {};

    ORDER.forEach((k, c) => setCell(ws, 0, c, S(COLS[k])));

    const lastDataRow = n + 1;
    const totals = { fee: 0, deposit: 0, interim: 0, collected: 0, remaining: 0, stamp: 0, net: 0 };

    rows.forEach((ev, i) => {
      const R = i + 2; // Excel satır numarası
      const m = calculateStampDutyMetrics(ev.feeValue, ev.isFree, ev.stampDutyExempt, stampDutyRatePermille);
      const col = calculateCollectionMetrics(ev);
      const r = i + 1;
      const put = (key, cell) => setCell(ws, r, ORDER.indexOf(key), cell);

      put('id', N(ev.id));
      put('date', S(ev.date));
      put('day', S(ev.weekdayName));
      put('name', S(ev.name));
      put('cat', S(ev.category));
      put('note', S(ev.status));
      put('booking', S(ev.bookingStatus || 'Normal'));
      put('fee', N(ev.feeValue, NUM_FMT));
      put('deposit', N(ev.depositAmount, NUM_FMT));
      put('interim', N(ev.interimPayment, NUM_FMT));
      put('collected', F(`MIN(${L('fee')}${R},${L('deposit')}${R}+${L('interim')}${R})`, col.collected, NUM_FMT));
      put('remaining', F(`${L('fee')}${R}-${L('collected')}${R}`, col.remaining, NUM_FMT));
      put('rate', F(`IF(OR(${L('exempt')}${R}="Evet",${L('fee')}${R}<=0),0,${rate})`, m.effectiveRate, '0.00'));
      put('stamp', F(`${L('fee')}${R}*${L('rate')}${R}/1000`, m.stampDuty, NUM_FMT));
      put('net', F(`${L('fee')}${R}-${L('stamp')}${R}`, m.netAmount, NUM_FMT));
      put('exempt', S(ev.stampDutyExempt ? 'Evet' : 'Hayır'));
      put('invoice', S(ev.invoiceStatus || 'Beklemede'));
      put('due', S(isoToDot(ev.dueDate)));
      put('pdf', N(Array.isArray(ev.invoiceFiles) ? ev.invoiceFiles.length : 0));

      totals.fee += ev.feeValue; totals.deposit += Number(ev.depositAmount) || 0; totals.interim += Number(ev.interimPayment) || 0;
      totals.collected += col.collected; totals.remaining += col.remaining; totals.stamp += m.stampDuty; totals.net += m.netAmount;
    });

    const tr = n + 1;
    setCell(ws, tr, ORDER.indexOf('name'), S('TOPLAM'));
    ['fee', 'deposit', 'interim', 'collected', 'remaining', 'stamp', 'net'].forEach(k => {
      setCell(ws, tr, ORDER.indexOf(k), F(`SUM(${L(k)}2:${L(k)}${lastDataRow})`, totals[k], NUM_FMT));
    });

    ws['!ref'] = `A1:${colLetter(ORDER.length - 1)}${n + 2}`;
    ws['!autofilter'] = { ref: `A1:${colLetter(ORDER.length - 1)}${lastDataRow}` };
    ws['!cols'] = [6, 12, 12, 34, 12, 14, 18, 20, 20, 18, 20, 20, 12, 18, 18, 10, 14, 14, 14].map(w => ({ wch: w }));

    // --- Aylık özet sayfası (Etkinlikler sayfasına formülle bağlı, yıl yıl) ---
    const ms = {};
    const hdr2 = ['Ay', 'Konser', 'Tiyatro', 'Mezuniyet', 'Kurulum', 'Etkinlik', 'Toplam Adet', 'Brüt Tutar (TL)', 'Damga Vergisi (TL)', 'Tahsil Edilen (TL)', 'Kalan Bakiye (TL)', 'Tahsilat %'];
    hdr2.forEach((h, c) => setCell(ms, 0, c, S(h)));
    const rng = key => `Etkinlikler!$${L(key)}$2:$${L(key)}$${MAX_ROW}`;
    const years = [...new Set(rows.map(e => e.year))].sort((a, b) => a - b);
    const pairs = [];
    years.forEach(y => { for (let mi = 0; mi < 12; mi++) pairs.push([y, mi]); });
    const sumTot = { cnt: [0, 0, 0, 0, 0], all: 0, fee: 0, stamp: 0, col: 0, rem: 0 };
    pairs.forEach(([yr, mi], k) => {
      const mm = pad(mi + 1);
      const R = k + 2, r = k + 1;
      const mEv = rows.filter(e => e.monthIndex === mi && e.year === yr);
      const cond = `(MID(${rng('date')},4,2)="${mm}")*(RIGHT(${rng('date')},4)="${yr}")`;
      setCell(ms, r, 0, S(`${MONTHS_TR[mi]} ${yr}`));
      let cntAll = 0;
      CATS.forEach((cat, ci) => {
        const cnt = mEv.filter(e => e.category === cat).length;
        cntAll += cnt; sumTot.cnt[ci] += cnt;
        setCell(ms, r, ci + 1, F(`SUMPRODUCT(${cond}*(${rng('cat')}="${cat}"))`, cnt));
      });
      setCell(ms, r, 6, F(`SUM(B${R}:F${R})`, cntAll));
      let gross = 0, stamp = 0, coll = 0, rem = 0;
      mEv.forEach(e => {
        const mt = calculateStampDutyMetrics(e.feeValue, e.isFree, e.stampDutyExempt, stampDutyRatePermille);
        const cl = calculateCollectionMetrics(e);
        gross += mt.grossAmount; stamp += mt.stampDuty; coll += cl.collected; rem += cl.remaining;
      });
      const sp = key => `SUMPRODUCT(${cond}*${rng(key)})`;
      setCell(ms, r, 7, F(sp('fee'), gross, NUM_FMT));
      setCell(ms, r, 8, F(sp('stamp'), stamp, NUM_FMT));
      setCell(ms, r, 9, F(sp('collected'), coll, NUM_FMT));
      setCell(ms, r, 10, F(sp('remaining'), rem, NUM_FMT));
      setCell(ms, r, 11, F(`IF(H${R}=0,1,J${R}/H${R})`, gross > 0 ? coll / gross : 1, '0.0%'));
      sumTot.all += cntAll; sumTot.fee += gross; sumTot.stamp += stamp; sumTot.col += coll; sumTot.rem += rem;
    });
    const tot = pairs.length;
    const totR = tot + 2;
    setCell(ms, tot + 1, 0, S('TOPLAM'));
    for (let c = 1; c <= 6; c++) {
      const v = c <= 5 ? sumTot.cnt[c - 1] : sumTot.all;
      setCell(ms, tot + 1, c, F(`SUM(${colLetter(c)}2:${colLetter(c)}${tot + 1})`, v));
    }
    [[7, sumTot.fee], [8, sumTot.stamp], [9, sumTot.col], [10, sumTot.rem]].forEach(([c, v]) => {
      setCell(ms, tot + 1, c, F(`SUM(${colLetter(c)}2:${colLetter(c)}${tot + 1})`, v, NUM_FMT));
    });
    setCell(ms, tot + 1, 11, F(`IF(H${totR}=0,1,J${totR}/H${totR})`, sumTot.fee > 0 ? sumTot.col / sumTot.fee : 1, '0.0%'));
    ms['!ref'] = `A1:L${totR}`;
    ms['!cols'] = [16, 9, 9, 11, 10, 9, 12, 20, 20, 20, 20, 12].map(w => ({ wch: w }));

    // --- Okubeni sayfası ---
    const info = [
      ['Aşık Veysel Takvimi - Excel Dosyası'],
      [`Oluşturulma: ${new Date().toLocaleString('tr-TR')}  |  Damga vergisi oranı: ${rate} ‰`],
      [''],
      ['Nasıl kullanılır?'],
      ['1) "Etkinlikler" sayfasında tarih, ad, tutar, teminat, ara ödeme, not, rezervasyon durumu, DV Muaf, fatura durumu ve vade sütunlarını düzenleyebilirsiniz.'],
      ['2) Tahsil Edilen, Kalan, DV Oranı, Damga Vergisi ve Net Tutar sütunları formüllüdür; kendiliğinden hesaplanır.'],
      ['3) Takvimde "Excel\'den Yükle" ile bu dosyayı geri yüklersiniz. ID\'si eşleşen kayıtlar güncellenir, ID\'si boş olan satırlar yeni etkinlik olarak eklenir.'],
      ['4) Excel\'den yükleme kayıt SİLMEZ. Silmek için takvimde kaydı açıp "Kaydı Sil" kullanın.'],
      ['5) Tarih "GG.AA.YYYY" biçiminde olmalıdır (örn: 07.05.2027 veya 14.03.2028). Yıl 2020-2040 arasında olabilir. Kategori: Konser, Tiyatro, Mezuniyet, Kurulum, Etkinlik.'],
      ['6) Rezervasyon Durumu: Normal, Teminat Alındı, Ödeme Alındı, Tarih Opsiyonlu. Fatura Durumu: Beklemede, Kesildi, Muaf. DV Muaf: Evet / Hayır.'],
      ['7) Fatura PDF dosyaları Excel\'e dahil edilmez, yalnızca adedi yazılır.']
    ];
    const rd = {};
    info.forEach((row, i) => setCell(rd, i, 0, S(row[0])));
    rd['!ref'] = `A1:A${info.length}`;
    rd['!cols'] = [{ wch: 150 }];

    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Etkinlikler');
    X.utils.book_append_sheet(wb, ms, 'Aylık Özet');
    X.utils.book_append_sheet(wb, rd, 'Okubeni');
    return wb;
  }

  function download(rows, label) {
    if (!window.XLSX) { showToast('Excel kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edin.'); return; }
    if (!rows.length) { showToast('Dışa aktarılacak kayıt yok.'); return; }
    const d = new Date();
    const yearTag = state.year === 'all' ? 'tum-yillar' : state.year;
    const name = `asik-veysel-${yearTag}-takvim${label ? '-' + label : ''}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
    window.XLSX.writeFile(buildWorkbook(rows), name);
    showToast(`${rows.length} kayıt Excel olarak indirildi.`);
  }

  // ---------- İçe aktarma ----------
  function parseDateAny(v, requireYear) {
    let y, m, d;
    if (v instanceof Date && !isNaN(v)) {
      const t = new Date(v.getTime() + 12 * 3600 * 1000);
      y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
    } else if (typeof v === 'number' && v > 20000) {
      const t = new Date(Math.round((v - 25569) * 86400000));
      y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
    } else {
      const s = String(v || '').trim();
      let mt = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
      if (mt) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
      else if ((mt = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
      else return null;
    }
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
    if (requireYear && (y < 2020 || y > 2040)) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function toNum(v) {
    if (typeof v === 'number') return Math.max(0, Math.round(v * 100) / 100);
    const s = String(v == null ? '' : v).trim();
    if (!s) return 0;
    return Math.max(0, normalizeFeeInput(s, false).feeValue);
  }
  const trMoney = n => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const pick = (val, list, fallback) => {
    const s = String(val || '').trim().toLocaleLowerCase('tr');
    return list.find(x => x.toLocaleLowerCase('tr') === s) || fallback;
  };

  async function importFile(file) {
    if (!canEditSchedule()) {
      showToast('Excel yüklemek için yetkili kullanıcı girişi gereklidir.');
      openUserAccessModal();
      return;
    }
    if (!window.XLSX) { showToast('Excel kütüphanesi yüklenemedi.'); return; }
    let rows;
    try {
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets['Etkinlikler'] || wb.Sheets[wb.SheetNames[0]];
      rows = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
    } catch (e) {
      showToast('Excel dosyası okunamadı.');
      return;
    }

    const next = [...currentEvents];
    let maxId = next.reduce((mx, it) => Math.max(mx, Number(it.id) || 0), 0);
    const ops = [];
    let skipped = 0;

    rows.forEach(r => {
      const rawName = String(r[COLS.name] || '').trim();
      const iso = parseDateAny(r[COLS.date], true);
      const hasId = r[COLS.id] !== '' && r[COLS.id] != null;
      if (!rawName && !iso && !hasId) return; // boş satır veya toplam satırı
      if (String(r[COLS.name]).trim().toLocaleUpperCase('tr') === 'TOPLAM') return;
      if (!rawName || !iso) { skipped++; return; }
      ops.push({ r, iso, rawName, id: hasId ? Number(r[COLS.id]) : null });
    });

    if (!ops.length) { showToast('Yüklenecek geçerli satır bulunamadı.' + (skipped ? ` (${skipped} satır hatalı)` : '')); return; }

    const existingIds = new Set(next.map(e => Number(e.id)));
    const updCount = ops.filter(o => o.id !== null && existingIds.has(o.id)).length;
    const addCount = ops.length - updCount;
    const msg = `${updCount} kayıt güncellenecek, ${addCount} yeni kayıt eklenecek.` + (skipped ? `\n${skipped} hatalı satır atlanacak.` : '') + '\n\nDevam edilsin mi?';
    if (!window.confirm(msg)) return;

    ops.forEach(o => {
      const r = o.r;
      const fee = toNum(r[COLS.fee]);
      const isFree = fee <= 0;
      const [yy, mm, dd] = o.iso.split('-');
      const patch = {
        date: `${dd}.${mm}.${yy}`,
        name: o.rawName,
        category: pick(r[COLS.cat], CATS, 'Konser'),
        status: String(r[COLS.note] || '').trim() || 'EK KOLTUK',
        bookingStatus: pick(r[COLS.booking], BOOKINGS, 'Normal'),
        feeValue: fee,
        feeRaw: isFree ? 'ÜCRETSİZ' : trMoney(fee),
        isFree,
        depositAmount: isFree ? '' : trMoney(toNum(r[COLS.deposit])),
        interimPayment: isFree ? '' : trMoney(toNum(r[COLS.interim])),
        stampDutyExempt: String(r[COLS.exempt] || '').trim().toLocaleLowerCase('tr') === 'evet',
        invoiceStatus: pick(r[COLS.invoice], INVOICES, isFree ? 'Muaf' : 'Beklemede'),
        dueDate: parseDateAny(r[COLS.due], 0) || '',
        updatedBy: currentActor,
        updatedAt: Date.now()
      };
      const idx = o.id !== null ? next.findIndex(e => Number(e.id) === o.id) : -1;
      if (idx >= 0) {
        next[idx] = hydrateEvent({ ...next[idx], ...patch }, next[idx].id);
      } else {
        maxId += 1;
        next.push(hydrateEvent({ id: maxId, invoiceFiles: [], ...patch }, maxId));
      }
    });

    currentEvents = next;
    saveEventsToStorage(currentEvents);
    renderApp();
    showToast(`Excel yüklendi: ${updCount} güncellendi, ${addCount} eklendi.`);
  }

  // ---------- Buton bağlantıları ----------
  const byId = id => document.getElementById(id);
  const on = (id, fn) => { const el = byId(id); if (el) el.addEventListener('click', fn); };

  on('exportXlsxBtn', () => download(getSortedEvents(getFilteredEvents()), ''));
  on('mobileExportXlsxBtn', () => download(getSortedEvents(getFilteredEvents()), ''));
  on('exportReportXlsxBtn', () => download(getReportRows(), 'rapor'));
  on('importXlsxBtn', () => byId('xlsxFileInput') && byId('xlsxFileInput').click());
  on('mobileImportXlsxBtn', () => byId('xlsxFileInput') && byId('xlsxFileInput').click());

  const fileInput = byId('xlsxFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0];
      if (f) await importFile(f);
      e.target.value = '';
    });
  }

  window.__excelTools = { buildWorkbook, parseDateAny, importFile };
})();
