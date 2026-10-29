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
# see .github/workflows/qa.yml for the exact checks
node --version
```

Firestore access-control rules have emulator-backed tests:

```sh
npm ci
npm run test:rules
```

The Firebase Firestore emulator requires a Java runtime.

## Repository boundary

This is a public deployment repository. Personal notes, inventories, local profiles, backups and operator instructions listed in `.gitignore` must remain local and must never be added to the Pages artifact.

## Licence

This repository currently has no open-source licence grant. Public source availability and GitHub Pages deployment do not grant permission to redistribute or relicense the application or its content.
