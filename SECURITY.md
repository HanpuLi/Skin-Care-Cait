# Security policy

This repository is the public deployment source for a client-side skincare PWA. Local notes, personal records and other private material are intentionally excluded by `.gitignore`.

## Reporting

Use GitHub private vulnerability reporting for security-sensitive findings. Do not include personal skincare records, account identifiers, screenshots containing private information, tokens or other credentials in a public issue.

Security-relevant areas include authentication, cloud synchronisation, access-control rules, import/export, service-worker caching and any change that could cause private local material to enter the public deployment artifact.

## Repository boundary

Only files tracked by Git are uploaded by the GitHub Pages workflow. Operator notes and private local records listed in `.gitignore` must stay untracked. Pull requests that widen the public file set should be reviewed specifically for privacy impact.
