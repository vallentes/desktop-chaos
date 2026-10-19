# Desktop Chaos privacy policy

Last updated: 19 October 2026 · Applies to Desktop Chaos 1.0 and later

Desktop Chaos is made by Valentin Vina (Vallentes). Short version: **nothing about you leaves your computer. There are no accounts, ads, analytics or tracking.**

## What the app never does

* It never records, captures or reads your screen. The effects are drawn on a transparent layer on top; nothing underneath is looked at.
* It never moves, closes or changes other windows, desktop icons, files, the wallpaper or system settings. The "monster" eats drawn fake icons, and the earthquake only shakes its own layer.
* It never installs drivers and never needs administrator rights.

## What is stored, and where

| What | Where | Why |
| --- | --- | --- |
| Settings, Chaos Mode setup, widget layouts | A SQLite database in the app's data folder on your computer | So they are still there next time |
| Control API token (only used if you switch the API on) | The same database | So local tools can connect |

Open the folder from Settings, App, *Open data folder*. Deleting it removes everything.

## What the widgets read

The widgets read your computer's own sensors (processor, memory, graphics card, disks, network, battery) through the operating system, and, on Windows, from LibreHardwareMonitor if you run it yourself. They also list your top processes and your IP address. All of this is shown on your screen only. It is never saved to disk or sent anywhere. *Streamer-safe* mode hides your IP addresses, computer name and process names from the widgets.

## When the app goes online

* **GitHub**, to check for and download updates. GitHub sees a normal download request (your IP address and the app version).
* **Your router**, if *Measure LAN latency* is on (it is by default while widgets are shown): one small ping every 5 seconds to measure the delay.
* **An internet host you choose** (1.1.1.1 by default), only if you switch on *Measure internet latency*: one small ping every 5 seconds.

Nothing else. No usage statistics, crash reports or personal data are sent to me or to anyone else.

## The streamer server

Off by default. When you switch on the OBS overlay or the control API, Desktop Chaos listens on 127.0.0.1 only, so only programs on your own computer can reach it. The control API also requires the secret token shown in the app, and you can replace the token at any time.

## Donations

The Support screen opens buymeacoffee.com or revolut.me in your browser. Those sites have their own privacy policies; Desktop Chaos does not see or store anything about a donation.

## Children

Desktop Chaos collects no personal data from anyone, including children.

## Your rights

Because no personal data is collected or sent to me, there is nothing for me to access, correct or delete on my side. Everything stays on your device and under your control.

## Contact

Questions about privacy: open an issue at https://github.com/vallentes/desktop-chaos/issues.
