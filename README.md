# LeetSync

Chrome extension that pushes accepted LeetCode submissions to a GitHub repo. Unlike LeetHub, it uses a fine-grained token scoped to **one repo** instead of access to all your repos.

## Setup

1. Create a GitHub repo (add an initial README).
2. Create a fine-grained token: **Only select repositories** → your repo, **Contents: Read and write**.
3. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
4. Click the extension icon, enter username, repo and token → Save → Test connection.
5. Refresh LeetCode and submit. Accepted solutions land in `NNNN-problem-slug/`.

## Files

- `inject.js` - detects accepted submissions on the page
- `content.js` - fetches code and problem info from LeetCode
- `background.js` - commits to GitHub (only place the token is used)
- `options.html/js` - settings page

## Debugging

DevTools console on LeetCode → filter `LeetSync`. GitHub errors show under `chrome://extensions` → LeetSync → service worker.
