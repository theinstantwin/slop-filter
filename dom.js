/**
 * dom.js — the single place that knows what LinkedIn's DOM looks like.
 *
 * Every selector here was verified against a live authenticated feed on
 * 26 Jul 2026. When LinkedIn changes its markup, this file
 * is the only one that should need editing.
 *
 * Rule: anchor on data-testid and ARIA. Never on class names — LinkedIn's SDUI
 * build emits hashed classes like `_49700731 _89202f1c` that change per deploy.
 */

const SEL = {
  feed:        '[data-testid="mainFeed"]',
  listitem:    '[role="listitem"]',
  textBox:     '[data-testid="expandable-text-box"]',
  moreButton:  '[data-testid="expandable-text-button"]',
  menuTrigger: 'button[aria-label^="Open control menu for post by"]',
  hideTrigger: 'button[aria-label^="Hide post by"]',
  openMenu:    '[role="menu"]',
  menuItem:    '[role="menuitem"]',
};

const MENU_PREFIX = 'Open control menu for post by ';

/**
 * Top-level feed posts. Comments are also [role="listitem"], so anything
 * nested inside another listitem is excluded.
 */
function getPosts(root = document) {
  const feed = root.querySelector(SEL.feed);
  if (!feed) return [];
  return Array.from(feed.querySelectorAll(SEL.listitem))
    .filter(el => el.parentElement.closest(SEL.listitem) === null);
}

/**
 * Author display name.
 *
 * MUST come from the control-menu aria-label. Do NOT derive it from the first
 * profile link: on a post carrying social proof ("X likes this",
 * "X commented"), the first a[href*="/in/"] is the REACTOR, not the author.
 * Measured on a live feed: 5 of 8 posts carried social proof, so link-based
 * attribution was wrong 62% of the time. LinkedIn's own menu mixes both people
 * — "Unfollow <reactor>" sits next to "Hide posts by <author>".
 */
function getAuthor(post) {
  const btn = post.querySelector(SEL.menuTrigger);
  if (!btn) return null;
  const label = btn.getAttribute('aria-label') || '';
  return label.startsWith(MENU_PREFIX)
    ? label.slice(MENU_PREFIX.length).trim()
    : null;
}

/**
 * The author's own post text.
 *
 * A post may contain several [data-testid="expandable-text-box"] nodes: the
 * post body plus any surfaced comments. They are distinguishable by depth —
 * the body sits ~4 levels below the listitem, surfaced comments ~13. Taking
 * the shallowest avoids filtering a post on a commenter's words.
 *
 * Uses textContent, not innerText: textContent already holds the FULL text
 * even while LinkedIn renders it collapsed. Verified by clicking every "…more"
 * expander and re-measuring — zero characters gained. The extension never
 * needs to expand anything to scan it.
 */
function getPostText(post) {
  const boxes = Array.from(post.querySelectorAll(SEL.textBox));
  if (!boxes.length) return '';

  let best = null;
  let bestDepth = Infinity;
  for (const box of boxes) {
    let depth = 0;
    let node = box;
    while (node && node !== post) { depth++; node = node.parentElement; }
    if (depth < bestDepth) { bestDepth = depth; best = box; }
  }
  return (best?.textContent || '').trim();
}

/**
 * Social-proof header, e.g. "Alex Example likes this".
 * Rendered OUTSIDE the text box, so it never pollutes filter matching —
 * verified. Exposed for display only.
 *
 * Walks all elements in the post (depth-first) and collects each element's
 * OWN text (direct text nodes only). Tests each line against the regex and
 * the <80 char rule. Returns the first match or null. This avoids depending
 * on whitespace in minified markup.
 */
function getSocialProof(post) {
  const lines = [];

  function walkElements(node) {
    if (!node) return;
    for (let child of node.childNodes) {
      if (child.nodeType === 3) { // TEXT_NODE
        const text = child.textContent.trim();
        if (text) lines.push(text);
      } else if (child.nodeType === 1) { // ELEMENT_NODE
        walkElements(child);
      }
    }
  }

  walkElements(post);

  return lines.find(l => l.length < 80 &&
    /\b(likes|loves|celebrates|supports|commented|finds this)\b/i.test(l)) || null;
}

/**
 * The open control menu for a given post.
 *
 * The menu is PORTALED — it renders outside the post element, not within it,
 * so `post.querySelector('[role="menu"]')` never finds it. It must be located
 * globally after the trigger is clicked.
 *
 * Video posts also render their own [role="menu"] / [role="menuitem"] nodes
 * for subtitle settings, so match on the menu's known items rather than
 * assuming the first menu found is the right one.
 */
const POST_MENU_RE = /Report post|Copy link to post|Not interested/;

function isPostMenu(el) {
  if (!el || el.getAttribute?.('role') !== 'menu') return false;
  return POST_MENU_RE.test(el.textContent || '');
}

/**
 * Wait for the feed to exist — it is absent at document_idle.
 *
 * No give-up timeout: this is a content script in a SPA, not a page load
 * check. A user who lands on a profile or article tab and then navigates to
 * the feed client-side must still get scanned, arbitrarily long after
 * injection. The observer disconnects the instant the feed appears (its only
 * exit) and otherwise stays armed for the life of the page.
 */
function whenFeedReady() {
  return new Promise(resolve => {
    const existing = document.querySelector(SEL.feed);
    if (existing) return resolve(existing);

    const observer = new MutationObserver(() => {
      const feed = document.querySelector(SEL.feed);
      if (feed) { observer.disconnect(); resolve(feed); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * Promoted/boosted ad detection.
 *
 * DOCUMENTED EXCEPTION to this file's data-testid/ARIA anchor rule. Live
 * specimens show LinkedIn ads reuse the organic post shell completely: same
 * aria-label set, no data-testid, no ad-specific ARIA anywhere. The only tell
 * is a plain-text label in the actor block, where an organic post would show
 * a timestamp instead — so this walks text nodes OUTSIDE the text box and
 * matches on exact/prefixed strings, scoped hard by length so body copy never
 * qualifies even when the text-box exclusion below is bypassed some other way.
 *
 * Two predicates, not one, because the product treats the two label shapes
 * differently (PRD's locked decision): plain "Promoted"/"Sponsored" is
 * LinkedIn selling inventory directly to a company and hides by default;
 * "Promoted • Partnership with <brand>" — and "Promoted by <brand>", a newer
 * LinkedIn phrasing observed 2026-07-28 for the same underlying concept, a
 * real person's post amplified by a named sponsor — is opt-in.
 */
function _adLabel(post) {
  const doc = post.ownerDocument;
  const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT
    ?? (typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4);
  const walker = doc.createTreeWalker(post, showText);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const t = (node.textContent || '').trim();
    if (!t || t.length > 60) continue;
    if (node.parentElement?.closest(SEL.textBox)) continue; // body copy never counts
    if (t === 'Promoted' || t === 'Sponsored') return 'promoted';
    // Exact equality, not a /by\b/ prefix, for the split-node form: live
    // markup (Fireflies.ai sighting, 2026-08-22) puts the brand in its own
    // <a><strong> with the whitespace in a separate <span>, so the label
    // text node is exactly "Promoted by" — trim has eaten the space the
    // old "by " prefix required. Equality keeps the headline rule:
    // "Promoted by my boss to VP…" body/headline copy still never matches.
    if (t === 'Promoted by' || t === 'Sponsored by') return 'boosted';
    if (/^(Promoted|Sponsored) ([•·] |by )/.test(t)) return 'boosted';
  }
  return null;
}

const isPromoted = post => _adLabel(post) === 'promoted';
const isBoosted = post => _adLabel(post) === 'boosted';

const domExports = {
  SEL, getPosts, getAuthor, getPostText,
  getSocialProof, isPostMenu, whenFeedReady,
  isPromoted, isBoosted,
};

if (typeof module !== 'undefined') {
  module.exports = domExports;
} else {
  window.dom = domExports;
}
