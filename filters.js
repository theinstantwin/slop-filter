/**
 * Pattern definitions and the matcher.
 *
 * Filters are BINARY: a regex matches or it does not. There is no confidence
 * score and no sensitivity level. The two counting filters carry a numeric
 * threshold instead.
 */

const FILTERS = {
  aiSlop: {
    id: 'aiSlop',
    name: 'AI Slop',
    description: 'Sentence shapes common to generated text',
    patterns: [
      /let me break (?:this|it) down/gi,
      /read that again/gi,
      /let that sink in/gi,
      /most people don'?t realize/gi,
      /here'?s the thing/gi,
      /here'?s what (?:nobody|no one) tells you/gi,
      /it'?s not [^.—]{1,40}—\s*it'?s [^.]{1,40}/gi,
    ],
  },
  fakeInsight: {
    id: 'fakeInsight',
    name: 'Fake Insight',
    description: 'Fake profundity and thought-leadership clichés',
    patterns: [
      /the truth is/gi,
      /changes everything/gi,
      /nobody talks about this/gi,
      /somewhere along the way/gi,
    ],
  },
  humbleBrag: {
    id: 'humbleBrag',
    name: 'Humble Brag',
    description: 'Fake humility announcements',
    patterns: [
      /humbled to announce/gi,
      /excited to announce/gi,
      /grateful to share/gi,
      /blessed to announce/gi,
      /honored to share/gi,
    ],
  },
  engagementBait: {
    id: 'engagementBait',
    name: 'Engagement Bait',
    description: 'Fishing for comments and reactions',
    patterns: [
      /thoughts\s*\?/gi,
      /agree\s*\?/gi,
      /hot take/gi,
      /unpopular opinion/gi,
      /change my mind/gi,
      // Comment/reply-to-unlock: a quoted trigger word promising something
      // in exchange for a PUBLIC comment or reply, to game the algorithm.
      // Deliberately excludes DM/message-me CTAs — those move the ask to a
      // private channel and aren't polluting the public feed the same way.
      // Connector shapes written once per trigger word (comment/reply)
      // rather than duplicated ad hoc.
      /drop a [^.—]{1,40} below/gi,
      /drop a [^.—]{1,40} in the comments/gi,
      /type [^.—]{1,40} below/gi,
      /comment [^.—]{1,40} and i'?ll/gi,
      /reply [^.—]{1,40} and i'?ll/gi,
      /comment [^.—]{1,40} to get/gi,
      /reply [^.—]{1,40} to get/gi,
      /comment [^.—]{1,40} for the/gi,
      /reply [^.—]{1,40} for the/gi,
      /comment [^.—]{1,40} below/gi,
      /reply [^.—]{1,40} below/gi,
      /comment [^.—]{1,40} if you want/gi,
      /reply [^.—]{1,40} if you want/gi,
      /comment [^.—]{1,40} and it'?s yours/gi,
      /reply [^.—]{1,40} and it'?s yours/gi,
      /comment and i'?ll send/gi,
      /reply and i'?ll send/gi,
      /comment to claim your/gi,
      /reply to claim your/gi,
    ],
  },
  selfPromotion: {
    id: 'selfPromotion',
    name: 'Self-promotion CTA',
    description: 'Pitching a follow instead of standing on its own',
    patterns: [
      /follow me for/gi,
      /follow for more/gi,
      /follow along for/gi,
      /follow along if/gi,
      /follow if you want/gi,
      /hit follow/gi,
      /hit that follow/gi,
      /click follow/gi,
      /tap follow/gi,
      /smash that follow/gi,
      /give me a follow/gi,
      /give this a follow/gi,
      /ring the bell/gi,
    ],
  },
  hustleCulture: {
    id: 'hustleCulture',
    name: 'Hustle Culture',
    description: 'Grind mentality and FOMO language',
    patterns: [
      /rise and grind/gi,
      /left behind/gi,
      /hustle harder/gi,
      /outwork everyone/gi,
      /while you'?re sleeping/gi,
    ],
  },
  /**
   * Catches ORGANIC influencer disclosures only — a creator taking brand money
   * and saying so. It does NOT catch LinkedIn's own paid placements: those are
   * marked `Promoted` in the actor block, which is not part of the post body
   * this filter scans, and a text pattern for it would fire on every post about
   * being promoted at work. That needs structural detection in dom.js.
   * Decided for 1.2: hide entirely.
   */
  sponsored: {
    id: 'sponsored',
    name: 'Sponsored',
    description: 'Paid partnerships from creators (not LinkedIn ads — see BACKLOG)',
    patterns: [
      /#sponsored/gi,
      /#ad\b/gi,
      /#paidpartnership/gi,
      /partnering with/gi,
      /proud to partner/gi,
    ],
  },
  hashtagOverload: {
    id: 'hashtagOverload',
    name: 'Hashtag Overload',
    description: 'Too many hashtags in one post',
    count: text => (text.match(/#\w+/g) || []).length,
    unit: 'hashtags',
  },
  emojiOverload: {
    id: 'emojiOverload',
    name: 'Emoji Overload',
    description: 'Too many emoji in one post',
    count: text => (text.match(/\p{Extended_Pictographic}/gu) || []).length,
    unit: 'emoji',
  },
};

const DEFAULT_THRESHOLDS = { hashtagOverload: 5, emojiOverload: 5 };

const BLANK = '___';
const _compileCache = new Map();
function compile(txt) {
  let re = _compileCache.get(txt);
  if (!re) {
    const esc = txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(esc.split(BLANK).join('[^.]{1,40}'), 'gi');
    _compileCache.set(txt, re);
  }
  re.lastIndex = 0;
  return re;
}

const COUNTERS = {
  hashtagOverload: FILTERS.hashtagOverload.count,
  emojiOverload: FILTERS.emojiOverload.count,
};

// Labs: hardcoded, non-user-editable regex patterns. Never read from
// storage — a RegExp does not survive JSON round-tripping through
// chrome.storage.local, so the actual pattern lives here, keyed by the
// category id, the same way isPromoted/isBoosted keep structural detection
// in code (dom.js) rather than in the stored blob. Stored categories only
// ever carry {id, name, def, on, labs: true}.
const LABS_PATTERNS = {
  followVerbAlternation: /(hit|click|tap|smash|give)[^.]{0,18}follow/gi,
  commentReplyGating: /(comment|reply)[^.]{1,25}(and i'?ll|to get|for the|if you want|and it'?s yours|to claim your)/gi,
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
  sponsored: /#ad\b|#sponsored|#paidpartnership|partnering with|proud to partner/gi,
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
  { id: 'selfPromotion', name: 'Self-promotion CTA', def: 'Pitching a follow instead of standing on its own',
    on: true,
    // Verb-first phrasing (hit/click/tap/smash/give ... follow) now lives
    // in the Labs followVerbAlternation pattern instead — these follow-
    // first phrases were never awkward as plain text, so they stay here.
    rules: ["follow me for", "follow for more", "follow along for", "follow along if",
            "follow if you want", "ring the bell"] },
  { id: 'hashtagOverload', name: 'Hashtag Overload', def: 'Too many hashtags in one post',
    on: true, counting: true, unit: 'hashtags', threshold: 5 },
  { id: 'emojiOverload', name: 'Emoji Overload', def: 'Too many emoji in one post',
    on: false, counting: true, unit: 'emoji', threshold: 5 },
  // Last and off by default: "excited to announce" and "grateful to share" are
  // how people post genuine news — new job, new baby. High false-positive rate
  // against posts you probably wanted to see, so this one opts in.
  { id: 'humbleBrag', name: 'Humble Brag', def: 'Fake humility announcements',
    on: false,
    rules: ["humbled to announce", "excited to announce", "grateful to share",
            "blessed to announce", "honored to share"] },
  // Labs — hardcoded regex patterns, off by default, no rules array. See
  // LABS_PATTERNS above.
  { id: 'followVerbAlternation', name: 'Follow verb variants',
    def: 'Different verbs pitching the same follow (hit/click/tap/smash/give)',
    on: false, labs: true },
  { id: 'commentReplyGating', name: 'Comment/Reply Gate',
    def: "Comment or reply with a word to unlock something, beyond the built-in phrasing",
    on: false, labs: true },
];

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

      for (const rule of cat.rules || []) {
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
              index: hit.index,
            });
          }
          if (hit.index === pattern.lastIndex) pattern.lastIndex++;
        }
      }
    }
    return out;
  }

  const enabled = opts.enabled || {};
  const allowed = (opts.allowed || []).map(p => p.toLowerCase());
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };

  for (const filter of Object.values(FILTERS)) {
    if (!enabled[filter.id]) continue;

    if (filter.count) {
      const n = filter.count(text);
      const limit = thresholds[filter.id];
      if (n >= limit) {
        out.push({
          filterId: filter.id,
          filterName: filter.name,
          phrase: `${n} ${filter.unit}`,
          index: -1,
          counting: true,
          count: n,
          limit,
          unit: filter.unit,
        });
      }
      continue;
    }

    for (const pattern of filter.patterns) {
      pattern.lastIndex = 0;
      let hit;
      while ((hit = pattern.exec(text)) !== null) {
        const phrase = hit[0].trim();
        if (!allowed.includes(phrase.toLowerCase())) {
          out.push({
            filterId: filter.id,
            filterName: filter.name,
            phrase,
            index: hit.index,
          });
        }
        if (hit.index === pattern.lastIndex) pattern.lastIndex++;
      }
    }
  }
  return out;
}

if (typeof module !== 'undefined') {
  module.exports = { FILTERS, findMatches, DEFAULT_THRESHOLDS, BLANK, compile, SEED_CATEGORIES, COUNTERS, LABS_PATTERNS };
}
