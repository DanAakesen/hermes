# Personal Hermes setup

This checkout is Dan's editable Hermes agent OS.

## Layout

- Source and tracked personal automation: `C:\Repo\hermes`
- Runtime state, sessions, generated skills, channel credentials, and API keys: `C:\Repo\hermes\.local\home`
- Python environment: `C:\Users\danaakesen\.hermes\venvs\repo-hermes`
- Durable personal knowledge: the existing Obsidian vault, not Hermes' internal memory files
- Versioned global Hermes instructions: `personal\SOUL.md`

`.local` is deliberately ignored. It must not be committed or copied to GitHub.

## First run

```powershell
.\scripts\personal-bootstrap.ps1 -InstallDependencies
.\scripts\hermes-personal.ps1 setup
```

Place provider and channel credentials only in `.local\home\.env`. Do not put API keys, Copilot credentials, or messaging tokens in source-controlled files.

`personal\SOUL.md` is the versioned instruction source for this profile. Apply
an intentional instruction update to the runtime copy with:

```powershell
.\scripts\personal-bootstrap.ps1 -ForceInstructions
```

Start a new Hermes session after changing `SOUL.md`; existing sessions retain
their original cached system prompt.

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

Run `scripts\\personal-bootstrap.ps1` once before using Desktop. It configures
your Windows user environment so **Hermes (Personal)** launches directly with
no terminal window and can be pinned to the taskbar. The shortcut targets
`apps\\desktop\\release\\win-unpacked\\Hermes.exe` and will use this checkout's
external virtual environment.

## Operating rules

- Hermes is the sole harness and control plane.
- Codex CLI and Copilot CLI are workers invoked through Hermes skills or plugins.
- Obsidian is the durable memory authority; Hermes internal memory is an approval-gated operational cache.
- The Realtime/GPT Live implementation belongs in `personal/`; shared source may contain only provider-neutral Desktop/session extension seams that Hermes plugins cannot supply today.
- Keep core modifications on `personal/main`; use a plugin or skill before changing Hermes source.

## Updating

```powershell
.\scripts\update-personal.ps1
```

The update script rebases `personal/main` onto `upstream/main`, pushes the result to the fork, and refreshes the editable environment. If Git reports a rebase conflict, resolve it before continuing; it is evidence that upstream changed the same surface as your customization.
