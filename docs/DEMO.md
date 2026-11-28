# CoNote – Demo guide

**Status (2026-11-26):** these instructions describe a **local** demonstration. A public instance does not exist (DEPLOYMENT.md §16.A), so there is no public URL to demonstrate. Once a deployment exists and `pnpm verify:deployment` passes against it, the same script (§4) works on its address, using two browsers on two networks if possible.

## 1. What the demonstration shows

CoNote is a collaborative workspace: several people edit one page at the same time and see each other, comment, and recover earlier versions. Each part below takes about a minute; the whole demo about eight minutes.

## 2. Preparation (once, about 10 minutes)

Prerequisites: Node.js 24, pnpm 12.18.0, Docker, two different browsers (or one normal and one private window; two profiles are better because the cookies must not be shared).

```bash
pnpm bootstrap                    # .env, install, PostgreSQL + Redis, build, migrations
pnpm dev:api & pnpm dev:collab & pnpm dev:web      # three terminals are clearer
```

Open <http://localhost:3000> in browser A. Check `http://localhost:4000/ready` and `http://localhost:4100/ready` answer `200`. **Rehearse the demo once before recording**: create the accounts and the workspace beforehand so the recording does not wait on typing.

Accounts to prepare (any e-mail-shaped names; passwords of at least 12 characters): **Alice** (owner) in browser A, **Ben** (editor) and **Cara** (viewer) in browser B. Alice creates the workspace "Demo", invites Ben as *Editor* and Cara as *Viewer* from the members page; invitation links are shown on screen and are opened in browser B by each user in turn (no e-mail is sent: the project has no e-mail delivery).

## 3. Script (what to do and say)

| # | Action | What the viewer should see |
|---|---|---|
| 1 | Alice creates a page "Launch plan" and types a heading, two paragraphs, a checklist and a table (slash menu `/`) | Rich-text editing: toolbar, slash commands, keyboard use |
| 2 | Ben opens the same page in browser B | The text appears; Ben's avatar appears in Alice's header (presence) |
| 3 | Both type in the same paragraph at once | Both edits survive, nothing is overwritten; coloured cursors with names move live |
| 4 | Ben goes offline (browser developer tools → Network → Offline), types a sentence, goes online | The status shows reconnecting, then the sentence reaches Alice without loss |
| 5 | Alice selects a phrase and adds a comment; Ben replies; Alice resolves the thread | Comment threads, replies, highlight |
| 6 | Alice saves a version "Draft 1", changes the text, opens the history, views the version, restores it | Read-only version view; restore is a new change, and a "Before a restore" version is kept |
| 7 | Cara (viewer) opens the page | She sees live edits but cannot change the text; comment and save-version actions are refused for her role (check what the interface shows for her before recording) |
| 8 | Alice changes Ben's role to *Viewer* | Ben's editor becomes read-only without reloading (the server pushes the change; at the latest the next periodic revalidation, 60 s, applies it; time it in the rehearsal) |
| 9 | Reload any browser | The page, comments and versions are still there (persistence) |

## 4. Optional: show the production checks

Against the local stack the black-box checks can be run in 30 seconds. They need the local stack in **production mode** behind HTTPS (the rehearsal described in DEPLOYMENT.md §16.B uses Caddy with a local certificate authority); on a plain development stack the cookie and HTTPS checks will fail, which is correct:

```bash
VERIFY_APP_URL=https://app.example.com pnpm verify:deployment    # a real deployment
```

## 5. Recording instructions

- **Tool:** any screen recorder (OBS Studio, QuickTime on macOS, Windows Game Bar). Record at 1920×1080, 30 fps, MP4 (H.264).
- **Layout:** the two browsers side by side (each half of the screen) so the live cursors and the edits are visible together; zoom the browsers to 125 % for readability; hide bookmarks and notifications.
- **Audio:** record a voice-over from the table above, or add captions afterwards; keep each step short; pause one second after each action so the other window can be seen to react.
- **Do not show secrets:** the terminal showing `.env`, tokens, cookies (developer tools → Application) or the production `.env.production`. Use throw-away accounts and passwords.
- **Length:** 6–8 minutes; split into a short (about 2 minutes) highlight with steps 2, 3 and 6.
- **After recording:** note the commit hash (`git rev-parse --short HEAD`) and date next to the video, and say in the description that it was recorded **locally**, not on a public deployment.

## 6. If something does not work

| Symptom | Likely cause |
|---|---|
| "Collaboration unavailable" or the editor stays read-only | `pnpm dev:collab` is not running, or `.env` has no collaboration keys (`node scripts/generate-collab-keys.mjs --write`) |
| Login works but nothing saves | PostgreSQL not running (`pnpm infra:up`) or migrations not applied (`pnpm db:migrate:deploy`) |
| The second browser shows the first user's account | Both windows share cookies: use a different browser or profile |
| 429 errors after repeated attempts | Rate limits; wait a few minutes or restart Redis (`pnpm infra:down && pnpm infra:up`) |