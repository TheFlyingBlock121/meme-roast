# Meme Roast

A party game that runs in the browser. Everyone gets a prompt like
**"@Daniel when he gets his first job"**, everyone except Daniel submits a funny
image or GIF, then everybody votes anonymously. Most votes wins.

The full loop works: create room → join → start → prompt → submit → vote → score → next round → final results,
with host controls, live prompt writing, reactions, and a beginner-friendly deployment path.

## Folders

| Folder | What is inside |
| --- | --- |
| `client/` | The website players see (React + Vite + TypeScript). |
| `server/` | The game brain (Node + Express + Socket.IO). **All rules and scoring live here.** |
| `shared/` | Types used by both sides, so they agree on what messages look like. |
| `uploads/` | Uploaded images. Wiped when a game ends or the room expires. |

Every limit (players, rounds, timers, upload size, scoring) is in **`server/config.ts`**.

## Run it on your computer

You need **Node.js 20 or newer** (the "LTS" version) from https://nodejs.org. Check with `node -v`.

### Windows
1. Install Node.js from https://nodejs.org (click the LTS button, keep the default options).
2. On the project's GitHub page click **Code → Download ZIP**, then right-click the ZIP → **Extract All**.
3. Open the extracted `meme-roast` folder, click the address bar at the top, type `cmd`, press Enter. A terminal opens in that folder.
4. Run `npm install` (wait a minute), then `npm run dev`.
5. Open http://localhost:5173 in Chrome, Firefox or Edge.

### Linux
```bash
# Install Node.js 22 (Debian/Ubuntu; see nodejs.org for other distros)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

git clone <your-repository-url> meme-roast   # or download and unzip the ZIP
cd meme-roast
npm install
npm run dev
```
Then open http://localhost:5173.

### Commands
| Command | What it does |
| --- | --- |
| `npm install` | Downloads everything the project needs (once). |
| `npm run dev` | Development mode: site on port **5173**, server on 3000, reloads when you edit code. |
| `npm run build` | Builds the website for production into `client/dist`. |
| `npm start` | Production mode: one server on http://localhost:3000 serving site and game. |
| `npm test` | Runs the automated tests of the game rules (46 tests: rooms, prompts, submissions, voting, reactions, host controls). |

## Try it alone (3 browser tabs)
1. Open http://localhost:5173, enter a name, click **Create game**.
2. Open two more tabs (each tab is its own player), enter the room code, join.
3. In the first tab press **Start game**. Submit images (or paste a direct `.gif` link), vote, watch the scores.

Refreshing a tab keeps you in the game. To test with fewer than 3 players, copy `.env.example` to `.env` and set `MIN_PLAYERS=1`.

## How prompts work
Before each round starts, the server picks who's being roasted. Then one player — anyone, including the player being
roasted themselves — is asked to write that round's prompt live, with a countdown:
- They can write anything at all — there's no required format. Typing "@" brings up a Discord-style autocomplete of
  real player names; picking one inserts their actual name into the text.
- If they'd rather not write one, **Skip — let someone else write it** passes the turn to another player.
- If everyone in the round has been asked and skipped (or the timer runs out), a random fallback prompt is used
  instead (see below), so the game always keeps moving.
- Everyone takes a turn writing before anyone writes twice.

### Fallback prompts (host only)
In the lobby, open **Fallback prompts** to add your own (used only when nobody writes a prompt in time — about half your prompts, half built-in, at random) and to include or exclude the wild built-in pack. These still use the classic `@PLAYER` placeholder (and `@random` for a second, different random player), since nobody is there to type a real name for them. Limits (up to 100 prompts, 140 characters each) are in `server/config.ts`.

## Host controls
| Control | Where | What it does |
| --- | --- | --- |
| Rounds, write time, submit time, vote time | Lobby | Pick before starting. Write time is a plain number box (10–120s); the others are preset buttons. |
| Pause / Resume | In game | Freezes the timer; nobody can write, submit or vote while paused. |
| Skip ahead / Next round | In game | Asks the next writer, ends submitting/voting early, or moves to the next round. |
| Restart | In game, final screen ("Play again") | Starts over from round 1, same players and settings, scores reset. |
| End game | In game | Jumps to the final results. |
| Kick | Lobby and in game | Removes a player and their image. They see a message and can't resume. |
| Return to lobby | Final screen | Back to the lobby (change prompts or settings), scores reset. |

Only the host can use these; the server checks every request.

## Reactions
During voting and on the results screen, everyone can react to a submission with an emoji (😂 💀 🔥 👀 😭). Tap an emoji again to remove your reaction. Reactions are anonymous during voting, same as the images themselves.

## Standings between rounds
The current scores are always visible in the sidebar, and the results screen after each round also shows a full standings list, so you can see how the game is going before the next round starts.

## How submissions work
- **Upload:** JPG, PNG, WebP or GIF up to 10 MB. The server checks the extension, the MIME type *and* the real file contents, then saves it under a random name.
- **Link:** paste a direct image URL (`http`/`https` only). If it can't be loaded, players see a friendly "couldn't be loaded" box.
- The player being roasted can submit too, if they want to join the joke.
- **Change your pick:** after submitting, press **Change your pick** to upload something else or paste a different link, any time before voting starts.
- Once everyone has submitted, the round doesn't jump straight to voting — it gives a short final-call window (5 seconds by default) in case anyone wants to change their pick at the last second.
- Nobody sees who submitted what until the round results.

## Scoring
1st place 3 points, 2nd 2, 3rd 1 (only for submissions with at least one vote). Ties go to whoever submitted first. Only the server calculates scores.

## Deploying it so friends can play online
Right now the game only runs on your own computer. To get a real `https://...` link you can send to friends, put
the code on GitHub first (create a repository at https://github.com/new, then follow GitHub's instructions to push
this folder to it), then use one of these:

### Recommended: Render
Render's free tier needs no credit card, builds straight from a GitHub repository, and supports the WebSocket
connections this game uses.
1. Go to https://render.com and sign up (you can use your GitHub account).
2. Click **New +** → **Web Service**, then connect your `meme-roast` GitHub repository.
3. Set:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - Leave **Instance Type** on the free option.
4. Click **Create Web Service**. After a couple of minutes you'll get a link like `https://meme-roast.onrender.com` — that's what you share with friends.
5. Every time you push a change to GitHub, Render rebuilds and redeploys automatically.

Two things worth knowing about Render's free tier: the service falls asleep after 15 minutes with nobody visiting,
so the first person to open the link after a break waits about a minute for it to wake up; and its storage is
wiped on every restart, which is fine here since uploaded images and rooms are only ever meant to last for one game.

### Alternative: Koyeb
Koyeb also has a free tier with native WebSocket support and the same GitHub-connected flow:
1. Go to https://www.koyeb.com and sign up.
2. Click **Create Web Service** → **GitHub**, and pick your `meme-roast` repository.
3. Set the same **Build Command** (`npm install && npm run build`) and **Run Command** (`npm start`) as above.
4. Deploy, and use the `https://...koyeb.app` link Koyeb gives you.

### Environment variables while deploying
You don't need to set any — the app works with its defaults. If you want to change a limit (like `MIN_PLAYERS`),
add it as an environment variable in the hosting platform's dashboard, the same way you would in `.env` locally
(see `.env.example`).

## Troubleshooting
- **`npm` is not recognized:** close and reopen the terminal after installing Node.js.
- **Port already in use:** set `PORT=3001` in `.env` (and change the proxy port in `client/vite.config.ts` for dev).
- **"The website is not built yet":** you opened port 3000 without building. Use http://localhost:5173 with `npm run dev`, or run `npm run build` then `npm start`.
- **Friends can't join:** if you're running locally, the game only works on your own computer — see **Deploying it so friends can play online** above. If you already deployed it, make sure you shared the platform's `https://` link, not `localhost`.
- **The deployed page opens but the game never connects (stuck on "Connecting…"):** the hosting platform may not have WebSockets enabled for the free plan you picked, or the service is still waking up from sleep (Render) — wait a minute and refresh.
"# meme-roast" 
