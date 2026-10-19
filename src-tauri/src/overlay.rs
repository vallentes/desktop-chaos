//! One transparent, always-on-top, click-through window per monitor. Windows are created on
//! first use, shown only while they have something to draw, and only take the mouse while a
//! tool is armed. Nothing here touches other applications' windows.

use crate::fx::{FxEvent, OverlayConfig};
use crate::{state, windows_util::BROWSER_ARGS};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub index: usize,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub primary: bool,
    /// Logical pixels between the bottom of the work area and the bottom of the screen (taskbar/dock).
    pub floor_inset: f64,
}

#[derive(Default)]
struct Win {
    ready: bool,
    pending: Vec<FxEvent>,
    last_seq: u64,
    visible: bool,
}

#[derive(Default)]
pub struct Overlays {
    wins: Mutex<HashMap<usize, Win>>,
    layout: Mutex<Vec<MonitorInfo>>,
}

pub fn label(idx: usize) -> String {
    format!("overlay-{idx}")
}

pub fn index_from_label(label: &str) -> Option<usize> {
    label.strip_prefix("overlay-")?.parse().ok()
}

pub fn monitors(app: &AppHandle) -> Vec<MonitorInfo> {
    let primary = app.primary_monitor().ok().flatten().map(|m| *m.position());
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let pos = *m.position();
            let size = *m.size();
            let wa = m.work_area();
            let bottom = pos.y as i64 + size.height as i64;
            let wa_bottom = wa.position.y as i64 + wa.size.height as i64;
            let scale = m.scale_factor();
            MonitorInfo {
                index: i,
                name: m.name().cloned().unwrap_or_else(|| format!("Display {}", i + 1)),
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                scale,
                primary: primary == Some(pos),
                floor_inset: ((bottom - wa_bottom).max(0) as f64 / scale).round(),
            }
        })
        .collect()
}

/// Indices of monitors that should show effects.
pub fn enabled_monitors(app: &AppHandle) -> Vec<usize> {
    let st = state(app);
    let disabled = st.settings.read().unwrap().disabled_monitors.clone();
    monitors(app).into_iter().map(|m| m.index).filter(|i| !disabled.contains(i)).collect()
}

pub fn primary_index(app: &AppHandle) -> usize {
    monitors(app).into_iter().find(|m| m.primary).map(|m| m.index).unwrap_or(0)
}

fn create(app: &AppHandle, m: &MonitorInfo) -> tauri::Result<()> {
    let url = format!("overlay.html?m={}&floor={}", m.index, m.floor_inset);
    let b = WebviewWindowBuilder::new(app, label(m.index), WebviewUrl::App(url.into()));
    #[cfg(windows)]
    let b = b.additional_browser_args(BROWSER_ARGS);
    let win = b
        .title("Desktop Chaos Overlay")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .visible_on_all_workspaces(true)
        .build()?;
    // One pixel short of the full height, so Windows does not treat it as a fullscreen app
    // (that would hide the taskbar and switch on Do Not Disturb).
    win.set_position(PhysicalPosition::new(m.x, m.y))?;
    win.set_size(PhysicalSize::new(m.width, m.height.saturating_sub(1).max(1)))?;
    win.set_ignore_cursor_events(true)?;
    Ok(())
}

impl Overlays {
    /// Makes sure the overlay for `idx` exists. Returns false if that monitor is gone.
    fn ensure(&self, app: &AppHandle, idx: usize) -> bool {
        if app.get_webview_window(&label(idx)).is_some() {
            return true;
        }
        let Some(m) = monitors(app).into_iter().find(|m| m.index == idx) else { return false };
        if let Err(e) = create(app, &m) {
            log::error!("could not create overlay for monitor {idx}: {e}");
            return false;
        }
        self.wins.lock().unwrap().insert(idx, Win::default());
        true
    }

    /// Sends an event to one overlay, creating and showing it as needed.
    pub fn send(&self, app: &AppHandle, idx: usize, ev: FxEvent) {
        if !self.ensure(app, idx) {
            return;
        }
        let mut wins = self.wins.lock().unwrap();
        let w = wins.entry(idx).or_default();
        if !w.ready {
            w.pending.push(ev);
            return;
        }
        if ev.needs_window() && !w.visible {
            if let Some(win) = app.get_webview_window(&label(idx)) {
                let _ = win.show();
                w.visible = true;
            }
        }
        w.last_seq = w.last_seq.max(ev.seq());
        let _ = app.emit_to(label(idx), "fx://event", &ev);
    }

    pub fn broadcast(&self, app: &AppHandle, ev: FxEvent, only_existing: bool) {
        for idx in enabled_monitors(app) {
            if only_existing && app.get_webview_window(&label(idx)).is_none() {
                continue;
            }
            self.send(app, idx, ev.clone());
        }
    }

    /// The overlay page finished loading. Flushes whatever was queued for it.
    pub fn ready(&self, app: &AppHandle, idx: usize) {
        let pending = {
            let mut wins = self.wins.lock().unwrap();
            let w = wins.entry(idx).or_default();
            w.ready = true;
            std::mem::take(&mut w.pending)
        };
        for ev in pending {
            self.send(app, idx, ev);
        }
    }

    /// The overlay has nothing left to animate. Hide it if it is also empty and nothing newer was sent.
    pub fn idle(&self, app: &AppHandle, idx: usize, empty: bool, seq: u64, armed: bool) {
        let mut wins = self.wins.lock().unwrap();
        let Some(w) = wins.get_mut(&idx) else { return };
        if empty && !armed && seq >= w.last_seq && w.pending.is_empty() && w.visible {
            if let Some(win) = app.get_webview_window(&label(idx)) {
                let _ = win.hide();
            }
            w.visible = false;
        }
    }

    pub fn set_interactive(&self, app: &AppHandle, on: bool) {
        for (l, win) in app.webview_windows() {
            if index_from_label(&l).is_some() {
                let _ = win.set_ignore_cursor_events(!on);
            }
        }
        if on {
            // Give keyboard focus (Esc, tool keys) to the overlay under the mouse.
            if let Ok(p) = app.cursor_position() {
                let hit = monitors(app).into_iter().find(|m| {
                    p.x >= m.x as f64 && p.x < (m.x + m.width as i32) as f64 && p.y >= m.y as f64 && p.y < (m.y + m.height as i32) as f64
                });
                if let Some(win) = hit.and_then(|m| app.get_webview_window(&label(m.index))) {
                    let _ = win.set_focus();
                }
            }
        }
    }

    pub fn hide_all(&self, app: &AppHandle) {
        let mut wins = self.wins.lock().unwrap();
        for (idx, w) in wins.iter_mut() {
            if let Some(win) = app.get_webview_window(&label(*idx)) {
                let _ = win.hide();
            }
            w.visible = false;
        }
    }

    /// Closes every overlay (monitor layout changed, or desktop effects switched off).
    pub fn destroy_all(&self, app: &AppHandle) {
        self.wins.lock().unwrap().clear();
        for (l, win) in app.webview_windows() {
            if index_from_label(&l).is_some() {
                let _ = win.destroy();
            }
        }
    }

    /// Recreates overlays when monitors are added, removed, moved or rescaled.
    pub fn check_layout(&self, app: &AppHandle) {
        let now = monitors(app);
        let changed = {
            let mut l = self.layout.lock().unwrap();
            let c = *l != now;
            *l = now;
            c
        };
        if changed {
            log::info!("monitor layout changed; rebuilding overlays");
            self.destroy_all(app);
            let _ = app.emit("monitors://changed", ());
        }
    }
}

pub fn overlay_config(app: &AppHandle) -> OverlayConfig {
    let s = state(app).settings.read().unwrap().clone();
    OverlayConfig {
        sound: s.sound,
        volume: s.volume,
        reduced_flashing: s.reduced_flashing,
        quality: s.quality,
        particle_budget: s.particle_budget,
        intensity: s.intensity,
        tool_options: s.tool_options,
        stop_shortcut: s.stop_shortcut,
    }
}
