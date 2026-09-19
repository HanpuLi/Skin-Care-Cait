# Privacy notes

This document describes data flows visible in the current client source. It is not a general privacy policy for Firebase or other third-party services.

## Local data

The application is designed to remain useful offline. Routine, inventory and assessment state can be stored in browser storage on the device. Clearing browser/site data may remove those local copies.

## Optional Firebase sync

When a user signs in, the application can synchronise account data to Firestore under `/users/{uid}`. Firestore Security Rules require an authenticated request and require the authenticated UID to match the document UID.

Authentication is provided by Firebase Authentication. The public client does not contain Firebase administrative credentials or a custom password database.

## Network dependencies

The application loads Firebase browser SDKs and web fonts from third-party CDNs. Authentication and database traffic are sent to Firebase/Google services. The service worker is intended to cache the application shell, not to turn private cloud responses into public repository content.

## Public repository boundary

No real user export, personal skincare record, account identifier, credential, private note or screenshot containing private information should be committed to this repository. Files explicitly listed in `.gitignore` are local-only operator material.
