# Visual Pitch Trainer

A web app that visually supports pitch practice for people who are deaf or hard of hearing.

While playing a reference tone such as Do-Re-Mi, the app analyzes the user's voice through the microphone in real time and displays the pitch difference from the target note and the pitch movement over time.

## Goals

- Help users understand pitch through visual feedback
- Support vocal practice with a reference tone
- Show pitch movement in real time while the user is vocalizing
- Work in desktop, tablet, and smartphone browsers

## Basic Approach

Visual Pitch Trainer is a static web app that runs without an application server.

Audio analysis, reference tone playback, graph rendering, and practice feedback all run inside the browser. This keeps latency low and avoids sending microphone audio to a server.

The UI uses Google Fonts, so the browser may make external requests to load fonts. Microphone input and analyzed pitch data are not sent to external services.

```text
Browser
  ├─ Web Audio API
  ├─ Reference Tone Playback
  ├─ Microphone Input
  ├─ Pitch Detection
  ├─ Realtime Visualization
  └─ Practice Summary
```

## Main Features

- Select and play reference tones across one chromatic octave
- Choose vocal ranges with voice range guides: C3-C4 / C4-C5 / C5-C6
- Adjust reference tone volume
- Detect the current pitch from microphone input
- Display the pitch difference from the target note in real time
- Show whether the voice is high, low, or in tune using visual feedback
- Display pitch movement over time in a graph
- Show volume, detection confidence, continuous in-range time, and a practice summary
- Responsive UI for desktop, tablet, and smartphone browsers

## Documentation

- [Design](docs/design.md) (Japanese)
- [Implementation notes](docs/implementation-notes.md) (Japanese)

## Local Development

This app is built with Bun + Vite + TypeScript. After a production build, it can be served as a static web app using only the generated `dist/` directory.

### Dev Container

Open this repository in VS Code and run `Dev Containers: Reopen in Container`.

The container includes Node.js, Bun, GitHub CLI (`gh`), OpenAI Codex CLI (`codex`), and related development tools. The expected Bun version is defined in `.bun-version` and the `packageManager` field in `package.json`.

If the `codex` command has not been set up yet, `.devcontainer/bin/codex` runs `.devcontainer/scripts/install-dev-tools.sh` to prepare the required development tools.

This repository is set up with Codex as the AI coding agent used during development. Repository-specific agent instructions are documented in `AGENTS.md`, and Codex Agent Skills are placed under `.agents/skills/`.

Dependencies are managed with Bun. If a lockfile exists, run `bun install --frozen-lockfile`; otherwise run `bun install`.

Start the Vite development server with:

```sh
bun run dev
```

Open the local URL shown by Vite in your browser. It is usually `http://localhost:5173/`.

Basic verification commands:

```sh
bun run lint
bun run test
bun run typecheck
bun run build
```

To publish the app without a server, configure GitHub Pages or Cloudflare Pages to serve the `dist/` directory.

### CI

GitHub Actions runs CI for:

- Pushes to `main`
- Pushes to SemVer tags such as `v1.2.3`
- Pull requests
- Manual runs through `workflow_dispatch`

CI uses the Bun version from `.bun-version`, installs dependencies from the lockfile, and runs:

```sh
bun run lint
bun run test
bun run typecheck
bun run build
```

On pushes to `main` or SemVer tags, the app is deployed to GitHub Pages after verification passes. For the first deployment, set the GitHub Pages Build and deployment source to `GitHub Actions` in the repository settings.

The deployed app shows a build version and short commit hash in the footer. Regular GitHub Pages deployments use `GITHUB_RUN_NUMBER` to generate labels such as `v0.1.N`, so you do not need to manually increment `package.json`. `N` is the CI workflow run number and may include gaps from pull requests or manual runs. Tag deployments display the SemVer tag name, such as `v1.2.3`.

### Microphone Input

Microphone access depends on the browser and how the page is opened. If the microphone does not work in the VS Code preview, open the Vite URL, such as `http://localhost:5173/`, in an external browser such as Chrome, Edge, or Safari.

This repository's `index.html` loads TypeScript through Vite, so use `bun run dev` or `bun run preview` instead of opening the file directly. For local microphone testing, open the app on a secure context such as `http://localhost` or `http://127.0.0.1`.

For deployed sites, microphone access generally requires a secure context such as HTTPS.

## Technology Stack

- HTML
- CSS
- TypeScript
- Vite
- Bun
- pitchy
- Web Audio API
- Canvas
- Google Fonts
- localStorage or IndexedDB, if practice history is added later

See [docs/design.md](docs/design.md) for more details. The detailed design and implementation documents are currently written in Japanese.
