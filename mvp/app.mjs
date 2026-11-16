import { Chain } from './engine.mjs';
import { keccak256, toUtf8Bytes, ZeroHash } from 'ethers';
import ART from '../artifacts/contracts/BattChain.sol/BattChain.json';
import REPORT_A1 from '../contoh-laporan/lab-a-uji-2026-11-02.txt';
import REPORT_B from '../contoh-laporan/lab-b-uji-2026-11-05.txt';
import REPORT_A2 from '../contoh-laporan/lab-a-refurbish-2026-11-07.txt';
import SOURCE from '../contracts/BattChain.sol';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = new Intl.NumberFormat('id-ID');
const fmt = (n) => nf.format(Number(n));
const pct = (bps) => (Number(bps) / 100).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const short = (h, a = 6, b = 4) => (h ? h.slice(0, a) + '…' + h.slice(-b) : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeStr = (ts) => new Date(Number(ts) * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const idOf = (serial) => keccak256(toUtf8Bytes(serial));

const ACTORS = [
  { name: 'Admin', desc: 'Admin konsorsium: memberi dan mencabut peran' },
  { name: 'Pabrikan', desc: 'Mendaftarkan pack baterai baru' },
  { name: 'Lab A', desc: 'Lab uji terdaftar' },
  { name: 'Lab B', desc: 'Lab uji terdaftar' },
  { name: 'Penjual', desc: 'Pemilik mobil bekas, tanpa peran' },
  { name: 'Pembeli', desc: 'Calon pembeli, hanya membaca' },
];

const REPORTS = [
  { key: 'a1', label: 'Lab A · 2 Nov · SOH 94%', text: REPORT_A1 },
  { key: 'b', label: 'Lab B · 5 Nov · SOH 91%', text: REPORT_B },
  { key: 'a2', label: 'Refurbish Lab A · 7 Nov · SOH 98%', text: REPORT_A2 },
];

const FN_LABEL = {
  deploy: 'Deploy kontrak',
  grantRole: 'Beri peran',
  registerBattery: 'Daftarkan baterai',
  recordTest: 'Catat uji',
  recordRefurbish: 'Catat refurbish',
};

let chain, ROLES = {}, roleName = {}, busy = false;
const state = { actor: 1, action: 'register', verifierText: REPORT_B, verifierHash: null, done: new Set(), readDone: false };

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return '0x' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256File(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return '0x' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
let REPORT_HASH = {};

function actorOf(addr) {
  const i = chain.accounts.findIndex((a) => a.address.toLowerCase() === String(addr).toLowerCase());
  return i >= 0 ? ACTORS[i].name : short(addr);
}

function explain(err, fn) {
  const a = err.args || [];
  switch (err.name) {
    case 'AccessControlUnauthorizedAccount': {
      const r = roleName[a[1]] || 'peran yang dibutuhkan';
      return `${actorOf(a[0])} tidak punya peran ${r}, jadi kontrak menolak panggilan ${fn}.`;
    }
    case 'AlreadyRegistered': return 'Nomor seri ini sudah terdaftar. Satu pack hanya bisa didaftarkan sekali.';
    case 'NotRegistered': return 'Baterai belum terdaftar. Pabrikan harus mendaftarkannya dulu.';
    case 'SohOutOfRange': return 'SOH harus lebih dari 0% dan paling tinggi 100%.';
    case 'OdometerRollback': return `Odometer tidak boleh mundur: catatan terakhir ${fmt(a[0])} km, yang diisi ${fmt(a[1])} km.`;
    case 'CycleRollback': return `Jumlah siklus tidak boleh berkurang: catatan terakhir ${fmt(a[0])}, yang diisi ${fmt(a[1])}.`;
    case 'SohIncreaseTooLarge': return `SOH naik lebih dari toleransi 3 poin tanpa refurbish: terakhir ${pct(a[0])}, yang diisi ${pct(a[1])}.`;
    default: return 'Transaksi dibatalkan oleh kontrak.';
  }
}
const errSig = (e) => `${e.name}(${(e.args || []).map((x) => (typeof x === 'string' && x.length > 20 ? short(x) : typeof x === 'bigint' ? String(x) : x)).join(', ')})`;

/* ---------- Boot ---------- */
async function boot() {
  busy = true;
  setBusy(true);
  chain = new Chain(ART.abi, ART.bytecode);
  await chain.init();
  state.done = new Set();
  state.readDone = false;
  await chain.deploy(0);
  ROLES = {
    admin: ZeroHash,
    reg: (await chain.call('REGISTRAR_ROLE'))[0],
    lab: (await chain.call('LAB_ROLE'))[0],
  };
  roleName = { [ROLES.admin]: 'Admin', [ROLES.reg]: 'Pabrikan (REGISTRAR_ROLE)', [ROLES.lab]: 'Lab (LAB_ROLE)' };
  await chain.send(0, 'grantRole', [ROLES.reg, chain.accounts[1].address]);
  await chain.send(0, 'grantRole', [ROLES.lab, chain.accounts[2].address]);
  await chain.send(0, 'grantRole', [ROLES.lab, chain.accounts[3].address]);
  $('#contract-addr').textContent = short(chain.contract, 8, 6);
  $('#contract-addr').title = chain.contract;
  $('#contract-full').textContent = chain.contract;
  $('#result').hidden = true;
  busy = false;
  setBusy(false);
  await refreshAll();
}

/* ---------- Actors ---------- */
async function renderActors() {
  const wrap = $('#actors');
  const rows = [];
  for (let i = 0; i < ACTORS.length; i++) {
    const addr = chain.accounts[i].address;
    const roles = [];
    if ((await chain.call('hasRole', [ROLES.admin, addr]))[0]) roles.push('Admin');
    if ((await chain.call('hasRole', [ROLES.reg, addr]))[0]) roles.push('Pabrikan');
    if ((await chain.call('hasRole', [ROLES.lab, addr]))[0]) roles.push('Lab');
    rows.push(`<button type="button" class="actor${i === state.actor ? ' on' : ''}" data-i="${i}" aria-pressed="${i === state.actor}">
      <span class="actor-name">${ACTORS[i].name}</span>
      <span class="actor-role">${roles.length ? roles.map((r) => `<b>${r}</b>`).join(' ') : '<i>tanpa peran</i>'}</span>
      <code class="actor-addr">${short(addr)}</code></button>`);
  }
  wrap.innerHTML = rows.join('');
  $$('.actor', wrap).forEach((b) => b.addEventListener('click', () => { state.actor = Number(b.dataset.i); renderActors(); renderSubmitLabel(); }));
  $('#actor-desc').textContent = ACTORS[state.actor].desc + ' · ' + chain.accounts[state.actor].address;
}

/* ---------- Form ---------- */
function setAction(a) {
  state.action = a;
  $$('.tab').forEach((t) => { const on = t.dataset.a === a; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
  $('#f-battery').hidden = a === 'grant';
  $('#f-nominal').hidden = a !== 'register';
  $('#f-test').hidden = !(a === 'test' || a === 'refurb');
  $('#f-grant').hidden = a !== 'grant';
  $('#refurb-note').hidden = a !== 'refurb';
  renderSubmitLabel();
}
function renderSubmitLabel() {
  const verb = { register: 'Daftarkan', test: 'Catat uji', refurb: 'Catat refurbish', grant: 'Beri peran' }[state.action];
  $('#submit').textContent = `${verb} sebagai ${ACTORS[state.actor].name}`;
}
function fill(p) {
  if (p.actor != null) state.actor = p.actor;
  if (p.action) setAction(p.action);
  if (p.serial != null) $('#serial').value = p.serial;
  if (p.kwh != null) $('#kwh').value = p.kwh;
  if (p.soh != null) $('#soh').value = p.soh;
  if (p.km != null) $('#km').value = p.km;
  if (p.cyc != null) $('#cyc').value = p.cyc;
  if (p.report) $('#report').value = p.report;
  renderActors();
  renderSubmitLabel();
  const form = $('#tx-form');
  form.classList.remove('flash'); void form.offsetWidth; form.classList.add('flash');
}

async function reportHashFromSelect() {
  const v = $('#report').value;
  if (v === 'panel') return state.verifierHash || (await sha256Hex(state.verifierText));
  return REPORT_HASH[v];
}

async function submitTx() {
  if (busy) return;
  const a = state.action, who = state.actor;
  let fn, args, serial = $('#serial').value.trim();
  try {
    if (a === 'grant') {
      const role = $('#role').value === 'lab' ? ROLES.lab : ROLES.reg;
      fn = 'grantRole'; args = [role, chain.accounts[Number($('#target').value)].address];
    } else {
      if (!serial) throw new Error('Isi nomor seri pack.');
      const id = idOf(serial);
      if (a === 'register') {
        const kwh = Number($('#kwh').value);
        if (!(kwh > 0)) throw new Error('Isi kapasitas nominal dalam kWh.');
        fn = 'registerBattery'; args = [id, Math.round(kwh * 1000)];
      } else {
        const soh = Number($('#soh').value), km = Number($('#km').value), cyc = Number($('#cyc').value);
        if (!Number.isFinite(soh) || soh < 0 || soh > 655) throw new Error('Isi SOH dalam persen, misalnya 94,00.');
        if (!Number.isInteger(km) || km < 0 || !Number.isInteger(cyc) || cyc < 0) throw new Error('Odometer dan siklus harus bilangan bulat.');
        fn = a === 'test' ? 'recordTest' : 'recordRefurbish';
        args = [id, Math.round(soh * 100), km, cyc, await reportHashFromSelect()];
      }
    }
  } catch (e) {
    showResult({ input: true, msg: e.message });
    return;
  }
  busy = true; setBusy(true);
  const r = await chain.send(who, fn, args);
  r.serial = serial;
  busy = false; setBusy(false);
  showResult(r);
  checkGuide(r);
  await refreshAll();
}

function showResult(r) {
  const box = $('#result');
  box.hidden = false;
  if (r.input) {
    box.className = 'result bad';
    box.innerHTML = `<p class="res-head">Formulir belum lengkap</p><p>${esc(r.msg)}</p>`;
    return;
  }
  if (r.ok) {
    const ev = r.events.map((e) => e.name).join(', ');
    box.className = 'result ok';
    box.innerHTML = `<p class="res-head">Diterima · blok #${r.block}</p>
      <p>${FN_LABEL[r.fn]} oleh ${ACTORS[r.fromIdx].name}. Event: <b>${esc(ev)}</b>. Gas ${fmt(r.gas)}.</p>
      <p class="res-hash">tx <code>${r.hash}</code></p>`;
  } else {
    box.className = 'result bad';
    box.innerHTML = `<p class="res-head">Ditolak kontrak · blok #${r.block}</p>
      <p>${esc(explain(r.error, r.fn))}</p>
      <p class="res-hash"><code>${esc(errSig(r.error))}</code> · state tidak berubah · tx <code>${short(r.hash, 10, 6)}</code></p>`;
  }
}

/* ---------- History ---------- */
let lastHistory = [];
async function renderHistory() {
  const serial = $('#h-serial').value.trim() || 'PACK-001';
  const id = idOf(serial);
  const out = $('#history');
  $('#h-id').textContent = short(id, 10, 8);
  $('#h-id').title = id;
  const bat = await chain.call('batteries', [id]);
  const registered = bat[0];
  if (!registered) {
    lastHistory = [];
    out.innerHTML = `<div class="empty"><p class="empty-head">${esc(serial)} belum terdaftar</p>
      <p>Kontrak belum punya data untuk pack ini. Mulai dari langkah 1 di panduan: Pabrikan mendaftarkan pack.</p></div>`;
    return;
  }
  const hist = (await chain.call('getHistory', [id]))[0];
  lastHistory = hist.map((r, i) => ({ i, lab: r.lab, ts: r.timestamp, soh: r.sohBps, km: r.odometerKm, cyc: r.cycleCount, hash: r.reportHash, refurb: r.refurbish }));
  const last = lastHistory[lastHistory.length - 1];
  const labs = new Set(lastHistory.map((r) => r.lab.toLowerCase())).size;
  const summary = `<div class="h-sum">
    <div><span class="k">SOH terakhir</span><span class="v big">${last ? pct(last.soh) : '–'}</span></div>
    <div><span class="k">Catatan</span><span class="v">${lastHistory.length} dari ${labs} lab</span></div>
    <div><span class="k">Kapasitas nominal</span><span class="v">${fmt(Number(bat[1]) / 1000)} kWh</span></div>
    <div><span class="k">Didaftarkan oleh</span><span class="v">${actorOf(bat[2])}</span></div></div>`;
  const rows = lastHistory.length
    ? lastHistory.map((r) => `<tr data-hash="${r.hash}">
        <td class="num">#${r.i + 1}</td>
        <td>${timeStr(r.ts)}</td>
        <td>${actorOf(r.lab)}</td>
        <td><span class="soh"><span class="meter"><i style="width:${Math.min(100, Number(r.soh) / 100)}%"></i></span>${pct(r.soh)}</span></td>
        <td class="num">${fmt(r.km)} km</td>
        <td class="num">${fmt(r.cyc)}</td>
        <td>${r.refurb ? '<span class="pill warn">Refurbish</span>' : '<span class="pill">Uji</span>'}</td>
        <td><code title="${r.hash}">${short(r.hash, 8, 4)}</code></td></tr>`).join('')
    : `<tr><td colspan="8" class="muted">Terdaftar, belum ada catatan uji. Lanjutkan ke langkah 2.</td></tr>`;
  out.innerHTML = summary + `<div class="scroll"><table class="tbl"><thead><tr><th class="num">No</th><th>Jam blok</th><th>Lab</th><th>SOH</th><th class="num">Odometer</th><th class="num">Siklus</th><th>Jenis</th><th>Hash laporan</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---------- Verifier ---------- */
async function runVerify() {
  const h = state.verifierFileHash || (await sha256Hex(state.verifierText));
  state.verifierHash = h;
  $('#v-hash').textContent = h;
  const box = $('#v-result');
  const match = lastHistory.find((r) => r.hash.toLowerCase() === h.toLowerCase());
  $$('#history tr[data-hash]').forEach((tr) => tr.classList.toggle('hit', !!match && tr.dataset.hash.toLowerCase() === h.toLowerCase()));
  const serial = $('#h-serial').value.trim() || 'PACK-001';
  if (!lastHistory.length) {
    box.className = 'v-result idle';
    box.innerHTML = `Belum ada catatan on-chain untuk ${esc(serial)} yang bisa dicocokkan.`;
  } else if (match) {
    box.className = 'v-result ok';
    box.innerHTML = `<b>Cocok</b> dengan catatan #${match.i + 1} (${actorOf(match.lab)}, SOH ${pct(match.soh)}). Isi file sama persis dengan yang dicatat lab.`;
    if (!state.done.has(6)) { state.done.add(6); renderGuide(); }
  } else {
    box.className = 'v-result bad';
    box.innerHTML = `<b>Tidak cocok</b> dengan catatan mana pun untuk ${esc(serial)}. File ini bukan laporan yang dicatat lab, atau isinya sudah diubah.`;
  }
}
function loadReport(key) {
  const r = REPORTS.find((x) => x.key === key);
  state.verifierFileHash = null;
  state.verifierText = r.text;
  $('#v-text').value = r.text;
  $('#v-text').disabled = false;
  $('#v-file-name').textContent = '';
  $$('.v-sample').forEach((b) => b.classList.toggle('on', b.dataset.k === key));
  runVerify();
}

/* ---------- Log ---------- */
function renderLog() {
  const body = $('#log-body');
  $('#block-no').textContent = '#' + chain.blockNumber;
  $('#tx-count').textContent = chain.txs.length;
  $('#tx-rejected').textContent = chain.txs.filter((t) => !t.ok).length;
  const rows = [...chain.txs].reverse().map((t, k) => {
    const detail = t.ok
      ? t.events.map((e) => `<div><b>${e.name}</b>(${e.frag.inputs.map((inp, j) => `${inp.name}: ${fmtArg(e.args[j], inp)}`).join(', ')})</div>`).join('') || '<div>Tanpa event</div>'
      : `<div><b>${esc(errSig(t.error))}</b></div><div>${esc(explain(t.error, t.fn))}</div>`;
    const argsTxt = t.fn === 'deploy' ? `bytecode ${fmt((ART.bytecode.length - 2) / 2)} byte → ${t.created}` : (t.args || []).map((x) => (typeof x === 'string' && x.length > 20 ? x : String(x))).join(', ');
    return `<tr class="log-row" tabindex="0" data-k="${k}">
      <td class="num">#${t.block}</td>
      <td><code>${short(t.hash, 10, 6)}</code></td>
      <td>${ACTORS[t.fromIdx].name}</td>
      <td>${FN_LABEL[t.fn]}</td>
      <td>${t.ok ? '<span class="pill ok">Sukses</span>' : `<span class="pill bad">Ditolak</span> <span class="why">${esc(t.error.name)}</span>`}</td>
      <td class="num">${fmt(t.gas)}</td></tr>
      <tr class="log-detail" data-k="${k}" hidden><td colspan="6">
        <div class="kv"><span>Hash tx</span><code>${t.hash}</code></div>
        <div class="kv"><span>Dari</span><code>${t.from}</code></div>
        <div class="kv"><span>Input</span><code>${esc(argsTxt)}</code></div>
        <div class="kv"><span>${t.ok ? 'Event' : 'Alasan'}</span><div class="ev">${detail}</div></div>
      </td></tr>`;
  });
  body.innerHTML = rows.join('');
  $$('.log-row', body).forEach((tr) => {
    const toggle = () => { const d = $(`.log-detail[data-k="${tr.dataset.k}"]`, body); d.hidden = !d.hidden; tr.classList.toggle('open', !d.hidden); };
    tr.addEventListener('click', toggle);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}
function fmtArg(v, inp) {
  if (inp.type === 'address') return actorOf(v);
  if (inp.type === 'bytes32') return roleName[v] ? roleName[v].split(' ')[0] : short(v, 8, 4);
  if (inp.name === 'sohBps') return pct(v);
  if (inp.name === 'nominalWh') return fmt(Number(v) / 1000) + ' kWh';
  if (inp.type === 'bool') return v ? 'ya' : 'tidak';
  return fmt(v);
}

/* ---------- Guide ---------- */
const GUIDE = [
  { n: 1, title: 'Pabrikan mendaftarkan PACK-001', expect: 'Diterima', ok: true,
    fill: { actor: 1, action: 'register', serial: 'PACK-001', kwh: 60 } },
  { n: 2, title: 'Lab A mencatat uji: SOH 94%, 18.000 km', expect: 'Diterima', ok: true,
    fill: { actor: 2, action: 'test', serial: 'PACK-001', soh: 94, km: 18000, cyc: 320, report: 'a1' } },
  { n: 3, title: 'Lab B mengisi odometer 15.000 km (mundur)', expect: 'Ditolak: OdometerRollback', ok: false,
    fill: { actor: 3, action: 'test', serial: 'PACK-001', soh: 91, km: 15000, cyc: 400, report: 'b' } },
  { n: 4, title: 'Penjual mencoba menulis SOH 99%', expect: 'Ditolak: tidak punya peran Lab', ok: false,
    fill: { actor: 4, action: 'test', serial: 'PACK-001', soh: 99, km: 26000, cyc: 410, report: 'b' } },
  { n: 5, title: 'Lab B mencatat uji yang benar: SOH 91%, 25.000 km', expect: 'Diterima', ok: true,
    fill: { actor: 3, action: 'test', serial: 'PACK-001', soh: 91, km: 25000, cyc: 450, report: 'b' } },
  { n: 6, title: 'Pembeli membaca riwayat dan mencocokkan laporan Lab B', expect: 'Cocok dengan catatan #2', ok: true },
];
function checkGuide(r) {
  const s = (r.serial || '').toUpperCase() === 'PACK-001';
  if (r.ok && r.fn === 'registerBattery' && s) state.done.add(1);
  if (r.ok && r.fn === 'recordTest' && r.fromIdx === 2 && s) state.done.add(2);
  if (!r.ok && r.error && r.error.name === 'OdometerRollback') state.done.add(3);
  if (!r.ok && r.error && r.error.name === 'AccessControlUnauthorizedAccount' && (r.fn === 'recordTest' || r.fn === 'recordRefurbish')) state.done.add(4);
  if (r.ok && r.fn === 'recordTest' && r.fromIdx === 3 && s) state.done.add(5);
  renderGuide();
}
function renderGuide() {
  const ol = $('#guide');
  ol.innerHTML = GUIDE.map((g) => `<li class="${state.done.has(g.n) ? 'done' : ''}">
    <span class="g-mark" aria-hidden="true">${state.done.has(g.n) ? '✓' : g.n}</span>
    <span class="g-body"><span class="g-title">${g.title}</span>
    <span class="g-expect ${g.ok ? 'ok' : 'bad'}">Harus: ${g.expect}</span></span>
    <button type="button" class="ghost g-btn" data-n="${g.n}">${state.done.has(g.n) ? 'Ulangi' : 'Isi'}</button></li>`).join('');
  $('#guide-count').textContent = `${state.done.size}/6 selesai`;
  $$('.g-btn', ol).forEach((b) => b.addEventListener('click', () => doGuide(Number(b.dataset.n))));
}
async function doGuide(n) {
  const g = GUIDE.find((x) => x.n === n);
  if (n === 6) {
    state.actor = 5; renderActors(); renderSubmitLabel();
    $('#h-serial').value = 'PACK-001';
    await renderHistory();
    loadReport('b');
    $('#verify-card').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    return;
  }
  fill(g.fill);
  if (window.innerWidth < 980) $('#tx-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#submit').focus({ preventScroll: true });
}
async function runAll() {
  if (busy) return;
  for (const n of [1, 2, 3, 4, 5]) {
    fill(GUIDE[n - 1].fill);
    await sleep(450);
    await submitTx();
    await sleep(350);
  }
  await doGuide(6);
}

/* ---------- Misc ---------- */
function setBusy(b) {
  $$('button').forEach((x) => { if (!x.classList.contains('keep')) x.disabled = b; });
}
async function refreshAll() {
  await renderActors();
  await renderHistory();
  renderLog();
  renderGuide();
  await runVerify();
}

async function main() {
  REPORT_HASH = { a1: await sha256Hex(REPORT_A1), b: await sha256Hex(REPORT_B), a2: await sha256Hex(REPORT_A2) };
  $('#source').textContent = SOURCE;
  $('#bytecode-hash').textContent = keccak256(ART.bytecode);
  $('#bytecode-size').textContent = fmt((ART.bytecode.length - 2) / 2);
  $$('.tab').forEach((t) => t.addEventListener('click', () => setAction(t.dataset.a)));
  $('#tx-form').addEventListener('submit', (e) => { e.preventDefault(); submitTx(); });
  $('#run-all').addEventListener('click', runAll);
  $('#reset').addEventListener('click', async () => { await boot(); fill({ actor: 1, action: 'register', serial: 'PACK-001', kwh: 60 }); });
  $('#h-form').addEventListener('submit', async (e) => { e.preventDefault(); await renderHistory(); await runVerify(); });
  $$('.v-sample').forEach((b) => b.addEventListener('click', () => loadReport(b.dataset.k)));
  $('#v-text').addEventListener('input', () => { state.verifierText = $('#v-text').value; state.verifierFileHash = null; $$('.v-sample').forEach((b) => b.classList.remove('on')); runVerify(); });
  $('#v-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    state.verifierFileHash = await sha256File(f);
    $('#v-file-name').textContent = f.name;
    $('#v-text').value = f.size < 200000 ? await f.text() : '(file besar, isi tidak ditampilkan)';
    $('#v-text').disabled = true;
    $$('.v-sample').forEach((b) => b.classList.remove('on'));
    runVerify();
  });
  $('#v-tamper').addEventListener('click', () => {
    loadReport('b');
    const t = REPORT_B.replace('91,00%', '95,00%');
    $('#v-text').value = t; state.verifierText = t;
    $$('.v-sample').forEach((b) => b.classList.remove('on'));
    runVerify();
  });
  $('#v-text').value = REPORT_B;
  $$('.v-sample').forEach((b) => b.classList.toggle('on', b.dataset.k === 'b'));
  setAction('register');
  await boot();
  $('#loading').hidden = true;
  $('#app').hidden = false;
}

main().catch((e) => {
  console.error(e);
  $('#loading').innerHTML = `<p><b>EVM gagal dimuat.</b> ${esc(e.message)}</p>`;
});
