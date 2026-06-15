# Hide & Highlight — Job Tools

A Chrome extension that runs on **every site**:

1. **Hide button (all sites)** — hover a card and a single floating **Hide** button appears
   at its top-right; clicking it **removes the card from view**. Hidden cards are saved
   automatically and **stay hidden across reloads**. Open the **Hidden jobs** page from the
   popup to review and restore them.
2. **Keyword highlighter (all sites)** — color your chosen words (languages, "Easy Apply",
   etc.) anywhere on the page. Matches are shown **bold on a colored background** so they
   stand out, managed from the toolbar popup. (The no-DOM highlight technique can't change
   font-size, so "bold" is rendered via text-stroke.)
3. **Viewed tint (LinkedIn only)** — a job card is given a background tint once it's been
   viewed. A card counts as viewed if LinkedIn labels it **"Viewed"** *or* if **you click
   it** — the extension tracks your clicks itself, because LinkedIn doesn't show its own
   "Viewed" label on the job that's currently open. Viewed cards are tinted, never hidden.

On LinkedIn, **Hide** identifies a posting by its **title + company**, so clicking it hides
**every** card with that role at that company — including duplicate/re-posted listings
elsewhere in the results, and copies that scroll into view later. On every other site the
button hides one card, keyed by a per-page content signature.

The extension **never injects elements into a site's cards** — the only thing it ever does
to a card is toggle a CSS class (tint or hide), and the Hide button is a separate floating
element. This avoids disturbing a site's own rendering (e.g. LinkedIn applying its "Viewed"
marking when you click a job).

### Where hidden cards are stored

Hidden cards are stored automatically in **`chrome.storage.local`** (the extension's local
JSON store) as records of `{ title, company, country, logo, url, timestamp }` keyed by the
card's signature — no Export step needed. The popup's **View hidden jobs** button opens a
dedicated page (`hidden.html`) that lists every hidden card with its logo, title, company,
and country, with a **Restore** button per card and **Clear all**. (Your viewed-click
history is stored alongside it under `seenJobs`.)

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.
4. Open any page — the Hide button and highlighter work everywhere; the "Viewed"
   background tint only runs on LinkedIn.

## Using the highlighter

Click the toolbar icon to open the popup:

- The **switch in the top-right of the header** is the master on/off for the whole
  extension. When it's off, the three feature toggles below are dimmed and nothing runs.
  All three features are **on by default**.
- **Highlight keywords** master toggle turns all painting on/off.
- **+** adds a keyword group: a label, comma-separated words to match, and a color.
- Each row has **pause** (⏸), **edit** (✎), and **delete** (🗑). The filter box narrows the list.
- Text color (black/white) is auto-chosen for contrast against the background color.

A few example groups are seeded on first run; edit or delete them freely.

### How the painting stays safe

The highlighter uses the **CSS Custom Highlight API** (`CSS.highlights`). It finds
matches by walking text nodes, builds `Range` objects, and registers them under a
named highlight per group with a generated `::highlight()` style rule. **No DOM
element is ever created, inserted, or moved** — the page markup is completely
untouched. That's why it can't break LinkedIn's card click handlers (a problem
that DOM-rewriting highlighters cause by detaching React's event wiring) and can't
interfere with existing tags.

## Carrying settings between profiles

- **Bundled defaults:** `defaults.json` seeds the keyword groups on install
  (via the service worker), so loading the extension on another Chrome profile
  starts with your groups already in place. Edit `defaults.json` to change them —
  the easiest way is to tune them in the popup, **Export settings**, then paste
  that file's contents into `defaults.json`.
- **Export / Import:** the popup footer has **Export settings** (downloads a JSON
  of all toggles + groups) and **Import settings** (loads one back). Use this to
  copy your exact setup to another profile or machine.

## Files

| File            | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| `manifest.json` | Manifest V3 config.                                           |
| `content.js`    | Hide button + hidden/seen storage, viewed tint, highlighter. |
| `content.css`   | Hide/tint rules and floating-button styling.                |
| `hidden.html/css/js` | The "Hidden jobs" page: logo + title + company + country, restore / clear all. |
| `background.js` | Seeds `defaults.json` into storage on install.               |
| `defaults.json` | Default keyword groups shipped with the extension.           |
| `popup.html/css/js` | Toolbar UI: toggles, keyword manager, View-hidden-jobs button, export/import. |
| `icons/`        | Extension icons.                                              |

## Notes

LinkedIn changes its CSS class names periodically. If the LinkedIn "Viewed" tint
or its Hide button stops working, update `CARD_SELECTORS` in `content.js`. The "Viewed"
detection matches the exact label text and is fairly stable.

On non-LinkedIn sites a "card" is any `article`, `li`, or element with
`role="listitem"`/`role="article"` that's large enough to hold real content. Hidden cards
are remembered by a hash of their text for the current page URL, so they stay hidden on
reload. If a card's text changes substantially between visits, its saved hidden state
won't match anymore. Turn the feature off per the **Per-card Hide button** toggle in the
popup if the floating button is noisy on a particular site — that also reveals everything
hidden while it's off. Use the **View hidden jobs** button in the popup (which opens the
Hidden jobs page) to restore individual cards.
