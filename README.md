# ProjectGamma

A personal project manager that lets an autonomous Cloud-Code agent work
inside your projects while you capture ideas on the go. Mobile, desktop
and the agent stay in sync through a local relay server.

## What it does

- **Manage projects** — tasks, rules, ideas and file structure in one place.
- **Capture from anywhere** — quick note, voice or chat from your phone.
- **Autonomous Cloud-Code** — an agent works inside the selected project
  and respects the project's rules on every change.
- **Mobile ↔ Desktop sync** — operations replicate through `sync-server`
  with end-to-end encryption.

## Repository layout

| Folder           | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `mobile-app/`    | Flutter app (feature-first, snake_case modules)      |
| `desktop-app/`   | Desktop client (React/JSX prototype)                 |
| `sync-server/`   | Node relay: auth, project membership, op-log, TLS    |
| `shared-models/` | Schema + generator for Task / Idea / RuleDiff / etc. |
| `projectgamma/`  | Design bundle (sketchy B&W wireframes, German UI)    |
| `Flutter/`       | Local Flutter SDK (3.41.9 stable)                    |
| `docs/`          | Architecture and design notes                        |

## Design

- Hand-drawn sketchy aesthetic, strict black & white
  (`#faf8f3` paper, `#1a1a1a` ink).
- Fonts: Caveat, Architects Daughter, JetBrains Mono.
- UI language: German.
- Cloud-Code presence is ambient by default — never intrusive.

## Principles

- TDD: tests before implementation.
- Domain ↔ infra separation, feature-first organisation.
- Max 200 lines per file, snake_case file names.
- Animations respect `prefers-reduced-motion` /
  `MediaQuery.disableAnimations`.
- Device-local preferences (theme, UI state) are **not** mirrored
  through `sync-server`.

## Status

Work in progress. Mobile and desktop scaffolds, `sync-server` modules
(users, project membership, op-log, payload crypto, TLS bootstrap,
rule linter) exist as isolated, tested units; wiring is ongoing.
