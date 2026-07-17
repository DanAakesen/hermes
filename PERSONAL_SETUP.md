# Personal Hermes setup

This checkout is Dana's editable Hermes agent OS.

## Layout

- Source and tracked personal automation: `C:\Repo\hermes`
- Runtime state, sessions, generated skills, channel credentials, and API keys: `C:\Repo\hermes\.local\home`
- Python environment: `C:\Users\danaakesen\.hermes\venvs\repo-hermes`
- Durable personal knowledge: the existing Obsidian vault, not Hermes' internal memory files

`.local` is deliberately ignored. It must not be committed or copied to GitHub.

## First run

```powershell
.\scripts\personal-bootstrap.ps1 -InstallDependencies
.\scripts\hermes-personal.ps1 setup
```

Place provider and channel credentials only in `.local\home\.env`. Do not put API keys, Copilot credentials, or messaging tokens in source-controlled files.

## Desktop and dashboard

The first Desktop launch builds the packaged Electron app. Later launches can
reuse that build:

```powershell
.\scripts\hermes-personal.ps1 desktop --skip-build --ignore-existing
```

Run the browser dashboard locally:

```powershell
.\scripts\hermes-personal.ps1 dashboard --skip-build
```

The dashboard is loopback-only by default at `http://127.0.0.1:9119`.

For future Desktop launches, double-click `scripts\\Launch-Hermes-Desktop.cmd`.
Do not open `apps\\desktop\\release\\win-unpacked\\Hermes.exe` directly: it
cannot see this repository's external virtual environment and will try to make
a separate installation under `%USERPROFILE%\\.hermes`.

## Operating rules

- Hermes is the sole harness and control plane.
- Codex CLI and Copilot CLI are workers invoked through Hermes skills or plugins.
- Obsidian is the durable memory authority; Hermes internal memory is an approval-gated operational cache.
- The Realtime/GPT Live voice interface belongs in a separate local plugin or service, not Hermes core.
- Keep core modifications on `personal/main`; use a plugin or skill before changing Hermes source.

## Updating

```powershell
.\scripts\update-personal.ps1
```

The update script rebases `personal/main` onto `upstream/main`, pushes the result to the fork, and refreshes the editable environment. If Git reports a rebase conflict, resolve it before continuing; it is evidence that upstream changed the same surface as your customization.
