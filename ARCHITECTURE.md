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
sw.js                 offline cache, cache-first for one version at a time; its file list must match js/ and css/ exactly,
                      and CACHE_NAME must be bumped whenever any precached file changes (the page, js/, css/, fonts,
                      manifest, icons; engine-unit reads the list from sw.js and checks both)
```

## Layers and rules

1. **Nothing touches storage or the DOM at import time.** Every module only defines functions. `js/app.js` calls `startWithLock()` (`js/sync.js`), and only after the same-origin Web Lock `skincare-account-storage` is held does `boot()` open the store. A second window shows a notice and changes nothing. The lock name is the same as the previous version, so old and new windows also exclude each other.

2. **One storage path.** All persistent records go through `store.lg(key)` / `store.ls(key, value, origin)` from `createStore()`. Keys live in `K` (synced) and `LOCAL_KEYS` (device only). `CLOUD_KEYS` is the list of synced keys and must stay identical to the previous version; QA compares it with `legacy/`.

   `ls` takes an origin:
   - `'user'` (default): a person changed something. The envelope revision goes up and an upload is scheduled.
   - `'derived'`: a record that follows from what the person did (for example, marking yesterday's prescribed step as used in minimal mode). The revision goes up.
   - `'system'`: startup maintenance (migrations, a regenerated routine, today's plan). Written locally only, never uploaded on its own, so it cannot overwrite an account from another device.

3. **The engine is pure.** `js/model/world.js` `buildWorld(store, {today})` reads every key once into a plain object `W`; every function in `js/engine/` takes `W` and returns data. Results are memoised per `W` (a `WeakMap`), and hypotheticals use `derive(W, patch)` instead of mutating globals. `buildWorld` is also the single place where minimal-mode history is absorbed (`absorbPrescribedHistory`), before anything reads the journal.

4. **One safety gate.** `engine/gate.js` `safetyGate(W)` decides what tonight may contain (acid cap, strong actives, retinol, oils, masks), and `gateBlocks(product, gate, W)` explains why a product is blocked. It also honours the starting state given during setup: "redness or stinging now" stops acids, masks and retinol for the first three nights after setup; "seeing a doctor / on medication" keeps tonight to cleansing, moisturiser, repair and eye cream until the person turns it off in settings (only when the v2 setup or settings wrote it, recorded as `careAt`; a value left by the v1 setup does not tighten the plan, so both versions keep computing the same night). The offline schedule (`engine/schedule.js`), the advisor's tonight changes, routine changes and whole plans (`ai/apply.js`) all pass through the same two functions. `engine/redline.js` decides when to suggest seeing a clinician. It counts only the status tags a person logged, not face-map spots or photo analysis results.

5. **Advisor changes apply directly and can be undone.** `ai/apply.js` validates each change against the gate, applies what passes, explains what was blocked, and stores enough to undo. Routine changes become a new routine version (`model/regimen.js`); undo is itself a version. The local-change notice (`shopLocalChange`) is fired only from these local entry points (apply / undo / restore and the `local*` shelf changes), never from sync, startup maintenance or automatic routine regeneration. QA checks this statically and by counting calls. It has two listeners, registered in `js/app.js`: the "should I buy something" runner (`ui/products.js` `ensureShopRunner`) and tonight's re-plan (`ui/tonight.js` `localChange`). Both debounce and skip the call when their signature has not changed.

6. **Startup failures stay visible.** `index.html` has a small classic-script watchdog: if the module graph never starts (a file failed to load or link), it shows "this version did not load completely" with a reload button after 8 seconds (1.5 seconds after a load error). `startWithLock` marks `<html data-boot="locking">` as soon as the modules run, and an exception inside `boot()` is caught there (the lock stays held and a "startup error, reload" sheet is shown) instead of escaping into the Web Lock callback. A screen whose `render`/`mount` throws shows a per-screen error card; the other screens keep working.

7. **Account switches reset screen state.** Each screen module may export `resetForUser()`; `js/app.js` calls them from the sync hook `clearLocalExtras` together with the advisor's local cache. Advisor requests remember `store.state.owner` before they start and drop the result if the account changed while waiting.

8. **Screens render from `W`.** A screen module gets `app` (`store`, `sync`, `ai`, `photos`, `today`, `world()`, `show`, `renderAll`, `signIn`, `signOut`). It builds its HTML in `render(app)` and binds events in `mount(root, app)`. It writes through model functions, then calls `app.renderAll()`. No inline event handlers and no globals on `window`.

## Automatic advisor requests

Nothing is sent to the advisor automatically (tonight's plan, feedback after logging, the first routine after setup, the weekly review, the "should I buy something" runner) until this account has seen the "what the advisor sees" notice on this device (`sk_aiprivacy1`, `ui/advisor.js` `dataNoticeSeen` / `openDataNotice`). Until then tonight uses the offline schedule and offers a "take a look first" link. Requests have time limits (`ai/client.js`); a streamed answer that ends without its `done` event is marked partial and is not stored as a complete answer.

## Tonight written by the advisor

`ui/tonight.js` asks the advisor (`/api/tonight`) for tonight's steps and runs the answer through `gateTonightPlan` before showing it. If the advisor is unavailable (offline, not invited, signed out, quota, error) the page uses the offline schedule from `engine/schedule.js` and says so.

- Cache: device-only key `sk_ai_tonight1` = `{uid, date, sig, data | err, quota, down, at, model, why}`. It is in `LOCAL_KEYS`, not in `CLOUD_KEYS`, so each device keeps its own copy and nothing is synced.
- `sig` = `date | shower | shave | minimal mode | routine version id | shelfSignature`. The first four parts are the premise of the advisor's answer. If only the last two change (a new routine version or a shelf change), the cached answer is gated again against the current state and kept, with a note and a "let the advisor re-plan" button. If the premise changes, the page falls back to the offline schedule until the advisor is asked again.
- When it calls: once on a new day, only while the page is visible (`document.hidden` is false); after a local change (this page's shower/shave buttons, "let the advisor re-plan", or `app.tonightChanged(why)` / the local-change notice from other screens), debounced, and only if `sig` changed; never because of a synced change or an automatic routine regeneration; never after tonight is marked done.
- Steps the person already ticked, and steps already logged today, are facts: the gate does not move them into "not tonight".
- In minimal mode the advisor's active steps are aligned with today's plan (`sk_planday1`), because tomorrow's presumed history follows that plan: actives outside the plan are not shown, and planned actives the advisor left out stay as steps with the advisor's reason, so only her "not done tonight" marks them as skipped.
- What tonight's page shows is computed in one place, `ai/apply.js` `shownTonight(W, aiData)` (tonight changes → gate → ticked steps put back → minimal-mode alignment → "something on the whole face" check, which adds a moisturiser if the advisor left none, or raises the safety notice). The chat and feedback context, `change_tonight` validation and the "next seven nights" cell for today all use the same function (`app.shownTonight()`), so the advisor talks about, and changes, the list she is looking at. Safety notices are recomputed for the shown steps (`engine/schedule.js` `stepWarnings`).
- If she has already ticked steps when a new advisor version arrives (late, or re-planned), the page keeps the list she is following and offers "swap in".

Other device-only keys added in v2: `sk_aiprivacy1` (`{uid, at}`: the data notice shown the first time this account opens the advisor screen on this device; same format as v1) and the photo-analysis switch, which is a profile field (`photoAnalysis`, synced): unset means on only for the owner account, other accounts must turn it on themselves.

## Tonight: per-step actions and "ask one thing"

`ui/tonight-step.js` (opened from the "adjust" button at the right of every product step on `ui/tonight.js`; the row itself is still the tick checkbox) adds two things, both only through existing paths:

- **Step sheet.** How to use / why, "not tonight", "swap for one on the shelf", "let the advisor pick" (`/api/swap`, reason used_up / uncomfortable / dont_want plus an optional line), "ask the advisor" (prefills the chat, never sends). Every change is written to the same tonight revision line as the advisor's (`sk_tnai1`, `ai/apply.js` `applyTonight`), so undo / redo are one mechanism. Her own changes carry `by: 'user'` on the op: the revision bar says "你改了今晚" (neutral rule, not the advisor's `--rev`), `withOverride` / the offline schedule word the reasons as "你". An advisor pick is the advisor's change (no `by`).
- **The gate is not duplicated.** Candidates (same role, on the shelf, usable at night) must pass `validateTonight` (the check the advisor's tonight changes use) and then `shownTonight` is run on a derived world with the hypothetical op (`derive(W, {tnai})`), so the whole pipeline (override, `gateTonightPlan`, kept ticks, minimal-mode alignment, moisturiser cover) decides whether the product really gets a step. After a change is applied the shown plan is checked once more and the change is undone on the spot if it did not take. Ticked steps and a finished night cannot be edited. With the medical red line on there is no acid step and no acid candidate.
- **Ask one thing.** A panel under the steps sends `/api/quick` with `live` = now, ticked / not yet / marked "not done" (minimal mode sends no ticks, only what she marked not done), and the steps she sees. The answer streams in; a `change_today` action goes through `applyTonight` (same gate, same revision line). State is in memory only (cleared on account switch and at midnight); no new storage key.
- Both are hidden when `app.ai.access() !== 'on'` (signed out, not invited); "not tonight" and the shelf swap work offline. The first send asks for the "what the advisor sees" notice like every other request.

## Shell

The design target is a real phone screen (390 × 844). The page header (date and seal) is `position: sticky` at the top, the content scrolls under it with the document's own scrolling, and the tab bar is fixed at the bottom. There is no separate overflow container, so iOS keeps its native behaviours (tap the status bar to scroll up, Safari's toolbar collapsing, the keyboard pushing inputs into view). Because the four tabs share the document scroll, `show(id)` remembers each tab's scroll position and restores it (a tab not visited yet starts at the top).

The Firebase SDK is not loaded by `index.html`; `js/app.js` inserts the three compat scripts after the first screen is drawn (the service worker caches them). If they cannot load, the app keeps working on local data and says that the sign-in service could not load, rather than "not signed in".

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
- Photos (IndexedDB, device only) are keyed by the envelope owner (`store.state.owner`), the same owner as the records, not by the currently signed-in Firebase user; photos saved under `local__` before sign-in move to the account when it claims the local records.
- Engine change on purpose (not in v1): on a shave night the advisor's "add a clay mask" is refused and a mask is dropped from that night's slot, like acid and retinol. It only affects nights where a mask would otherwise be placed next to shaving.

## Advisor service

`js/ai/client.js` talks to the advisor service with the signed-in user's Firebase ID token. Endpoints used: chat (streaming), quick, plan, review, note, feedback, swap, vision, tonight, assess, shop, memory. `js/ai/context.js` builds the snapshot sent with a request: profile, products, recent logs (with spots and photo results), acid history (this week's acid nights and recent dates), the next seven nights' shower/shave schedule, low and emptied products, and the offline ladder and gate. Fields that only apply to some users are included only when that user has turned them on.

## Tests

```sh
npm run test:sync      # sync envelope and lock, no browser (imports js/store.js + js/sync.js)
npm run test:engine    # gate, redline, ladder, schedule, needs, routine versions, advisor apply/context, file table
npm run test:rules     # Firestore security rules and round trip, needs Java for the emulator
node t/run.mjs         # everything that runs on this machine, one after another (needs Google Chrome; about 10 to 15 minutes)
```

`t/run.mjs` runs the two unit suites, the migrated whole-page scenarios `t/s-*.mjs`, and these headless Chrome suites as separate processes:

```sh
node t/v2-boot.mjs        # shell loads, four tabs switch, deep links, lock, dark mode, 0 console errors
node t/v2-a-tonight.mjs   # tonight: advisor-written plan, cache and gate, offline fallback, minimal mode, safety notices
node t/v2-a-record.mjs    # record: quick note, skin sheet, face map, advisor feedback, HRT
node t/v2-a-capture.mjs   # photo analysis: per-account switch, camera fallbacks, retake, confirm before writing
node t/v2-b-advisor.mjs   # advisor: chat, revision lines, routine versions, next seven nights, guide
node t/v2-b-products.mjs  # shelf, run out / bought again / running low, add, label reading, "should I buy something"
node t/v2-b-settings.mjs  # settings: mode, habits, photo consent, owner options, backup and data notes
node t/v2-b-oobe.mjs      # new-user setup and the one-time "what changed" note
node t/v1-parity.mjs      # the previous version and v2 compute the same tonight, schedule, routine and plan on the same data
```

All of them use fake advisor and Firebase stand-ins inside the page; nothing calls the real advisor service.

`t/v1-parity.mjs` guards the transition period, when one account may be open in both versions. Both versions write the routine and today's plan as `'system'` records only when they change, so any difference in what they compute would make them overwrite each other. If the engine is changed on purpose, document it here and bump `REGIMEN_ENGINE`.

`t/s-*.mjs` were whole-page tests written against the previous single file. They now run against v2: they wait for `<html data-boot="ok">`, read records from the account's envelope in `localStorage` instead of globals, and click the real DOM. Assertions about rules moved into `t/engine-unit.mjs`; assertions that the v2 suites already cover point to them in each file's header; the few that no longer apply (for example the step timer, which the v2 design does not have) are listed with the reason at the top of `t/run.mjs`.

## Where new UI goes

- A screen: `js/ui/<screen>.js` and `css/screens/<screen>.css`. Add the files to `sw.js` (QA fails otherwise).
- Shared sheets, alerts and toasts: `js/ui/sheets.js`.
- Rules: `js/engine/`. If a screen needs a new decision, add a pure function there with a unit test, not logic in the screen.
- Text shown to people is Chinese; source has no emoji.
