<h1 align="center">Desktop Chaos 💥</h1>

<p align="center"><b>Destroy your desktop. Not your computer.</b><br>15 ways to wreck your screen, plus floating system-monitor widgets. Free.</p>

<p align="center">
  <a href="https://github.com/vallentes/desktop-chaos/releases/latest"><b>⬇ Download for Windows / macOS</b></a>
  &nbsp;·&nbsp; <a href="#installation">Installation</a>
  &nbsp;·&nbsp; <a href="PRIVACY.md">Privacy</a>
</p>

## Download

| Windows 10 / 11 | macOS 11+ (Apple Silicon and Intel) |
| --- | --- |
| [`Desktop.Chaos_x.y.z_x64-setup.exe`](https://github.com/vallentes/desktop-chaos/releases/latest) | [`Desktop.Chaos_x.y.z_universal.dmg`](https://github.com/vallentes/desktop-chaos/releases/latest) |

Free, no ads, no accounts, no tracking. It updates itself when a new version is out.

## What it does

Everything is drawn on a see-through layer above your screen. Your files, icons, windows, wallpaper and settings are never touched, and the screen is never recorded. When the mess is gone, the layer disappears and uses no GPU at all.

### The arsenal

| | | |
| --- | --- | --- |
| 🔨 **Hammer**: cracks that grow when you keep hitting the same spot | 🔫 **Machine gun**: bullet holes, adjustable fire rate | 🔥 **Flamethrower**: fire that spreads and leaves burn marks |
| 💧 **Water cannon**: puts the fires out | ⚡ **Lightning**: branching bolts, with a reduced-flashing mode | ☄️ **Meteor**: trail, shockwave, crater |
| 🕳️ **Black hole**: pulls in every particle, shard and crate | 👾 **Monster**: eats drawn fake icons (your real ones are safe) | 📦 **Gravity objects**: crates, balls and bricks that pile up |
| 🪟 **Broken glass**: shards with real physics | 🎨 **Paintball**: neon splats that drip and stay | ❄️ **Snowstorm**: snow that settles at the bottom |
| 🌋 **Earthquake**: shakes the layer, never your windows | 🔆 **Laser**: follows the mouse and burns a trail | 💣 **Reset bomb**: one last boom, then everything is gone |

**Pick up** a weapon to use it with the mouse: the screen becomes clickable until you put it away with `Esc` or a right-click. Number keys switch weapons. **Fire** lets a weapon go off on its own.

### Chaos Mode

Five presets (Mild Chaos, Gamer Rage, Apocalypse, Total Destruction, Random Madness) or your own mix, with duration, intensity, pace, sound, a 3-2-1 countdown and a choice of ending (fade away, reset bomb, or leave the mess).

### Always a way out

* **Emergency stop:** `Ctrl + Alt + Backspace` (`Cmd + Option + Delete` on a Mac), changeable in Settings. Stops chaos, puts the weapon away and wipes the screen.
* **Stop everything** in the tray menu, and a big red button in the app.

### Widgets

Floating, transparent system monitors you can drag anywhere, on any screen: CPU (per core, clock, temperature, power), GPU (load, VRAM, temperature, fan), RAM, network (up/down, LAN and internet latency), disks (read/write, per-drive usage and temperature), battery, motherboard fans and voltages, top processes, a clock with uptime, world clocks, an analog clock, a countdown, a stopwatch and custom text.

* Size, opacity, always on top or on the desktop, click-through, locked positions
* Seven themes (Gaming, Minimal Dark, Minimal White, Cyberpunk, Gaming RGB, Professional, Custom)
* Layouts you can switch between, export and import
* Streamer-safe mode hides IP addresses, the computer name and process names

**Real readings only.** If your system does not share a value, the widget says *unavailable*. What works without admin rights:

| Reading | Windows | macOS |
| --- | --- | --- |
| CPU load per core, RAM, disks, network, processes, battery | ✓ | ✓ |
| CPU clock | ✓ (performance counters) | ✓ |
| GPU load and video memory | ✓ (performance counters) | ✓ (load; memory on most Macs) |
| GPU temperature and fan | ✓ when the display driver reports it (most NVIDIA/AMD cards) | GPU temperature on Apple Silicon |
| RAM type and speed, motherboard model | ✓ | ✓ (memory type, model) |
| CPU temperature and power, fans, voltages, disk temperatures | With [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) running | CPU temperature on Apple Silicon; no fans or voltages |

Windows only gives these deeper sensors to programs with a kernel driver. Desktop Chaos never installs one; if you run LibreHardwareMonitor (free, open source), Desktop Chaos reads its sensors automatically.

## For streamers

* **OBS overlay:** Streamer, *Serve the OBS browser source*, then add a Browser Source with `http://127.0.0.1:47474/obs` at 1920x1080. Chaos Mode and API effects show up there, and optionally whatever you smash by hand. You can keep the effects on stream only.
* **Control API** (off by default): a local WebSocket at `ws://127.0.0.1:47474/api/ws?token=…` and `POST /api/command` with `Authorization: Bearer …`. Only programs on your computer can reach it, and they need the token shown in the app.

```json
{"id": 1, "cmd": "trigger_effect", "effect": "meteor", "x": 0.5, "y": 0.6, "intensity": 0.9}
{"cmd": "start_chaos", "preset": "apocalypse", "duration": 30}
{"cmd": "stop_chaos"}
{"cmd": "clear_effects", "fade": true}
{"cmd": "set_intensity", "value": 0.4}
{"cmd": "get_status"}
```

Effects: `hammer, machinegun, flamethrower, water, lightning, meteor, blackhole, monster, gravity, glass, paintball, snow, earthquake, laser, bomb`. Presets: `mild, gamer-rage, apocalypse, total, random`. Up to 20 commands per second.

## Installation

### Windows 10 / 11

1. Download **`Desktop.Chaos_x.y.z_x64-setup.exe`** from [Releases](https://github.com/vallentes/desktop-chaos/releases/latest).
2. Run it. Windows may show **"Windows protected your PC"** because the installer is not code-signed yet: click **More info**, then **Run anyway**.
3. It installs for your user only (no admin needed) and opens Desktop Chaos.
4. It lives in the **system tray** (bottom right, near the clock; click the `^` arrow if you don't see it).

Uninstall from **Settings, Apps, Installed apps, Desktop Chaos**. The **`.msi`** is the same app for managed installs (`msiexec /i Desktop.Chaos_x.y.z_x64_en-US.msi /qn`).

### macOS 11 or newer

1. Download **`Desktop.Chaos_x.y.z_universal.dmg`** from [Releases](https://github.com/vallentes/desktop-chaos/releases/latest).
2. Open the `.dmg` and drag **Desktop Chaos** into **Applications**.
3. The app is not notarized by Apple yet, so the first launch needs one extra step: open **Applications**, **right-click Desktop Chaos, Open**, then click **Open** again. On macOS 15 and later: try to open it once, then go to **System Settings, Privacy & Security** and click **Open Anyway**.
4. Desktop Chaos appears in the **menu bar**.

Uninstall by dragging Desktop Chaos from Applications to the Trash.

## Support development ☕

Desktop Chaos is free. If it saved a real monitor from a real keyboard, a tip keeps it going:

<table>
<tr>
<td align="center" width="50%">

**[☕ Buy Me a Coffee](https://buymeacoffee.com/vallentes)**

</td>
<td align="center" width="50%">

**[Revolut · @vallentes](https://revolut.me/vallentes)**

<a href="https://revolut.me/vallentes"><img src="docs/revolut-qr.svg" width="140" alt="QR code for revolut.me/vallentes"></a>

Card, Apple Pay or Revolut. No account needed.

</td>
</tr>
</table>

## Technical notes

### Stack

* Tauri 2 + Rust core, React + TypeScript app, PixiJS (WebGL) for effects, Rapier 2D for rigid-body physics
* SQLite (bundled) for settings and widget layouts
* All sounds are synthesized at runtime with Web Audio; all visuals are drawn in code
* Fonts: Inter, Rajdhani, JetBrains Mono (SIL Open Font License), bundled

### How the overlay stays safe and light

* One transparent, always-on-top window per screen, created on first use, shown only while something is on it, and one pixel shorter than the screen so Windows never mistakes it for a fullscreen app.
* It ignores the mouse except while a weapon is picked up.
* The frame loop stops as soon as nothing moves. Persistent marks (cracks, paint) are baked into one texture, so a covered screen costs nothing per frame.
* A particle budget and automatic quality keep slow machines smooth.

### Layout

| Path | What |
| --- | --- |
| `src-tauri/src/` | Rust: overlays, effect bus, Chaos Mode scheduler, streamer server and API, sensors, widgets, tray, shortcuts, updater |
| `src/overlay/` | Overlay page (desktop windows and the OBS source), the 15 effects |
| `src/engine/` | Particle pool, procedural shapes, fire, snow, physics wrapper, quality control, sound synth |
| `src/widgets/` | Widget window, widget faces, themes |
| `src/app/` | Main app (React) |

### Develop

Requirements: Node 20+, Rust stable; on Windows the Visual Studio 2022 Build Tools ("Desktop development with C++"); on macOS the Xcode command line tools.

```bash
npm install
```

```bash
npm run tauri dev
```

```bash
npm test
```

```bash
cargo test --workspace
```

To check effects in a normal browser, run `npm run dev` and open `http://localhost:1430/harness.html`; `fx('meteor', 0.5, 0.5)` in the console fires one.

Release builds come from GitHub Actions when a `v*` tag is pushed (`.github/workflows/release.yml`). The updater key lives outside the repository; its private half is the `TAURI_SIGNING_PRIVATE_KEY` secret.

## License

Free to use. Not open source: see [LICENSE](LICENSE).
