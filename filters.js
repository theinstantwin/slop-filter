/**
 * Default categories, the phrase compiler, and findMatches().
 * Matching is binary (a pattern hits or it doesn't; no scores). The two
 * counting categories compare a count against a threshold instead.
 */

const BLANK = '___';
// Adjacent wildcards backtrack against each other. Measured on a 400-char
// post: 2 blanks take 4ms, 4 take 1.3s, 6 take 54s, enough to freeze the tab.
// Rules can come from an imported file, so the cap lives here, not in the UI.
// Blanks past the cap match a literal "___".
const MAX_BLANKS = 2;
const _compileCache = new Map();
function compile(txt) {
  let re = _compileCache.get(txt);
  if (!re) {
    // Phones and Macs type curly apostrophes; a straight one in a rule matches both.
    const esc = txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’‘]/g, "['’‘]");
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

// Labs: hardcoded regexes keyed by category id. A RegExp doesn't survive JSON
// round-tripping through chrome.storage, so stored Labs categories carry only
// {id, name, def, on, labs: true} and the pattern lives here.
const LABS_PATTERNS = {
  followVerbAlternation: /(hit|click|tap|smash|give)[^.]{0,18}follow/gi,
  // Comment/reply as an instruction: the bare verb, not "comments"/"replies" or
  // the noun in "the/first/my/this comment". "Full post in the comments if you
  // want the longer version" is link-in-comments, not a gate.
  commentReplyGating: /(?<!\b(?:the|first|my|this) )\b(comment|reply)\b[^.]{1,25}(and i'?ll|to get|for the|if you want|and it'?s yours|to claim your)/gi,
  // A regex, not a plain rule: "#ad" as a plain rule has no word boundary and
  // matched #advertising, #adnews, and so on, and compile() escapes backslashes,
  // so \b can't be written in a rule string. Bare "Sponsored" in ordinary text
  // ("Sponsored a local team") must not match; only hashtag and partnership
  // forms are a disclosure. "partnering with" counts only as an announcement
  // (after I'm/we're/am/are/is/be/been, or opening a sentence), not as the
  // object of a preposition ("talks with H&M about partnering with SFF").
  sponsored: /#ad\b|#sponsored|#paidpartnership|(?<=(?:^|[.!?\n]\s*|\b(?:i[’']?m|we[’']?re|am|are|is|be|been)\s))partnering with|proud to partner/gi,
};

// Default categories, in display order.
const SEED_CATEGORIES = [
  { id: 'aiSlop', name: 'AI Slop', def: 'Sentence shapes common to generated text',
    on: true,
    rules: ["let me break this down", "read that again", "let that sink in",
            "most people don't realize", "here's the thing",
            "here's what nobody tells you", "most people get this wrong",
            "in the ever-evolving landscape", "unlocking new possibilities",
            "it's not ___ it's ___",
            "in today's fast-paced world", "no fluff", "the best part?",
            "here's the kicker",
            // Without "i", so "we asked ChatGPT" matches too.
            "asked chatgpt"] },
  { id: 'fakeInsight', name: 'Fake Insight', def: 'Fake profundity and thought-leadership clichés',
    on: true,
    rules: ["the truth is", "changes everything", "nobody talks about this", "somewhere along the way",
            "nobody tells you", "the uncomfortable truth", "everything you've been told",
            "is wrong. here's why", "is half right", "harsh truth:"] },
  { id: 'engagementBait', name: 'Engagement Bait', def: 'Fishing for comments and reactions',
    on: true,
    // "below" and "in the comments" stay plain rules: nothing separates
    // call-to-action gating from an ordinary "Comment below with your
    // thoughts", and the Labs regex false-positived on it. Other
    // comment/reply shapes live in the Labs commentReplyGating pattern.
    // A bare "hook" rule is deliberately absent: plain rules have no word
    // boundary, so it would match "webhook" and "React hooks".
    rules: ["thoughts?", "agree?", "hot take", "unpopular opinion", "change my mind",
            "drop a ___ below", "drop a ___ in the comments", "type ___ below",
            "comment ___ below", "reply ___ below",
            "comment and i'll send", "reply and i'll send",
            "tag someone who", "repost if", "share if you agree",
            "stop scrolling", "this is your sign", "and i love it. why?", "busy founders:"] },
  { id: 'hustleCulture', name: 'Hustle Culture', def: 'Grind mentality and FOMO language',
    on: true,
    rules: ["rise and grind", "left behind", "hustle harder", "outwork everyone",
            "while you're sleeping",
            "your network is your net worth", "5am club", "built different"] },
  { id: 'sponsored', name: 'Sponsored', def: 'Paid partnerships from creators',
    // On by default, unlike other Labs entries: the move to a regex fixes false
    // positives and shouldn't silently stop catching disclosed ads.
    on: true, labs: true },
  { id: 'selfPromotion', name: 'Self Promotion', def: 'Posts that sign off asking for a follow.',
    on: true,
    // Verb-first phrasing ("hit follow") is the Labs followVerbAlternation pattern.
    rules: ["follow me for", "follow for more", "follow along for", "follow along if",
            "follow if you want", "ring the bell", "follow for the latest", "follow us for"] },
  { id: 'hashtagOverload', name: 'Hashtag Overload', def: 'Too many hashtags in one post',
    on: false, counting: true, unit: 'hashtags', threshold: 5 },
  { id: 'emojiOverload', name: 'Emoji Overload', def: 'Too many emoji in one post',
    on: true, counting: true, unit: 'emoji', threshold: 5 },
  // Off by default: "excited to announce" is also how people post real news (a
  // new job, a new baby), so false positives are likely.
  { id: 'humbleBrag', name: 'Humble Brag', def: 'Fake humility announcements',
    on: false,
    rules: ["humbled to announce", "excited to announce", "grateful to share",
            "blessed to announce", "honored to share"] },
  // Labs: off by default, no rules array; patterns are in LABS_PATTERNS.
  { id: 'followVerbAlternation', name: 'Follow Bait',
    def: 'Hides posts that beg for a follow, whatever the verb: hit, click, tap, smash or give follow',
    on: false, labs: true },
  { id: 'commentReplyGating', name: 'Comment/Reply Gate',
    def: "Comment or reply with a word to unlock something, beyond the built-in phrasing",
    on: false, labs: true },
];

/**
 * Returns every match of the enabled categories in `text`, dropping a match
 * that sits inside a longer one. opts.allowed lists phrases to ignore.
 * @param {string} text @param {{ categories?: Category[], [k: string]: any }} [opts] */
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

      // cat.off lists rules the reader unchecked: kept, but not flagging.
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
  // A phrase inside a longer match ("nobody tells you" inside "here's what
  // nobody tells you") is one catch: keep the longer.
  const within = (m, o) => o !== m && o.index >= 0 && o.phrase.length > m.phrase.length &&
    o.index <= m.index && o.index + o.phrase.length >= m.index + m.phrase.length;
  return out.filter(m => !(m.index >= 0) || !out.some(o => within(m, o)));
}

Object.assign(typeof module !== 'undefined' ? module.exports : (globalThis.SlopFilter ||= {}), {
  findMatches, BLANK, MAX_BLANKS, compile, SEED_CATEGORIES, COUNTERS, LABS_PATTERNS,
});
