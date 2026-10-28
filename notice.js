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
   step and nothing moves; the receipt is excluded so hovering an Allow row
   doesn't light up the whole bar. */
.wrap { cursor:pointer; transition:background-color .12s ease; }
.wrap:hover:not(:has(.detail:hover)) { background-color:#F4DCD7; }
.detail { cursor:auto; }
.toggle:focus-visible { outline:2px solid #0854A0; outline-offset:2px; }

/* The notice is rebuilt on every toggle (renderNotice replaces the node), so
   the reveal is a one-shot entrance ANIMATION, not a transition: the receipt
   unfolds, then its content settles in just behind the unfold. Collapse has
   no exit animation — the node is destroyed — which reads as a quick close. */
@keyframes sf-unfold { from { grid-template-rows:0fr; } to { grid-template-rows:1fr; } }
@keyframes sf-settle { from { opacity:0; transform:translateY(-4px); } }
.detail {
  flex-basis:100%; width:100%;
  display:grid; grid-template-rows:1fr;
  animation:sf-unfold .22s cubic-bezier(.25,.7,.3,1);
}
.detail > .inner { overflow:hidden; min-height:0; }
.receipt {
  background:#fff; border:1px solid rgba(0,0,0,.11);
  border-radius:4px; margin:6px 0 2px; overflow:hidden;
  animation:sf-settle .2s ease .07s backwards;
}
@media (prefers-reduced-motion: reduce) {
  .detail, .receipt { animation:none; }
  .wrap { transition:none; }
}
.lbl {
  display:flex; justify-content:space-between; gap:8px;
  font-size:12px; font-weight:600; color:rgba(0,0,0,.6);
  padding:7px 10px 6px; border-bottom:1px solid rgba(0,0,0,.08);
}
.lbl span { font-weight:400; color:rgba(0,0,0,.56); font-size:11.5px; }
.row {
  display:flex; align-items:center; gap:10px;
  padding:7px 10px; border-bottom:1px solid rgba(0,0,0,.08);
}
.row[data-allowed="true"] { opacity:.55; }
.cat {
  font-family:"SF Mono",ui-monospace,Menlo,monospace;
  font-size:9px; font-weight:600; letter-spacing:.04em;
  color:#fff; background:#C62D18; border-radius:2px;
  padding:2px 6px; width:90px; text-align:center; flex-shrink:0;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.row[data-allowed="true"] .cat { background:rgba(0,0,0,.45); }
.q {
  flex:1; min-width:0;
  font-family:"SF Mono",ui-monospace,Menlo,monospace;
  font-size:11.5px; line-height:1.55; color:#C62D18;
  text-decoration:line-through; text-decoration-thickness:1px;
}
.q small {
  text-decoration:none; display:inline-block; margin-left:6px;
  color:rgba(0,0,0,.56); font-family:Geist,-apple-system,system-ui,sans-serif;
  font-size:11px;
}
.q.count { text-decoration:none; }
.row[data-allowed="true"] .q { text-decoration:none; color:rgba(0,0,0,.45); }
.drop {
  flex-shrink:0; background:none; border:0; cursor:pointer;
  font-family:inherit; font-size:12px; font-weight:600;
  color:rgba(0,0,0,.6); padding:2px 8px; border-radius:3px; white-space:nowrap;
}
.drop:hover { background:#EAF5F1; color:#2C7C63; }
.row[data-allowed="true"] .drop { color:#2C7C63; background:#EAF5F1; }
.scope {
  font-size:11px; color:rgba(0,0,0,.56); padding:5px 10px 6px;
  border-top:1px solid rgba(0,0,0,.08);
}
.mute {
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  font-size:12px; color:rgba(0,0,0,.7); padding:6px 10px;
  border-top:1px solid rgba(0,0,0,.08);
}
`;

/* The pig badge: the logo's pig mark, viewBox cropped to the
   circle so it fills the 22px slot the old "S" glyph used. */
const PIG_BADGE =
  '<svg viewBox="16 16 96 96" width="22" height="22">' +
  '<circle cx="64" cy="64" r="48" fill="#C62D18"/>' +
  '<g transform="translate(64 64) scale(.9) translate(-64 -59)">' +
  '<path d="M36 50 Q30 34 36 27 Q44 26 56 38 Z" fill="#FEFDFB" stroke="#FEFDFB" stroke-width="4" stroke-linejoin="round"/>' +
  '<path d="M92 50 Q98 34 92 27 Q84 26 72 38 Z" fill="#FEFDFB" stroke="#FEFDFB" stroke-width="4" stroke-linejoin="round"/>' +
  '<ellipse cx="64" cy="64" rx="34" ry="28" fill="#FEFDFB"/>' +
  '<circle cx="50" cy="56" r="3.8" fill="#12212B"/>' +
  '<circle cx="78" cy="56" r="3.8" fill="#12212B"/>' +
  '<ellipse cx="64" cy="73" rx="18" ry="12.5" fill="#FEFDFB" stroke="#C62D18" stroke-width="4"/>' +
  '<ellipse cx="57.5" cy="73" rx="3" ry="5" fill="#C62D18"/>' +
  '<ellipse cx="70.5" cy="73" rx="3" ry="5" fill="#C62D18"/>' +
  '</g></svg>';

/* setThreshold clamps at this ceiling, so a raise past it could never take
   effect — rows at or above it show evidence with no dead button. */
const LIMIT_CEILING = 15;

/**
 * Two states, one button: Show post <-> Hide post.
 *
 * Collapsed shows the bar alone — chips are the summary. Expanded shows the
 * post AND the receipt together; the chips stay in the bar in both states
 * (chips-vanish-on-expand was tried and reverted — the bar losing its tags
 * read worse than the repeat). There is no separate "Why" state.
 */
function buildNotice({ matches, author, collapsed = true, onAction = () => {} }) {
  const host = document.createElement('div');
  host.dataset.sfNotice = 'true';
  host.dataset.collapsed = String(collapsed);
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'wrap';

  // Decorative: the wordmark beside it already names the extension, so a
  // screen reader announcing "S" would be noise.
  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.innerHTML = PIG_BADGE; // static constant, no page data
  glyph.setAttribute('aria-hidden', 'true');
  wrap.appendChild(glyph);

  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.textContent = 'Slop Filter';
  wrap.appendChild(mark);

  // Collapsed posts show nothing but this bar, so the notice has to say whose
  // post it is — otherwise "Mute <author>" in the ··· menu names a stranger.
  if (author) {
    const by = document.createElement('span');
    by.className = 'author';
    by.dataset.author = author;
    by.textContent = author;
    wrap.appendChild(by);
  }

  // Chips stay in the bar in both states — the bar keeps its identity while
  // the receipt repeats the tags per row.
  const chips = document.createElement('div');
  chips.className = 'chips';
  const seen = new Set();
  for (const m of matches) {
    if (seen.has(m.filterName)) continue;
    seen.add(m.filterName);
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.chip = m.filterName;
    // A counting chip carries its count so the collapsed bar already
    // answers half of "why" — "Emoji Overload 11".
    // Sentence case, not caps: at 11.5px the tinted badge no longer needs
    // uppercase to read as a label, and caps cost width the ribbon needs.
    // The count goes in its own span so it can take tabular figures.
    chip.textContent = m.filterName;
    if (m.counting) {
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(m.count);
      chip.appendChild(n);
    }
    chips.appendChild(chip);
  }
  wrap.appendChild(chips);

  const toggle = document.createElement('button');
  toggle.className = 'toggle';
  toggle.dataset.toggle = 'true';
  toggle.textContent = collapsed ? 'Show post' : 'Hide post';
  wrap.appendChild(toggle);

  // The whole bar toggles, both ways — a 40px strip is a bigger target than
  // the text button alone. The button stays for keyboard users; its click
  // bubbles here, so it has no listener of its own (one toggle, not two).
  // Clicks inside the receipt never toggle: the Allow buttons live in the
  // same .wrap and must not also hide the post.
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('.detail')) return;
    onAction('toggle');
  });

  if (!collapsed) {
    const detail = document.createElement('div');
    detail.className = 'detail';
    const inner = document.createElement('div');
    inner.className = 'inner';

    const receipt = document.createElement('div');
    receipt.className = 'receipt';

    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    const n = matches.length;
    lbl.innerHTML = `${n} match${n === 1 ? '' : 'es'} in this post<span>Allow any that are fine</span>`;
    receipt.appendChild(lbl);

    for (const m of matches) {
      receipt.appendChild(m.counting ? buildCountRow(m, onAction) : buildPhraseRow(m, onAction));
    }

    const scope = document.createElement('div');
    scope.className = 'scope';
    scope.textContent =
      'Allowing a phrase allows it everywhere, from every author. Raising a limit changes it in Settings.';
    receipt.appendChild(scope);

    // Mute lives here as well as the ··· menu: testers could not find it there.
    if (author) {
      const mute = document.createElement('div');
      mute.className = 'mute';
      const q = document.createElement('span');
      q.textContent = `Hide every post from ${author}?`;
      mute.appendChild(q);
      const btn = document.createElement('button');
      btn.className = 'drop';
      btn.dataset.mute = 'true';
      btn.textContent = 'Mute';
      btn.addEventListener('click', () => onAction('mute', author));
      mute.appendChild(btn);
      receipt.appendChild(mute);
    }

    inner.appendChild(receipt);
    detail.appendChild(inner);
    wrap.appendChild(detail);
  }

  root.appendChild(wrap);
  return host;
}

function buildRowShell(m) {
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.match = m.phrase;

  const cat = document.createElement('span');
  cat.className = 'cat';
  cat.textContent = m.filterName.toUpperCase();
  row.appendChild(cat);
  return row;
}

function buildPhraseRow(m, onAction) {
  const row = buildRowShell(m);

  const q = document.createElement('span');
  q.className = 'q';
  q.textContent = m.phrase;

  const drop = document.createElement('button');
  drop.className = 'drop';
  drop.textContent = 'Allow';
  drop.addEventListener('click', () => {
    const allowed = row.dataset.allowed === 'true';
    row.dataset.allowed = String(!allowed);
    drop.textContent = allowed ? 'Allow' : 'Allowed · Undo';
    onAction(allowed ? 'unallow' : 'allow', m.phrase);
  });

  row.append(q, drop);
  return row;
}

/**
 * Counting matches aren't phrases — "11 emoji" can't go on an allowlist, only
 * the limit can move. The row states the evidence against the user's limit
 * and the button names its exact outcome: "Allow up to 11".
 */
function buildCountRow(m, onAction) {
  const row = buildRowShell(m);

  const q = document.createElement('span');
  q.className = 'q count';
  q.textContent = m.phrase;
  const small = document.createElement('small');
  small.textContent = `your limit is ${m.limit}`;
  q.appendChild(small);
  row.appendChild(q);

  if (m.count < LIMIT_CEILING) {
    const drop = document.createElement('button');
    drop.className = 'drop';
    drop.textContent = `Allow up to ${m.count}`;
    drop.addEventListener('click', () => {
      const allowed = row.dataset.allowed === 'true';
      row.dataset.allowed = String(!allowed);
      drop.textContent = allowed ? `Allow up to ${m.count}` : `Limit raised to ${m.count} · Undo`;
      onAction(allowed ? 'restoreLimit' : 'raiseLimit', m);
    });
    row.appendChild(drop);
  }

  return row;
}

if (typeof module !== 'undefined') module.exports = { buildNotice, CSS };
