# EnergyPulse — website + phone app (PWA)

A daily energy dashboard: **Indian Crude Basket**, Brent, WTI, USD/INR, India and global energy news, **PPAC** and **CHT** updates, and **refinery / petrochemical safety incidents**. It opens in any browser and can be saved to an Android or iPhone home screen like an app.

Cost: **₹0**. GitHub hosts the site (GitHub Pages) and runs the daily update robot (GitHub Actions).

```
 GitHub Actions (8:00 & 16:00 IST)          GitHub Pages
 ┌──────────────────────────────┐           ┌──────────────────────┐
 │ scripts/update_data.py       │  commits  │ index.html + js/css  │  ← phones & laptops
 │  PPAC · EIA · ECB FX · RSS   │ ───────▶  │ data/live/*.json     │
 └──────────────────────────────┘           └──────────────────────┘
```

---

## Part 1 — Put the code on GitHub (one time, ~5 min)

**1. Create a GitHub account** at <https://github.com/signup> if you don't have one.

**2. Create an empty repository**
- Go to <https://github.com/new>
- Repository name: `energypulse`
- Choose **Public** (Actions minutes are unlimited for public repos; a private repo also works on the free plan's monthly minutes)
- **Do not** tick "Add a README", ".gitignore" or "license" — leave it empty
- Click **Create repository**

**3. Push the code from your Mac** (Terminal):

```bash
cd ~/Desktop/Projects/energypulse

# move the robot's schedule file into the folder GitHub looks for
mkdir -p .github/workflows
mv setup/update-and-deploy.yml .github/workflows/
rmdir setup

git init -b main
git add .
git commit -m "EnergyPulse PWA: first version"
git remote add origin https://github.com/<YOUR-USERNAME>/energypulse.git
git push -u origin main
```

Replace `<YOUR-USERNAME>` with your GitHub username. If Git asks for a password, use a **Personal Access Token**, not your GitHub password: GitHub → your photo → **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token**, tick **repo** and **workflow**, copy the token and paste it as the password. (If you use GitHub Desktop or the `gh` CLI and are already signed in, you won't be asked.)

---

## Part 2 — Turn on hosting (one time, ~2 min)

**4. Enable GitHub Pages**
- On your repo page: **Settings → Pages**
- Under **Build and deployment → Source**, choose **GitHub Actions**

**5. Allow the robot to save data**
- **Settings → Actions → General**
- Scroll to **Workflow permissions** → select **Read and write permissions** → **Save**

**6. Run it the first time**
- Open the **Actions** tab → click **Update data & deploy site** on the left → **Run workflow** → **Run workflow**
- Wait about 1 minute for the green tick ✅

**7. Open your site**

`https://<YOUR-USERNAME>.github.io/energypulse/`

(Also shown under **Settings → Pages** once the first run finishes.)

---

## Part 3 — Optional: Brent & WTI prices (~3 min)

Brent and WTI come from the U.S. EIA's free API, which needs a free key.

**8.** Register at <https://www.eia.gov/opendata/register.php> — the key arrives by email.

**9.** In your repo: **Settings → Secrets and variables → Actions → New repository secret**
- Name: `EIA_API_KEY`
- Secret: paste the key → **Add secret**

**10.** **Actions → Update data & deploy site → Run workflow** again. Brent and WTI now show as **Live**.

Without the key the app still works; those two cards show "Not set up". EIA prices usually lag by a few days.

---

## Part 4 — Install on your phone

- **Android (Chrome):** open the site → ⋮ menu → **Add to Home screen** / **Install app**
- **iPhone (Safari):** open the site → **Share** button → **Add to Home Screen**

It opens full screen with the EnergyPulse icon, and shows the last saved data when you're offline.

---

## Daily running — what happens by itself

- Twice a day (≈ 8:00 and 16:00 IST) GitHub runs `scripts/update_data.py`, saves the new `data/live/*.json`, and republishes the site. GitHub may start scheduled runs a little late.
- Each push you make to `main` also refreshes data and redeploys.
- You can refresh any time: **Actions → Update data & deploy site → Run workflow**.

### Adding an Indian Basket price by hand

The robot reads the Indian Basket from PPAC's website. If PPAC changes its page and the robot can't read it, the card turns **Stale**. To add a price yourself (works from the GitHub phone app too):

1. Open `data/indian_basket_daily.csv` on GitHub → pencil icon ✏️
2. Add a line at the bottom, e.g. `2026-11-20,89.40,PPAC`
3. **Commit changes** — the site updates in about a minute.

Monthly averages live in `data/indian_basket_monthly.csv`; ICB ratios in `data/indian_basket_composition.json`. Edit them the same way when PPAC publishes new figures.

---

## Live vs demo data

| | Live | Demo |
|---|---|---|
| Files | `data/live/*.json` | `data/demo/*.json` |
| Written by | daily robot (real, attributed sources) | `scripts/make_demo_data.py` (invented) |
| Shown as | green **Live** / amber **Stale** badges | orange **DEMO** banner on every screen |

- Switch modes under the **Sources** tab.
- Live mode **never** fills gaps with demo numbers. A failed source keeps yesterday's real data, marked **Stale**, or shows "Unavailable".
- Each JSON file declares its own `"mode"`; the app refuses a file whose mode doesn't match.

## Data sources

| Feed | Source | Key needed |
|---|---|---|
| Indian Crude Basket (daily, monthly, ICB ratio) | PPAC, MoPNG | No |
| Brent, WTI daily spot | U.S. EIA Open Data API | Free key |
| USD/INR reference rate | ECB via Frankfurter API | No |
| India / global / PPAC / CHT news | Google News RSS + PPAC "Important News" | No |
| Refinery & petrochemical safety incidents | Google News RSS, filtered by incident keywords (fire, explosion, leak…) | No |

Headlines link to the original publisher; no article text is copied. Safety items are matched automatically by keyword, so verify against the original report.

## Project layout

```
index.html              app page
css/style.css           styles (light + dark mode)
js/app.js               screens, charts, calculator (no libraries)
sw.js                   service worker: offline + fast loading
manifest.webmanifest    name, icon, colours for "Add to Home screen"
icons/                  app icons
data/live/              real data written by the robot
data/demo/              invented demo data
data/*.csv / *.json     Indian Basket history you can edit by hand
scripts/update_data.py  the daily robot (Python standard library only)
.github/workflows/      the schedule that runs the robot and publishes the site
```

## Try it on your Mac before pushing

```bash
cd ~/Desktop/Projects/energypulse
python3 scripts/update_data.py        # optional: fetch real data now
python3 -m http.server 8000
```
Open <http://localhost:8000>.

## Changing things

- **Update times:** edit the `cron:` lines in `.github/workflows/update-and-deploy.yml` (times are UTC; IST = UTC + 5:30).
- **News topics:** edit `NEWS_FEEDS` in `scripts/update_data.py`.
- **After changing app files** (`js/`, `css/`, `index.html`), bump `VERSION` in `sw.js` (e.g. `ep-v2`) so installed phones pick up the new version.

## Troubleshooting

| Problem | Fix |
|---|---|
| Actions run fails at "Save data back to the repo" (403) | Step 5: set **Read and write permissions** |
| Actions run fails at "Publish to GitHub Pages" | Step 4: Pages source must be **GitHub Actions** |
| Site shows 404 | Wait 1–2 min after the first green run; check the URL includes `/energypulse/` |
| A card says **Stale** | The source failed today; yesterday's data is shown. Check the run log in **Actions** |
| Scheduled runs stopped | GitHub pauses schedules in public repos after 60 days with no activity; click **Run workflow** to restart |
| Phone shows an old version | Close and reopen the app; after code changes, bump `VERSION` in `sw.js` |
