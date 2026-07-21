# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository is at the **initial-commit stage**. It currently contains only `README.md` — there is no source code, build system, dependency manifest, tests, or configuration yet. Commands for building, linting, and testing do not exist and should not be assumed; establish them as part of implementing the project, then document them here.

## What this project is

**Context-Budget-Visualizer** — a real-time "what's eating my context window" breakdown for a Claude Code / agent harness session. It attributes context consumption to its sources (which files, which tool outputs, which skill loads) and surfaces prune suggestions.

The motivating problem (from `README.md`): context is the single biggest opaque cost in long agent sessions. The harness summarizes context when it grows large but never shows the user its *composition* — this tool makes that composition visible and actionable.

## Guidance for early work

- When scaffolding, record the chosen stack, build/run/test commands, and the high-level architecture back into this file so future sessions can be productive immediately.
- Keep the visualizer's core concern in mind: mapping raw context sources (file reads, tool-call results, skill/system-prompt loads) to token cost, and turning that into a breakdown plus prune recommendations.
