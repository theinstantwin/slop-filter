/**
 * Orchestration: scans the feed, judges each post, renders the verdict, and
 * routes notice actions back into settings. Markup knowledge lives in dom.js
 * and rendering in notice.js.
 *
 * In the extension the library scripts share one scope and publish on
 * globalThis.SlopFilter; under Node they are required. `sf` is the only
 * top-level name this file adds for them.
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
 * Judges one post and renders the verdict. Returns true if the post was
 * flagged. Runs on every post every scan, so it is idempotent: the
 * sfProcessed dataset flag short-circuits to the cached verdict. The flag
 * survives scrolling because LinkedIn keeps post nodes rather than recycling
 * them.
 */
function processPost(post, current) {
  // In the extension this is already the global; the assignment lets notice
  // actions read live settings when tests call processPost with their own.
  settings = current;
  // Paused: judge and mark nothing, so un-pausing re-judges every post.
  if (current.paused) return false;
  if (post.dataset.sfProcessed === 'true') return post.dataset.sfFlagged === 'true';

  const author = sf.getAuthor(post);
  // LinkedIn inserts an empty listitem shell and fills it later, and the author
  // and the ad label render on separate ticks. Wait for the text box: once the
  // body exists, the actor block with "Promoted" has rendered. Marking a
  // skeleton processed would exempt it forever.
  if (!post.querySelector(sf.SEL.textBox)) return false;
  post.dataset.sfProcessed = 'true';

  // Trusted People override everything, ad labels included, so this runs first.
  if (author && current.whitelistedAuthors.includes(author)) {
    return false;
  }

  // Ads are checked before mutes: an ad's author is the advertiser, not a
  // person the reader chose to mute.
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
  // applySettings re-judges every post, so count a catch only once.
  countOnce(post, () => {
    for (const m of matches) sf.record('caught', m.phrase);
    sf.markCaught();
  });

  // A post opened with "Show post" stays open across re-judging.
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

// Verdict flags that a re-judge clears. Deliberately absent so they survive:
// sfCaught/sfCounted (no double counting) and sfRevealed (the reader's choice).
const VERDICT_KEYS = ['sfProcessed', 'sfFlagged', 'sfFilters', 'sfCollapsed',
  'sfMuted', 'sfMutedCard', 'sfPromoted', 'sfBoosted'];

/**
 * Re-judges every post on the page against new settings, in place. A page
 * reload would lose the reader's scroll position and any draft in LinkedIn's
 * composer.
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

// The one-time tip shows on one notice: the first rendered. Rebuilds of that
// post keep it; it moves on if the post leaves the page or stops being flagged.
let hintPost = null;
// Set by the limit stepper so the rebuild that follows reopens its popover.
let reopen = null;

/** Replaces the post's notice with a fresh one. */
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

// The only mute path (the pig popover's Mute link). The originating post swaps
// its notice for a card with Undo; the author's other posts just hide.
async function muteAuthor(author, post) {
  settings = sf.mute(settings, author);
  const saving = sf.save(settings);
  for (const p of sf.getPosts()) {
    if (sf.getAuthor(p) !== author) continue;
    p.dataset.sfMuted = 'true';
    if (p === post) continue;
    // Match the state processPost gives a muted author.
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

// Unmute and re-judge, which also clears the card and the sfMuted marks.
function undoMute(author) {
  applySettings(sf.unmute(settings, author));
  sf.save(settings);
}

/**
 * The notice's only channel back into state. Actions:
 * toggle: Show post / Hide post.
 * mute: from the pig popover.
 * setLimit: the counting chip's stepper; saves and re-judges so a post that no
 *   longer qualifies un-flags.
 * openSettings: {cat, phrase?} or {panel}, forwarded to the background worker.
 * dismissHint: the one-time tip.
 */
function onNoticeAction(post, action, payload, matches, author) {
  if (action === 'mute') {
    muteAuthor(payload, post);
    return;
  }

  if (action === 'toggle') {
    const collapsed = post.dataset.sfCollapsed === 'true';

    if (collapsed) {
      // The reader chose to read a flagged post anyway; count it once per post.
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
    // A tab left open across an extension update loses its worker connection,
    // and sendMessage then throws or rejects. Fail quietly.
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

  // Poll rather than observe mutations: after a React hydration error (#418)
  // on LinkedIn's side, a MutationObserver on the feed silently stops firing
  // even though the node stays connected. A poll survives whatever the page
  // does to itself, and is cheap: getPosts() is one querySelectorAll and
  // sfProcessed short-circuits handled posts.
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
