(() => {
  'use strict';

  const KEY = 'kapnota.v1';

  const CATS = {
    skiv: 'Skivmaterial',
    faner: 'Fanér',
    massiv: 'Massivträ',
    ovrigt: 'Övriga material',
    beslag: 'Beslag',
  };
  const UNITS = ['m²', 'm³', 'st', 'par', 'kg', 'liter'];

  // dims: 3 = längd × bredd × tjocklek (mm → m³), 2 = längd × bredd (mm → m²), 0 = antal × á-pris
  const SECTIONS = [
    { id: 'massiv', title: 'Massivträ', dims: 3, div: 1e9, unit: 'm³', cats: ['massiv'] },
    { id: 'skiv', title: 'Skivmaterial', dims: 2, div: 1e6, unit: 'm²', cats: ['skiv'] },
    { id: 'faner', title: 'Fanér', dims: 2, div: 1e6, unit: 'm²', cats: ['faner'] },
    { id: 'beslag', title: 'Beslag och ytbehandling', dims: 0, cats: ['ovrigt', 'beslag'] },
  ];

  const DEFAULT_SETTINGS = { markup: { massiv: 40, skiv: 25, faner: 40 }, moms: 25, theme: 'spreadsheet', mode: 'system' };
  const MODES = { system: 'System', light: 'Ljust', dark: 'Mörkt' };

  const THEMES = {
    spreadsheet: { name: 'Kalkylblad', color: '#2f6f4f', dark: '#1f4a35' },
    minimal: { name: 'Rent och enkelt', color: '#ffffff', dark: '#111113' },
    woodshop: { name: 'Snickeri', color: '#4a3220', dark: '#120c08' },
  };

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const moneyFmt = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const numFmt = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 });
  const kr = (n) => moneyFmt.format(n || 0) + ' kr';
  const nf = (n) => numFmt.format(n || 0);
  const inputVal = (n) => (n == null ? '' : String(n).replace('.', ','));
  const parseNum = (s) => {
    const t = String(s ?? '').replace(/\s/g, '').replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  // ---------- state ----------
  // Varje material från den publicerade prislistan har en nyckel så att listan kan synkas senare.
  const priceKey = (p) => `${p.cat}|${p.name}|${p.thickness ?? ''}`;
  const defaultPrices = () => window.DEFAULT_PRICES.map((p) => ({ id: uid(), key: priceKey(p), ...p }));
  // Kontrollsumma av den publicerade listans innehåll: ändras listan ändras summan.
  function hostHash() {
    const text = JSON.stringify(window.DEFAULT_PRICES.map((p) => [p.cat, p.name, p.thickness, p.price, p.unit]));
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16);
  }
  const newProject = () => ({
    id: uid(), produkt: '', namn: '', updated: Date.now(),
    rows: { massiv: [], skiv: [], faner: [], beslag: [] },
  });

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.projects) && Array.isArray(s.prices)) {
        s.settings = { ...clone(DEFAULT_SETTINGS), ...s.settings };
        s.settings.markup = { ...DEFAULT_SETTINGS.markup, ...s.settings.markup };
        if (!s.pricesHash) {
          // Data sparad innan synk fanns: koppla ihop raderna med den publicerade listan.
          const defs = new Map(window.DEFAULT_PRICES.map((d) => [priceKey(d), d]));
          s.prices.forEach((item) => {
            const d = defs.get(priceKey(item));
            if (!d || item.key) return;
            item.key = priceKey(item);
            if (d.price !== item.price || d.unit !== item.unit) item.edited = true;
          });
          s.pricesHash = hostHash();
          delete s.pricesVersion;
        }
        s.deletedKeys = s.deletedKeys || [];
        // Helt tomma kalkyler sparas inte mellan besöken.
        s.projects = s.projects.filter((p) => p.produkt || p.namn || Object.values(p.rows).some((r) => r.length));
        if (!s.projects.some((p) => p.id === s.currentId)) s.currentId = s.projects[0] ? s.projects[0].id : null;
        return s;
      }
    } catch (e) { /* börja om med standardvärden */ }
    return {
      prices: defaultPrices(), pricesHash: hostHash(), pricesSynced: Date.now(), deletedKeys: [],
      settings: clone(DEFAULT_SETTINGS), projects: [], currentId: null,
    };
  }

  const state = load();
  let tab = state.currentId ? 'kalkyl' : 'kalkyler';
  let priceFilter = '';
  let priceNotice = '';

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* lagring ej tillgänglig */ }
  }
  const cur = () => state.projects.find((p) => p.id === state.currentId);
  const touch = () => { cur().updated = Date.now(); save(); };

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    if (!THEMES[state.settings.theme]) state.settings.theme = DEFAULT_SETTINGS.theme;
    const theme = THEMES[state.settings.theme];
    if (!MODES[state.settings.mode]) state.settings.mode = DEFAULT_SETTINGS.mode;
    const dark = state.settings.mode === 'system' ? systemDark.matches : state.settings.mode === 'dark';
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.dataset.mode = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = dark ? theme.dark : theme.color;
  }
  systemDark.addEventListener('change', applyTheme);

  // ---------- price list sync ----------
  const hasPriceUpdate = () => hostHash() !== state.pricesHash;

  // Hämtar in den publicerade listan. Egna ändringar, egna material och borttagna rader behålls.
  function syncPrices() {
    const host = new Map(window.DEFAULT_PRICES.map((h) => [priceKey(h), h]));
    let updated = 0, added = 0, removed = 0;
    state.prices = state.prices.filter((item) => {
      const gone = item.key && !item.edited && !host.has(item.key);
      if (gone) removed++;
      return !gone;
    });
    const local = new Map(state.prices.filter((item) => item.key).map((item) => [item.key, item]));
    host.forEach((h, key) => {
      const item = local.get(key);
      if (!item) {
        if (state.deletedKeys.includes(key)) return;
        state.prices.push({ id: uid(), key, ...h });
        added++;
      } else if (!item.edited && (item.price !== h.price || item.unit !== h.unit)) {
        Object.assign(item, h);
        updated++;
      }
    });
    state.pricesHash = hostHash();
    state.pricesSynced = Date.now();
    save();
    return `Prislistan är uppdaterad: ${updated} ändrade, ${added} nya, ${removed} borttagna.`;
  }

  // Laddar om prices.js från servern (förbi cachen) och ser om innehållet har ändrats.
  function checkForPriceUpdate(manual) {
    const el = document.createElement('script');
    el.src = 'prices.js?t=' + Date.now();
    el.onload = () => {
      el.remove();
      if (manual) priceNotice = hasPriceUpdate() ? '' : 'Du har redan den senaste prislistan.';
      if (manual || tab === 'prislista') render(); else updateBadge();
    };
    el.onerror = () => {
      el.remove();
      if (!manual) return;
      priceNotice = 'Det gick inte att söka efter uppdateringar. Kontrollera anslutningen.';
      render();
    };
    document.head.appendChild(el);
  }

  function updateBadge() {
    document.querySelector('#tabs [data-tab="prislista"]').classList.toggle('has-update', hasPriceUpdate());
  }

  // ---------- calculations ----------
  function rowSum(sec, r) {
    const base = (r.antal || 0) * (r.pris || 0);
    if (sec.dims === 0) return base;
    let v = base * (r.l || 0) * (r.b || 0);
    if (sec.dims === 3) v *= (r.t || 0);
    return v / sec.div;
  }
  function sectionTotals(project, sec) {
    const sum = project.rows[sec.id].reduce((a, r) => a + rowSum(sec, r), 0);
    const pct = sec.dims ? (state.settings.markup[sec.id] || 0) : 0;
    return { sum, pct, total: sum * (1 + pct / 100) };
  }
  function projectTotals(project) {
    const ex = SECTIONS.reduce((a, sec) => a + sectionTotals(project, sec).total, 0);
    return { ex, inc: ex * (1 + (state.settings.moms || 0) / 100) };
  }

  // ---------- rendering ----------
  function render() {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const view = $('#view');
    const titles = { kalkyler: 'Kalkyler', kalkyl: 'Kapnota', prislista: 'Prislista', installningar: 'Inställningar' };
    $('#title').textContent = titles[tab];
    if (tab === 'kalkyler') view.innerHTML = viewProjects();
    if (tab === 'kalkyl') view.innerHTML = viewCalc();
    if (tab === 'prislista') { view.innerHTML = viewPrices(); renderPriceList(); }
    if (tab === 'installningar') view.innerHTML = viewSettings();
    updateTotals();
    updateBadge();
  }

  function updateTotals() {
    const show = tab === 'kalkyl' && !!cur();
    $('#totalbar').hidden = !show;
    document.body.classList.toggle('has-total', show);
    if (!show) return;
    const t = projectTotals(cur());
    $('#tot-ex').textContent = kr(t.ex);
    $('#tot-inc').textContent = kr(t.inc);
    $('#tot-moms-label').textContent = `Inkl. moms (${nf(state.settings.moms)} %)`;
  }

  function viewProjects() {
    const items = [...state.projects].sort((a, b) => b.updated - a.updated).map((p) => `
      <div class="rowwrap">
        <button class="row" data-act="open-project" data-id="${p.id}">
          <span class="main">
            <span class="name">${esc(p.produkt || 'Namnlös kalkyl')}${p.id === state.currentId ? ' ●' : ''}</span>
            <span class="sub">${esc(p.namn ? p.namn + ' · ' : '')}${new Date(p.updated).toLocaleDateString('sv-SE')}</span>
          </span>
          <span class="amount">${kr(projectTotals(p).ex)}</span>
        </button>
        <button class="x" data-act="del-project" data-id="${p.id}" aria-label="Ta bort kalkyl">✕</button>
      </div>`).join('');
    return `
      <p class="group-title">Sparade kalkyler</p>
      ${items ? `<div class="card">${items}</div>` : '<p class="muted">Inga sparade kalkyler ännu.</p>'}
      <button class="btn primary" data-act="new-project">+ Ny kalkyl</button>
      <p class="muted">Kalkylerna sparas lokalt i den här webbläsaren.</p>`;
  }

  function rowSub(sec, r) {
    const parts = [];
    if (sec.dims === 0) {
      parts.push(`${nf(r.antal)} ${esc(r.unit || 'st')} × ${kr(r.pris)}`);
    } else {
      parts.push(`${nf(r.antal)} st`);
      const d = [r.l, r.b, r.t].filter((v) => v != null).map(nf).join(' × ');
      if (d) parts.push(d + ' mm');
      if (r.material) parts.push(esc(r.material));
    }
    if (r.anm) parts.push(esc(r.anm));
    return parts.join(' · ');
  }

  function viewCalc() {
    const p = cur();
    if (!p) {
      return `
        <p class="muted">Ingen kalkyl är öppen.</p>
        <button class="btn primary" data-act="new-project">+ Ny kalkyl</button>`;
    }
    const sections = SECTIONS.map((sec) => {
      const t = sectionTotals(p, sec);
      const rows = p.rows[sec.id].map((r, i) => `
        <button class="row" data-act="edit-row" data-sec="${sec.id}" data-id="${r.id}">
          <span class="main">
            <span class="name">${i + 1}. ${esc(r.detalj || r.material || 'Detalj')}</span>
            <span class="sub">${rowSub(sec, r)}</span>
          </span>
          <span class="amount">${kr(rowSum(sec, r))}</span>
        </button>`).join('');
      const sums = sec.dims
        ? `<div class="sumline"><span>Summa</span><span>${kr(t.sum)}</span></div>
           <div class="sumline strong"><span>Med pålägg ${nf(t.pct)} %</span><span>${kr(t.total)}</span></div>`
        : `<div class="sumline strong"><span>Summa</span><span>${kr(t.total)}</span></div>`;
      return `
        <section class="card">
          <header><h2>${sec.title}</h2><span class="amount">${kr(t.total)}</span></header>
          ${rows || '<div class="empty">Inga detaljer ännu.</div>'}
          ${p.rows[sec.id].length ? sums : ''}
          <button class="btn ghost" data-act="add-row" data-sec="${sec.id}">+ Lägg till detalj</button>
        </section>`;
    }).join('');
    return `
      <div class="card"><div class="pad">
        <label>Produkt<input data-field="produkt" value="${esc(p.produkt)}" placeholder="T.ex. Byrå"></label>
        <label style="margin-bottom:0">Namn<input data-field="namn" value="${esc(p.namn)}" placeholder="Ditt namn"></label>
      </div></div>
      ${sections}`;
  }

  function viewPrices() {
    const update = hasPriceUpdate() ? `
      <div class="card notice"><div class="pad">
        <strong>Ny prislista finns</strong>
        <p class="muted">Dina egna ändringar och egna material behålls.</p>
        <button class="btn primary" data-act="sync-prices">Uppdatera prislistan</button>
      </div></div>` : '';
    return `
      ${update}
      ${priceNotice ? `<p class="muted notice-text">${esc(priceNotice)}</p>` : ''}
      <input id="price-search" type="search" placeholder="Sök material …" value="${esc(priceFilter)}" style="margin:0 0 12px">
      <button class="btn primary" data-act="add-price">+ Lägg till material</button>
      <div id="plist"></div>
      <p class="muted">Alla priser är exklusive moms. Ändringar sparas lokalt och påverkar inte detaljer som redan lagts in i en kalkyl.</p>
      ${state.pricesSynced ? `<p class="muted">Prislistan hämtades ${new Date(state.pricesSynced).toLocaleDateString('sv-SE')}.</p>` : ''}
      <button class="btn" data-act="check-prices">Sök efter uppdatering</button>
      <button class="btn danger" data-act="reset-prices">Återställ standardpriser</button>`;
  }

  function priceLabel(p) {
    return esc(p.name) + (p.thickness != null ? ` ${nf(p.thickness)} mm` : '');
  }

  function renderPriceList() {
    const q = priceFilter.trim().toLowerCase();
    const html = Object.keys(CATS).map((cat) => {
      const items = state.prices.filter((p) => p.cat === cat && (!q || p.name.toLowerCase().includes(q)));
      if (!items.length) return '';
      return `<p class="group-title">${CATS[cat]}</p><div class="card">${items.map((p) => `
        <button class="row" data-act="edit-price" data-id="${p.id}">
          <span class="main"><span class="name">${priceLabel(p)}</span></span>
          <span class="amount">${kr(p.price)}<span class="muted"> / ${esc(p.unit)}</span></span>
        </button>`).join('')}</div>`;
    }).join('');
    $('#plist').innerHTML = html || '<div class="empty">Inga material matchar sökningen.</div>';
  }

  function viewSettings() {
    const s = state.settings;
    const pct = (label, key, val) => `
      <label class="suffix">${label}<input inputmode="decimal" data-setting="${key}" value="${inputVal(val)}"></label>`;
    const themes = Object.entries(THEMES).map(([id, t]) =>
      `<option value="${id}"${id === s.theme ? ' selected' : ''}>${t.name}</option>`).join('');
    const modes = Object.entries(MODES).map(([id, name]) =>
      `<option value="${id}"${id === s.mode ? ' selected' : ''}>${name}</option>`).join('');
    return `
      <p class="group-title">Utseende</p>
      <div class="card"><div class="pad">
        <label>Tema<select data-setting="theme">${themes}</select></label>
        <label style="margin-bottom:0">Läge<select data-setting="mode">${modes}</select></label>
      </div></div>
      <p class="group-title">Pålägg</p>
      <div class="card"><div class="pad">
        ${pct('Massivträ', 'massiv', s.markup.massiv)}
        ${pct('Fanér', 'faner', s.markup.faner)}
        ${pct('Skivmaterial', 'skiv', s.markup.skiv)}
        <p class="muted" style="margin:0">Pålägget läggs på summan för respektive materialtyp. Beslag och ytbehandling har inget pålägg.</p>
      </div></div>
      <p class="group-title">Moms</p>
      <div class="card"><div class="pad">
        ${pct('Moms', 'moms', s.moms)}
      </div></div>
      <button class="btn" data-act="reset-settings">Återställ standardvärden</button>`;
  }

  // ---------- bottom sheet ----------
  const dialog = $('#sheet');
  const form = $('#sheet-form');
  let sheetHandlers = {};

  function openSheet(html, handlers, canDelete) {
    sheetHandlers = handlers;
    form.innerHTML = `${html}
      <button class="btn primary" value="save">Spara</button>
      <button class="btn" type="button" data-sheet="cancel">Avbryt</button>
      ${canDelete ? '<button class="btn ghost danger" type="button" data-sheet="delete">Ta bort</button>' : ''}`;
    dialog.showModal();
    if (handlers.onInput) handlers.onInput();
  }

  form.addEventListener('submit', () => {
    sheetHandlers.onSave(Object.fromEntries(new FormData(form)));
    render();
  });
  form.addEventListener('input', () => sheetHandlers.onInput && sheetHandlers.onInput());
  form.addEventListener('click', (e) => {
    const a = e.target.dataset.sheet;
    if (a === 'cancel') dialog.close();
    if (a === 'delete') {
      ask('Vill du ta bort den här raden?', 'Ta bort', () => {
        sheetHandlers.onDelete();
        dialog.close();
        render();
      });
    }
  });

  // Egen bekräftelsedialog: window.confirm() blockeras i vissa inbäddade webbläsare.
  let confirmYes = null;
  function ask(message, yesLabel, onYes) {
    $('#confirm-msg').textContent = message;
    $('#confirm-yes').textContent = yesLabel;
    confirmYes = onYes;
    $('#confirm').showModal();
  }
  $('#confirm-no').addEventListener('click', () => $('#confirm').close());
  $('#confirm-yes').addEventListener('click', () => {
    $('#confirm').close();
    if (confirmYes) confirmYes();
  });

  const field = (label, name, value, decimal) => `
    <label>${label}<input name="${name}" value="${esc(decimal ? inputVal(value) : value)}"${decimal ? ' inputmode="decimal"' : ''}></label>`;

  function rowFromForm(sec, d) {
    const r = { detalj: d.detalj.trim(), antal: parseNum(d.antal), pris: parseNum(d.pris), anm: d.anm.trim() };
    if (sec.dims) {
      Object.assign(r, { material: d.material.trim(), l: parseNum(d.l), b: parseNum(d.b), t: parseNum(d.t) });
    } else {
      r.unit = d.unit || 'st';
    }
    return r;
  }

  function openRowSheet(secId, rowId) {
    const sec = SECTIONS.find((s) => s.id === secId);
    const rows = cur().rows[secId];
    const row = rowId ? rows.find((r) => r.id === rowId) : { antal: 1 };
    const options = sec.cats.map((cat) => {
      const opts = state.prices.filter((p) => p.cat === cat).map((p) =>
        `<option value="${p.id}">${priceLabel(p)} – ${nf(p.price)} kr/${esc(p.unit)}</option>`).join('');
      return sec.cats.length > 1 ? `<optgroup label="${CATS[cat]}">${opts}</optgroup>` : opts;
    }).join('');

    const dims = sec.dims ? `
      ${field('Material', 'material', row.material)}
      <div class="grid3">
        ${field('Längd (mm)', 'l', row.l, true)}
        ${field('Bredd (mm)', 'b', row.b, true)}
        ${field('Tjocklek (mm)', 't', row.t, true)}
      </div>` : `<input type="hidden" name="unit" value="${esc(row.unit || 'st')}">`;

    openSheet(`
      <h2>${rowId ? 'Ändra detalj' : 'Ny detalj'} – ${sec.title}</h2>
      <label>Välj från prislistan<select name="pick"><option value="">Välj material …</option>${options}</select></label>
      ${field('Detalj', 'detalj', row.detalj)}
      ${dims}
      <div class="grid2">
        ${field(sec.dims ? 'Antal' : 'Antal / mängd', 'antal', row.antal, true)}
        ${field(`á-pris (kr${sec.dims ? '/' + sec.unit : ''})`, 'pris', row.pris, true)}
      </div>
      ${field('Anmärkning', 'anm', row.anm)}
      <div class="preview"><span>Summa</span><span id="row-preview"></span></div>`,
    {
      onInput() {
        $('#row-preview').textContent = kr(rowSum(sec, rowFromForm(sec, Object.fromEntries(new FormData(form)))));
      },
      onSave(d) {
        const r = rowFromForm(sec, d);
        if (rowId) Object.assign(row, r); else rows.push({ id: uid(), ...r });
        touch();
      },
      onDelete() {
        rows.splice(rows.indexOf(row), 1);
        touch();
      },
    }, !!rowId);

    form.elements.pick.addEventListener('change', (e) => {
      const p = state.prices.find((x) => x.id === e.target.value);
      if (!p) return;
      const el = form.elements;
      el.pris.value = inputVal(p.price);
      if (sec.dims) {
        el.material.value = p.name;
        // Skivor och fanér har materialets tjocklek; massivträ hyvlas till eget mått.
        if (p.thickness != null && (sec.dims === 2 || !el.t.value)) el.t.value = inputVal(p.thickness);
      } else {
        el.detalj.value = p.name;
        el.unit.value = p.unit;
      }
      // Nollställ väljaren så att samma material kan väljas igen och skriva över egna ändringar.
      e.target.value = '';
      sheetHandlers.onInput();
    });
  }

  function openPriceSheet(id) {
    const item = id ? state.prices.find((p) => p.id === id) : { cat: 'skiv', unit: 'm²' };
    const sel = (name, pairs, value) => `<select name="${name}">${pairs.map(([v, l]) =>
      `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    openSheet(`
      <h2>${id ? 'Ändra material' : 'Nytt material'}</h2>
      ${field('Namn', 'name', item.name)}
      <label>Kategori${sel('cat', Object.entries(CATS), item.cat)}</label>
      ${field('Tjocklek (mm)', 'thickness', item.thickness, true)}
      <div class="grid2">
        ${field('Pris (kr, exkl. moms)', 'price', item.price, true)}
        <label>Enhet${sel('unit', UNITS.map((u) => [u, u]), item.unit)}</label>
      </div>`,
    {
      onSave(d) {
        const v = {
          name: d.name.trim() || 'Namnlöst material', cat: d.cat,
          thickness: parseNum(d.thickness), price: parseNum(d.price) || 0, unit: d.unit,
        };
        if (id) {
          const changed = Object.keys(v).some((k) => v[k] !== item[k]);
          if (item.key && changed) item.edited = true;
          Object.assign(item, v);
        } else {
          state.prices.push({ id: uid(), ...v });
        }
        save();
      },
      onDelete() {
        if (item.key) state.deletedKeys.push(item.key);
        state.prices.splice(state.prices.indexOf(item), 1);
        save();
      },
    }, !!id);
  }

  // ---------- events ----------
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    priceNotice = '';
    render();
    window.scrollTo(0, 0);
  });

  $('#view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const { act, id, sec } = b.dataset;
    if (act === 'add-row') return openRowSheet(sec);
    if (act === 'edit-row') return openRowSheet(sec, id);
    if (act === 'add-price') return openPriceSheet();
    if (act === 'edit-price') return openPriceSheet(id);
    if (act === 'check-prices') return checkForPriceUpdate(true);
    if (act === 'sync-prices') {
      priceNotice = syncPrices();
      return render();
    }

    if (act === 'new-project') {
      const p = newProject();
      state.projects.push(p);
      state.currentId = p.id;
      tab = 'kalkyl';
    } else if (act === 'open-project') {
      state.currentId = id;
      tab = 'kalkyl';
    } else if (act === 'del-project') {
      const p = state.projects.find((x) => x.id === id);
      return ask(`Vill du ta bort kalkylen "${p.produkt || 'Namnlös kalkyl'}"?`, 'Ta bort', () => {
        state.projects.splice(state.projects.indexOf(p), 1);
        if (state.currentId === id) state.currentId = state.projects[0] ? state.projects[0].id : null;
        save();
        render();
      });
    } else if (act === 'reset-prices') {
      return ask('Vill du återställa prislistan till standardpriserna? Dina ändringar försvinner.', 'Återställ', () => {
        state.prices = defaultPrices();
        state.pricesHash = hostHash();
        state.pricesSynced = Date.now();
        state.deletedKeys = [];
        priceNotice = '';
        save();
        render();
      });
    } else if (act === 'reset-settings') {
      state.settings = { ...clone(DEFAULT_SETTINGS), theme: state.settings.theme, mode: state.settings.mode };
    }
    save();
    render();
  });

  $('#view').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.field) {
      cur()[t.dataset.field] = t.value;
      touch();
    } else if (t.dataset.setting === 'theme' || t.dataset.setting === 'mode') {
      state.settings[t.dataset.setting] = t.value;
      applyTheme();
      save();
    } else if (t.dataset.setting) {
      const v = parseNum(t.value) || 0;
      if (t.dataset.setting === 'moms') state.settings.moms = v;
      else state.settings.markup[t.dataset.setting] = v;
      save();
    } else if (t.id === 'price-search') {
      priceFilter = t.value;
      renderPriceList();
    }
  });

  applyTheme();
  render();
  checkForPriceUpdate(false);
})();
