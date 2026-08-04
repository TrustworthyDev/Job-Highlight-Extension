# Shared state across Chrome profiles (native host)

This makes every Chrome profile that loads the extension share **one** set of
clicked ("viewed") jobs, hidden jobs, blocked companies and **highlight keyword
groups**. One profile writes the state to a local JSON file; the next profile reads
it and shows the same thing. (Designed for use **one profile at a time** — not
simultaneously.)

```
content.js ──► background.js ──(native messaging)──► host.js ──► shared-state.json
```

## Requirements

- **Node.js** installed and on `PATH` (the host runs via `node`). Check with `node -v`.
  If you'd prefer Python or a no-dependency `.exe`, ask and we'll swap the host.

## Install (once per Windows user — covers all profiles)

1. Load the extension unpacked in Chrome: `chrome://extensions` → **Developer mode** →
   **Load unpacked** → select the extension folder. Do this from the **same folder**
   in every profile (that's what gives them the same extension ID).
2. Open the extension popup → **Profile sync** → **Copy setup command**. This copies
   `install.bat <your-extension-id>` with the ID already filled in. (The popup also
   shows whether sync is currently **On** or **Off**.)
3. Open this `native-host` folder, **paste** the copied command, and press Enter.

   (Manual equivalent: `install.bat <extension-id>`, or
   `powershell -ExecutionPolicy Bypass -File install.ps1 -ExtensionId <id>`.)

4. Restart Chrome (all windows/profiles). The popup should now show **Profile sync: On**.

That's it. `install` writes `com.jobtools.shared.json` (the host manifest) and a
registry entry under `HKCU\Software\Google\Chrome\NativeMessagingHosts` pointing at
it. Because that registry hive is per-Windows-user, all of your Chrome profiles use
it automatically.

## How it behaves

- Open LinkedIn in a profile → the extension asks the host for the file and applies
  the saved viewed/hidden state.
- Click or hide a job → the extension sends just that change; the host merges it into
  the file (so other profiles' saved jobs are never overwritten).
- Switch to another profile later → it loads the same file and looks identical.

## Files

| File | Purpose |
| --- | --- |
| `host.js` | The host program. Reads/writes `shared-state.json`. |
| `host.bat` | What Chrome launches (`node host.js`). |
| `install.bat` / `install.ps1` | Registers the host for the current user. |
| `uninstall.bat` | Removes the registration. |
| `shared-state.json` | Created on first write. The shared data: `{ seen, hidden, companies, groups }`. `groups` (the highlight keyword groups) is an ordered array merged by group id; the key is absent until it's first seeded. |
| `../linkedin-job-tools-settings.json` | One-way mirror of the keyword groups, rewritten by the host whenever they change, in the same shape as the extension's **Export settings**. Read-only as far as Chrome is concerned — use **Import settings** to load it back. |

## If the host isn't installed

The extension still works — it just falls back to **per-profile** storage
(`chrome.storage.local`), so profiles won't share until you run the installer.

## Notes

- The shared file lives in this folder. Keep the extension in a path all profiles
  can read/write.
- A native-messaging message is capped at ~1 MB host→Chrome; that's thousands of
  job records, far more than a normal search session.
