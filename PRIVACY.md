# Privacy Policy

**Slop Filter for LinkedIn**
Last updated: October 24, 2026

Slop Filter does its work inside your browser. It has no server, no account and no analytics, and it never sends anything about you or your feed anywhere.

## What it reads

On `www.linkedin.com`, and nowhere else, the extension reads the text of posts in your feed and the name of each post's author. It checks that text against your filters to decide whether to flag a post. The reading happens on your device, and the text is not kept except as noted below.

## What it stores

Everything is saved with Chrome's local extension storage (`chrome.storage.local`) on your computer:

- Your settings: which filters are on, your phrases and categories, your limits for hashtags and emoji.
- The names of people you mute or mark as trusted.
- Phrases you choose to allow.
- Activity counts: how many times each phrase was caught and how many promoted posts were hidden. These counts include the matched phrase itself, which is a few words from a post.
- The date you installed the extension.

This data never leaves your browser. Uninstalling the extension deletes it.

## What it sends

Nothing. The extension makes no network requests and loads no remote code. It uses no cookies, trackers, ads or third-party services.

The only way data leaves the extension is a file you create yourself: the Backup panel can download your settings as a JSON file, and the Activity panel can download a PNG summary card. Those files go to your computer, and where they go from there is up to you.

## Permissions

- **storage:** saves the settings and counts listed above on your device.
- **Access to www.linkedin.com:** lets the extension read posts in your feed and add the flag bar to the ones it catches.

## Sale and sharing

No data is collected, so none is sold, shared or used for anything beyond filtering your feed.

## Changes

If this policy changes, the new version will be posted here with a new date.

## Contact

Questions: open an issue at [github.com/theinstantwin/slop-filter](https://github.com/theinstantwin/slop-filter/issues).

Slop Filter is not affiliated with LinkedIn.
