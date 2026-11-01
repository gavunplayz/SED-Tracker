# Small Enclosed Driving Tracker

Static GitHub Pages tracker. No database, Roblox game scripts, or serverless proxy are included in this first version.

## Files
- index.html — page structure
- style.css — responsive dark theme
- app.js — game cards and team directory
- config.js — Roblox place IDs and refresh interval
- accounts.js — public team member list

## Add team members
Edit accounts.js:
```js
const SED_ACCOUNTS = [
  { username: "RobloxUsername", displayName: "Display Name", robloxId: "123456789", group: "Management" },
  { username: "AnotherUser", displayName: "Another User", robloxId: "987654321", group: "Developer" }
];
```
Groups: Management, Developer, Tester, Moderator.

## Live data
The current version is a visual preview. Roblox player counts and presence are not fetched yet. Browser CORS restrictions may prevent direct requests, so the live connection will be evaluated separately. Do not put passwords, cookies, or API secrets in this public repository.
