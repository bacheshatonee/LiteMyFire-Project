# LiteMyFire Project Tracker

This repository stores `roadmap.json` as the source of truth and a GitHub Action that syncs it into GitHub Issues/Milestones/Labels across repos.

## How it works
- Edit `roadmap.json`
- Push to main
- GitHub Action runs and:
  - Ensures labels exist
  - Ensures milestones exist
  - Creates/updates issues by exact title match

## Run manually
Actions tab → Roadmap Sync → Run workflow

## Files
- roadmap.json
- tools/roadmap-sync/
- .github/workflows/roadmap-sync.yml

## Safety note
This project involves controlling heating equipment. All actuation must be fail-safe (default OFF) and hardware-isolated.
