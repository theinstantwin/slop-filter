/**
 * Orchestration. Holds no knowledge of LinkedIn's markup — that lives in
 * dom.js — and no rendering logic — that lives in notice.js.
 *
 * Under the extension the library scripts share one scope and publish their
 * API on globalThis.SlopFilter; under Node they are required instead. `sf` is
 * the only top-level name this file adds for them.
 */

const sf = typeof module !== 'undefined'
  ? {
      ...module.require('./dom.js'),
      ...module.require('./filters.js'),
      ...module.require('./storage.js'),
      ...module.require('./counters.js'),
      ...module.require('./notice.js'),
    }
  : globalThis.SlopFilter;

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
  // Paused: judge nothing and mark nothing, so un-pausing re-judges every post.
  if (current.paused) return false;
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

  const text = sf.getPostText(post);
  const matches = sf.findMatches(text, {
    categories: current.categories,
  });
  if (!matches.length) return false;

  post.dataset.sfFlagged = 'true';
  post.dataset.sfFilters = [...new Set(matches.map(m => m.filterName))].join(',');
  // A settings change re-judges every post on the page (applySettings), so
  // count a post the first time it is caught, not on every re-judge.
  countOnce(post, () => {
    for (const m of matches) sf.record('caught', m.phrase);
    sf.markCaught();
  });

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
// sfCaught/sfCounted (counters never count a post twice) and sfRevealed
// (the reader's own choice).
const VERDICT_KEYS = ['sfProcessed', 'sfFlagged', 'sfFilters', 'sfCollapsed',
  'sfMuted', 'sfMutedCard', 'sfPromoted', 'sfBoosted'];

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

// The one-time tip lives on a single notice: the first one rendered. Rebuilds
// of that same post keep it; a post that left the page or is no longer
// flagged hands it on.
let hintPost = null;
// Set by the limit stepper so the rebuild that follows reopens its popover.
let reopen = null;

/**
 * Replace whatever notice the post currently has with a fresh one.
 */
function renderNotice(post, matches, author, collapsed) {
  post.querySelector('[data-sf-notice]')?.remove();
  let showHint = false;
  if (settings && !settings.noticeHintSeen && author) {
    if (!hintPost || hintPost === post || !hintPost.isConnected || hintPost.dataset.sfFlagged !== 'true') {
      hintPost = post;
      showHint = true;
    }
  }
  const mine = reopen && reopen.post === post ? reopen : null;
  // The pig twitches the first time a post's notice renders, never on a rebuild.
  const twitch = post.dataset.sfTwitched !== 'true';
  post.dataset.sfTwitched = 'true';
  const notice = sf.buildNotice({
    twitch,
    matches,
    author,
    collapsed,
    showHint,
    openKey: mine?.key ?? null,
    openFocus: mine?.focus ?? null,
    onAction: (action, payload) => onNoticeAction(post, action, payload, matches, author),
  });
  post.insertBefore(notice, post.firstChild);
  if (mine) { notice.sfRestore?.(); reopen = null; }
}

// One mute path, used by the pig popover's Mute link. The post the reader
// muted from swaps its notice for a quiet card with Undo; the author's other
// posts hide as before.
async function muteAuthor(author, post) {
  settings = sf.mute(settings, author);
  const saving = sf.save(settings);
  for (const p of sf.getPosts()) {
    if (sf.getAuthor(p) !== author) continue;
    p.dataset.sfMuted = 'true';
    if (p === post) continue;
    // The same state processPost gives a muted author: no notice, not flagged.
    p.querySelector('[data-sf-notice]')?.remove();
    for (const k of ['sfFlagged', 'sfFilters', 'sfCollapsed']) delete p.dataset[k];
  }
  if (post) {
    post.querySelector('[data-sf-notice]')?.remove();
    post.dataset.sfMutedCard = 'true';
    post.insertBefore(sf.buildMutedCard({
      author,
      onAction: (action, who) => { if (action === 'undoMute') undoMute(who); },
    }), post.firstChild);
  }
  await saving;
}

// Undo = unmute and re-judge, which also clears the card and every sfMuted mark.
function undoMute(author) {
  applySettings(sf.unmute(settings, author));
  sf.save(settings);
}

/**
 * The notice's only channel back into state.
 *
 * toggle: Show post <-> Hide post. mute: the pig popover. setLimit: the counting chip's stepper, which saves
 * at once and re-judges the page so a post that no longer qualifies un-flags.
 * openSettings: "Change in Settings" ({cat, phrase?}) or the pig popover's
 * Settings link ({panel}), forwarded to the background worker. dismissHint: the one-time tip.
 */
function onNoticeAction(post, action, payload, matches, author) {
  if (action === 'mute') {
    muteAuthor(payload, post);
    return;
  }

  if (action === 'toggle') {
    const collapsed = post.dataset.sfCollapsed === 'true';

    if (collapsed) {
      // "Show post": this is the reader choosing to read a flagged post
      // anyway — count it once per
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

  if (action === 'setLimit') {
    reopen = { post, key: matches.find(m => m.filterId === payload.filterId)?.filterName, focus: payload.focus };
    applySettings(sf.setThreshold(settings, payload.filterId, payload.n));
    reopen = null;
    sf.save(settings);
    return;
  }

  if (action === 'openSettings') {
    // A tab left open across an extension update has lost its connection to
    // the worker; sendMessage then throws, or rejects. Fail quietly.
    try {
      chrome.runtime?.sendMessage?.({ type: 'sf-open-settings', ...payload })?.catch?.(() => {});
    } catch (e) { /* extension context invalidated */ }
    return;
  }

  if (action === 'dismissHint') {
    hintPost = null;
    settings = { ...settings, noticeHintSeen: true };
    sf.save(settings);
  }
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
}

/**
 * Settings changed somewhere: the popover, the settings page, a restore, or a
 * notice in another LinkedIn tab. This tab's own saves come back through here
 * too and are skipped, so a stepper click doesn't rebuild the notice twice.
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
  Object.assign(module.exports, { processPost, onNoticeAction, renderNotice,
    applySettings, onStorageChanged,
    resetNoticeState: () => { hintPost = null; reopen = null; } });
}
