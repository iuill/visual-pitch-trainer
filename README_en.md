# Visual Pitch Trainer

[![HTML](https://img.shields.io/badge/HTML-5-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/docs/Web/HTML)
[![CSS](https://img.shields.io/badge/CSS-3-1572B6?logo=css&logoColor=white)](https://developer.mozilla.org/docs/Web/CSS)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0.2-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3.3-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Bun](https://img.shields.io/badge/Bun-1.3.13-000000?logo=bun&logoColor=white)](https://bun.sh/)

A web app that visually supports vocal pitch practice and vocal-range checks for people who are deaf or hard of hearing.

The app analyzes the user's voice through the microphone in real time while practicing against a reference tone such as Do-Re-Mi, then displays the pitch difference from the target note and the pitch movement over time. It can also estimate voice-like pitch ranges from local audio or video files, and in WebGPU-capable browsers it can run vocal extraction in the browser before estimating the range of a mixed song.

## Goals

- Help users understand pitch through visual feedback
- Support vocal practice with a reference tone
- Show pitch movement in real time while the user is vocalizing
- Help users check voice-like ranges from audio or video files for song selection and review
- Support playback and saving of vocals extracted from mixed songs
- Work in desktop, tablet, and smartphone browsers

## Basic Approach

Visual Pitch Trainer is a static web app that runs without an application server.

Audio analysis, reference tone playback, vocal extraction, pitch estimation, graph rendering, and practice feedback all run inside the browser. This keeps latency low and avoids sending microphone input or local audio files to a server.

The UI uses Google Fonts. When vocal extraction, MP3 saving, or RMVPE / CREPE estimation is first used, the browser may also fetch or load WASM files and model files used inside the browser. Pitch-estimation models for audio-file analysis are included in published artifacts. Microphone input, local audio files, extracted vocals, and analyzed pitch data are not sent to external services.

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

Switch between single-note practice, melody practice and audio range analysis using the top menu. Shared settings sit above the menu and apply to both single-note and melody practice. Their collapsed summary shows range, instrument, volume and tolerance. Choose the target note or melody within its own practice view. Shared practice settings do not affect audio range analysis. Switching views stops playback and releases the microphone while retaining audio analysis results and melody review.

- Select and play reference tones across one chromatic octave
- Choose vocal ranges with voice range guides: C3-C4 / C4-C5 / C5-C6
- Adjust reference tone volume
- Detect the current pitch from microphone input
- Display the pitch difference from the target note in real time
- Show whether the voice is high, low, or in tune using visual feedback
- Display pitch movement over time in a graph
- Show volume, detection confidence, continuous in-range time, and a practice summary
- Estimate a rough vocal range from local audio or video files
- Extract vocals before analysis in WebGPU-capable browsers
- Save extracted vocals as an MP3 file
- Estimate audio-file pitch with RMVPE / CREPE ONNX models in WebGPU-capable browsers
- Export a development PNG comparing pitchy / CREPE / RMVPE pitch graphs
- Play either the analyzed audio file or a separately selected playback audio file while following the current position on the vocal range graph
- Responsive UI for desktop, tablet, and smartphone browsers

## Documentation

- [Design](docs/design.md) (Japanese)
- [Implementation notes](docs/implementation-notes.md) (Japanese)

## Local Development

This app is built with Bun + Vite + TypeScript. After a production build, it can be served as a static web app using only the generated `dist/` directory.

### Dev Container

Open this repository in VS Code and run `Dev Containers: Reopen in Container`.

The container includes Node.js, Bun, GitHub CLI (`gh`), and related development tools. The expected Bun version is defined in `.bun-version` and the `packageManager` field in `package.json`.

GitHub CLI shares the host's `~/.config/gh` read-write at `/home/node/.config/gh`, which is set as `GH_CONFIG_DIR`. Sign in with `gh auth login` on the host before starting the container. The container uses the same GitHub authentication as the host.

Codex CLI uses the host's standalone installation. Before starting the container, make sure `~/.codex/packages/standalone/current/bin/codex` is executable on the host and sign in with `codex login`. Container initialization checks that the host installation exists and can run.

The entire `~/.codex/packages/standalone` directory is mounted read-only at the same path, and `.devcontainer/bin/codex` runs `HOST_CODEX_BIN`. Codex is not installed separately inside the container; it uses host updates. The host's `~/.codex/auth.json` is shared read-write at `/home/node/.codex/auth.json`. Configuration and conversation history are not shared.

If `dc` is installed on the host, run `dc codex` from the root of this checkout. Run `dc rebuild codex` to apply these settings to an existing container. The host must run Linux compatible with the container's `linux/amd64` platform.

This repository is set up with Codex as the AI coding agent used during development. Repository-specific agent instructions are documented in `AGENTS.md`, and Codex Agent Skills are placed under `.agents/skills/`.

Dependencies are managed with Bun. If a lockfile exists, run `bun install --frozen-lockfile`; otherwise run `bun install`.

`minimumReleaseAge = 1209600` in `bunfig.toml` limits dependency updates and new resolutions to versions published at least 14 days ago. Use `bun update` for updates and check compatibility before major upgrades. Explicit version pins and existing lockfiles can bypass the age filter, so verify publication dates for transitive dependencies as well when updating.

Start the Vite development server with:

```sh
bun run dev
```

In the Dev Container, the Vite development server runs on port 5173 inside the container and is available from the host at `http://localhost:35173/`. The Vite dev server and `bun run preview` return Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy headers required by browser-based vocal extraction.

Basic verification commands:

```sh
bun run lint
bun run test
bun run typecheck
bun run build
```

To publish the app without a server, configure GitHub Pages or Cloudflare Pages to serve the `dist/` directory. If you want RMVPE / CREPE to work in a manually served `dist/` build or on Cloudflare Pages, run `bun run download:pitch-models` before building so the ONNX models are placed under `public/models/`. The GitHub Pages deployment workflow downloads those models automatically and includes them in the Pages artifact.

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

To update Pages manually, select Actions → `Deploy Pages` → `Run workflow` on `main`. It audits dependencies, runs lint, tests and typechecking, downloads models, builds and deploys. Other branches are skipped. Manual `CI` runs only verify the app.

Version run numbers are scoped to each workflow and may overlap or go backwards between automatic and manual deployments. Use the commit hash to identify the code.

### Melody Practice

The dedicated melody graph shows the whole reference as stepped bars before practice starts. Green bars/bands show the reference, a blue line shows microphone pitch, and a black dashed line marks the current position. Pitch bounds and timeline stay fixed; the reference and full voice trace remain after completion, including traces older than 12 seconds. Long melodies scroll horizontally and follow playback; after finishing, scroll freely to review. A collapsible text list provides the note sequence.

Melody Practice offers ascending/descending major scales, a five-note up-and-down pattern, do–mi–sol–mi–do, chromatic scales, and custom sequences. Enter 2–32 Japanese solfege tokens separated by spaces, including sharps such as ド# and upper do (高ド). Notes stay within the selected voice range and have equal durations; rests and per-note rhythms are not supported.

After microphone permission and instrument loading, watch/listen to one demonstration, prepare during a three-second visual countdown, then sing with reference audio and live pitch feedback. Each note lasts 1–5 seconds (default 2). The first 0.4 seconds per note are excluded from scoring. Per-note results show in-tune time, percentage of remaining scheduled time (including silence/undetected input), and detected-pitch time.

Use headphones: reference audio leaking into the microphone can be scored as singing. Training effectiveness for people with hearing loss has not been evaluated. Cancellation, target/range/instrument changes, or leaving the tab stop playback and the microphone.

### Reference Instruments

Harmonium, organ, violin and flute are available alongside sine and piano. The four added timbres use crossfaded sustain loops from CC0 recordings, held until stop or the end of each melody note, without piano-style retriggering. Small variations in the original performance remain.

Organ recordings are from VCSL; violin and flute from VSCO 2 CE; harmonium from Donya Quick on Freesound (HQ MP3 preview). The additions total about 2 MB and load from the app's origin on first use of each timbre. Playback rate compensates for measured tuning. Violin below G3, flute below C4 and harmonium above D5 use transposition beyond their recorded ranges. Each instrument directory under public/audio/ includes provenance, checksums, processing notes and the full CC0 license. Optional regeneration uses Bun and ffmpeg via bun run prepare:reference-sustains; regular builds do not download recordings.

Sine sustains continuously; piano repeats a naturally decaying strike approximately every 2.5 seconds. The selected instrument also applies to melody practice. Changing instruments cancels melody practice and switches an active reference tone.

Piano uses acoustic grand piano recordings from Versilian Studios' [VCSL](https://github.com/sgossner/VCSL), released under CC0-1.0. Commercial use, modification and redistribution are permitted without royalties or mandatory attribution. Source information and the license are included in `public/THIRD_PARTY_NOTICES.txt` and `public/audio/piano/`; the recordings have a separate license from this application's MIT license.

The ten recordings (about 3.5 MB total) are loaded from the application's own origin on first playback and reused for that page. No external sound service or additional npm dependency is required. Assets are committed, so normal installation and builds do not download them. Optional regeneration requires ffmpeg and `bun run prepare:reference-piano`, which verifies the pinned source recordings with SHA256.

### Microphone Input

Microphone access depends on the browser and how the page is opened. If the microphone does not work in the VS Code preview, open the Dev Container host URL, such as `http://localhost:35173/`, in an external browser such as Chrome, Edge, or Safari.

This repository's `index.html` loads TypeScript through Vite, so use `bun run dev` or `bun run preview` instead of opening the file directly. For local microphone testing, open the app on a secure context such as `http://localhost` or `http://127.0.0.1`.

For deployed sites, microphone access generally requires a secure context such as HTTPS.

### Audio File Voice Range Estimation

The app can load local audio files or video files and estimate a rough range from voice-like pitch. Audio files are decoded with `AudioContext.decodeAudioData()`. Video files, and formats the browser cannot decode through Web Audio, are handled through Mediabunny when browser WebCodecs support allows it. DRM-protected audio, such as tracks from Apple Music, cannot be analyzed.

If a normal mixed song is loaded directly, bass, guitar, synth, backing vocals, and other pitched sounds can be detected as well, which makes the estimated range and graph unreliable. In WebGPU-capable browsers, enable vocal extraction to try Demucs v4 or BS-RoFormer in the browser before pitch analysis. The first run may take time because ONNX Runtime Web and large model files are loaded.

After vocal extraction, playback can use either the original audio or the extracted vocal generated in the browser. The extracted vocal can also be saved as an MP3 file.

Vocal extraction requires SharedArrayBuffer in practice, so deployed environments may need Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy response headers. Cloudflare Pages can ship these through `public/_headers`. GitHub Pages cannot set these headers, so vocal extraction may not work there.

BS-RoFormer is an experimental higher-quality option. In development it uses `public/models/bs-roformer-fp16-webgpu.onnx`, generated with:

```sh
bun run prepare:bs-roformer-webgpu
```

For production builds, set `VITE_BS_ROFORMER_FP16_MODEL_URL` to a hosted model URL. Without that env var, production builds hide the BS-RoFormer option so the app does not request a missing local model.

Demucs v4 uses one ONNX Runtime session by default. For experiments, `VITE_DEMUCS_PARALLEL_SEGMENTS=2` tries two parallel segments, but this increases VRAM and memory usage and may fail on some WebGPU environments.

If browser-based vocal extraction is unavailable, separate the vocal with an external tool first and load the extracted vocal file into the app. In a Windows host environment with Docker Desktop and a GPU available, run the command from PowerShell in the directory that contains the source audio file. This example is intended for Windows host PowerShell, not CMD or inside WSL2:

```powershell
docker run --rm -it --gpus all -v ${PWD}:/workdir beveradb/audio-separator:gpu "input.mp3" --model_filename model_bs_roformer_ep_317_sdr_12.9755.ckpt --output_format MP3
```

Pitch estimation can use the default RMVPE model, lightweight pitchy, or CREPE small / medium / large / full for comparison. The default RMVPE option is intended for gaming-PC-class machines; on typical PCs and smartphones, choose lightweight pitchy. Real-time microphone pitch detection still uses pitchy. Runtime model URLs can be customized with `VITE_RMVPE_MODEL_URL`, `VITE_DEMUCS_MODEL_URL`, and `VITE_BS_ROFORMER_FP16_MODEL_URL`; `VITE_CREPE_MODEL_URL` currently affects only CREPE small. For local development or non-GitHub Pages builds, fetch the bundled pitch models with `bun run download:pitch-models`. The model download script uses size-specific source env vars such as `CREPE_SMALL_MODEL_SOURCE_URL`.

The development-only pitch-estimator comparison PNG export outputs one combined PNG with pitchy, CREPE small / medium / large / full, and RMVPE results stacked vertically. RMVPE uses the bundled `lj1995/VoiceConversionWebUI` `rmvpe.onnx` model.

The development-only all vocal extraction models MP3 export runs Demucs v4 and BS-RoFormer fp16 2-stem in sequence on the same analysis audio and exports each available model's extracted vocal as a separate MP3. Some browsers may require permission for multiple file downloads.

After analysis, the app shows the estimated vocal range, the commonly used range, the center area, and the percentage of audio where voice-like pitch was detected. The result is still an approximation because breaths, consonants, reverb, backing vocals, and separation artifacts may remain.

## Technology Stack

- HTML
- CSS
- TypeScript
- Vite
- Bun
- pitchy
- Mediabunny
- demucs-web
- ONNX Runtime Web
- CREPE / onnxcrepe
- RMVPE
- Web Audio API
- WebCodecs
- WebGPU
- Canvas
- Google Fonts
- localStorage or IndexedDB, if practice history is added later

See [docs/design.md](docs/design.md) for more details. The detailed design and implementation documents are currently written in Japanese.
