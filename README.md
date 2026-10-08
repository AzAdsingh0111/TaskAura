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
- No frontend framework
- No external npm packages are required

## Project structure

```text
taskAura/
├── app.js       # Frontend state, views, navigation, interactions, and API calls
├── index.html   # HTML entry point
├── server.js    # Local static server and JSON API
├── styles.css   # Layout, responsive styles, themes, animations, and components
├── README.md    # Project documentation
├── .gitignore   # Local data and environment file exclusions
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

## Data and privacy

Task Aura is designed as a local prototype.

- Runtime data is stored in `data.json` by the local server.
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

## Deployment

Pushing the repository to GitHub stores the source code but does not run the Node.js server.

For the complete application, use a Node-compatible host such as:

- Render
- Railway
- Fly.io
- A VPS or another Node.js hosting provider

GitHub Pages can host only the static frontend. API-backed features such as persistence, authentication, profile updates, workload data, and server-side routes will not work there without a separate backend.

For production deployment, replace the local JSON file with a managed database and configure environment variables through the hosting provider.

## Git workflow

```powershell
git pull origin main
git add .
git commit -m "Describe the change"
git push origin main
```

Do not commit `data.json`, credentials, or other private runtime files.
