# Task Aura

Task Aura is a local-first productivity workspace for planning tasks, tracking focus sessions, building habits, and reviewing personal progress. It uses a plain HTML, CSS, and JavaScript frontend with a dependency-free Node.js server.

## Features

- Dashboard with daily greeting, focus summary, current task, activity, workload, and quick actions.
- Focus timer that starts at `00:00`, counts upward, and supports 2-hour, 3-hour, and 4-hour limits.
- Task creation, completion, deletion, priorities, due dates, XP rewards, and active-task tracking.
- Habit tracking with local daily check-ins and automatic pattern-based habit suggestions.
- Bento-style calendar with events, selected-date details, and focus summaries.
- Analytics, progress, workload, Website Guard, plugins, profile, and settings views.
- Local AI Coach features for workload monitoring and productivity suggestions.
- Interactive Aura Companion with cursor attention, blinking, idle/sleepy state, and task progress feedback.
- LiquidFlow dashboard effect with cursor glow and reduced-motion support.
- Responsive sidebar navigation with outlined icons and labels.
- Dragonfruit and Night Violet visual theme:
  - Dragonfruit: `#FF4696`
  - Night Violet: `#1E1033`
- Local browser persistence with a local Node.js API when the server is running.

## Technology

- HTML5
- CSS3
- Vanilla JavaScript
- Node.js built-in `http`, `fs`, `path`, and `crypto` modules
- PostgreSQL through the `pg` package for hosted persistence
- No frontend framework

## Project structure

```text
taskAura/
├── app.js       # Frontend state, views, navigation, interactions, and API calls
├── index.html   # HTML entry point
├── server.js    # Local static server and JSON API
├── styles.css   # Layout, responsive styles, themes, animations, and components
├── README.md    # Project documentation
├── .gitignore   # Local data and environment file exclusions
├── package.json  # Node.js scripts and production dependencies
├── render.yaml   # Render web service and PostgreSQL blueprint
├── .env.example  # Environment variable template
└── data.json    # Local runtime data (created/updated locally, not committed)
```

## Requirements

- Node.js 18 or newer
- A modern browser such as Chrome, Edge, or Firefox

## Run locally

From the project directory:

```powershell
node server.js
```

Then open:

```text
http://localhost:5173
```

To stop the server, press `Ctrl+C` in the terminal.

For the hosted-style dependency install and validation commands:

```powershell
npm install
npm run check
npm start
```

## Data and privacy

Task Aura is designed as a local prototype.

- Runtime data is stored in `data.json` when `DATABASE_URL` is not configured.
- When `DATABASE_URL` is configured, the server creates an `app_state` PostgreSQL table and stores runtime data there.
- Browser fallback data is stored in localStorage if the API is unavailable.
- `data.json` is ignored by Git because it can contain personal tasks, profile information, settings, and local runtime data.
- `.env` files and logs are also ignored.
- No local data is intentionally uploaded by the application.

The workload monitoring feature is intentionally limited. It uses broad local workload signals and does not inspect keystrokes, screen contents, browser page contents, files, or private messages.

## Navigation and UI

The sidebar navigation is generated from the `navItems` array in `app.js`. Each entry contains:

```js
['page-id', 'icon-name', 'Visible label']
```

The `navIcon()` helper renders the outlined SVG icon shown before each navigation label. To change an icon, update the relevant SVG path in that helper. To rename or reorder a navigation item, update `navItems`.

The main visual theme and responsive behavior are in `styles.css`. The latest sidebar design keeps the icon and text label visible together, including on narrow screens.

## Local authentication note

The project contains local authentication scaffolding for prototype use. It is not production-grade authentication. A public deployment should add:

- HTTPS
- Secure password hashing
- Durable sessions
- Rate limiting
- CSRF protection
- A real database
- Multi-user authorization

Google sign-in also requires real OAuth credentials and environment configuration before it can be used.

## Deploy on Render

Pushing the repository to GitHub stores the source code but does not run the Node.js server.

This repository includes [`render.yaml`](./render.yaml) for a Render web service and PostgreSQL database.

1. Push the repository to GitHub.
2. In Render, choose **New > Blueprint** and select this repository.
3. Review the `task-aura` web service and `task-aura-db` PostgreSQL database.
4. Deploy the blueprint. Render provides `DATABASE_URL` to the web service automatically.
5. Open the generated Render URL.

The service listens on Render's `PORT` environment variable and binds to `0.0.0.0`, which is required for public hosting. Copy the optional Google variables from [`.env.example`](./.env.example) into Render's environment settings if Google login or Calendar is needed.

GitHub Pages can host only the static frontend. API-backed features such as persistence, authentication, profile updates, workload data, and server-side routes will not work there without a separate backend.

For production deployment, configure environment variables through the hosting provider and use a managed PostgreSQL database. The current app keeps one shared application state record for this prototype; a future multi-user release should migrate collections and accounts into separate user-scoped tables.

## Git workflow

```powershell
git pull origin main
git add .
git commit -m "Describe the change"
git push origin main
```

Do not commit `data.json`, credentials, or other private runtime files.
