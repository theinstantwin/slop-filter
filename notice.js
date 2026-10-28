/**
 * Builds the flag notice. Pure rendering — it holds no state and never
 * touches storage. All styling lives inside the shadow root so LinkedIn's
 * stylesheet cannot reach it and no !important is needed.
 */

const CSS = `
:host { display:block; }
/* The wash is brand red at 12% over white. 9% was too easy to scroll past;
   18% starts reading as an error state at density. The wordmark and toggle are
   darkened from #C62D18/#0A66C2 because at this tint depth the lighter pair
   measures 4.6:1 and 4.9:1 — under the 4.5:1 AA floor once antialiasing eats
   into it. Measured, not eyeballed. */
.wrap {
  background:#F8E6E3; color:#12212B;
  border-bottom:1px solid rgba(0,0,0,.08);
  border-radius:7px 7px 0 0;
  padding:9px 16px;
  display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  font-family:Geist,-apple-system,system-ui,sans-serif;
}
:host([data-collapsed="true"]) .wrap { border-radius:7px; border-bottom:0; }
/* Sits at the same x-position as a post's avatar, so a saturated circle
   breaks a pattern the eye is already scanning down the feed. This is what
   makes the notice catchable at scroll speed without a louder wash. */
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
.chips { display:flex; gap:5px; flex-wrap:wrap; }
/* B0: tinted fill rather than the old solid-red chip. Solid fills competed
   with the glyph for the one saturated accent in the row; the tint lets the
   glyph lead and keeps the badges as supporting detail. */
.chip {
  font-family:Geist,-apple-system,system-ui,sans-serif;
  font-size:11.5px; font-weight:600;
  color:#9E1B0B; background:rgba(198,45,24,.10);
  border-radius:3px; padding:3px 7px;
}
.chip .n { font-variant-numeric:tabular-nums; opacity:.75; margin-left:4px; }
/* LinkedIn's own blue, darkened for AA on the wash. Inheriting the platform's
   action colour means the affordance is already learned. */
.toggle {
  margin-left:auto; flex-shrink:0;
  font-family:inherit; font-size:13px; font-weight:600;
  color:#0854A0; background:none; border:0;
  padding:6px 8px; border-radius:4px; cursor:pointer;
}
.toggle:hover { background:rgba(0,0,0,.08); }
/* The bar is the click target (see buildNotice). Hover deepens the wash one
   step and nothing moves; popovers and the reasons list are excluded so
   pointing at them doesn't light up the whole bar. */
.wrap { cursor:pointer; transition:background-color .12s ease; position:relative; }
.wrap:hover:not(:has(.anchor:hover, .detail:hover, .hint:hover)) { background-color:#F4DCD7; }
.toggle:focus-visible, .link:focus-visible, .step button:focus-visible,
[data-trigger]:focus-visible { outline:2px solid #0854A0; outline-offset:2px; }

/* The notice is rebuilt on every toggle (renderNotice replaces the node), so
   the reveal is a one-shot entrance ANIMATION, not a transition. Collapse has
   no exit animation — the node is destroyed — which reads as a quick close. */
@keyframes sf-unfold { from { grid-template-rows:0fr; } to { grid-template-rows:1fr; } }
@keyframes sf-settle { from { opacity:0; transform:translateY(-4px); } }
/* The hairline spans the notice's full width: the negative margins cancel the
   bar's 16px side padding, and the basis adds it back so the row still fits. */
.detail {
  flex-basis:calc(100% + 32px); margin:9px -16px 0; cursor:auto;
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
/* The text is the list item so its marker is a real red disc; the row stays a
   flex line so "Change in Settings" can sit at the right edge. */
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

/* Popovers. The anchor wraps trigger + card so moving the pointer from one to
   the other never leaves the anchor (no hover gap, no timers). */
.anchor { position:relative; display:inline-flex; align-items:center; }
.anchor[data-trigger-pig] { flex-shrink:0; }
[data-trigger] { cursor:pointer; }
.pop { display:none; position:absolute; left:0; top:100%; z-index:5; padding-top:6px; cursor:auto; }
.anchor[data-open="true"] .pop { display:block; }
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
.anchor[data-open="true"] .chip { background:#E6BAB1; }
/* The pig twitches snout and ears twice, once, the first time a notice renders. */
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

/* The pig badge: the logo's pig mark, viewBox cropped to the
   circle so it fills the 22px slot the old "S" glyph used. */
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

/* setThreshold clamps at this ceiling, so the stepper's + stops here. */
const LIMIT_CEILING = 15;
const LIMIT_FLOOR = 2;

const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : '');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function linkBtn(text, cls = '') {
  const b = el('button', ('link ' + cls).trim(), text);
  b.type = 'button';
  return b;
}

function card(title) {
  const c = el('div', 'card');
  c.appendChild(el('div', 't', title));
  return c;
}

/**
 * The notice: a bar (pig, wordmark, author, chips, toggle) and, when opened,
 * a bulleted list of reasons, each with a "Change in Settings" link. The
 * pig and counting chips carry hover popovers; phrase chips are plain labels.
 *
 * onAction(action, payload): 'toggle', 'mute' (author),
 * 'setLimit' ({filterId, n}), 'openSettings' ({panel} or {cat, phrase?}),
 * 'dismissHint'.
 *
 * openKey/openFocus reopen a popover after the host rebuilds the notice (the
 * stepper changes settings, which re-judges the feed).
 */
function buildNotice({ matches, author, collapsed = true, showHint = false,
  openKey = null, openFocus = null, twitch = false, onAction = () => {} }) {
  const host = document.createElement('div');
  host.dataset.sfNotice = 'true';
  host.dataset.collapsed = String(collapsed);
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  const wrap = el('div', 'wrap');
  const anchors = [];
  let hint = null;
  let hintDismissed = false;

  function setOpen(a, on) {
    a.dataset.open = String(on);
    a.querySelector('[data-trigger]').setAttribute('aria-expanded', String(on));
  }
  function open(a) {
    for (const o of anchors) if (o !== a && o.dataset.open === 'true') setOpen(o, false);
    setOpen(a, true);
  }
  function close(a) { setOpen(a, false); }
  function dismissHint() {
    if (hintDismissed) return;
    hintDismissed = true;
    hint?.remove();
    hint = null;
    onAction('dismissHint');
  }

  /* trigger + popover card in one hover/focus/click unit */
  function makeAnchor(key, trigger, cardEl, label, isPig) {
    const a = el('span', 'anchor');
    a.dataset.pop = key;
    if (isPig) a.dataset.triggerPig = 'true';
    trigger.dataset.trigger = 'true';
    trigger.tabIndex = 0;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', label);
    const pop = el('div', 'pop');
    cardEl.setAttribute('role', 'dialog');
    cardEl.setAttribute('aria-label', cardEl.firstChild.textContent);
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
  const glyph = el('span', 'glyph');
  glyph.innerHTML = PIG_BADGE; // static constant, no page data
  if (twitch) glyph.classList.add('react');
  if (author) {
    const c = card(`Mute ${author}?`);
    const d = el('div', 'd');
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
    wrap.appendChild(makeAnchor('pig', glyph, c, `Mute ${author}?`, true));
  } else {
    glyph.setAttribute('aria-hidden', 'true');
    wrap.appendChild(glyph);
  }

  wrap.appendChild(el('span', 'mark', 'Slop Filter'));

  // Collapsed posts show nothing but this bar, so the notice has to say whose
  // post it is.
  if (author) {
    const by = el('span', 'author', author);
    by.dataset.author = author;
    wrap.appendChild(by);
  }

  const chips = el('div', 'chips');
  const seen = new Set();
  for (const m of matches) {
    if (seen.has(m.filterName)) continue;
    seen.add(m.filterName);
    const chip = el('span', 'chip', m.filterName);
    chip.dataset.chip = m.filterName;
    if (m.counting) {
      chip.appendChild(el('span', 'n', String(m.count)));
      chips.appendChild(makeAnchor(m.filterName, chip, buildLimitCard(m, onAction),
        `${m.filterName}, ${m.count}. Adjust limit`, false));
    } else {
      chips.appendChild(chip); // plain label: phrases are changed in Settings
    }
  }
  wrap.appendChild(chips);

  const toggle = el('button', 'toggle', collapsed ? 'Show post' : 'Hide post');
  toggle.dataset.toggle = 'true';
  wrap.appendChild(toggle);

  // The whole bar toggles, both ways. The button stays for keyboard users; its
  // click bubbles here (one toggle, not two). Clicks inside a popover, the
  // hint or the reasons never toggle.
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('.anchor, .hint, .detail')) return;
    onAction('toggle');
  });
  root.addEventListener('click', (e) => {
    if (!e.target.closest('.anchor')) anchors.forEach(close);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const a of anchors) {
      if (a.dataset.open !== 'true') continue;
      const hadFocus = a.contains(root.activeElement);
      close(a);
      if (hadFocus) a.querySelector('[data-trigger]').focus();
    }
  });

  if (!collapsed) {
    const detail = el('div', 'detail');
    const inner = el('div', 'inner');
    const why = el('div', 'why');
    const ul = document.createElement('ul');
    const done = new Set();
    for (const m of matches) {
      const key = m.counting ? m.filterId : `${m.filterId}|${m.rule || m.phrase}`;
      if (done.has(key)) continue;
      done.add(key);
      const li = document.createElement('li');
      li.dataset.reason = m.counting ? 'count' : 'phrase';
      const tx = el('span', 'tx');
      if (m.counting) {
        tx.append(`${cap(m.unit)}: ${m.limit} or more `, el('span', 'dim', `(this post has ${m.count})`));
      } else {
        tx.append('Phrase: ', el('span', 'q', `“${m.phrase}”`));
      }
      const chg = el('button', 'chg', 'Change in ');
      chg.type = 'button';
      chg.dataset.change = 'true';
      chg.appendChild(el('u', '', 'Settings'));
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
    hint = el('div', 'hint');
    hint.setAttribute('role', 'note');
    hint.dataset.hint = 'true';
    hint.appendChild(el('span', '', 'Tip: hover the pig to mute someone, or a tag to adjust it.'));
    const got = linkBtn('Got it', 'inline');
    got.dataset.gotit = 'true';
    got.addEventListener('click', dismissHint);
    hint.appendChild(got);
    wrap.appendChild(hint);
  }

  root.appendChild(wrap);

  // Reopen after a rebuild, then put keyboard focus back on the pressed button.
  host.sfRestore = () => {
    const a = anchors.find(x => x.dataset.pop === openKey);
    if (!a) return;
    open(a);
    if (openFocus) a.querySelector(`[data-step="${openFocus}"]`)?.focus();
  };
  return host;
}

function buildLimitCard(m, onAction) {
  let limit = m.limit;
  const c = card(m.filterName);
  const d = el('div', 'd');
  c.appendChild(d);
  const step = el('div', 'step');
  const dec = el('button', '', '−');
  const inc = el('button', '', '+');
  dec.type = inc.type = 'button';
  dec.dataset.step = '-1';
  inc.dataset.step = '1';
  dec.setAttribute('aria-label', 'Flag at one fewer');
  inc.setAttribute('aria-label', 'Flag at one more');
  const val = document.createElement('b');
  val.dataset.limit = 'true';
  const lab = el('span', '', 'Flag at ');
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

/**
 * Replaces a notice after the reader mutes its author: a quiet card with Undo.
 * onAction('undoMute', author).
 */
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

function buildMutedCard({ author, onAction = () => {} }) {
  const host = document.createElement('div');
  host.dataset.sfNotice = 'true';
  host.dataset.sfMutedCard = 'true';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = MUTED_CSS;
  const c = el('div', 'card');
  c.setAttribute('role', 'status');
  c.appendChild(el('span', 'msg', `${author} is muted. Their posts won’t appear.`));
  const undo = el('button', 'undo', 'Undo');
  undo.type = 'button';
  undo.dataset.undo = 'true';
  undo.addEventListener('click', () => onAction('undoMute', author));
  c.appendChild(undo);
  root.append(style, c);
  return host;
}

if (typeof module !== 'undefined') module.exports = { buildNotice, buildMutedCard, CSS };
