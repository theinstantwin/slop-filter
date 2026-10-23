# Slop Filter for LinkedIn

![Slop Filter: clean up the mess in your LinkedIn feed](.github/readme/promo-marquee.png)

A Chrome extension that folds the worst of your LinkedIn feed down to one line. The ChatGPT-shaped posts. The "read that again" posts. The guy who woke up at 4:30am for 1,000 days straight and wants you to comment GRIND for his morning routine.

Then it tells you exactly which phrase got each one caught.

That second part is the point. Every feed blocker asks you to trust it. Slop Filter shows its work, and when it gets one wrong, you overrule it in one click.

Not affiliated with LinkedIn.

---

## What you'll see

![A flagged post opened up, with its receipt of matched phrases](.github/readme/02-receipt.png)

A flagged post shrinks to a thin red bar: the author's name and a chip for each category it tripped. Click anywhere on the bar and the post opens. Click again and it folds back up.

Open one and you get the receipt. Every phrase that matched, struck through, labeled with its category, each with its own **Allow** button. Allow "agree?" and it's allowed everywhere, from everyone, from then on. The rest of the filter keeps working.

Good posts never see the extension. Nothing gets added to them, nothing moves.

Prefer to see everything? The toolbar popup can switch from **Collapse it to one line** to **Show the post with a notice**, so flagged posts stay open with the bar on top.

---

## What it catches

| Category | What it's looking for | A few of the phrases | On out of the box |
|-|-|-|-|
| AI Slop | Sentence shapes generated text loves | "let that sink in," "read that again," "in today's fast-paced world" | Yes |
| Fake Insight | Profundity with nothing underneath | "the truth is," "changes everything," "nobody talks about this" | Yes |
| Engagement Bait | Fishing for comments and reactions | "agree?," "unpopular opinion," "tag someone who," "stop scrolling" | Yes |
| Hustle Culture | Grind talk and FOMO | "rise and grind," "5am club," "your network is your net worth" | Yes |
| Self-promotion CTA | Pitching a follow instead of making the post stand on its own | "follow me for," "follow for more," "ring the bell" | Yes |
| Sponsored | Creator ads disclosed in the post | #ad, #sponsored, "partnering with" | Yes |
| Hashtag Overload | Too many hashtags | 5 or more, and you set the number | Yes |
| Emoji Overload | Too many emoji | 5 or more, and you set the number | Off |
| Humble Brag | Fake humility announcements | "humbled to announce," "excited to announce" | Off |

Humble Brag ships switched off on purpose. "Excited to announce" is also how people share a new job or a new kid, and you probably want to see those. Turn it on if your feed can take it.

LinkedIn's own ads, the ones labeled **Promoted**, don't get a bar at all. They're gone. Boosted posts can go the same way with one switch in Settings.

Every post also gets a few extra lines in its **···** menu: **Mute** the author, **Read anyway**, or **Allow** a whole category.

---

## Make it yours

Open Settings from the toolbar popup.

- **Categories.** Edit any phrase, add your own, delete the ones that bug you, or build a whole new category. Phrases are plain text and ignore capitalization. Type `circle back` and it catches "Circle back." Use three underscores as a blank: `drop a ___ below` catches "drop a 🔥 below" and "drop a YES below."
- **Muted people.** Everyone you've muted from the ··· menu, with an Unmute button and a six-second undo if you change your mind.
- **Activity.** What got caught, by category and by phrase. If you keep opening posts a phrase flagged, it gets marked as misfiring so you know it's catching things you want to read. There's also a shareable card of your totals, drawn in your browser.
- **Promoted content.** The switches for LinkedIn's Promoted and Boosted posts.
- **Backup.** Export your settings, or only your categories and phrases, and restore them on another machine. You see what's in the file before anything gets replaced.
- **Labs.** Two stricter patterns for follow-bait and comment-to-unlock posts. Off by default, because stricter means more false alarms.

---

## Private by design

Nothing leaves your browser. No account, no analytics, no server, no network requests. Your settings live in Chrome's own extension storage.

It asks Chrome for two permissions: `storage`, to remember your settings, and access to linkedin.com, to read the feed. That's the full list.

---

## Install

Slop Filter isn't on the Chrome Web Store yet. Until it is:

1. Download this repo as a ZIP and unzip it, or clone it.
2. Go to `chrome://extensions` and turn on **Developer mode**, top right.
3. Click **Load unpacked** and pick the folder.
4. Reload LinkedIn.

---

## How it works

`dom.js` is the only file that knows what LinkedIn's HTML looks like. LinkedIn rebuilt its feed in June 2026, and version 1.0 kept loading, kept reporting success, and matched nothing for six weeks. When LinkedIn changes its markup again, that's the one file to fix.
