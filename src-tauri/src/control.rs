//! High-level actions shared by the UI, tray, shortcuts and the streamer API.

use crate::chaos::{ChaosConfig, ChaosStatus, Scheduler};
use crate::fx::{is_effect, random_u32, FxEvent, FxTrigger};
use crate::overlay::{enabled_monitors, overlay_config, primary_index};
use crate::{state, tray};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct Chaos {
    /// Bumped on every start/stop; a runner exits when its generation is stale.
    generation: AtomicU64,
    pub status: Mutex<ChaosStatus>,
    /// Live intensity, so the API can turn a running chaos up or down.
    pub intensity: Mutex<f64>,
}

fn desktop_on(app: &AppHandle) -> bool {
    state(app).settings.read().unwrap().desktop_effects
}

/// Sends an event to the desktop overlays (if on) and the OBS stream.
fn publish(app: &AppHandle, ev: FxEvent, monitors: Option<Vec<usize>>) {
    let st = state(app);
    if desktop_on(app) {
        match monitors {
            Some(list) => {
                for m in list {
                    st.overlays.send(app, m, ev.clone());
                }
            }
            None => st.overlays.broadcast(app, ev.clone(), matches!(ev, FxEvent::Clear { .. } | FxEvent::Config { .. } | FxEvent::Disarm { .. })),
        }
    }
    let _ = st.fx.bus.send(ev);
}

pub fn trigger(app: &AppHandle, mut t: FxTrigger) -> Result<(), String> {
    if !is_effect(&t.effect) {
        return Err(format!("Unknown effect '{}'", t.effect));
    }
    t.intensity = if t.intensity.is_finite() { t.intensity.clamp(0.05, 1.0) } else { 0.7 };
    t.x = t.x.filter(|v| v.is_finite()).map(|v| v.clamp(0.0, 1.0));
    t.y = t.y.filter(|v| v.is_finite()).map(|v| v.clamp(0.0, 1.0));
    t.duration = t.duration.filter(|v| v.is_finite()).map(|v| v.clamp(0.2, 120.0));
    let enabled = enabled_monitors(app);
    let target = match t.monitor {
        Some(m) if enabled.contains(&m) => m,
        Some(m) => return Err(format!("Monitor {m} is not available")),
        None => {
            let p = primary_index(app);
            if enabled.contains(&p) {
                p
            } else {
                *enabled.first().ok_or("No monitor is enabled for effects")?
            }
        }
    };
    t.monitor = Some(target);
    let seq = state(app).fx.next_seq();
    publish(app, FxEvent::Trigger { seq, trigger: t }, Some(vec![target]));
    Ok(())
}

/// A hit the user made by hand on an overlay; only forwarded to OBS.
pub fn report_manual(app: &AppHandle, t: FxTrigger) {
    let st = state(app);
    if !st.settings.read().unwrap().obs_mirror_manual || !is_effect(&t.effect) {
        return;
    }
    let seq = st.fx.next_seq();
    let _ = st.fx.bus.send(FxEvent::Trigger { seq, trigger: t });
}

pub fn clear(app: &AppHandle, fade: bool) {
    let seq = state(app).fx.next_seq();
    publish(app, FxEvent::Clear { seq, mode: if fade { "fade" } else { "instant" }.into() }, None);
}

pub fn arm(app: &AppHandle, tool: &str) -> Result<(), String> {
    if !is_effect(tool) {
        return Err(format!("Unknown tool '{tool}'"));
    }
    if !desktop_on(app) {
        return Err("Desktop effects are switched off in Settings.".into());
    }
    let st = state(app);
    *st.fx.armed.lock().unwrap() = Some(tool.to_string());
    {
        let mut s = st.settings.write().unwrap();
        if s.last_tool != tool {
            s.last_tool = tool.to_string();
            let _ = s.save(&st.db);
        }
    }
    let seq = st.fx.next_seq();
    for m in enabled_monitors(app) {
        st.overlays.send(app, m, FxEvent::Arm { seq, tool: tool.to_string() });
    }
    st.overlays.set_interactive(app, true);
    let _ = app.emit("armed://changed", Some(tool));
    tray::refresh(app);
    Ok(())
}

pub fn disarm(app: &AppHandle) {
    let st = state(app);
    let was = st.fx.armed.lock().unwrap().take();
    st.overlays.set_interactive(app, false);
    if was.is_some() {
        let seq = st.fx.next_seq();
        st.overlays.broadcast(app, FxEvent::Disarm { seq }, true);
        let _ = app.emit("armed://changed", None::<String>);
        tray::refresh(app);
    }
}

pub fn toggle_arm(app: &AppHandle) {
    if state(app).fx.armed().is_some() {
        disarm(app);
    } else {
        let tool = state(app).settings.read().unwrap().last_tool.clone();
        if let Err(e) = arm(app, &tool) {
            log::warn!("{e}");
        }
    }
}

/// The panic button: stop chaos, put the tool away, wipe everything, hide the overlays.
pub fn stop_everything(app: &AppHandle) {
    stop_chaos(app, false);
    disarm(app);
    clear(app, false);
    state(app).overlays.hide_all(app);
    let _ = app.emit("fx://stopped", ());
}

pub fn push_config(app: &AppHandle) {
    let seq = state(app).fx.next_seq();
    publish(app, FxEvent::Config { seq, config: overlay_config(app) }, None);
}

// ---------------------------------------------------------------------------------------------
// Chaos Mode
// ---------------------------------------------------------------------------------------------

fn set_status(app: &AppHandle, s: ChaosStatus) {
    let st = state(app);
    let changed_running = st.chaos.status.lock().unwrap().running != s.running;
    *st.chaos.status.lock().unwrap() = s.clone();
    let _ = app.emit("chaos://status", &s);
    if changed_running {
        tray::refresh(app);
    }
}

pub fn chaos_status(app: &AppHandle) -> ChaosStatus {
    state(app).chaos.status.lock().unwrap().clone()
}

pub fn start_chaos(app: &AppHandle, cfg: ChaosConfig) -> Result<ChaosStatus, String> {
    let cfg = cfg.sanitized();
    let monitors = enabled_monitors(app);
    let obs = state(app).settings.read().unwrap().obs_enabled;
    if monitors.is_empty() || (!desktop_on(app) && !obs) {
        return Err("Nothing to show chaos on: turn on desktop effects or the OBS overlay.".into());
    }
    disarm(app);
    let st = state(app);
    let gen = st.chaos.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *st.chaos.intensity.lock().unwrap() = cfg.intensity;
    // Sound follows the chaos setting for this run.
    if !cfg.sound {
        let mut c = overlay_config(app);
        c.sound = false;
        let seq = st.fx.next_seq();
        publish(app, FxEvent::Config { seq, config: c }, None);
    }
    let status = ChaosStatus {
        running: true,
        preset: Some(cfg.preset.clone()),
        phase: if cfg.countdown { "countdown" } else { "running" }.into(),
        remaining_secs: cfg.duration_secs as f64,
        duration_secs: cfg.duration_secs as f64,
        events_fired: 0,
    };
    set_status(app, status.clone());
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move { run_chaos(app2, cfg, gen, monitors).await });
    Ok(status)
}

fn alive(app: &AppHandle, gen: u64) -> bool {
    state(app).chaos.generation.load(Ordering::SeqCst) == gen
}

async fn run_chaos(app: AppHandle, cfg: ChaosConfig, gen: u64, monitors: Vec<usize>) {
    if cfg.countdown {
        for (v, label) in [(3, ""), (2, ""), (1, ""), (0, "CHAOS!")] {
            if !alive(&app, gen) {
                return;
            }
            let seq = state(&app).fx.next_seq();
            publish(&app, FxEvent::Countdown { seq, value: v, label: label.into() }, Some(monitors.clone()));
            tokio::time::sleep(Duration::from_millis(if v > 0 { 1000 } else { 400 })).await;
        }
    }
    let mut sched = Scheduler::new(cfg.clone(), random_u32() as u64 | ((random_u32() as u64) << 32));
    let start = Instant::now();
    let total = cfg.duration_secs as f64;
    let mut last_status = 0.0;
    loop {
        if !alive(&app, gen) {
            return;
        }
        let t = start.elapsed().as_secs_f64();
        if t >= total {
            break;
        }
        let intensity = *state(&app).chaos.intensity.lock().unwrap() / cfg.intensity.max(0.05);
        for trig in sched.due(t, &monitors, intensity) {
            let _ = trigger(&app, trig);
        }
        if t - last_status >= 0.5 {
            last_status = t;
            set_status(
                &app,
                ChaosStatus {
                    running: true,
                    preset: Some(cfg.preset.clone()),
                    phase: "running".into(),
                    remaining_secs: (total - t).max(0.0),
                    duration_secs: total,
                    events_fired: sched.fired,
                },
            );
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if !alive(&app, gen) {
        return;
    }
    match cfg.cleanup.as_str() {
        "bomb" => {
            for m in &monitors {
                let _ = trigger(&app, FxTrigger { effect: "bomb".into(), monitor: Some(*m), x: None, y: None, intensity: 1.0, duration: None, seed: random_u32(), source: "chaos".into() });
            }
        }
        "fade" => {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if alive(&app, gen) {
                clear(&app, true);
            }
        }
        _ => {}
    }
    finish(&app, gen, sched.fired);
}

fn finish(app: &AppHandle, gen: u64, fired: u32) {
    if !alive(app, gen) {
        return;
    }
    state(app).chaos.generation.fetch_add(1, Ordering::SeqCst);
    set_status(app, ChaosStatus { events_fired: fired, ..Default::default() });
    push_config(app);
}

pub fn stop_chaos(app: &AppHandle, fade: bool) {
    let st = state(app);
    let was_running = st.chaos.status.lock().unwrap().running;
    st.chaos.generation.fetch_add(1, Ordering::SeqCst);
    if was_running {
        set_status(app, ChaosStatus::default());
        push_config(app);
        if fade {
            clear(app, true);
        }
    }
}

pub fn set_intensity(app: &AppHandle, v: f64) -> Result<f64, String> {
    if !v.is_finite() {
        return Err("Intensity must be a number between 0 and 1".into());
    }
    let v = v.clamp(0.05, 1.0);
    let st = state(app);
    {
        let mut s = st.settings.write().unwrap();
        s.intensity = v;
        let _ = s.save(&st.db);
    }
    if st.chaos.status.lock().unwrap().running {
        *st.chaos.intensity.lock().unwrap() = v;
    }
    push_config(app);
    let _ = app.emit("settings://changed", st.settings.read().unwrap().clone());
    Ok(v)
}

pub fn fire_now(app: &AppHandle, effect: &str, monitor: Option<usize>) -> Result<(), String> {
    let intensity = state(app).settings.read().unwrap().intensity;
    trigger(app, FxTrigger { effect: effect.into(), monitor, x: None, y: None, intensity, duration: None, seed: random_u32(), source: "user".into() })
}
