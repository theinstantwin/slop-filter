/**
 * dom.js: the only file that knows LinkedIn's feed markup.
 * Anchor on data-testid and ARIA, never class names: LinkedIn emits hashed
 * classes (`_49700731`) that change per deploy. Ad detection is the one
 * exception (see _adLabel).
 */

const SEL = {
  feed:        '[data-testid="mainFeed"]',
  listitem:    '[role="listitem"]',
  textBox:     '[data-testid="expandable-text-box"]',
  moreButton:  '[data-testid="expandable-text-button"]',
  menuTrigger: 'button[aria-label^="Open control menu for post by"]',
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
 * Author display name, read from the control-menu aria-label. The first
 * profile link is not safe: on a post with social proof ("X likes this") it
 * points to the reactor, not the author (5 of 8 posts on a sampled feed).
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
 * A post can hold several text boxes (the body plus surfaced comments). The
 * body is the shallowest, about 4 levels below the listitem versus about 13
 * for comments, so a commenter's words never trigger a filter.
 * textContent, not innerText: it already holds the full text while LinkedIn
 * shows it collapsed behind "…more", so nothing needs expanding.
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
 * Social-proof header, e.g. "Alex Example likes this", or null. It renders
 * outside the text box, so it never affects matching; display only.
 * Matches each element's own text nodes (under 80 chars) so it doesn't depend
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
 * Resolves with the feed element once it exists (absent at document_idle).
 * There is no timeout: a user can open a profile first and reach the feed by
 * client-side navigation arbitrarily later, and must still be scanned.
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
 * Classifies a post's ad label as 'promoted', 'boosted', or null.
 *
 * Ads reuse the organic post shell: same aria-labels, no data-testid. The only
 * tell is a plain-text label in the actor block where an organic post shows a
 * timestamp. So this walks text nodes outside the text box and matches exact
 * or prefixed strings of at most 60 chars, which keeps body copy from matching.
 *
 * Two classes because they filter differently. Plain "Promoted"/"Sponsored" is
 * LinkedIn selling inventory to a company (hidden by default). "Promoted
 * by/Partnership with <brand>" is a real person's post amplified by a sponsor
 * (opt-in).
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
    if (node.parentElement?.closest(SEL.textBox)) continue;
    if (t === 'Promoted' || t === 'Sponsored') return 'promoted';
    // Split-node form: the brand sits in its own link, so the label node is
    // exactly "Promoted by" (trim removes the trailing space). Equality, not a
    // prefix, so a headline like "Promoted by my boss to VP" never matches.
    if (t === 'Promoted by' || t === 'Sponsored by') return 'boosted';
    if (/^(Promoted|Sponsored) ([•·] |by )/.test(t)) return 'boosted';
    // Co-authored posts put the label after the byline in one node
    // ("with 3 others • Promoted by"). Only the exact split form counts after
    // a separator, so "CEO • Promoted to VP" doesn't.
    const tail = t.split(/\s*[•·]\s*/).pop();
    if (tail !== t && (tail === 'Promoted by' || tail === 'Sponsored by')) return 'boosted';
  }
  return null;
}

const isPromoted = post => _adLabel(post) === 'promoted';
const isBoosted = post => _adLabel(post) === 'boosted';

// Node: module.exports. Browser: the shared SlopFilter namespace, since content
// scripts share one scope and top-level names would collide.
Object.assign(typeof module !== 'undefined' ? module.exports : (globalThis.SlopFilter ||= {}), {
  SEL, getPosts, getAuthor, getPostText,
  getSocialProof, whenFeedReady,
  isPromoted, isBoosted,
});
