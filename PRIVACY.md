# Privacy notes

This document describes data flows visible in the current client source. It is not a general privacy policy for Firebase or other third-party services.

## Local data

The application is designed to remain useful offline. Routine, inventory and assessment state can be stored in browser storage on the device. Clearing browser/site data may remove those local copies.

Each signed-in account's records are kept in a separate local store on the device. Switching accounts does not show one account's records to the other, but both stores remain in that browser's storage until site data is cleared. When a sync conflict or an upgrade occurs, the application saves up to four recovery copies per account in the same browser storage; they are not uploaded.

## Optional Firebase sync

When a user signs in, the application can synchronise account data to Firestore under `/users/{uid}`. Firestore Security Rules require an authenticated request and require the authenticated UID to match the document UID.

Authentication is provided by Firebase Authentication. The public client does not contain Firebase administrative credentials or a custom password database.

## Network dependencies

The application loads the Firebase browser SDKs from a third-party CDN. Fonts are self-hosted in this repository and cached by the service worker. For rare characters outside the self-hosted subset, the app also loads Noto Serif SC from Google Fonts when online; the browser then requests only the font slices for characters that actually appear on the page (including characters typed into notes or product names), so Google receives the usual request metadata (IP address, user agent, referrer) for those slices. Authentication and database traffic are sent to Firebase/Google services. The service worker is intended to cache the application shell, not to turn private cloud responses into public repository content.

## Optional AI adviser (invite-only)

Signed-in accounts on an invite list can use an AI adviser. Before the first automatic request, the app shows a notice describing what the adviser sees; until the user has seen it on that device, tonight's routine is planned offline and nothing is sent automatically. After that, the client sends requests to a small server operated by the app owner in these situations:

- once a day, when the "tonight" screen is open, to plan tonight's steps (and again after a local change such as tonight's shower or shave answer);
- after the user logs skin notes or marks tonight as done, for a short piece of feedback;
- when a new user finishes setup, for a first routine;
- once a week, when the adviser screen is first opened, for a weekly review (only if at least 3 days were logged in the last two weeks);
- after the user marks a product as used up or running low (or makes another shelf change on this device), to judge whether to buy something;
- when the user chats with the adviser, asks for a routine or weekly review, reads an ingredient label, or asks the adviser whether to buy something;
- when the user runs a photo analysis: the one to three photos taken this time, plus the front photo from the previous analysis if it is still stored on this device (the user can choose not to include it).

Each request carries the data needed to answer: the first word of the account's display name, products and their ingredient traits, the current routine, recent skin-state entries, face-map positions and notes, tonight's plan, the conversation text and any photo the user chooses to attach, and hormone-therapy context only if that user has enabled it in their own profile. For the operator's own account, the server may additionally attach health context that the operator maintains on the server, independently of the in-app setting. The server verifies the Firebase ID token and forwards the request to Anthropic's Claude API.

The server does not keep the request content. It logs only which account called which endpoint, the model, token counts and estimated cost. The only content it stores is short long-term memory notes: the adviser may save them on its own during chat (for example reactions to an ingredient, allergies or preferences); each save is shown under the reply ("remembered: ..."), and the user can view and delete them in the app. Conversation history stays on the device.

Some adviser output is saved into the user's own synced record: the photo analysis result (structured findings, not the photos), the adviser's feedback on a day's log, and weekly review results. Photos themselves are never synced; they stay in the browser's local database on the device and can be deleted from the app together with that day's record.

Reminders (off by default, per account): when the user turns them on in settings, the device registers a Web Push subscription with the adviser server and, when something changes, uploads a few facts used to decide whether to send a notification: today's date, the mode, whether tonight is marked done, the type of night and the name of tonight's key product, the clock times of the last 14 "done tonight" marks, whether photo analysis is on and the date of the last analysis, whether the medical notice is on and since when, and short ids of shopping items marked as needed now. No hormone data, skin notes or other records are sent for this. The server keeps only the latest set and the subscription, and deletes both when reminders are turned off. The one-line notification text is written by a fast Claude model from these facts, or taken from a fixed template; lock-screen text never names a condition or medication, and the medical notice always uses the same neutral sentence.

## Public repository boundary

No real user export, personal skincare record, account identifier, credential, private note or screenshot containing private information should be committed to this repository. Files explicitly listed in `.gitignore` are local-only operator material.
