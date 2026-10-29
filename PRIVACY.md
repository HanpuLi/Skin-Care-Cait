# Privacy notes

This document describes data flows visible in the current client source. It is not a general privacy policy for Firebase or other third-party services.

## Local data

The application is designed to remain useful offline. Routine, inventory and assessment state can be stored in browser storage on the device. Clearing browser/site data may remove those local copies.

Each signed-in account's records are kept in a separate local store on the device. Switching accounts does not show one account's records to the other, but both stores remain in that browser's storage until site data is cleared. When a sync conflict or an upgrade occurs, the application saves up to four recovery copies per account in the same browser storage; they are not uploaded.

## Optional Firebase sync

When a user signs in, the application can synchronise account data to Firestore under `/users/{uid}`. Firestore Security Rules require an authenticated request and require the authenticated UID to match the document UID.

Authentication is provided by Firebase Authentication. The public client does not contain Firebase administrative credentials or a custom password database.

## Network dependencies

The application loads the Firebase browser SDKs from a third-party CDN. Fonts are self-hosted in this repository and cached by the service worker. Authentication and database traffic are sent to Firebase/Google services. The service worker is intended to cache the application shell, not to turn private cloud responses into public repository content.

## Optional AI adviser (invite-only)

Signed-in accounts on an invite list can use an AI adviser. Only when the adviser is used, the client sends the data needed to answer to a small server operated by the app owner: products and their ingredient traits, the current routine, recent skin-state entries and notes, the conversation text, any photo the user chooses to attach, and hormone-therapy context only if that user has enabled it in their own profile. The server verifies the Firebase ID token and forwards the request to Anthropic's Claude API.

The server does not keep the request content. It logs only which account called which endpoint, the model, token counts and estimated cost. The only content it stores is short long-term memory notes that the user explicitly asks the adviser to remember; the user can view and delete them in the app. Conversation history stays on the device.

## Public repository boundary

No real user export, personal skincare record, account identifier, credential, private note or screenshot containing private information should be committed to this repository. Files explicitly listed in `.gitignore` are local-only operator material.
