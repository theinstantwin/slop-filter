# Slop Filter for LinkedIn

![Slop Filter: clean up the mess in your LinkedIn feed](.github/readme/promo-marquee.png)

A Chrome extension that folds the worst of your LinkedIn feed down to one line. The ChatGPT-shaped posts. The "read that again" posts. The guy who woke up at 4:30am for 1,000 days straight and wants you to comment GRIND for his morning routine.

Then it tells you exactly which phrase got each one caught.

That second part is the point. Every feed blocker asks you to trust it. Slop Filter shows its work, and when it gets one wrong, you overrule it in one click.

Not affiliated with LinkedIn.

---

## Here's how it works

- **Your feed gets quiet.** AI-written filler, engagement bait and hustle posts fold down to one thin line.
- **You see why.** Every flagged post shows the exact phrase that caught it.
- **You stay in charge.** One click opens any post. One more teaches the filter what to keep.
- **Good posts stay untouched.** Real updates from real people look exactly like they always have.
- **Nothing leaves your browser.** No account, no tracking, no server.

The filter reads every post as your feed loads and pulls out the slop before you have to wade through it. What's left is the reason you joined LinkedIn in the first place. The people you know and the work they're proud of. Install it once and your feed stays clean for good. (Yep, you can even get rid of all those long emoji posts.)

![A flagged post opened up, with its receipt of matched phrases](.github/readme/02-receipt.png)

---

## What it catches

You know these posts. You've scrolled past thousands of them. You've liked a few out of guilt. Slop Filter sorts them into nine piles:

- **AI Slop**: "let that sink in"
- **Fake Insight**: "nobody talks about this"
- **Engagement Bait**: "agree?"
- **Hustle Culture**: "5am club"
- **Self-promotion CTA**: "follow me for more"
- **Sponsored**: #ad
- **Hashtag Overload**: five or more
- **Emoji Overload** (off to start): five or more
- **Humble Brag** (off to start): "humbled to announce"

Humble Brag starts off because "excited to announce" is also how people share a new job or a new kid.

Every list is yours to edit. Add phrases, cut the ones that bug you, or build a category of your own. And because everyone has a friend who posts like a LinkedIn growth coach, there's **Trusted People**: add someone by name and their posts always come through untouched, slop and all. You can love a person and still hate their content strategy.

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

## Why I built this

I'm Matt DeSiena, and I've spent the better part of twenty years in social media at some of the best-known agencies in the Big 3 holding companies. Everywhere I go, from Cannes Lions 2026 to a long list of ad conferences, I hear the same thing. LinkedIn is the bane of every user's existence.

At Cannes I spent time outside Microsoft's exhibits. Microsoft owns LinkedIn, and even there, people were talking about how they just don't want to be on it.

Slop Filter is built to change that. It turns LinkedIn from the site people shudder at opening into one they actually look forward to.
