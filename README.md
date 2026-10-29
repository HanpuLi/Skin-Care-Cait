# Skin Care Cait

An offline-first skincare inventory and routine PWA. The public application is served from `index.html`; the historical Chinese-named URL is retained only as a redirect so existing bookmarks and installed copies keep working.

Live app: https://hanpuli.github.io/Skin-Care-Cait/

## Architecture

- **Static PWA:** `index.html`, `manifest.json`, `sw.js` and `icon.svg`.
- **Offline cache:** the service worker keeps the current application shell available after a successful load.
- **Local data:** skincare inventory, routine and assessment state are stored client-side for offline use.
- **Optional cloud sync:** Firebase Authentication and Firestore.
- **Access boundary:** `firestore.rules` permits an authenticated user to read or write only `/users/{their uid}`; unmatched paths are denied.

The Firebase browser configuration embedded in `index.html` is client configuration, not an administrative credential. Data access is enforced by Firebase Authentication plus Firestore Security Rules. See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

## Local development

No application build step is required:

```sh
python3 -m http.server 8000
# open http://127.0.0.1:8000/
```

Run the same source checks as QA with:

```sh
npm run test:sync          # sync-envelope logic, no browser needed
node t/run.mjs             # full headless suite (needs a local Google Chrome)
# .github/workflows/qa.yml also checks inline script syntax and public file boundaries
```

Firestore access-control rules have emulator-backed tests:

```sh
npm ci
npm run test:rules
```

The Firebase Firestore emulator requires a Java runtime.

## Offline sync and recovery

A same-origin Web Lock allows one app window at a time to read or change account storage. A second tab or installed PWA window shows a notice asking to close the other window and retry; it does not run any app code until then. If the browser has no Web Locks API, the app pauses without changing stored records. Close windows running an older app version when upgrading: they do not take the lock. Web Locks are available in Safari and iOS Safari 15.4+, in installed iOS home-screen apps on 15.4+, and in current Chromium browsers.

Each account has its own local sync envelope. An edit is committed to that envelope, with a revision number, before an upload is scheduled; closing the page, losing the connection or an upload timeout leaves the unconfirmed revision on the device and it is uploaded later. Cloud hydration waits for a server snapshot, and automatic startup writes (migrations, regenerated routines, a new day) are stored locally without being treated as edits, so they never overwrite an existing account.

Uploads use a Firestore transaction that writes only if the cloud document still matches the last version this device confirmed (or a version this device itself sent earlier). The transaction replaces the synced fields as a whole, so deleted entries stay deleted, and leaves other document fields untouched. If both the device and the cloud have changed, syncing pauses, recoverable copies of both versions are saved on the device, and the app asks which complete version to keep. Records from two devices are not merged automatically. Choosing “稍后再选” keeps syncing paused while local edits continue to be saved.

Local data from older app versions has no sync metadata. On the first server snapshot after upgrading, the app resolves it silently when that is unambiguous (identical data, an empty cloud document, a cloud document unchanged since this device last uploaded, or a stale device whose records are all already in the cloud) and asks only when the cloud has changed and the device also holds records the cloud does not. A copy of the pre-upgrade data is saved either way.

Recovery copies are listed under Settings → 数据 → 恢复副本, where each copy can be downloaded as a JSON backup or restored (the current records are saved as another copy first). Up to four copies are kept per account on that device; clearing site storage removes them.

## Repository boundary

This is a public deployment repository. Personal notes, inventories, local profiles, backups and operator instructions listed in `.gitignore` must remain local and must never be added to the Pages artifact.

## Licence

This repository currently has no open-source licence grant. Public source availability and GitHub Pages deployment do not grant permission to redistribute or relicense the application or its content.
