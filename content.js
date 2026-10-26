/**
 * Orchestration. Holds no knowledge of LinkedIn's markup — that lives in
 * dom.js — and no rendering logic — that lives in notice.js.
 *
 * Loading model: under the extension these are plain content scripts sharing
 * ONE isolated-world scope, loaded in manifest order, so dom/filters/storage/
 * notice/menu have already declared their top-level names by the time this
 * file runs. Under Node they are required instead.
 *
 * This file must therefore not declare ANY top-level identifier that an
 * earlier script already declares. Importing them under their own names —
 * `var { SEED_CATEGORIES } = require(...)` — is a SyntaxError in the browser
 * ("Identifier 'SEED_CATEGORIES' has already been declared") because `var` is hoisted
 * and declared at parse time whether or not its `if` branch ever runs, and a
 * `var` cannot shadow filters.js's `const SEED_CATEGORIES` in the same scope. That
 * error kills the entire content-script bundle silently.
 *
 * So: one uniquely-named binding, resolved per environment. `sf` collides with
 * nothing in dom/filters/storage/notice/menu.
 */

const sf = (typeof module !== 'undefined' && typeof require !== 'undefined')
  ? {
      ...require('./dom.js'),
      ...require('./filters.js'),
      ...require('./storage.js'),
      ...require('./counters.js'),
      ...require('./notice.js'),
      ...require('./menu.js'),
    }
  : {
      SEL, getPosts, getAuthor, getPostText, whenFeedReady,
      isPromoted, isBoosted,
      findMatches,
      load, save, migrate, STORAGE_KEY,
      mute, allowPhrase, unallowPhrase, setCategoryOn, setThreshold,
      ...sc,
      buildNotice, attachMenuWatcher,
    };

let settings = null;

/**
 * Decide about one post and render the verdict.
 *
 * Called for every post on every scan, and scans are debounced over an
 * infinite feed — so this must be idempotent and cheap. The sfProcessed guard
 * does both: it short-circuits to the cached verdict instead of re-running the
 * matcher and re-inserting a second notice. LinkedIn reuses post nodes rather
 * than recycling them across virtualised scroll (verified 8/8 over a 13k px
 * round trip), so a dataset flag survives.
 *
 * Returns true if the post was flagged.
 */
function processPost(post, current) {
  // In the extension `current` IS the module-global settings (scanFeed passes
  // it), so this assignment is a no-op there. It exists so notice actions —
  // which must read the LIVE settings, not a stale closure — also work when
  // tests drive processPost directly with their own settings object.
  settings = current;
  if (post.dataset.sfProcessed === 'true') return post.dataset.sfFlagged === 'true';

  const author = sf.getAuthor(post);
  // SDUI can insert a listitem shell and fill it a tick later, and the
  // author (menu aria-label) and the ad label (actor-block text node) render
  // on independent ticks — author alone is not proof the ad label has
  // settled. Require the text box too: by the time the post body is present,
  // the actor block above it (where "Promoted"/"Sponsored" lives) has
  // rendered. Marking a skeleton processed would exempt it forever — the 1.0
  // silent-miss shape, now specific to ad detection.
  if (!post.querySelector(sf.SEL.textBox)) return false;
  post.dataset.sfProcessed = 'true';

  // Trusted People is an absolute override: checked before ad detection and
  // before the mute check, so a whitelisted author's post is never hidden or
  // flagged for ANY reason, including being marked Promoted/Boosted by
  // LinkedIn itself.
  if (author && current.whitelistedAuthors.includes(author)) {
    return false;
  }

  // Ad detection wins over the mute check: an ad's "author" is the
  // advertiser, not a person the reader chose to mute or not.
  if (current.hidePromoted && sf.isPromoted(post)) {
    post.dataset.sfPromoted = 'true';
    countOnce(post, () => sf.record('promoted'));
    return true;
  }
  if (current.hideBoosted && sf.isBoosted(post)) {
    post.dataset.sfBoosted = 'true';
    countOnce(post, () => sf.record('boosted'));
    return true;
  }

  if (author && current.mutedAuthors.includes(author)) {
    post.dataset.sfMuted = 'true';
    return false;
  }

  // "Read anyway" from the ··· menu is the reader's call on this post and
  // outlives a settings change; only ads and mutes above still apply.
  if (post.dataset.sfDismissed === 'true') return false;

  const text = sf.getPostText(post);
  const matches = sf.findMatches(text, {
    categories: current.categories,
    allowed: current.allowedPhrases,
  });
  if (!matches.length) return false;

  post.dataset.sfFlagged = 'true';
  post.dataset.sfFilters = [...new Set(matches.map(m => m.filterName))].join(',');
  // A settings change re-judges every post on the page (applySettings), so
  // count a post the first time it is caught, not on every re-judge.
  countOnce(post, () => { for (const m of matches) sf.record('caught', m.phrase); });

  // A post the reader opened with "Show post" stays open across re-judging.
  const collapsed = current.flagMode === 'collapse' && post.dataset.sfRevealed !== 'true';
  if (collapsed) post.dataset.sfCollapsed = 'true';

  renderNotice(post, matches, author, collapsed);
  return true;
}

function countOnce(post, record) {
  if (post.dataset.sfCaught) return;
  post.dataset.sfCaught = 'true';
  record();
  sf.scheduleFlush();
}

// Every verdict processPost writes. Not here, so they survive a re-judge:
// sfCaught/sfCounted (counters never count a post twice), sfRevealed and
// sfDismissed (the reader's own choices), sfOpenPost (menu bookkeeping).
const VERDICT_KEYS = ['sfProcessed', 'sfFlagged', 'sfFilters', 'sfCollapsed',
  'sfMuted', 'sfPromoted', 'sfBoosted'];

/**
 * Re-judge every post already on the page against new settings, in place.
 * Replaces the old full-page reload: a reload threw away whatever the reader
 * was typing in LinkedIn's composer and their scroll position.
 */
function applySettings(next) {
  settings = next;
  for (const post of sf.getPosts()) {
    if (!post.dataset.sfProcessed) continue;
    post.querySelector('[data-sf-notice]')?.remove();
    for (const k of VERDICT_KEYS) delete post.dataset[k];
  }
  scanFeed();
}

/**
 * Replace whatever notice the post currently has with a fresh one.
 */
function renderNotice(post, matches, author, collapsed) {
  post.querySelector('[data-sf-notice]')?.remove();
  const notice = sf.buildNotice({
    matches,
    author,
    collapsed,
    onAction: (action, payload) => onNoticeAction(post, action, payload, matches, author),
  });
  post.insertBefore(notice, post.firstChild);
}

/**
 * The notice's only channel back into state.
 *
 * The toggle is TWO states — Show post <-> Hide post — and the receipt rides
 * with the revealed post (buildNotice renders it whenever not collapsed).
 *
 * `payload` is the matched phrase for allow/unallow, and the whole match
 * object for raiseLimit/restoreLimit — counting matches aren't phrases, so
 * resolving one means moving that category's threshold, never allowlisting
 * a synthetic "11 emoji" entry the counting matcher would ignore.
 */
function onNoticeAction(post, action, payload, matches, author) {
  if (action === 'toggle') {
    const collapsed = post.dataset.sfCollapsed === 'true';

    if (collapsed) {
      // "Show post": this is the reader choosing to read a flagged post
      // anyway, same as onReadAnyway from the ··· menu — count it once per
      // post, not once per toggle.
      delete post.dataset.sfCollapsed;
      post.dataset.sfRevealed = 'true';
      if (!post.dataset.sfCounted) {
        post.dataset.sfCounted = 'true';
        for (const m of matches) sf.record('readPast', m.phrase);
        sf.scheduleFlush();
      }
    } else {
      post.dataset.sfCollapsed = 'true';
      delete post.dataset.sfRevealed;
    }

    renderNotice(post, matches, author, post.dataset.sfCollapsed === 'true');
    return;
  }

  if (action === 'allow' || action === 'unallow') {
    settings = action === 'allow'
      ? sf.allowPhrase(settings, payload)
      : sf.unallowPhrase(settings, payload);
    sf.save(settings);
    return;
  }

  if (action === 'raiseLimit' || action === 'restoreLimit') {
    // Fire condition is n >= threshold, so allowing a count of N means a
    // threshold of N+1. restoreLimit puts back the limit that fired.
    const n = action === 'raiseLimit' ? payload.count + 1 : payload.limit;
    settings = sf.setThreshold(settings, payload.filterId, n);
    sf.save(settings);
  }
}

/**
 * Record which post owns the control menu that is about to open.
 *
 * The menu is PORTALED — it renders outside the post, so once it is open there
 * is no DOM path from the menu back to its post. The only moment the link is
 * observable is the click on the trigger. Capture phase, and mousedown rather
 * than click, so the tag is in place before LinkedIn's own handler opens the
 * menu and menu.js's observer fires getContext().
 *
 * Without this the menu still renders, still responds to clicks, and does
 * nothing: getContext() returns no author and no filters, so Mute and Allow
 * never appear and Read anyway returns immediately.
 */
function tagPostOnMenuOpen(root) {
  const tag = event => {
    const trigger = event.target.closest?.(sf.SEL.menuTrigger);
    if (!trigger) return;
    // Only a NEW trigger moves the tag. An earlier version cleared it on any
    // mousedown anywhere, which broke "Read anyway" for every mouse user: the
    // mousedown on the menu item itself (portaled, outside the post) wiped
    // the tag a few ms before the click handler went looking for it, so
    // onReadAnyway found no post and returned. Keyboard activation (Enter →
    // click, no mousedown) was the only path that worked. Verified live
    // 2026-09-01. A stale tag between menus is harmless — getContext() only
    // runs when a post menu is decorated, which only follows a trigger click.
    for (const stale of root.querySelectorAll('[data-sf-open-post]')) {
      delete stale.dataset.sfOpenPost;
    }
    const post = trigger.closest(sf.SEL.listitem);
    if (post) post.dataset.sfOpenPost = 'true';
  };
  // mousedown covers the mouse path (fires before LinkedIn's own click handler
  // opens the menu); click covers keyboard activation (Enter/Space on a
  // focused trigger fires click, not mousedown). Both capture phase, same
  // reasoning as the original mousedown-only listener.
  root.addEventListener('mousedown', tag, true);
  root.addEventListener('click', tag, true);
}

function scanFeed() {
  if (!settings) return;
  for (const post of sf.getPosts()) processPost(post, settings);
}

async function init() {
  settings = await sf.load();
  const feed = await sf.whenFeedReady();
  if (!feed) return;

  scanFeed();

  // A MutationObserver-driven rescan was tried and dropped: LinkedIn's own
  // React tree can throw a hydration-mismatch crash (error #418) during a
  // live session, and when it does, our observer's callback goes silently
  // dark — no exception on our side, it just stops being invoked, even
  // though the feed node itself stays live and connected. Confirmed dead
  // across two fresh extension reloads and three separate live sessions
  // (BACKLOG.md item 10) — never fired once, while this poll alone caught
  // 36+ posts correctly in the same sessions. A poll doesn't depend on any
  // single observer/event-listener surviving whatever the host page does to
  // itself, which is the actual requirement here. getPosts() is just a
  // querySelectorAll and processPost's sfProcessed guard short-circuits
  // already-handled posts, so a scan every 2s is cheap even on a long feed.
  setInterval(scanFeed, 2000);

  tagPostOnMenuOpen(document);

  sf.attachMenuWatcher({
    getContext: () => {
      const open = document.querySelector('[data-sf-open-post]');
      return {
        author: open ? sf.getAuthor(open) : null,
        filterNames: open ? (open.dataset.sfFilters || '').split(',').filter(Boolean) : [],
      };
    },
    onMute: async author => {
      settings = sf.mute(settings, author);
      await sf.save(settings);
      for (const p of sf.getPosts()) {
        if (sf.getAuthor(p) === author) p.dataset.sfMuted = 'true';
      }
    },
    onReadAnyway: () => {
      const open = document.querySelector('[data-sf-open-post]');
      if (!open) return;
      // The notice is about to be removed and no per-match phrase list
      // survives on the DOM (sfFilters only keeps category names) — recompute
      // the matches against current settings so readPast is still per-phrase.
      if (!open.dataset.sfCounted) {
        open.dataset.sfCounted = 'true';
        const text = sf.getPostText(open);
        const matches = sf.findMatches(text, {
          categories: settings.categories,
          allowed: settings.allowedPhrases,
        });
        for (const m of matches) sf.record('readPast', m.phrase);
        sf.scheduleFlush();
      }
      open.querySelector('[data-sf-notice]')?.remove();
      open.dataset.sfDismissed = 'true';
      delete open.dataset.sfFlagged;
      delete open.dataset.sfCollapsed;
    },
    // Turning a category off makes every notice from it stale, so the page
    // is re-judged in place.
    onAllowFilter: async name => {
      const cat = settings.categories.find(c => c.name === name);
      if (!cat) return;
      // Apply first: the save's onChanged echo then matches and is skipped.
      applySettings(sf.setCategoryOn(settings, cat.id, false));
      await sf.save(settings);
    },
  });
}

/**
 * Settings changed somewhere: the popover, the settings page, a restore, or a
 * notice in another LinkedIn tab. This tab's own saves come back through here
 * too and are skipped, so allowing a phrase doesn't rebuild the receipt the
 * reader is clicking in.
 */
function onStorageChanged(changes, area) {
  if (area !== 'local' || !changes[sf.STORAGE_KEY]) return;
  const next = changes[sf.STORAGE_KEY].newValue;
  if (!next || JSON.stringify(next) === JSON.stringify(settings)) return;
  applySettings(sf.migrate(next));
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.storage?.onChanged?.addListener(onStorageChanged);
  init();
}

if (typeof module !== 'undefined') {
  module.exports = { processPost, onNoticeAction, renderNotice, tagPostOnMenuOpen,
    applySettings, onStorageChanged };
}
