use crate::chaos::{presets, ChaosConfig, ChaosPreset, ChaosStatus};
use crate::fx::FxTrigger;
use crate::overlay::{index_from_label, monitors, overlay_config, MonitorInfo};
use crate::server::{self, ServerStatus};
use crate::settings::Settings;
use crate::widgets::{self, Profile, Widget};
use crate::{control, sensors, shortcuts, state, tray, updater::UpdateInfo, windows_util};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub const COFFEE_URL: &str = "https://buymeacoffee.com/vallentes";
pub const REVOLUT_URL: &str = "https://revolut.me/vallentes";

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Commands that change settings or layouts only accept calls from the main window.
fn main_only(w: &WebviewWindow) -> CmdResult<()> {
    if w.label() == "main" {
        Ok(())
    } else {
        Err("not allowed from this window".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    settings: Settings,
    version: String,
    platform: &'static str,
    monitors: Vec<MonitorInfo>,
    presets: Vec<ChaosPreset>,
    chaos: ChaosStatus,
    armed: Option<String>,
    server: ServerStatus,
    shortcut_errors: Vec<String>,
    update: Option<UpdateInfo>,
}

pub fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

#[tauri::command]
pub fn get_bootstrap(app: AppHandle) -> Bootstrap {
    let st = state(&app);
    let b = Bootstrap {
        settings: st.settings.read().unwrap().clone(),
        version: app.package_info().version.to_string(),
        platform: platform(),
        monitors: monitors(&app),
        presets: presets(),
        chaos: control::chaos_status(&app),
        armed: st.fx.armed(),
        server: server::status(&app),
        shortcut_errors: st.shortcuts.errors.lock().unwrap().clone(),
        update: st.update.lock().unwrap().clone(),
    };
    b
}

/// Applies a settings patch and every side effect it implies.
pub fn apply_settings_patch(app: &AppHandle, patch: Value) -> CmdResult<Settings> {
    let st = state(app);
    let old = st.settings.read().unwrap().clone();
    let new = old.patched(&patch)?;
    new.save(&st.db).map_err(err)?;
    *st.settings.write().unwrap() = new.clone();

    if new.launch_at_startup != old.launch_at_startup {
        let al = app.autolaunch();
        let _ = if new.launch_at_startup { al.enable() } else { al.disable() };
    }
    if new.stop_shortcut != old.stop_shortcut || new.arm_shortcut != old.arm_shortcut {
        shortcuts::apply(app);
    }
    if new.obs_enabled != old.obs_enabled || new.api_enabled != old.api_enabled || new.server_port != old.server_port {
        server::apply(app);
    }
    if new.desktop_effects != old.desktop_effects || new.disabled_monitors != old.disabled_monitors {
        control::disarm(app);
        st.overlays.destroy_all(app);
    }
    if new.widgets_hidden != old.widgets_hidden
        || new.widgets_locked != old.widgets_locked
        || new.widget_refresh_ms != old.widget_refresh_ms
        || new.active_profile != old.active_profile
        || new.streamer_safe != old.streamer_safe
    {
        widgets::sync(app);
    }
    control::push_config(app);
    tray::refresh(app);
    let _ = app.emit("settings://changed", &new);
    Ok(new)
}

#[tauri::command]
pub fn update_settings(app: AppHandle, window: WebviewWindow, patch: Value) -> CmdResult<Settings> {
    main_only(&window)?;
    apply_settings_patch(&app, patch)
}

#[tauri::command]
pub fn get_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    monitors(&app)
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

#[tauri::command]
pub fn fire_effect(app: AppHandle, window: WebviewWindow, effect: String, monitor: Option<usize>) -> CmdResult<()> {
    main_only(&window)?;
    control::fire_now(&app, &effect, monitor)
}

#[tauri::command]
pub fn arm_tool(app: AppHandle, tool: String) -> CmdResult<()> {
    control::arm(&app, &tool)
}

#[tauri::command]
pub fn disarm_tool(app: AppHandle) {
    control::disarm(&app);
}

#[tauri::command]
pub fn clear_effects(app: AppHandle, mode: Option<String>) {
    control::clear(&app, mode.as_deref() == Some("fade"));
}

#[tauri::command]
pub fn stop_everything(app: AppHandle) {
    control::stop_everything(&app);
}

#[tauri::command]
pub fn start_chaos(app: AppHandle, window: WebviewWindow, config: ChaosConfig) -> CmdResult<ChaosStatus> {
    main_only(&window)?;
    apply_settings_patch(&app, json!({ "chaos": config.clone() }))?;
    control::start_chaos(&app, config)
}

#[tauri::command]
pub fn stop_chaos(app: AppHandle) {
    control::stop_chaos(&app, true);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayBoot {
    config: crate::fx::OverlayConfig,
    armed: Option<String>,
    mirror: usize,
}

#[tauri::command]
pub fn overlay_ready(app: AppHandle, window: WebviewWindow) -> CmdResult<OverlayBoot> {
    let idx = index_from_label(window.label()).ok_or("not an overlay")?;
    let st = state(&app);
    let boot = OverlayBoot { config: overlay_config(&app), armed: st.fx.armed(), mirror: st.settings.read().unwrap().obs_mirror_monitor };
    st.overlays.ready(&app, idx);
    Ok(boot)
}

#[tauri::command]
pub fn overlay_idle(app: AppHandle, window: WebviewWindow, empty: bool, seq: u64) -> CmdResult<()> {
    let idx = index_from_label(window.label()).ok_or("not an overlay")?;
    let st = state(&app);
    let armed = st.fx.armed().is_some();
    st.overlays.idle(&app, idx, empty, seq, armed);
    Ok(())
}

#[tauri::command]
pub fn overlay_report(app: AppHandle, window: WebviewWindow, trigger: FxTrigger) -> CmdResult<()> {
    index_from_label(window.label()).ok_or("not an overlay")?;
    control::report_manual(&app, trigger);
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Streamer
// ---------------------------------------------------------------------------------------------

#[tauri::command]
pub fn server_status(app: AppHandle) -> ServerStatus {
    server::status(&app)
}

#[tauri::command]
pub fn regenerate_token(app: AppHandle, window: WebviewWindow) -> CmdResult<ServerStatus> {
    main_only(&window)?;
    server::regenerate_token(&state(&app));
    Ok(server::status(&app))
}

// ---------------------------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetsState {
    widgets: Vec<Widget>,
    profiles: Vec<Profile>,
    edit_mode: bool,
}

#[tauri::command]
pub fn widgets_state(app: AppHandle) -> CmdResult<WidgetsState> {
    let st = state(&app);
    let profile = st.settings.read().unwrap().active_profile;
    Ok(WidgetsState {
        widgets: widgets::list(&st.db, profile).map_err(err)?,
        profiles: widgets::profiles(&st.db).map_err(err)?,
        edit_mode: st.widgets.edit_mode.load(Ordering::Relaxed),
    })
}

#[tauri::command]
pub fn add_widget(app: AppHandle, window: WebviewWindow, kind: String) -> CmdResult<Widget> {
    main_only(&window)?;
    let st = state(&app);
    let profile = st.settings.read().unwrap().active_profile;
    let existing = widgets::list(&st.db, profile).map_err(err)?;
    if existing.len() >= widgets::MAX_WIDGETS {
        return Err(format!("A layout can hold up to {} widgets", widgets::MAX_WIDGETS));
    }
    let (w, h) = widgets::default_size(&kind).ok_or("Unknown widget")?;
    // Cascade new widgets from the top-left of the primary monitor.
    let m = monitors(&app).into_iter().find(|m| m.primary);
    let (ox, oy) = m.map(|m| (m.x as f64 / m.scale, m.y as f64 / m.scale)).unwrap_or((0.0, 0.0));
    let n = existing.len() as f64;
    let mut wd = widgets::sanitize(Widget { id: 0, profile_id: profile, kind, x: ox + 80.0 + (n % 6.0) * 36.0, y: oy + 80.0 + (n % 6.0) * 36.0, w, h, opacity: 1.0, level: "top".into(), click_through: false, visible: true, config: json!({}) })?;
    wd.id = widgets::insert(&st.db, &wd).map_err(err)?;
    if st.settings.read().unwrap().widgets_hidden {
        apply_settings_patch(&app, json!({ "widgetsHidden": false }))?;
    }
    widgets::sync(&app);
    Ok(wd)
}

#[tauri::command]
pub fn update_widget(app: AppHandle, window: WebviewWindow, widget: Widget) -> CmdResult<Widget> {
    main_only(&window)?;
    let st = state(&app);
    let cur = widgets::get(&st.db, widget.id).ok_or("Widget not found")?;
    let w = widgets::sanitize(Widget { profile_id: cur.profile_id, kind: cur.kind, ..widget })?;
    widgets::save(&st.db, &w).map_err(err)?;
    if let Some(win) = app.get_webview_window(&widgets::label(w.id)) {
        let _ = win.set_size(tauri::LogicalSize::new(w.w, w.h));
        let _ = win.set_position(tauri::LogicalPosition::new(w.x, w.y));
    }
    widgets::sync(&app);
    let _ = app.emit_to(widgets::label(w.id), "widget://updated", &w);
    Ok(w)
}

#[tauri::command]
pub fn remove_widget(app: AppHandle, window: WebviewWindow, id: i64) -> CmdResult<()> {
    main_only(&window)?;
    widgets::delete(&state(&app).db, id).map_err(err)?;
    widgets::sync(&app);
    Ok(())
}

#[tauri::command]
pub fn widget_bootstrap(app: AppHandle, window: WebviewWindow) -> CmdResult<Value> {
    let id = widgets::id_from_label(window.label()).ok_or("not a widget")?;
    let st = state(&app);
    let w = widgets::get(&st.db, id).ok_or("Widget not found")?;
    let s = st.settings.read().unwrap().clone();
    Ok(json!({
        "widget": w,
        "theme": s.widget_theme,
        "customTheme": s.custom_theme,
        "locked": s.widgets_locked,
        "editMode": st.widgets.edit_mode.load(Ordering::Relaxed),
        "snapshot": st.sensors.latest.lock().unwrap().clone(),
    }))
}

#[tauri::command]
pub fn set_widget_edit_mode(app: AppHandle, on: bool) {
    let st = state(&app);
    st.widgets.edit_mode.store(on, Ordering::Relaxed);
    widgets::sync(&app);
    let _ = app.emit("widgets://edit-mode", on);
}

#[tauri::command]
pub fn watch_sensors(app: AppHandle, window: WebviewWindow, on: bool) -> CmdResult<()> {
    main_only(&window)?;
    state(&app).widgets.screen_watching.store(on, Ordering::Relaxed);
    widgets::sync(&app);
    Ok(())
}

#[tauri::command]
pub fn latest_snapshot(app: AppHandle) -> Option<sensors::Snapshot> {
    state(&app).sensors.latest.lock().unwrap().clone()
}

#[tauri::command]
pub fn create_profile(app: AppHandle, window: WebviewWindow, name: String, copy_current: bool) -> CmdResult<i64> {
    main_only(&window)?;
    let st = state(&app);
    let cur = st.settings.read().unwrap().active_profile;
    let id = widgets::create_profile(&st.db, &name, copy_current.then_some(cur))?;
    apply_settings_patch(&app, json!({ "activeProfile": id }))?;
    Ok(id)
}

#[tauri::command]
pub fn rename_profile(app: AppHandle, window: WebviewWindow, id: i64, name: String) -> CmdResult<()> {
    main_only(&window)?;
    widgets::rename_profile(&state(&app).db, id, &name)?;
    let _ = app.emit("widgets://changed", ());
    Ok(())
}

#[tauri::command]
pub fn delete_profile(app: AppHandle, window: WebviewWindow, id: i64) -> CmdResult<()> {
    main_only(&window)?;
    let st = state(&app);
    widgets::delete_profile(&st.db, id)?;
    if st.settings.read().unwrap().active_profile == id {
        let first = widgets::profiles(&st.db).map_err(err)?.first().map(|p| p.id).unwrap_or(1);
        apply_settings_patch(&app, json!({ "activeProfile": first }))?;
    } else {
        widgets::sync(&app);
    }
    Ok(())
}

#[tauri::command]
pub async fn export_profile(app: AppHandle, window: WebviewWindow, id: i64) -> CmdResult<bool> {
    main_only(&window)?;
    let st = state(&app);
    let theme = st.settings.read().unwrap().widget_theme.clone();
    let data = widgets::export(&st.db, id, &theme)?;
    let name = data["name"].as_str().unwrap_or("layout").chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-').collect::<String>();
    let Some(path) = app.dialog().file().set_file_name(format!("{name}.chaoslayout.json")).add_filter("Widget layout", &["json"]).blocking_save_file() else { return Ok(false) };
    let path = path.into_path().map_err(err)?;
    std::fs::write(path, serde_json::to_string_pretty(&data).map_err(err)?).map_err(err)?;
    Ok(true)
}

#[tauri::command]
pub async fn import_profile(app: AppHandle, window: WebviewWindow) -> CmdResult<Option<i64>> {
    main_only(&window)?;
    let Some(path) = app.dialog().file().add_filter("Widget layout", &["json"]).blocking_pick_file() else { return Ok(None) };
    let path = path.into_path().map_err(err)?;
    let meta = std::fs::metadata(&path).map_err(err)?;
    if meta.len() > 1024 * 1024 {
        return Err("That file is too big to be a widget layout".into());
    }
    let text = std::fs::read_to_string(&path).map_err(err)?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("Not a valid layout file: {e}"))?;
    let st = state(&app);
    let (id, theme) = widgets::import(&st.db, &v)?;
    let mut patch = json!({ "activeProfile": id });
    if let Some(t) = theme {
        patch["widgetTheme"] = json!(t);
    }
    apply_settings_patch(&app, patch)?;
    Ok(Some(id))
}

// ---------------------------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------------------------

/// Opens one of the two fixed donation links. No other URL can be opened from here.
#[tauri::command]
pub fn open_support_link(app: AppHandle, kind: Option<String>) -> CmdResult<()> {
    let url = match kind.as_deref() {
        Some("revolut") => REVOLUT_URL,
        _ => COFFEE_URL,
    };
    app.opener().open_url(url, None::<&str>).map_err(err)
}

#[tauri::command]
pub fn open_data_folder(app: AppHandle) -> CmdResult<()> {
    let dir = app.path().app_data_dir().map_err(err)?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(err)
}

#[tauri::command]
pub fn show_main(app: AppHandle, section: Option<String>) {
    windows_util::show_main(&app, section.as_deref());
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    control::stop_everything(&app);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn support_links_are_fixed() {
        assert_eq!(COFFEE_URL, "https://buymeacoffee.com/vallentes");
        assert_eq!(REVOLUT_URL, "https://revolut.me/vallentes");
    }
}
