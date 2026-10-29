# Security policy

This repository is the public deployment source for a client-side skincare PWA. Local notes, personal records and other private material are intentionally excluded by `.gitignore`.

## Reporting

Use GitHub private vulnerability reporting for security-sensitive findings. Do not include personal skincare records, account identifiers, screenshots containing private information, tokens or other credentials in a public issue.

Security-relevant areas include authentication, cloud synchronisation, access-control rules, import/export, service-worker caching and any change that could cause private local material to enter the public deployment artifact.

## Repository boundary

Only files tracked by Git are available to the GitHub-hosted Pages build. Operator notes and private local records listed in `.gitignore` must stay untracked. Pull requests that widen the public file set should be reviewed specifically for privacy impact.

## Firebase web API key review

The Firebase web API key embedded in the browser configuration is a project identifier rather than an administrative credential. It still needs an API-restriction review in Google Cloud: keep it restricted to the Firebase-related APIs this app actually uses, and do not enable unrelated or billable APIs on the same browser key. Firestore Security Rules remain the data-access boundary; Firebase App Check should be enabled where practical.

The emulator-backed rules tests verify owner-only reads/writes, denied cross-account access, denied anonymous access, and default-denied unmatched subcollections.
