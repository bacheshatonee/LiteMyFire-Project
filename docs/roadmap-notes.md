# LiteMyFire Roadmap Notes

This file is intended to be edited by humans or pasted from ChatGPT.
A GitHub Action parses the `ROADMAP_UPDATE` block and regenerates `roadmap.json`.

Rules:
- Only content inside the ROADMAP_UPDATE block is parsed.
- Titles must be unique per repo (used as stable identifiers).
- Labels must match labels in roadmap.json (or will be created by sync step if present there).

---

<!-- ROADMAP_UPDATE:BEGIN -->

OWNER: YOUR_GITHUB_ORG_OR_USERNAME

REPOS:
  firmware: fireplace-thermostat
  android: LiteMyFire
  project: LiteMyFire-Project

LABELS:
  - name: type:feature
    color: 1d76db
    description: Feature work
  - name: type:bug
    color: d73a4a
    description: Bug fix
  - name: type:chore
    color: cfd3d7
    description: Maintenance / housekeeping
  - name: area:firmware
    color: 0052cc
    description: ESP32 firmware
  - name: area:android
    color: 0e8a16
    description: Android app
  - name: area:project
    color: 5319e7
    description: Project/Docs/Meta
  - name: safety:critical
    color: b60205
    description: Safety-critical work
  - name: prio:P0
    color: b60205
    description: Must do now
  - name: prio:P1
    color: d93f0b
    description: High priority
  - name: prio:P2
    color: fbca04
    description: Medium priority

MILESTONES:
  - repoKey: firmware
    title: v1.0.0-safety
    description: Safety foundation: watchdog, fail-safe OFF, state machine, NVS persistence, diagnostics.
    dueOn: null
    issues:
      - title: "[v1.0.0] Implement explicit state machine + safe relay default"
        labels: [type:feature, area:firmware, safety:critical, prio:P0]
        body: |
          Objective: deterministic control loop.
          Requirements:
          - Create SystemState enum
          - transitionTo() function
          - Relay OFF by default on boot/reset
          - ERROR_CRITICAL forces OFF

          Acceptance tests:
          - Power cycle -> relay OFF
          - Critical error -> relay OFF
          - No control logic directly in loop()

      - title: "[v1.0.0] Add hardware watchdog + feed in main loop"
        labels: [type:feature, area:firmware, safety:critical, prio:P0]
        body: |
          Objective: prevent hang leaving output ON.

          Requirements:
          - Enable ESP32 task watchdog
          - Feed watchdog at safe frequency
          - If watchdog triggers, relay defaults OFF on reboot

          Acceptance tests:
          - Simulated hang -> reset occurs
          - After reset, relay OFF

  - repoKey: android
    title: v1.0.0-safety-ui
    description: Surface safety + health in app: offline banner, critical indicator, device info screen.
    dueOn: null
    issues:
      - title: "[v1.0.0] Add device health banner + last-seen timer"
        labels: [type:feature, area:android, prio:P1]
        body: |
          Objective: no silent failure.

          Requirements:
          - Track last successful poll timestamp
          - If >10s show 'Device Offline'
          - If repeated failures -> show critical action

          Acceptance tests:
          - Disable WiFi on ESP32 -> banner appears
          - Restore -> banner clears

<!-- ROADMAP_UPDATE:END -->
