(function () {
  'use strict';

  // ---------- simulated state (nothing real is invested or changed) ----------
  const SIP = { fund: 'Flexi Cap Fund (example)', amount: 2000, day: 5, min: 500 };
  const state = { skipsInRow: 0, plan: null, postpones: 0, stopped: false, planTries: 0, msgCount: 0 };
  const MAX_MSGS = 25;

  const $ = s => document.querySelector(s);
  const screen = $('#screen'), sheet = $('#sheet'), backdrop = $('#backdrop'), toastEl = $('#toast');
  const fmtINR = n => '₹' + Number(n).toLocaleString('en-IN');
  const fmtDate = d => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function nextSipDate(from = new Date()) {
    const t = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    let d = new Date(t.getFullYear(), t.getMonth(), SIP.day);
    if (d <= t) d = new Date(t.getFullYear(), t.getMonth() + 1, SIP.day);
    return d;
  }
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  const monthName = d => d.toLocaleDateString('en-IN', { month: 'long' });

  function annot(n, text) { return `<div class="annot"><b>${n}.</b> ${text}</div>`; }

  // ---------- guided scenarios ----------
  const params = new URLSearchParams(location.search);
  const TEST = params.get('test') === '1';
  const SCEN = {
    reminder: { n: 1, title: 'A tight month is coming',
      story: `It's the 2nd. Your SIP of ${fmtINR(SIP.amount)} goes out on the 5th, but this month your salary is late and only arrives on the 7th.`,
      task: "Decide what to do about this month's SIP." },
    detail: { n: 2, title: 'You decide to stop',
      story: 'Money will be tight for the next couple of months, and you have decided to stop your SIP.',
      task: 'Go ahead and stop it from this screen, the way you normally would.' },
    restart: { n: 3, title: 'Restart day',
      story: 'Last month money was tight, so you stopped your SIP and planned to restart today. Your salary has come in.',
      task: 'Decide what to do.' }
  };
  const ORDER = ['reminder', 'detail', 'restart'];
  let current = null;
  const taskEl = $('#task');

  function showTask(key) {
    current = key;
    document.querySelectorAll('[data-go]').forEach(b => b.classList.toggle('active', b.dataset.go === key));
    if (!SCEN[key]) {
      taskEl.innerHTML = `<div class="t-label">How this works</div><p class="t-story">Try the 3 short scenarios in order. Each one tells you the situation and what to do.</p><button class="btn primary" type="button" data-go="reminder">Start scenario 1</button>`;
      return;
    }
    const c = SCEN[key];
    taskEl.classList.remove('collapsed');
    taskEl.innerHTML = `<div class="t-label">Scenario ${c.n} of 3 · ${c.title}<button type="button" class="t-toggle" aria-label="Hide or show the task">Hide</button></div><div class="t-body"><p class="t-story">${c.story}</p><p class="t-do"><b>Your task:</b> ${c.task}</p></div>`;
    taskEl.querySelector('.t-toggle').onclick = () => {
      const col = taskEl.classList.toggle('collapsed');
      taskEl.querySelector('.t-toggle').textContent = col ? 'Show task' : 'Hide';
    };
  }

  function markDone(key) {
    if (key !== current || !SCEN[key]) return;
    const i = ORDER.indexOf(key), next = ORDER[i + 1];
    const nextBtn = next
      ? `<button class="btn primary" type="button" data-go="${next}">Next: scenario ${i + 2} →</button>`
      : `<p class="t-story" style="margin:8px 0 0">${TEST ? 'All 3 done. Thank you! Please go back to the form and answer the questions.' : 'All 3 done. Thank you for trying it.'}</p>`;
    const done = document.createElement('div'); done.className = 't-done';
    done.innerHTML = `<div class="t-check">✓ Done</div>${nextBtn}`;
    const old = taskEl.querySelector('.t-done'); if (old) old.remove();
    taskEl.classList.remove('collapsed'); const tg = taskEl.querySelector('.t-toggle'); if (tg) tg.textContent = 'Hide';
    taskEl.appendChild(done);
  }

  // ---------- sheet and toast ----------
  function openSheet(html) { sheet.innerHTML = html; sheet.hidden = false; backdrop.hidden = false; }
  function closeSheet() { sheet.hidden = true; backdrop.hidden = true; sheet.innerHTML = ''; }
  backdrop.addEventListener('click', closeSheet);
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
  }

  // ---------- screens ----------
  function home() {
    const due = nextSipDate();
    screen.innerHTML = `
      <div class="topbar"><h3>My SIPs</h3></div>
      <div class="card">
        <div class="row"><div><div style="font-weight:600">${SIP.fund}</div><div class="muted">Monthly on the ${SIP.day}th</div></div>
        <span class="pill">${state.stopped ? 'Stopped' : state.plan ? 'Paused' : 'Active'}</span></div>
        <div class="row" style="margin-top:10px"><span class="amount">${fmtINR(SIP.amount)}</span><span class="muted">Next: ${state.stopped ? '-' : fmtDate(due)}</span></div>
        <button class="btn" data-go="detail">View SIP</button>
      </div>
`;
  }

  function reminder() {
    const due = nextSipDate();
    const blocked = state.skipsInRow >= 2;
    screen.innerHTML = `
      <div class="notif">
        <div class="app">SIP reminder · now</div>
        <div><b>Your SIP of ${fmtINR(SIP.amount)} goes out on ${fmtDate(due)}.</b></div>
        <div class="muted" style="font-size:13.5px">If this month is tight, you can skip just this month or lower the amount.</div>
      </div>
      ${annot(1, 'New: a reminder 3 days before the debit. Today there is no heads-up, so a tight month can turn into a failed payment (P1, P6).')}
      <div class="topbar"><button class="icon-btn" data-go="home" aria-label="Back">←</button><h3>Upcoming instalment</h3></div>
      <div class="card">
        <div class="muted">${SIP.fund}</div>
        <div class="row" style="margin:6px 0 4px"><span class="amount">${fmtINR(SIP.amount)}</span><span>${fmtDate(due)}</span></div>
        <p style="margin:8px 0 2px">Skipping or lowering applies to this month only. Your SIP continues as usual after that.</p>
        ${annot(2, 'Skip already exists in the app, but is buried under My SIPs, Edit SIP. Here it is offered at the moment it is needed (P2 and the researcher did not know it existed).')}
        <button class="btn primary" id="keep">Keep as planned</button>
        <div class="btn-grid" style="margin-top:8px">
          <button class="btn" id="skip" ${blocked ? 'disabled' : ''}>Skip this month</button>
          <button class="btn" id="lower">Lower this month</button>
        </div>
        ${blocked ? `<p class="src">You've skipped the last 2 months. Under SEBI rules a monthly SIP can be cancelled after 3 consecutive missed instalments, so skipping is turned off here. You can still lower the amount, or plan a restart from the SIP page.</p>` : ''}
        ${annot(3, 'Guardrail: Skip is hidden after 2 skips in a row and the 3-instalment rule is explained instead, so the nudge cannot cause accidental cancellation.')}
        <button class="btn" id="ask">Ask a question</button>
      </div>`;
    $('#keep').onclick = () => { toast('All set. Your SIP goes out as planned.'); markDone('reminder'); };
    $('#lower').onclick = () => lowerSheet(due);
    $('#ask').onclick = () => openAssistant('qa');
    const sk = $('#skip'); if (sk) sk.onclick = () => skipSheet(due);
  }

  function skipSheet(due) {
    const next = addMonths(due, 1);
    openSheet(`
      <h4>Skip the ${monthName(due)} instalment?</h4>
      <p class="muted">Only ${monthName(due)} is skipped. Your SIP continues automatically from ${fmtDate(next)}.</p>
      <p class="src">Source: <a href="https://groww.in/help/mutual-funds/order/can-i-pause-sip-for-next-month" target="_blank" rel="noopener">Groww Help, skip an instalment</a></p>
      <button class="btn primary" id="skipYes">Skip ${monthName(due)}</button>
      <button class="btn" id="skipNo">Cancel</button>`);
    $('#skipYes').onclick = () => { state.skipsInRow++; closeSheet(); const from = current; toast(`${monthName(due)} skipped. Next instalment ${fmtDate(next)}. (Simulated)`); if (from === 'reminder') { reminder(); markDone('reminder'); } else markDone(from); };
    $('#skipNo').onclick = closeSheet;
  }

  function lowerSheet(due) {
    openSheet(`
      <h4>Lower the ${monthName(due)} amount</h4>
      <p class="muted">This change applies to ${monthName(due)} only. From next month your SIP goes back to ${fmtINR(SIP.amount)}.</p>
      <input type="number" id="amt" min="${SIP.min}" max="${SIP.amount}" step="100" value="1000" aria-label="Amount for this month">
      <p class="src" id="amtMsg">Minimum ${fmtINR(SIP.min)} (example scheme minimum).</p>
      <button class="btn primary" id="amtYes">Confirm</button>
      <button class="btn" id="amtNo">Cancel</button>`);
    $('#amtYes').onclick = () => {
      const v = Number($('#amt').value);
      if (!v || v < SIP.min || v >= SIP.amount) { $('#amtMsg').textContent = `Enter an amount from ${fmtINR(SIP.min)} to ${fmtINR(SIP.amount - 100)}.`; return; }
      state.skipsInRow = 0; closeSheet(); toast(`${monthName(due)}: ${fmtINR(v)}. Back to ${fmtINR(SIP.amount)} next month. (Simulated)`); markDone('reminder');
    };
    $('#amtNo').onclick = closeSheet;
  }

  function detail() {
    screen.innerHTML = `
      <div class="topbar"><button class="icon-btn" data-go="home" aria-label="Back">←</button><h3>SIP details</h3></div>
      <div class="card">
        <div style="font-weight:600">${SIP.fund}</div>
        <div class="list-item"><span class="muted">Amount</span><span>${fmtINR(SIP.amount)}</span></div>
        <div class="list-item"><span class="muted">Date</span><span>${SIP.day}th of every month</span></div>
        <div class="list-item"><span class="muted">Status</span><span>${state.stopped ? 'Stopped' : state.plan ? 'Paused, restart planned' : 'Active'}</span></div>
      </div>
      <button class="btn" id="edit">Edit SIP</button>
      <button class="btn" id="stop" ${state.stopped ? 'disabled' : ''}>Stop SIP</button>
      ${annot(4, 'Unchanged entry point. The change happens after tapping Stop SIP.')}`;
    $('#edit').onclick = () => toast('Edit amount and date: existing feature, not part of this concept.');
    const st = $('#stop'); if (st) st.onclick = stopSheet;
  }

  function stopSheet() {
    const due = nextSipDate();
    openSheet(`
      <h4>Before you stop</h4>
      <p>If this is a tight patch, you can pause and choose when to restart. Units you already hold stay invested either way.</p>
      <p class="src">Source: <a href="https://www.edelweissmf.com/investor-insights/mutual-fund-investment-tips-and-articles/how-to-stop-or-pause-an-sip" target="_blank" rel="noopener">Edelweiss MF, stopping or pausing a SIP</a></p>
      ${annot(5, 'New sheet. Today Stop SIP goes straight to confirmation, and a "temporary" stop often becomes permanent (P2, P4). All three options have equal weight: Stop is never hidden.')}
      <button class="btn equal" id="planBtn">Pause and plan a restart</button>
      <button class="btn equal" id="skipBtn" ${state.skipsInRow >= 2 ? 'disabled' : ''}>Skip just this month</button>
      <button class="btn equal" id="stopBtn">Stop SIP</button>`);
    $('#planBtn').onclick = () => { closeSheet(); openAssistant('plan'); };
    const sb = $('#skipBtn'); if (sb) sb.onclick = () => { closeSheet(); skipSheet(due); };
    $('#stopBtn').onclick = () => {
      state.stopped = true; closeSheet();
      toast('SIP stopped. Units you hold stay invested. (Simulated)'); detail(); markDone('detail');
    };
  }

  function restart() {
    const amt = SIP.amount;
    const planned = state.plan ? new Date(state.plan.date) : new Date();
    screen.innerHTML = `
      <div class="notif">
        <div class="app">SIP reminder · today</div>
        <div><b>You planned to restart your SIP today.</b></div>
        <div class="muted" style="font-size:13.5px">${SIP.fund} · planned ${fmtDate(planned)}</div>
      </div>
      ${annot(6, 'New: the restart has a date and a one-tap action, instead of an open-ended "next month" that keeps sliding (P2, P4).')}
      <div class="card">
        <p style="margin-top:0">Restart with one tap?</p>
        <button class="btn primary" id="rs">Restart at ${fmtINR(amt)}</button>
        <div class="btn-grid" style="margin-top:8px">
          <button class="btn" id="rsSmall">Restart smaller</button>
          <button class="btn" id="rsMove">Move the date</button>
        </div>
        <button class="btn" id="rsNot">Not now</button>
        <p class="src">${state.postpones >= 2 ? "You've moved this twice, so no more reminders will be sent unless you set a new date." : 'Restarting sets up the SIP again with the same fund and amount. You can change both.'}</p>
        ${annot(7, 'Guardrail: after 2 postponements reminders stop, so it never turns into nagging.')}
      </div>`;
    $('#rs').onclick = () => { state.stopped = false; state.plan = null; state.skipsInRow = 0; toast(`SIP restarted at ${fmtINR(amt)}. (Simulated)`); markDone('restart'); };
    $('#rsSmall').onclick = () => lowerRestart();
    $('#rsMove').onclick = () => moveDate();
    $('#rsNot').onclick = () => { state.postpones++; moveDate(true); };
  }

  function lowerRestart() {
    openSheet(`
      <h4>Restart at a smaller amount</h4>
      <input type="number" id="ramt" min="${SIP.min}" step="100" value="1000" aria-label="Restart amount">
      <p class="src" id="ramtMsg">Minimum ${fmtINR(SIP.min)} (example scheme minimum).</p>
      <button class="btn primary" id="ramtYes">Restart</button>
      <button class="btn" id="ramtNo">Cancel</button>`);
    $('#ramtYes').onclick = () => {
      const v = Number($('#ramt').value);
      if (!v || v < SIP.min) { $('#ramtMsg').textContent = `Minimum is ${fmtINR(SIP.min)}.`; return; }
      state.stopped = false; state.plan = null; closeSheet(); toast(`SIP restarted at ${fmtINR(v)}. (Simulated)`); markDone('restart');
    };
    $('#ramtNo').onclick = closeSheet;
  }

  function moveDate(fromNotNow) {
    const min = new Date(); min.setDate(min.getDate() + 1);
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    openSheet(`
      <h4>${fromNotNow ? 'When would suit you?' : 'Pick a new restart date'}</h4>
      <input type="date" id="nd" min="${iso(min)}" value="${iso(addMonths(min, 1))}">
      <button class="btn primary" id="ndYes">Save date</button>
      <button class="btn" id="ndNo">Cancel</button>`);
    $('#ndYes').onclick = () => {
      const v = $('#nd').value; if (!v) return;
      state.plan = { date: v + 'T00:00:00' }; closeSheet();
      toast(`Restart planned for ${fmtDate(new Date(v + 'T00:00:00'))}. (Simulated)`); restart(); markDone('restart');
    };
    $('#ndNo').onclick = closeSheet;
  }

  // ---------- assistant ----------
  const panel = $('#assistant'), aBody = $('#aBody'), aForm = $('#aForm'), aText = $('#aText');
  let mode = 'qa';

  function openAssistant(m) {
    mode = m; aBody.innerHTML = ''; state.planTries = 0;
    $('#aTitle').textContent = m === 'plan' ? 'Plan your restart' : 'SIP assistant';
    panel.hidden = false; document.body.classList.add('a-open');
    if (m === 'plan') {
      bot(`Pausing can help through a tight month. Let's pick a realistic restart date.<br><br><b>When does your salary or income usually arrive each month?</b>`);
      aText.placeholder = 'For example: salary comes on the 1st';
    } else {
      bot(`Ask me how skipping, pausing, stopping or restarting a SIP works. I answer only from official and cited sources, and I can't give investment advice.`);
      asked.clear();
      suggest(null);
      aText.placeholder = 'Ask about skipping, pausing or restarting';
    }
    aText.focus();
  }
  $('#aClose').onclick = () => { panel.hidden = true; document.body.classList.remove('a-open'); };
  $('#fab').onclick = () => openAssistant('qa');
  $('#exitFocus').onclick = () => { document.body.classList.remove('focus'); panel.hidden = true; document.body.classList.remove('a-open'); closeSheet(); window.scrollTo(0, 0); };

  // suggested questions; after every answer the assistant offers the ones not yet asked
  const SUGGESTED = ['How do I skip this month?', 'What happens to my units if I stop?', 'What if my SIP payment fails?', 'Can I change my SIP date?', 'If I stop, can I restart later?'];
  const asked = new Set();
  function suggest(lead) {
    const old = aBody.querySelector('.followup'); if (old) old.remove();
    const left = SUGGESTED.filter(q => !asked.has(q)).slice(0, 3);
    const w = document.createElement('div'); w.className = 'followup';
    w.innerHTML = lead ? `<div class="f-lead">${lead}</div>` : '';
    const c = document.createElement('div'); c.className = 'chips';
    left.forEach(t => { const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = t; b.onclick = () => send(t); c.appendChild(b); });
    w.appendChild(c);
    const hint = document.createElement('div'); hint.className = 'f-hint'; hint.textContent = 'Or type your own question below.';
    w.appendChild(hint);
    aBody.appendChild(w); aBody.scrollTop = aBody.scrollHeight;
  }

  function bot(html, cls = '') {
    const d = document.createElement('div'); d.className = 'msg bot ' + cls; d.innerHTML = html;
    aBody.appendChild(d); aBody.scrollTop = aBody.scrollHeight; return d;
  }
  function user(text) {
    const d = document.createElement('div'); d.className = 'msg user'; d.textContent = text;
    aBody.appendChild(d); aBody.scrollTop = aBody.scrollHeight;
  }

  function loadCount() { try { return Number(sessionStorage.getItem('msgCount') || 0); } catch { return state.msgCount; } }
  function saveCount(n) { state.msgCount = n; try { sessionStorage.setItem('msgCount', String(n)); } catch { /* storage unavailable */ } }

  aForm.addEventListener('submit', e => { e.preventDefault(); const t = aText.value.trim(); if (t) send(t); });

  async function send(text) {
    aText.value = ''; asked.add(text);
    const old = aBody.querySelector('.followup'); if (old) old.remove();
    user(text);
    const n = loadCount();
    if (n >= MAX_MSGS) { bot('This demo allows ' + MAX_MSGS + ' messages per visit. Thanks for trying it.', 'fallback'); return; }
    saveCount(n + 1);
    const typing = bot('<span class="typing">Checking sources…</span>');
    let data;
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, message: text }) });
      data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Request failed');
    } catch (err) {
      typing.remove();
      bot(`Sorry, I couldn't reach the assistant just now. ${esc(err.message || '')}`, 'fallback');
      if (mode === 'qa') suggest('You can try again or ask something else.');
      return;
    }
    typing.remove();
    render(data);
    if (mode === 'qa') suggest('Anything else I can help you with?');
  }

  function render(d) {
    if (d.type === 'answer') {
      const cites = (d.citations || []).map(c => `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}${c.status === 'secondary' ? ' (secondary)' : ''}</a>`).join('');
      bot(`${esc(d.text)}<div class="cites">${cites}</div><div class="checked">✓ Checked: sourced · not advice · no pressure</div>`);
    } else if (d.type === 'fallback') {
      bot(`${esc(d.text)}${d.link ? `<div class="cites"><a href="${esc(d.link)}" target="_blank" rel="noopener">Official help</a></div>` : ''}`, 'fallback');
    } else if (d.type === 'clarify') {
      state.planTries++;
      if (state.planTries >= 2) { datePicker('No problem. Pick a restart date that works for you:'); return; }
      bot(esc(d.text));
    } else if (d.type === 'plan') {
      const m = bot(`${esc(d.text)}<div class="src">How this date is chosen: ${esc(d.rule)}. The assistant only reads your payday; the date is calculated by a fixed rule.</div><div class="actions"><button class="btn primary" type="button">Yes, plan it</button><button class="btn" type="button">Pick another date</button></div>`);
      const [yes, other] = m.querySelectorAll('button');
      yes.onclick = () => savePlan(d.date_iso);
      other.onclick = () => datePicker('Pick a restart date:');
    }
  }

  function datePicker(label) {
    const min = new Date(); min.setDate(min.getDate() + 1);
    const iso = `${min.getFullYear()}-${String(min.getMonth() + 1).padStart(2, '0')}-${String(min.getDate()).padStart(2, '0')}`;
    const m = bot(`${esc(label)}<input type="date" min="${iso}"><div class="actions"><button class="btn primary" type="button">Save</button></div>`);
    m.querySelector('button').onclick = () => { const v = m.querySelector('input').value; if (v) savePlan(v); };
  }

  function savePlan(dateIso) {
    const date = new Date(dateIso + 'T00:00:00');
    let skipsNeeded = 0, d = nextSipDate();
    while (d < date) { skipsNeeded++; d = addMonths(d, 1); }
    state.plan = { date: dateIso + 'T00:00:00' };
    markDone('detail');
    const total = skipsNeeded + state.skipsInRow;
    const how = total <= 2
      ? (skipsNeeded === 0 ? `No instalment is due before then, so nothing changes until ${fmtDate(date)}.`
                           : `Your SIP will skip ${skipsNeeded === 1 ? 'the next instalment' : 'the next 2 instalments'} and continue automatically from then.`)
      : `That would mean ${total} missed instalments in a row, and skipping 3 in a row can cancel a SIP. So your SIP will be stopped now (units stay invested) and a one-tap restart with the same fund and amount will be ready on ${fmtDate(date)}.`;
    bot(`<b>Restart planned for ${fmtDate(date)}.</b> ${how} We'll remind you that day.<div class="src">(Simulated)</div><div class="actions"><button class="btn" type="button">See restart day</button></div>`)
      .querySelector('button').onclick = () => { panel.hidden = true; document.body.classList.remove('a-open'); restart(); showTask(null); taskEl.innerHTML = `<div class="t-label">Your plan</div><p class="t-story">This is what you would see on your restart day.</p>`; };
  }

  // ---------- routing ----------
  const routes = { home, reminder, detail, restart };
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (!g) return;
    panel.hidden = true; document.body.classList.remove('a-open'); closeSheet();
    clearTimeout(toastTimer); toastEl.hidden = true;
    const key = routes[g.dataset.go] ? g.dataset.go : 'home';
    if (SCEN[key]) {
      // each scenario starts fresh, so the story always matches the screen
      Object.assign(state, { skipsInRow: 0, plan: null, postpones: 0, stopped: key === 'restart', planTries: 0 });
      showTask(key);
    }
    routes[key]();
    // on phones a scenario opens as a full-screen app view
    if (SCEN[key] && window.matchMedia('(max-width: 820px)').matches) { document.body.classList.add('focus'); window.scrollTo(0, 0); }
  });

  // annotations: on by default for reviewers, off in test mode (?test=1)
  const annot0 = params.has('annot') ? params.get('annot') === '1' : !TEST;
  const annotBox = $('#annotToggle');
  annotBox.checked = annot0; document.body.classList.toggle('show-annot', annot0);
  annotBox.addEventListener('change', e => document.body.classList.toggle('show-annot', e.target.checked));
  if (TEST) document.body.classList.add('test');

  // view: phone frame (default) or full width (?frame=0)
  function setFrame(on) {
    document.body.classList.toggle('frameless', !on);
    $('#viewFrame').classList.toggle('active', on); $('#viewFull').classList.toggle('active', !on);
  }
  setFrame(params.get('frame') !== '0');
  $('#viewFrame').onclick = () => setFrame(true);
  $('#viewFull').onclick = () => setFrame(false);
  const now = new Date(); $('#clock').textContent = now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[ap]m/i, '');
  home(); showTask(null);
})();
