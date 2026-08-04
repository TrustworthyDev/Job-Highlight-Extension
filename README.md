# Hide & Highlight — Job Tools

A Chrome extension that runs on **every site**:

1. **Hide button (all sites)** — hover a card and a single floating **Hide** button appears
   at its top-right; clicking it **removes the card from view**. Hidden cards are saved
   automatically and **stay hidden across reloads**. Open the settings page from the popup
   (**Other settings**) to search, filter and restore them.

   **Hide by company (LinkedIn)** — on the settings page's **Companies** tab, type a company
   name and every job card from that company is hidden (case-insensitive, matches company
   names containing the text). Remove a name from the list to unblock it. The list is shared
   across profiles the same way hidden jobs are.
2. **Keyword highlighter (all sites)** — color your chosen words (languages, "Easy Apply",
   etc.) anywhere on the page. Matches are shown **bold on a colored background** so they
   stand out, managed on the settings page's **Keywords** tab. (The no-DOM technique can't change
   font-size, so "bold" is rendered via text-stroke.)
3. **Hide "Easy Apply" jobs (LinkedIn only)** — off by default. When on, every job card
   LinkedIn labels **"Easy Apply"** is removed from view, the same way a manually hidden
   card is. It matches the visible footer label rather than a class name (LinkedIn's class
   names churn, the label doesn't), and only an exact leaf-node match counts — a job
   description that happens to mention "Easy Apply" in a sentence is not hidden. Nothing is
   stored: turn the toggle off and the cards come straight back.
4. **Viewed tint (LinkedIn only)** — a job card is given a background tint once it's been
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

Hidden cards are stored automatically as records of
`{ title, company, country, logo, url, timestamp }` keyed by the card's signature — no
Export step needed. The popup's **Other settings** button opens the settings page
(`hidden.html`, also reachable via **Options** on `chrome://extensions`). Its **Hidden jobs**
tab lists every hidden card with its logo, title, company and country, and lets you search by
text, filter by site or time range, sort, **Restore** individual cards, or **Clear all**.
(Your viewed-click history is stored alongside it.)

By default the data lives in this profile's **`chrome.storage.local`**.

### Sharing across Chrome profiles (optional)

To make **every profile show the same clicked/hidden jobs** (used one profile at a time),
install the bundled native host — see **[`native-host/README.md`](native-host/README.md)**.
It stores the state in a single local JSON file (`native-host/shared-state.json`) that all
profiles read and write through a small Node helper. Flow:

```
content.js ──► background.js ──(native messaging)──► host.js ──► shared-state.json
```

Step-by-step setup, what exactly is shared, and troubleshooting for a stuck "Off" badge
are all written out on the settings page under **Sync & backup**.

A profile loads the file when a page opens, and on each click/hide it sends **only that
change** (a delta op) to the host, which **merges** it into the file. So profiles never
overwrite each other — every profile's clicks/hides accumulate in the one file, and a
restore/clear removes only the specific item. If the host isn't installed, the extension
falls back to per-profile `chrome.storage.local`.

A long-open profile also stays in sync: it re-reads the shared file **every minute** (a
background alarm) and **immediately when you switch back to its window/tab**, so it picks up
what other profiles changed without needing a reload.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.
4. Open any page — the Hide button and highlighter work everywhere; the "Viewed"
   background tint only runs on LinkedIn.

## Using the highlighter

Click the toolbar icon to open the popup. The popup holds **only the switches**:

- The **switch in the top-right of the header** is the master on/off for the whole
  extension. When it's off, the four feature toggles below are dimmed and nothing runs.
  The first three are **on by default**; **Hide "Easy Apply" jobs** is off by default,
  since it removes cards from view.
- **Highlight keywords** master toggle turns all painting on/off.
- **Other settings** opens the settings page, where everything else lives.

On the settings page's **Keywords** tab:

- **Add group** creates a keyword group: a label, comma-separated words to match, and a colour.
- Each row has **pause** (⏸), **edit** (✎), and **delete** (🗑). The filter box narrows the list.
- Text color (black/white) is auto-chosen for contrast against the background color.
- **Matching ignores case.** `Go` highlights `Go`, `go` and `GO`; `On-Site` also catches
  LinkedIn's `On-site`. Add a term per *spelling*, not per capitalisation — `Node.js, NodeJS`
  are two spellings, `nodejs` and `NodeJS` are not.
- **Matching is whole-word.** A term never matches glued inside a longer word: `Go` is
  highlighted in `Go, Python` and `(Go)` but not in `ArgoCD`, `Google` or `Mongo`, and `Java`
  is not highlighted inside `javascript`. This is what keeps short terms usable. The edges
  are lookarounds (`(?<![\p{L}\p{N}])` … `(?![\p{L}\p{N}])`) rather than `\b`, because `\b` is
  defined against word characters and so breaks on terms that begin or end with punctuation —
  `\b.NET\b` would never match ` .NET ` and `\bC#\b` would never match `C# `.
- Longer terms win over shorter ones, so `Node.js` is highlighted as one match rather than
  `Node` plus `.js`, and `GoLang` beats `Go`.

The settings page follows your system light/dark theme; the icon in its header cycles
system → light → dark.

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

- **Shared automatically:** keyword groups live in the same shared file as the
  clicked/hidden jobs (`native-host/shared-state.json`), so adding, editing, pausing
  or deleting a group on one profile changes the file immediately and every other
  profile picks it up — no export/import needed. Groups merge **by group id**, so two
  profiles editing different groups don't overwrite each other's list. Without the
  native host installed they fall back to this profile's `chrome.storage.local`.
  Only the on/off toggles remain per-profile (`chrome.storage.sync`).
  Groups that were already in `chrome.storage.sync` from an older version are moved
  into the file automatically the first time the new version loads.
- **Bundled defaults:** `defaults.json` seeds the keyword groups on install
  (via the service worker), so loading the extension on another Chrome profile
  starts with your groups already in place. Edit `defaults.json` to change them —
  the easiest way is to tune them on the settings page, **Export settings**, then paste
  that file's contents into `defaults.json`.
- **Auto-saved settings file:** with the native host installed, every keyword change is
  also written to **`linkedin-job-tools-settings.json`** in the extension folder, in the
  same shape **Export settings** produces — so there's always a readable, up-to-date copy
  to open or commit, without pressing Export. Keys already in that file (toggles from an
  earlier export) are preserved; only `highlightGroups` is replaced, and a `savedAt`
  timestamp is added. It is written **one-way**: `shared-state.json` stays the source of
  truth, and hand-editing the settings file changes nothing until you **Import** it.
  Card clicks and hides don't rewrite it — only keyword changes do.
- **Export / Import:** the settings page's **Sync & backup** tab has **Export settings**
  (a JSON of all toggles + groups) and **Import settings** (loads one back). Use this to
  copy your exact setup to another profile or machine.

## Files

| File            | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| `manifest.json` | Manifest V3 config.                                           |
| `content.js`    | Hide button + hidden/seen storage, viewed tint, highlighter. |
| `content.css`   | Hide/tint rules and floating-button styling.                |
| `hidden.html/css/js` | Settings page (registered as the extension's options page): Hidden jobs, Keywords, Companies, Sync & backup tabs. |
| `theme.js`      | Resolves the settings page's light/dark theme before first paint. |
| `background.js` | Seeds defaults on install; bridges the page to the native host (shared state). |
| `native-host/`  | Optional Node host + installer for sharing state across profiles via one JSON file. |
| `defaults.json` | Default keyword groups shipped with the extension.           |
| `popup.html/css/js` | Toolbar UI: master switch + the four feature toggles, and the **Other settings** button. |
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
hidden while it's off. Use **Other settings** in the popup to open the settings page and
restore individual cards from its **Hidden jobs** tab.
