/**
 * Pattern definitions and the matcher.
 *
 * Filters are BINARY: a regex matches or it does not. There is no confidence
 * score and no sensitivity level. The two counting filters carry a numeric
 * threshold instead.
 */

const BLANK = '___';
// Each blank is a bounded wildcard, but adjacent wildcards backtrack against
// each other: measured on a 400-char post, 2 blanks take 4ms, 4 take 1.3s,
// 6 take 54s — long enough to freeze the LinkedIn tab. A rule can arrive from
// a shared rules file, so the cap lives here, not in the UI. Blanks past the
// cap match as literal "___".
const MAX_BLANKS = 2;
const _compileCache = new Map();
function compile(txt) {
  let re = _compileCache.get(txt);
  if (!re) {
    const esc = txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = esc.split(BLANK);
    let src = parts[0];
    for (let i = 1; i < parts.length; i++) {
      src += (i <= MAX_BLANKS ? '[^.]{1,40}' : BLANK) + parts[i];
    }
    re = new RegExp(src, 'gi');
    _compileCache.set(txt, re);
  }
  re.lastIndex = 0;
  return re;
}

const COUNTERS = {
  hashtagOverload: text => (text.match(/#\w+/g) || []).length,
  emojiOverload: text => (text.match(/\p{Extended_Pictographic}/gu) || []).length,
};

// Labs: hardcoded, non-user-editable regex patterns. Never read from
// storage — a RegExp does not survive JSON round-tripping through
// chrome.storage.local, so the actual pattern lives here, keyed by the
// category id, the same way isPromoted/isBoosted keep structural detection
// in code (dom.js) rather than in the stored blob. Stored categories only
// ever carry {id, name, def, on, labs: true}.
const LABS_PATTERNS = {
  followVerbAlternation: /(hit|click|tap|smash|give)[^.]{0,18}follow/gi,
  // Comment/reply as an instruction only: the bare verb, not "comments" or
  // "replies", and not the noun in "the/first/my/this comment". "Full blog
  // post in the comments if you want the longer version" is the link-in-
  // comments habit, not a gate.
  commentReplyGating: /(?<!\b(?:the|first|my|this) )\b(comment|reply)\b[^.]{1,25}(and i'?ll|to get|for the|if you want|and it'?s yours|to claim your)/gi,
  // Moved from a plain-text SEED_CATEGORIES rule after "#ad" (a bare literal
  // string via compile(), no word boundary) matched inside #adcampaigns,
  // #advertising, #adnews — any hashtag merely starting with "ad". \b can't
  // be expressed as a plain rule string: compile()'s escaping treats every
  // backslash as literal text to protect the OTHER ~40 rules in this file
  // from accidental regex metacharacters, so "\\b" written into a rule
  // string becomes a dead double-escaped "\\\\b" that matches nothing.
  // "#sponsored"/"#paidpartnership" have no equivalent collision (no common
  // hashtag extends past them the way "#ad" does), but move together so the
  // whole category is real regex end to end rather than a mix — deliberate:
  // bare "Sponsored" as ordinary text ("Sponsored a local team") must NOT
  // match; only the hashtag/partnership-phrase forms are a disclosure.
  // "partnering with" counts as an announcement: after I'm/we're/am/are/is/
  // be/been, or opening a sentence. As the object of a preposition ("talks
  // with H&M about partnering with SFF") it is a topic, not a disclosure.
  sponsored: /#ad\b|#sponsored|#paidpartnership|(?<=(?:^|[.!?\n]\s*|\b(?:i[’']?m|we[’']?re|am|are|is|be|been)\s))partnering with|proud to partner/gi,
};

// SEED_CATEGORIES: default display order, names, defs, rules, and on-flags.
const SEED_CATEGORIES = [
  { id: 'aiSlop', name: 'AI Slop', def: 'Sentence shapes common to generated text',
    on: true,
    rules: ["let me break this down", "read that again", "let that sink in",
            "most people don't realize", "here's the thing",
            "here's what nobody tells you",
            "it's not ___ it's ___",
            "in today's fast-paced world", "no fluff", "the best part?",
            "here's the kicker",
            // "asked chatgpt", not "i asked chatgpt": also catches "we asked
            // ChatGPT" / "so I asked ChatGPT" with no added sincere use.
            "asked chatgpt"] },
  { id: 'fakeInsight', name: 'Fake Insight', def: 'Fake profundity and thought-leadership clichés',
    on: true,
    rules: ["the truth is", "changes everything", "nobody talks about this", "somewhere along the way"] },
  { id: 'engagementBait', name: 'Engagement Bait', def: 'Fishing for comments and reactions',
    on: true,
    // "below"/"in the comments" stay plain-text rules — they have no
    // natural word boundary distinguishing CTA-gating from an ordinary
    // "comment below" invitation (moving them to the Labs regex produced
    // a false positive on "Comment below with your thoughts."). Every
    // other comment/reply connector shape now lives in the Labs
    // commentReplyGating pattern instead.
    //
    // A bare-word "hook" rule (catching marketers narrating their own
    // writing formula, e.g. "the hook is...") was tried and REVERTED — as a
    // plain-text rule it compiles via compile() with no word boundary, so it
    // matched as a substring inside "webhook", "unhooked", "hooks" (as in
    // React hooks), "left hook", far broader than the bare-word match that
    // was actually agreed to. Fixing it needs a real regex (/\bhook\b/gi,
    // same mechanism as LABS_PATTERNS.sponsored below), which in turn needs
    // its own category id — "hook" doesn't fit Engagement Bait's or any
    // other existing category's definition, and inventing a new one for a
    // single keyword wasn't worth it.
    rules: ["thoughts?", "agree?", "hot take", "unpopular opinion", "change my mind",
            "drop a ___ below", "drop a ___ in the comments", "type ___ below",
            "comment ___ below", "reply ___ below",
            "comment and i'll send", "reply and i'll send",
            "tag someone who", "repost if", "share if you agree",
            "stop scrolling", "this is your sign"] },
  { id: 'hustleCulture', name: 'Hustle Culture', def: 'Grind mentality and FOMO language',
    on: true,
    rules: ["rise and grind", "left behind", "hustle harder", "outwork everyone",
            "while you're sleeping",
            "your network is your net worth", "5am club", "built different"] },
  { id: 'sponsored', name: 'Sponsored', def: 'Paid partnerships from creators',
    // Kept on:true (unlike the other Labs entries, which default off) — this
    // category was already default-enabled before moving to Labs, and the
    // move is a false-positive fix, not a reason to silently stop catching
    // disclosed ads for existing users. Migration never overwrites an
    // existing stored on:true either way (append-only by id).
    on: true, labs: true },
  { id: 'selfPromotion', name: 'Self Promotion', def: 'Posts that sign off asking for a follow.',
    on: true,
    // Verb-first phrasing (hit/click/tap/smash/give ... follow) now lives
    // in the Labs followVerbAlternation pattern instead — these follow-
    // first phrases were never awkward as plain text, so they stay here.
    rules: ["follow me for", "follow for more", "follow along for", "follow along if",
            "follow if you want", "ring the bell", "follow for the latest", "follow us for"] },
  { id: 'hashtagOverload', name: 'Hashtag Overload', def: 'Too many hashtags in one post',
    on: true, counting: true, unit: 'hashtags', threshold: 5 },
  { id: 'emojiOverload', name: 'Emoji Overload', def: 'Too many emoji in one post',
    on: true, counting: true, unit: 'emoji', threshold: 5 },
  // Last and off by default: "excited to announce" and "grateful to share" are
  // how people post genuine news — new job, new baby. High false-positive rate
  // against posts you probably wanted to see, so this one opts in.
  { id: 'humbleBrag', name: 'Humble Brag', def: 'Fake humility announcements',
    on: false,
    rules: ["humbled to announce", "excited to announce", "grateful to share",
            "blessed to announce", "honored to share"] },
  // Labs — hardcoded regex patterns, off by default, no rules array. See
  // LABS_PATTERNS above.
  { id: 'followVerbAlternation', name: 'Follow Bait',
    def: 'Hides posts that beg for a follow, whatever the verb: hit, click, tap, smash or give follow',
    on: false, labs: true },
  { id: 'commentReplyGating', name: 'Comment/Reply Gate',
    def: "Comment or reply with a word to unlock something, beyond the built-in phrasing",
    on: false, labs: true },
];

/** @param {string} text @param {{ categories?: Category[], [k: string]: any }} [opts] */
function findMatches(text, opts = {}) {
  const out = [];
  if (!text) return out;

  if (Array.isArray(opts.categories)) {
    const allowed = (opts.allowed || []).map(p => p.toLowerCase());
    for (const cat of opts.categories) {
      if (!cat.on) continue;

      if (cat.counting) {
        const n = COUNTERS[cat.id] ? COUNTERS[cat.id](text) : 0;
        if (n >= cat.threshold) {
          out.push({
            filterId: cat.id,
            filterName: cat.name,
            phrase: `${n} ${cat.unit}`,
            index: -1,
            counting: true,
            count: n,
            limit: cat.threshold,
            unit: cat.unit,
          });
        }
        continue;
      }

      if (cat.labs) {
        const re = LABS_PATTERNS[cat.id];
        if (!re) continue;
        re.lastIndex = 0;
        let hit;
        while ((hit = re.exec(text)) !== null) {
          const phrase = hit[0].trim();
          if (!allowed.includes(phrase.toLowerCase())) {
            out.push({
              filterId: cat.id,
              filterName: cat.name,
              phrase,
              index: hit.index,
            });
          }
          if (hit.index === re.lastIndex) re.lastIndex++;
        }
        continue;
      }

      // `off` lists rules the reader unchecked in Settings: kept, not flagging.
      const off = Array.isArray(cat.off) ? cat.off.map(r => String(r).toLowerCase()) : [];
      for (const rule of cat.rules || []) {
        if (off.includes(rule.toLowerCase())) continue;
        const pattern = compile(rule);
        pattern.lastIndex = 0;
        let hit;
        while ((hit = pattern.exec(text)) !== null) {
          const phrase = hit[0].trim();
          if (!allowed.includes(phrase.toLowerCase())) {
            out.push({
              filterId: cat.id,
              filterName: cat.name,
              phrase,
              rule,
              index: hit.index,
            });
          }
          if (hit.index === pattern.lastIndex) pattern.lastIndex++;
        }
      }
    }
  }
  return out;
}

Object.assign(typeof module !== 'undefined' ? module.exports : (globalThis.SlopFilter ||= {}), {
  findMatches, BLANK, MAX_BLANKS, compile, SEED_CATEGORIES, COUNTERS, LABS_PATTERNS,
});
