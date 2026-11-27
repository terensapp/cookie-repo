# Cookie Repo

A cookie recipe box, bake-day planner and shopping list for a household.

- **Add recipes** from a link, a photo of a recipe card or cookbook page, pasted text, or by hand. Claude reads the ingredients, times, oven temperature, sheet capacity and make-ahead advice; you review before saving.
- **Scale** any recipe from ½× to 4×.
- **Plan a bake day**: which doughs to mix the night before, which cookies can share the oven, and a timed schedule for mixing, chilling, preheating, every sheet, cooling and decorating. Each cookie has an owner and a baker.
- **Keep every bake**: each bake day (the December bake, a spring cookie swap) has its own cookies, schedule, shopping checks and notes. Start a new one empty or copied from an earlier one, and look back at what you made. A big bake can have prebakes (each family baking on its own day), and a shopping list can cover one bake, the whole event, or any bakes you pick. Each kitchen has its own pantry: people and bakes are linked to one, and a list subtracts every pantry its bakes use.
- **Shop**: one combined list for everything on the plan, minus what's already in the pantry, with butter in sticks and flour and sugar in pounds.
- **Print or save as PDF**: a clean one-page recipe at your batch size, plus the bake-day plan and shopping list.
- **Duplicate warnings**: recipes with nearly the same name or mostly the same ingredients are flagged, on import (with a check before saving) and in the recipe box, with the ingredient differences.
- **Notes** on each recipe for next time, plus the original photos at full size and a link to the recipe online. If a photographed page shows a web address, Claude saves it as the link.
- **Sign-in by emailed code**, limited to the people on the Settings list.

## How it's built

- `server/`: Node 24 + Express 5, SQLite (built-in `node:sqlite`), the Anthropic SDK for recipe reading, Resend for sign-in emails.
- `public/`: one static page (`index.html` + `app.js`), no build step.

Recipe links are fetched by the server (private network addresses are refused) and passed to Claude along with any schema.org recipe data on the page. Photos are shrunk in the browser before upload.

## Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key, used to read recipes |
| `RESEND_API_KEY` | Sends sign-in codes |
| `EMAIL_FROM` | Sender, e.g. `Cookie Repo <hello@cookierepo.com>`. Defaults to Resend's test sender, which only delivers to the Resend account owner's address |
| `SESSION_SECRET` | Long random string used to sign sessions and codes |
| `BOOTSTRAP_EMAILS` | Comma-separated addresses allowed in on first start, when the list is empty |
| `CANONICAL_HOST` | Optional, e.g. `cookierepo.com`: every other hostname (www, the fly.dev address) redirects here |
| `CLAUDE_MODEL` | Optional; defaults to `claude-opus-5-5` |
| `DATABASE_PATH` | SQLite file; `/data/cookie-tin.db` on Fly |

## Run locally

With Node 24:

```bash
npm install
cp .env.example .env   # fill in values
node --env-file=.env server/index.js
```

Or with Docker only:

```bash
docker run --rm -p 8787:8080 -v "$PWD":/app -w /app --env-file .env node:24-slim sh -c "npm install && node server/index.js"
```

Without `RESEND_API_KEY` (and outside production), sign-in codes are printed to the server log.

## Deploy to Fly.io

```bash
fly volumes create cookie_tin_data --region ord --size 1
fly secrets set ANTHROPIC_API_KEY=... RESEND_API_KEY=... SESSION_SECRET="$(openssl rand -hex 32)" BOOTSTRAP_EMAILS=you@example.com
fly deploy
```

The Fly app, volume and database file keep their original `cookie-tin` names; renaming them would mean moving the data to a new app.

### Custom domain

```bash
fly certs add cookierepo.com
fly certs add www.cookierepo.com
fly ips list   # A and AAAA records for the apex domain
```

Once the certificates are issued, `fly secrets set CANONICAL_HOST=cookierepo.com` sends every other address to the main one.
