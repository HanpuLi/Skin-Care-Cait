# Architecture (v2)

The app is a static PWA made of native ES modules. There is no build step: `index.html` is a shell with mount points, and `js/app.js` is the only entry script. The previous single-file version is kept read-only in `legacy/` (as `.txt`, so Pages never serves it as a page); it is neither loaded nor cached.

```
index.html            shell: header, four tab panels, tab bar, sheet root
js/app.js             boot, routing (#/tonight | #/advisor | #/record | #/products), Firebase hookup, SW registration
js/clock.js           local dates; a day rolls over at 03:00
js/store.js           storage keys, the only localStorage read/write path, sync envelope, recovery copies
js/sync.js            Firestore sync, conflict and recovery UI, the one-window Web Lock
js/firebase-config.js public Firebase client configuration (not a credential; see SECURITY.md)
js/model/*.js         records: profile, products, journal, week (shower/shave schedule), regimen, photos, world
js/engine/*.js        pure rules: gate, redline, ladder, rules, schedule, needs, score, assess, regimen
js/ai/*.js            advisor: HTTP client, context snapshot, applying advisor changes through the gate
js/ui/*.js            one module per screen plus shared sheets; each exports id, title, render(app), mount(root, app)
css/tokens.css        paper-and-ink design tokens, light and dark
css/base.css          reset, layout, typography, tab bar, toast
css/components.css    buttons, chips, segmented controls, fields, switches, sheets, folds
css/screens/*.css     per-screen styles
sw.js                 offline cache; its file list must match js/ and css/ exactly (checked in QA)
```

## Layers and rules

1. **Nothing touches storage or the DOM at import time.** Every module only defines functions. `js/app.js` calls `startWithLock()` (`js/sync.js`), and only after the same-origin Web Lock `skincare-account-storage` is held does `boot()` open the store. A second window shows a notice and changes nothing. The lock name is the same as the previous version, so old and new windows also exclude each other.

2. **One storage path.** All persistent records go through `store.lg(key)` / `store.ls(key, value, origin)` from `createStore()`. Keys live in `K` (synced) and `LOCAL_KEYS` (device only). `CLOUD_KEYS` is the list of synced keys and must stay identical to the previous version; QA compares it with `legacy/`.

   `ls` takes an origin:
   - `'user'` (default): a person changed something. The envelope revision goes up and an upload is scheduled.
   - `'derived'`: a record that follows from what the person did (for example, marking yesterday's prescribed step as used in minimal mode). The revision goes up.
   - `'system'`: startup maintenance (migrations, a regenerated routine, today's plan). Written locally only, never uploaded on its own, so it cannot overwrite an account from another device.

3. **The engine is pure.** `js/model/world.js` `buildWorld(store, {today})` reads every key once into a plain object `W`; every function in `js/engine/` takes `W` and returns data. Results are memoised per `W` (a `WeakMap`), and hypotheticals use `derive(W, patch)` instead of mutating globals. `buildWorld` is also the single place where minimal-mode history is absorbed (`absorbPrescribedHistory`), before anything reads the journal.

4. **One safety gate.** `engine/gate.js` `safetyGate(W)` decides what tonight may contain (acid cap, strong actives, retinol, oils, masks), and `gateBlocks(product, gate, W)` explains why a product is blocked. The offline schedule (`engine/schedule.js`), the advisor's tonight changes, routine changes and whole plans (`ai/apply.js`) all pass through the same two functions. `engine/redline.js` decides when to suggest seeing a clinician. It counts only the status tags a person logged, not face-map spots or photo analysis results.

5. **Advisor changes apply directly and can be undone.** `ai/apply.js` validates each change against the gate, applies what passes, explains what was blocked, and stores enough to undo. Routine changes become a new routine version (`model/regimen.js`); undo is itself a version. The "should I buy something" re-check (`shopLocalChange`) is triggered only from these local entry points, never from sync, startup maintenance or automatic routine regeneration. QA checks this statically and by counting calls.

6. **Screens render from `W`.** A screen module gets `app` (`store`, `sync`, `ai`, `photos`, `today`, `world()`, `show`, `renderAll`, `signIn`, `signOut`). It builds its HTML in `render(app)` and binds events in `mount(root, app)`. It writes through model functions, then calls `app.renderAll()`. No inline event handlers and no globals on `window`.

## Data flow

```
user action ─▶ model fn ─▶ store.ls(..., 'user') ─▶ envelope rev+1 ─▶ sync.schedulePush ─▶ Firestore transaction
                                                    │
cloud snapshot ─▶ sync.onCloudSnapshot ─▶ store (applyingCloud) ─▶ hooks.reloadFromStore / renderAll
                                                    │
render ─▶ buildWorld(store) ─▶ engine(W) ─▶ ui/*.js
```

Startup: lock, open envelope, migrate older keys, seed profile, then `'system'` maintenance (habit sources, shelf migrations, status cleanup, new-day tonight state, routine, today's plan), then render, then Firebase and the service worker.

## Data compatibility

- Same keys, same value shapes, same sync envelope (`sk_sync_v1:<uid>`), same recovery copies (up to four per account on a device) and same Firestore document layout as the previous version. A device running the old version and one running v2 can share an account.
- The routine fingerprint (`REGIMEN_ENGINE = 'e4'`, `skinSignature`, `shelfSignature`) is unchanged, so the two versions do not keep regenerating each other's routine.
- New optional fields: journal `skipped` (steps a person marked as not done), `spots` (face-map zones), `photoAssess` (cleaned photo analysis result); tonight-change undo records may carry `noteAdded`. Older readers ignore them.

## Advisor service

`js/ai/client.js` talks to the advisor service with the signed-in user's Firebase ID token. Endpoints used: chat (streaming), quick, plan, review, note, feedback, swap, vision, tonight, assess, shop, memory. `js/ai/context.js` builds the snapshot sent with a request: profile, products, recent logs (with spots and photo results), acid history (this week's acid nights and recent dates), the next seven nights' shower/shave schedule, low and emptied products, and the offline ladder and gate. Fields that only apply to some users are included only when that user has turned them on.

## Tests

```sh
npm run test:sync      # sync envelope and lock, no browser (imports js/store.js + js/sync.js)
npm run test:engine    # gate, redline, ladder, schedule, needs, routine versions, advisor apply/context, file table
npm run test:rules     # Firestore security rules and round trip, needs Java for the emulator
node t/v2-boot.mjs     # headless Chrome: shell loads, four tabs switch, deep links, lock, dark mode, 0 console errors
node t/v1-parity.mjs   # headless Chrome: the previous version and v2 compute the same tonight, schedule, routine and plan on the same data
```

`t/v1-parity.mjs` guards the transition period, when one account may be open in both versions. Both versions write the routine and today's plan as `'system'` records only when they change, so any difference in what they compute would make them overwrite each other. If the engine is changed on purpose, document it here and bump `REGIMEN_ENGINE`.

`t/s-*.mjs` are whole-page tests written against the previous single file. They are being moved screen by screen: each assertion about rules moves into `t/engine-unit.mjs`; each assertion about a screen is rewritten against the new DOM when that screen is built. `t/s-80-sync.mjs` already runs against the new modules.

## Where new UI goes

- A screen: `js/ui/<screen>.js` and `css/screens/<screen>.css`. Add the files to `sw.js` (QA fails otherwise).
- Shared sheets, alerts and toasts: `js/ui/sheets.js`.
- Rules: `js/engine/`. If a screen needs a new decision, add a pure function there with a unit test, not logic in the screen.
- Text shown to people is Chinese; source has no emoji.
