/**
 * Builds the flag notice and the muted-author card. Pure rendering: no state,
 * no storage; user actions go out through onAction. Styling lives in a shadow
 * root so LinkedIn's stylesheet can't reach it.
 */

const NOTICE_CSS = `
:host { display:block; }
/* The wash is brand red at 12% over white: 9% is easy to scroll past, 18%
   reads as an error. The wordmark and toggle use darker reds and blues than the
   brand pair (#C62D18/#0A66C2), which measure 4.6:1 and 4.9:1 on this tint,
   too close to the 4.5:1 AA floor once antialiasing is counted. */
.wrap {
  background:#F8E6E3; color:#12212B;
  border-bottom:1px solid rgba(0,0,0,.08);
  border-radius:7px 7px 0 0;
  padding:9px 16px;
  font-family:Geist,-apple-system,system-ui,sans-serif;
}
/* The bar is always one line; tags that don't fit collapse into "+N" (see
   fit() in buildNotice). The reasons list sits below it. */
.bar { display:flex; align-items:center; gap:8px; flex-wrap:nowrap; min-width:0; }
:host([data-collapsed="true"]) .wrap { border-radius:7px; border-bottom:0; }
/* Aligned with a post's avatar column so a saturated circle interrupts the
   pattern the eye is already scanning, which lets a quiet wash stay catchable
   at scroll speed. */
.glyph { width:22px; height:22px; flex-shrink:0; display:block; }
.mark {
  font-family:"SlopFilter Display",Rosario,-apple-system,system-ui,sans-serif;
  font-weight:700;
  font-size:13px; text-transform:uppercase; letter-spacing:.07em;
  color:#9E1B0B; flex-shrink:0;
}
.author {
  font-size:12px; color:rgba(0,0,0,.6); flex-shrink:0;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;
}
.chips { display:flex; gap:5px; flex-wrap:nowrap; flex:1 1 0; min-width:0; }
.chips > * { flex:none; }
.chip { white-space:nowrap; }
.more {
  font-family:inherit; font-size:11.5px; font-weight:600; white-space:nowrap;
  color:#9E1B0B; background:none; border:1px dashed rgba(158,27,11,.4);
  border-radius:3px; padding:2px 7px; cursor:pointer;
}
.anchor[data-open="true"] > .more, .more:hover { background:rgba(198,45,24,.10); border-style:solid; }
.anchor[hidden] { display:none; }
.anchor[data-more] .pop { left:auto; right:0; }
.anchor[data-more] > .pop > .card { width:auto; min-width:0; } /* the +N list only, not a card nested in it */
.rest { display:flex; flex-direction:column; align-items:flex-start; gap:6px; }
/* Tinted, not solid: a solid chip would compete with the pig for the row's one
   saturated accent. */
.chip {
  font-family:Geist,-apple-system,system-ui,sans-serif;
  font-size:11.5px; font-weight:600;
  color:#9E1B0B; background:rgba(198,45,24,.10);
  border-radius:3px; padding:3px 7px;
}
.chip .n { font-variant-numeric:tabular-nums; opacity:.75; margin-left:4px; }
/* LinkedIn's action blue, darkened for AA on the wash, so the affordance is
   already familiar. */
.toggle {
  margin-left:auto; flex-shrink:0; white-space:nowrap;
  font-family:inherit; font-size:13px; font-weight:600;
  color:#0854A0; background:none; border:0;
  padding:6px 8px; border-radius:4px; cursor:pointer;
}
.toggle:hover { background:rgba(0,0,0,.08); }
/* The bar is the click target (see buildNotice). Hover deepens the wash;
   popovers and the reasons list are excluded from the hover state. */
.wrap { cursor:pointer; transition:background-color .12s ease; position:relative; }
.wrap:hover:not(:has(.anchor:hover, .detail:hover, .hint:hover)) { background-color:#F4DCD7; }
.toggle:focus-visible, .link:focus-visible, .step button:focus-visible,
[data-trigger]:focus-visible { outline:2px solid #0854A0; outline-offset:2px; }

/* The notice node is rebuilt on every toggle, so the reveal is an entrance
   animation rather than a transition; collapsing has no exit animation. */
@keyframes sf-unfold { from { grid-template-rows:0fr; } to { grid-template-rows:1fr; } }
@keyframes sf-settle { from { opacity:0; transform:translateY(-4px); } }
/* Negative margins cancel the wrap's 16px side padding so the hairline spans
   the full width. */
.detail {
  margin:9px -16px 0; cursor:auto;
  border-top:1px solid rgba(176,40,26,.18);
  display:grid; grid-template-rows:1fr;
  animation:sf-unfold .22s cubic-bezier(.25,.7,.3,1);
}
.detail > .inner { overflow:hidden; min-height:0; }
.why {
  padding:10px 16px 3px 30px; font-size:13.5px; line-height:1.5;
  color:rgba(0,0,0,.78); animation:sf-settle .2s ease .07s backwards;
}
.why ul { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:6px; }
.why li { display:flex; align-items:center; gap:10px; }
/* The text is the list item so it gets a real marker; the row stays flex so
   "Change in Settings" can sit at the right edge. */
.why .tx { flex:1; display:list-item; list-style:disc; margin-left:16px; }
.why .tx::marker { color:#B0281A; }
.why .dim { color:rgba(0,0,0,.5); }
.q {
  font-family:"SF Mono",ui-monospace,Menlo,monospace;
  font-size:12.5px; color:#B0281A;
}
.chg {
  flex:none; background:none; border:0; padding:2px 0; cursor:pointer;
  font:inherit; font-size:12px; color:rgba(0,0,0,.5); white-space:nowrap;
}
.chg u { text-decoration:underline; text-underline-offset:2px; }
.chg:hover, .chg:focus-visible { color:#0A66C2; }
.chg:focus-visible { outline:2px solid #0854A0; outline-offset:2px; border-radius:2px; }

/* Popovers. The anchor wraps trigger and card so the pointer never leaves it
   between the two (no hover gap, no timers). */
.anchor { position:relative; display:inline-flex; align-items:center; }
.anchor[data-trigger-pig] { flex-shrink:0; }
[data-trigger] { cursor:pointer; }
.pop { display:none; position:absolute; left:0; top:100%; z-index:5; padding-top:6px; cursor:auto; }
.anchor[data-open="true"] > .pop { display:block; }
.card {
  background:#fff; border:1px solid rgba(0,0,0,.12); border-radius:8px;
  box-shadow:0 6px 20px rgba(0,0,0,.12); padding:10px 12px; width:236px;
  box-sizing:border-box; font-size:12.5px; line-height:1.45; color:rgba(0,0,0,.75);
  font-weight:400; text-transform:none; letter-spacing:0; text-align:left;
}
.card .t { font-weight:600; color:#1d1d1f; margin-bottom:2px; }
.card .d { color:rgba(0,0,0,.55); margin-bottom:8px; }
.card .ph { margin-bottom:2px; word-break:break-word; }
.link {
  display:block; background:none; border:0; padding:3px 0; cursor:pointer;
  font:inherit; font-weight:600; color:#0A66C2; text-align:left;
}
.link.inline { display:inline; padding:0; }
.link:hover { text-decoration:underline; }
.step { display:flex; align-items:center; gap:8px; }
.step button {
  display:grid; place-items:center; width:22px; height:22px; padding:0;
  background:none; border:1px solid rgba(0,0,0,.15); border-radius:4px;
  font:inherit; font-weight:600; color:#1d1d1f; cursor:pointer;
}
.step button:hover:not(:disabled) { background:rgba(0,0,0,.06); }
.step button:disabled { opacity:.35; cursor:default; }
.step b { font-weight:600; color:#1d1d1f; }
.hint {
  position:absolute; left:10px; top:calc(100% - 4px); z-index:4;
  display:flex; align-items:center; gap:10px; cursor:auto;
  background:#fff; border:1px solid rgba(0,0,0,.12); border-radius:8px;
  box-shadow:0 6px 20px rgba(0,0,0,.12); padding:7px 10px;
  font-size:12.5px; line-height:1.45; color:rgba(0,0,0,.75);
  font-weight:400; text-transform:none; letter-spacing:0;
}
.hint .link { color:rgba(0,0,0,.5); display:inline; padding:0; font-weight:500; }
.anchor[data-trigger-pig] [data-trigger] { border-radius:50%; display:block; }
.anchor[data-trigger-pig][data-open="true"] [data-trigger] { box-shadow:0 0 0 3px #EFCFC8; }
.anchor[data-open="true"] > .chip { background:#E6BAB1; }
/* The pig twitches twice, the first time a notice renders. */
.glyph svg { overflow:visible; }
.react .snout { animation:sf-snout .5s ease-in-out 2; transform-origin:64px 73px; transform-box:view-box; }
.react .earL { animation:sf-earL .5s ease-in-out 2; transform-origin:44px 40px; transform-box:view-box; }
.react .earR { animation:sf-earR .5s ease-in-out 2; transform-origin:84px 40px; transform-box:view-box; }
@keyframes sf-snout { 0%,100% { transform:none; } 30% { transform:translateY(-2px) scaleX(1.08); } 60% { transform:translateY(1px) scaleX(.96); } }
@keyframes sf-earL { 0%,100% { transform:none; } 40% { transform:rotate(-12deg); } }
@keyframes sf-earR { 0%,100% { transform:none; } 40% { transform:rotate(12deg); } }
@media (prefers-reduced-motion: reduce) {
  .react * { animation:none !important; }
  .detail, .why { animation:none; }
  .wrap { transition:none; }
}
`;

/* The logo's pig mark, viewBox cropped to the circle to fill the 22px slot. */
const PIG_BADGE =
  '<svg viewBox="16 16 96 96" width="22" height="22">' +
  '<circle cx="64" cy="64" r="48" fill="#C62D18"/>' +
  '<g transform="translate(64 64) scale(.9) translate(-64 -59)">' +
  '<path class="earL" d="M36 50 Q30 34 36 27 Q44 26 56 38 Z" fill="#FEFDFB" stroke="#FEFDFB" stroke-width="4" stroke-linejoin="round"/>' +
  '<path class="earR" d="M92 50 Q98 34 92 27 Q84 26 72 38 Z" fill="#FEFDFB" stroke="#FEFDFB" stroke-width="4" stroke-linejoin="round"/>' +
  '<ellipse cx="64" cy="64" rx="34" ry="28" fill="#FEFDFB"/>' +
  '<circle cx="50" cy="56" r="3.8" fill="#12212B"/>' +
  '<circle cx="78" cy="56" r="3.8" fill="#12212B"/>' +
  '<g class="snout">' +
  '<ellipse cx="64" cy="73" rx="18" ry="12.5" fill="#FEFDFB" stroke="#C62D18" stroke-width="4"/>' +
  '<ellipse cx="57.5" cy="73" rx="3" ry="5" fill="#C62D18"/>' +
  '<ellipse cx="70.5" cy="73" rx="3" ry="5" fill="#C62D18"/>' +
  '</g></g></svg>';

// Mirror THRESHOLD_MIN/MAX in storage.js, which isn't loaded under Node tests.
const LIMIT_CEILING = 15;
const LIMIT_FLOOR = 2;

const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : '');

function mkEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function linkBtn(text, cls = '') {
  const b = mkEl('button', ('link ' + cls).trim(), text);
  b.type = 'button';
  return b;
}

function card(title) {
  const c = mkEl('div', 'card');
  c.appendChild(mkEl('div', 't', title));
  return c;
}

/**
 * The notice: a bar (pig, wordmark, author, chips, toggle) and, when opened, a
 * list of reasons each linking to Settings. The pig and counting chips carry
 * hover popovers; phrase chips are plain labels.
 *
 * onAction(action, payload): 'toggle', 'mute' (author), 'setLimit'
 * ({filterId, n}), 'openSettings' ({panel} or {cat, phrase?}), 'dismissHint'.
 * openKey/openFocus reopen a popover after the host rebuilds the notice (the
 * stepper changes settings, which re-judges the feed).
 */
/** @param {{ [k: string]: any, onAction?: (action: string, payload?: any) => void }} opts */
function buildNotice({ matches, author, collapsed = true, showHint = false,
  openKey = null, openFocus = null, twitch = false, onAction = () => {} }) {
  const host = document.createElement('div');
  host.dataset.sfNotice = 'true';
  host.dataset.collapsed = String(collapsed);
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = NOTICE_CSS;
  root.appendChild(style);

  const wrap = mkEl('div', 'wrap');
  const bar = mkEl('div', 'bar');
  wrap.appendChild(bar);
  const anchors = [];
  let hint = null;
  let hintDismissed = false;

  function setOpen(a, on) {
    a.dataset.open = String(on);
    a.querySelector('[data-trigger]').setAttribute('aria-expanded', String(on));
    // Lift the notice while a popover is open so the card isn't painted under
    // the next post's notice.
    const anyOpen = anchors.some(x => x.dataset.open === 'true');
    host.style.position = anyOpen ? 'relative' : '';
    host.style.zIndex = anyOpen ? '20' : '';
  }
  function open(a) {
    // A tag nested inside "+N" keeps its parent open.
    for (const o of anchors) {
      if (o !== a && o.dataset.open === 'true' && !o.contains(a)) setOpen(o, false);
    }
    setOpen(a, true);
  }
  function close(a) { setOpen(a, false); }
  function dismissHint() {
    if (hintDismissed || !hint) return; // only the notice showing the tip reports it
    hintDismissed = true;
    hint?.remove();
    hint = null;
    onAction('dismissHint');
  }

  // Trigger plus popover card as one hover/focus/click unit.
  function makeAnchor(key, trigger, cardEl, label, isPig) {
    const a = mkEl('span', 'anchor');
    a.dataset.pop = key;
    if (isPig) a.dataset.triggerPig = 'true';
    trigger.dataset.trigger = 'true';
    trigger.tabIndex = 0;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', label);
    const pop = mkEl('div', 'pop');
    cardEl.setAttribute('role', 'dialog');
    if (!cardEl.hasAttribute('aria-label')) cardEl.setAttribute('aria-label', cardEl.firstChild.textContent);
    pop.appendChild(cardEl);
    a.append(trigger, pop);

    const show = () => { open(a); if (isPig) dismissHint(); };
    a.addEventListener('mouseenter', show);
    a.addEventListener('mouseleave', () => {
      if (!a.contains(root.activeElement)) close(a);
    });
    a.addEventListener('focusin', show);
    a.addEventListener('focusout', (e) => { if (!a.contains(e.relatedTarget)) close(a); });
    trigger.addEventListener('click', show);
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
    });
    anchors.push(a);
    return a;
  }

  // Pig: decorative unless there is an author to mute.
  const glyph = mkEl('span', 'glyph');
  glyph.innerHTML = PIG_BADGE; // static constant, no page data
  if (twitch) glyph.classList.add('react');
  if (author) {
    const c = card(`Mute ${author}?`);
    const d = mkEl('div', 'd');
    d.append('Hide every post. Can be undone in ');
    const set = linkBtn('Settings', 'inline');
    set.dataset.settings = 'true';
    set.addEventListener('click', () => onAction('openSettings', { panel: 'muted' }));
    d.append(set, '.');
    c.appendChild(d);
    const mute = linkBtn(`Mute ${author}`);
    mute.dataset.mute = 'true';
    mute.addEventListener('click', () => { onAction('mute', author); anchors.forEach(close); });
    c.appendChild(mute);
    bar.appendChild(makeAnchor('pig', glyph, c, `Mute ${author}?`, true));
  } else {
    glyph.setAttribute('aria-hidden', 'true');
    bar.appendChild(glyph);
  }

  bar.appendChild(mkEl('span', 'mark', 'Slop Filter'));

  // A collapsed post shows only this bar, so it names the author.
  if (author) {
    const by = mkEl('span', 'author', author);
    by.dataset.author = author;
    bar.appendChild(by);
  }

  const chips = mkEl('div', 'chips');
  const units = []; // each tag: a plain chip or a counting chip's anchor
  const seen = new Set();
  for (const m of matches) {
    if (seen.has(m.filterName)) continue;
    seen.add(m.filterName);
    const chip = mkEl('span', 'chip', m.filterName);
    chip.dataset.chip = m.filterName;
    if (m.counting) {
      chip.appendChild(mkEl('span', 'n', String(m.count)));
      units.push(makeAnchor(m.filterName, chip, buildLimitCard(m, onAction),
        `${m.filterName}, ${m.count}. Adjust limit`, false));
    } else {
      units.push(chip); // plain label: phrases are changed in Settings
    }
  }
  units.forEach(u => chips.appendChild(u));

  // "+N" holds the tags that don't fit. The tags themselves move into its card
  // (not copies), so a counting tag keeps its limit popover, nested.
  const moreBtn = mkEl('button', 'more');
  moreBtn.type = 'button';
  const rest = mkEl('div', 'card rest');
  rest.setAttribute('aria-label', 'More reasons');
  const moreAnchor = makeAnchor('more', moreBtn, rest, '', false);
  moreAnchor.dataset.more = 'true';
  moreAnchor.hidden = true;
  chips.appendChild(moreAnchor);
  bar.appendChild(chips);

  const toggle = mkEl('button', 'toggle', collapsed ? 'Show post' : 'Hide post');
  toggle.dataset.toggle = 'true';
  bar.appendChild(toggle);

  const TAG_GAP = 5;
  function setMore(n) {
    moreBtn.textContent = `+${n}`;
    moreBtn.setAttribute('aria-label', `${n} more ${n === 1 ? 'reason' : 'reasons'}`);
  }
  // Shows as many tags as fit and puts the rest behind "+N". Re-runs on resize.
  // Pig, wordmark, author and toggle keep their width; tags get what remains.
  function fit() {
    const active = root.activeElement;
    for (const u of units) chips.insertBefore(u, moreAnchor); // restore order
    moreAnchor.hidden = true;
    if (moreAnchor.dataset.open === 'true') setOpen(moreAnchor, false);
    else moreAnchor.dataset.open = 'false';
    if (!bar.offsetWidth) return; // not laid out (detached or display:none)
    const avail = chips.clientWidth;
    const w = units.map(u => u.offsetWidth);
    const upto = (k) => w.slice(0, k).reduce((a, b) => a + b, 0) + TAG_GAP * Math.max(0, k - 1);
    let k = units.length;
    if (upto(k) > avail) {
      moreAnchor.hidden = false;
      for (k = units.length - 1; k >= 0; k--) {
        setMore(units.length - k);
        const mw = moreAnchor.offsetWidth;
        if (upto(k) + (k ? TAG_GAP : 0) + mw <= avail) break;
      }
      k = Math.max(0, k);
      setMore(units.length - k);
      for (const u of units.slice(k)) rest.appendChild(u);
    }
    // A tag that was open before a rebuild may now be behind +N.
    if (units.slice(k).some(u => u.dataset?.open === 'true')) setOpen(moreAnchor, true);
    if (active && root.activeElement !== active) /** @type {HTMLElement} */ (active).focus?.();
  }
  /** @type {any} */ (host).sfFit = fit;
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(bar);

  // The whole bar toggles. The button remains for keyboard users and its click
  // bubbles here, so there is one toggle. Popover, hint and reasons clicks don't.
  wrap.addEventListener('click', (e) => {
    if (/** @type {Element} */ (e.target).closest('.anchor, .hint, .detail')) return;
    onAction('toggle');
  });
  root.addEventListener('click', (e) => {
    if (!/** @type {Element} */ (e.target).closest('.anchor')) anchors.forEach(close);
  });
  root.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
    if (e.key !== 'Escape') return;
    // Close the innermost popover first (a tag inside "+N"), then its parent.
    const opened = anchors.filter(a => a.dataset.open === 'true');
    for (const a of opened) {
      if (opened.some(o => o !== a && a.contains(o))) continue;
      const hadFocus = a.contains(root.activeElement);
      close(a);
      if (hadFocus) a.querySelector('[data-trigger]').focus();
    }
  });

  if (!collapsed) {
    const detail = mkEl('div', 'detail');
    const inner = mkEl('div', 'inner');
    const why = mkEl('div', 'why');
    const ul = document.createElement('ul');
    const done = new Set();
    for (const m of matches) {
      const key = m.counting ? m.filterId : `${m.filterId}|${m.rule || m.phrase}`;
      if (done.has(key)) continue;
      done.add(key);
      const li = document.createElement('li');
      li.dataset.reason = m.counting ? 'count' : 'phrase';
      const tx = mkEl('span', 'tx');
      if (m.counting) {
        tx.append(`${cap(m.unit)}: ${m.limit} or more `, mkEl('span', 'dim', `(this post has ${m.count})`));
      } else {
        tx.append('Phrase: ', mkEl('span', 'q', `“${m.phrase}”`));
      }
      const chg = mkEl('button', 'chg', 'Change in ');
      chg.type = 'button';
      chg.dataset.change = 'true';
      chg.appendChild(mkEl('u', '', 'Settings'));
      chg.setAttribute('aria-label', m.counting
        ? `Change ${m.filterName} in Settings`
        : `Change “${m.phrase}” in Settings`);
      chg.addEventListener('click', () => onAction('openSettings',
        m.counting ? { cat: m.filterId } : { cat: m.filterId, phrase: m.rule || m.phrase }));
      li.append(tx, chg);
      ul.appendChild(li);
    }
    why.appendChild(ul);
    inner.appendChild(why);
    detail.appendChild(inner);
    wrap.appendChild(detail);
  }

  if (showHint && author) {
    hint = mkEl('div', 'hint');
    hint.setAttribute('role', 'note');
    hint.dataset.hint = 'true';
    hint.appendChild(mkEl('span', '', 'Tip: hover the pig to mute someone, or a tag to adjust it.'));
    const got = linkBtn('Got it', 'inline');
    got.dataset.gotit = 'true';
    got.addEventListener('click', dismissHint);
    hint.appendChild(got);
    wrap.appendChild(hint);
  }

  root.appendChild(wrap);

  // Reopens a popover after a rebuild and restores focus to the pressed button.
  /** @type {any} */ (host).sfRestore = () => {
    const a = anchors.find(x => x.dataset.pop === openKey);
    if (!a) return;
    open(a);
    if (openFocus) a.querySelector(`[data-step="${openFocus}"]`)?.focus();
  };
  return host;
}

/** The counting chip's popover: a stepper that clamps to LIMIT_FLOOR..LIMIT_CEILING. */
function buildLimitCard(m, onAction) {
  let limit = m.limit;
  const c = card(m.filterName);
  const d = mkEl('div', 'd');
  c.appendChild(d);
  const step = mkEl('div', 'step');
  const dec = mkEl('button', '', '−');
  const inc = mkEl('button', '', '+');
  dec.type = inc.type = 'button';
  dec.dataset.step = '-1';
  inc.dataset.step = '1';
  dec.setAttribute('aria-label', 'Flag at one fewer');
  inc.setAttribute('aria-label', 'Flag at one more');
  const val = document.createElement('b');
  val.dataset.limit = 'true';
  const lab = mkEl('span', '', 'Flag at ');
  lab.setAttribute('aria-live', 'polite');
  lab.appendChild(val);
  step.append(dec, lab, inc);
  c.appendChild(step);

  const paint = () => {
    d.textContent = `Flags posts with ${limit} or more ${m.unit}.`;
    val.textContent = String(limit);
    dec.disabled = limit <= LIMIT_FLOOR;
    inc.disabled = limit >= LIMIT_CEILING;
  };
  paint();
  for (const b of [dec, inc]) {
    b.addEventListener('click', () => {
      const n = Math.max(LIMIT_FLOOR, Math.min(LIMIT_CEILING, limit + Number(b.dataset.step)));
      if (n === limit) return;
      limit = n;
      paint();
      onAction('setLimit', { filterId: m.filterId, n, focus: b.dataset.step });
    });
  }
  return c;
}

const MUTED_CSS = `
:host { display:block; }
.card {
  display:flex; align-items:center; gap:10px;
  background:#fff; border:1px solid #E0DFDC; border-radius:8px; padding:12px 16px;
  font-family:Geist,-apple-system,system-ui,sans-serif; font-size:13px;
  line-height:1.45; color:rgba(0,0,0,.7);
}
.undo {
  margin-left:auto; flex:none; background:none; border:0; padding:4px 6px;
  border-radius:4px; font:inherit; font-weight:600; color:#0854A0; cursor:pointer;
}
.undo:hover { background:rgba(0,0,0,.06); }
.undo:focus-visible { outline:2px solid #0854A0; outline-offset:2px; }
`;

/**
 * The card that replaces a notice after the reader mutes its author, with an
 * Undo button: onAction('undoMute', author).
 * @param {{ author: string, onAction?: (action: string, payload?: any) => void }} opts */
function buildMutedCard({ author, onAction = () => {} }) {
  const host = document.createElement('div');
  host.dataset.sfNotice = 'true';
  host.dataset.sfMutedCard = 'true';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = MUTED_CSS;
  const c = mkEl('div', 'card');
  c.setAttribute('role', 'status');
  c.appendChild(mkEl('span', 'msg', `${author} is muted. Their posts won’t appear.`));
  const undo = mkEl('button', 'undo', 'Undo');
  undo.type = 'button';
  undo.dataset.undo = 'true';
  undo.addEventListener('click', () => onAction('undoMute', author));
  c.appendChild(undo);
  root.append(style, c);
  return host;
}

Object.assign(typeof module !== 'undefined' ? module.exports : (globalThis.SlopFilter ||= {}), { buildNotice, buildMutedCard, CSS: NOTICE_CSS });
