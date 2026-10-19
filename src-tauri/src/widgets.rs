//! Floating widgets: one small transparent window each, grouped into layouts (profiles) that
//! can be exported and imported as JSON.

use crate::db::Db;
use crate::{state, windows_util::BROWSER_ARGS};
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

pub const KINDS: &[(&str, f64, f64)] = &[
    ("clock", 450.0, 120.0),
    ("cpu", 450.0, 220.0),
    ("gpu", 450.0, 220.0),
    ("ram", 450.0, 210.0),
    ("network", 450.0, 215.0),
    ("disk", 450.0, 225.0),
    ("battery", 450.0, 210.0),
    ("board", 450.0, 215.0),
    ("processes", 450.0, 215.0),
    ("worldclock", 320.0, 200.0),
    ("analog", 220.0, 250.0),
    ("countdown", 320.0, 140.0),
    ("stopwatch", 320.0, 140.0),
    ("text", 360.0, 100.0),
];

pub const MAX_WIDGETS: usize = 64;
const MAX_CONFIG_BYTES: usize = 8 * 1024;

pub fn default_size(kind: &str) -> Option<(f64, f64)> {
    KINDS.iter().find(|k| k.0 == kind).map(|k| (k.1, k.2))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Widget {
    pub id: i64,
    pub profile_id: i64,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub opacity: f64,
    /// "top" (always on top), "desktop" (stays below other windows) or "normal".
    pub level: String,
    pub click_through: bool,
    pub visible: bool,
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: i64,
    pub name: String,
    pub widgets: usize,
}

#[derive(Default)]
pub struct Widgets {
    pub edit_mode: std::sync::atomic::AtomicBool,
    /// Screen open in the main window that needs live sensor data.
    pub screen_watching: std::sync::atomic::AtomicBool,
    pending_geom: Mutex<HashMap<i64, (f64, f64, f64, f64)>>,
}

fn row(r: &Row) -> rusqlite::Result<Widget> {
    let config: String = r.get(11)?;
    Ok(Widget {
        id: r.get(0)?,
        profile_id: r.get(1)?,
        kind: r.get(2)?,
        x: r.get(3)?,
        y: r.get(4)?,
        w: r.get(5)?,
        h: r.get(6)?,
        opacity: r.get(7)?,
        level: r.get(8)?,
        click_through: r.get::<_, i64>(9)? != 0,
        visible: r.get::<_, i64>(10)? != 0,
        config: serde_json::from_str(&config).unwrap_or_else(|_| json!({})),
    })
}

const COLS: &str = "id, profile_id, kind, x, y, w, h, opacity, level, click_through, visible, config";

pub fn list(db: &Db, profile: i64) -> rusqlite::Result<Vec<Widget>> {
    let c = db.conn();
    let mut q = c.prepare(&format!("SELECT {COLS} FROM widgets WHERE profile_id = ?1 ORDER BY id"))?;
    let rows = q.query_map([profile], row)?.collect();
    rows
}

pub fn get(db: &Db, id: i64) -> Option<Widget> {
    db.conn().query_row(&format!("SELECT {COLS} FROM widgets WHERE id = ?1"), [id], row).ok()
}

/// Clamps a widget to sane values (used for UI patches and imports).
pub fn sanitize(mut w: Widget) -> Result<Widget, String> {
    let (dw, dh) = default_size(&w.kind).ok_or_else(|| format!("Unknown widget '{}'", w.kind))?;
    let fin = |v: f64, d: f64| if v.is_finite() { v } else { d };
    w.x = fin(w.x, 100.0).clamp(-20000.0, 20000.0);
    w.y = fin(w.y, 100.0).clamp(-20000.0, 20000.0);
    w.w = fin(w.w, dw).clamp(dw * 0.4, dw * 3.0);
    w.h = fin(w.h, dh).clamp(dh * 0.4, dh * 3.0);
    w.opacity = fin(w.opacity, 1.0).clamp(0.15, 1.0);
    if !["top", "desktop", "normal"].contains(&w.level.as_str()) {
        w.level = "top".into();
    }
    if !w.config.is_object() {
        w.config = json!({});
    }
    if w.config.to_string().len() > MAX_CONFIG_BYTES {
        return Err("Widget settings are too large".into());
    }
    Ok(w)
}

pub fn insert(db: &Db, w: &Widget) -> rusqlite::Result<i64> {
    let c = db.conn();
    c.execute(
        "INSERT INTO widgets (profile_id, kind, x, y, w, h, opacity, level, click_through, visible, config) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![w.profile_id, w.kind, w.x, w.y, w.w, w.h, w.opacity, w.level, w.click_through as i64, w.visible as i64, w.config.to_string()],
    )?;
    Ok(c.last_insert_rowid())
}

pub fn save(db: &Db, w: &Widget) -> rusqlite::Result<()> {
    db.conn()
        .execute(
            "UPDATE widgets SET x = ?2, y = ?3, w = ?4, h = ?5, opacity = ?6, level = ?7, click_through = ?8, visible = ?9, config = ?10 WHERE id = ?1",
            params![w.id, w.x, w.y, w.w, w.h, w.opacity, w.level, w.click_through as i64, w.visible as i64, w.config.to_string()],
        )
        .map(|_| ())
}

pub fn delete(db: &Db, id: i64) -> rusqlite::Result<()> {
    db.conn().execute("DELETE FROM widgets WHERE id = ?1", [id]).map(|_| ())
}

pub fn profiles(db: &Db) -> rusqlite::Result<Vec<Profile>> {
    let c = db.conn();
    let mut q = c.prepare("SELECT p.id, p.name, (SELECT COUNT(*) FROM widgets w WHERE w.profile_id = p.id) FROM profiles p ORDER BY p.id")?;
    let rows = q.query_map([], |r| Ok(Profile { id: r.get(0)?, name: r.get(1)?, widgets: r.get::<_, i64>(2)? as usize }))?.collect();
    rows
}

pub fn create_profile(db: &Db, name: &str, copy_from: Option<i64>) -> Result<i64, String> {
    let name = clean_name(name)?;
    let id = {
        let c = db.conn();
        c.execute("INSERT INTO profiles (name, created_at) VALUES (?1, ?2)", params![name, crate::now()]).map_err(|e| e.to_string())?;
        c.last_insert_rowid()
    };
    if let Some(src) = copy_from {
        for mut w in list(db, src).map_err(|e| e.to_string())? {
            w.profile_id = id;
            insert(db, &w).map_err(|e| e.to_string())?;
        }
    }
    Ok(id)
}

fn clean_name(name: &str) -> Result<String, String> {
    let n: String = name.trim().chars().filter(|c| !c.is_control()).take(40).collect();
    if n.is_empty() {
        Err("Give the layout a name".into())
    } else {
        Ok(n)
    }
}

pub fn rename_profile(db: &Db, id: i64, name: &str) -> Result<(), String> {
    let n = clean_name(name)?;
    db.conn().execute("UPDATE profiles SET name = ?2 WHERE id = ?1", params![id, n]).map(|_| ()).map_err(|e| e.to_string())
}

pub fn delete_profile(db: &Db, id: i64) -> Result<(), String> {
    if profiles(db).map_err(|e| e.to_string())?.len() <= 1 {
        return Err("Keep at least one layout".into());
    }
    db.conn().execute("DELETE FROM profiles WHERE id = ?1", [id]).map(|_| ()).map_err(|e| e.to_string())
}

pub fn export(db: &Db, profile: i64, theme: &str) -> Result<Value, String> {
    let name: String = db.conn().query_row("SELECT name FROM profiles WHERE id = ?1", [profile], |r| r.get(0)).map_err(|_| "Layout not found".to_string())?;
    let widgets: Vec<Value> = list(db, profile)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|w| json!({ "kind": w.kind, "x": w.x, "y": w.y, "w": w.w, "h": w.h, "opacity": w.opacity, "level": w.level, "clickThrough": w.click_through, "visible": w.visible, "config": w.config }))
        .collect();
    Ok(json!({ "app": "Desktop Chaos", "type": "widget-layout", "version": 1, "name": name, "theme": theme, "widgets": widgets }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportWidget {
    kind: String,
    x: f64,
    y: f64,
    w: Option<f64>,
    h: Option<f64>,
    opacity: Option<f64>,
    level: Option<String>,
    click_through: Option<bool>,
    visible: Option<bool>,
    config: Option<Value>,
}

/// Imports a layout file as a new profile. Returns (profile id, theme in the file).
pub fn import(db: &Db, v: &Value) -> Result<(i64, Option<String>), String> {
    if v.get("type").and_then(|t| t.as_str()) != Some("widget-layout") {
        return Err("This is not a Desktop Chaos widget layout file".into());
    }
    let items = v.get("widgets").and_then(|w| w.as_array()).ok_or("The file has no widgets")?;
    if items.len() > MAX_WIDGETS {
        return Err(format!("Too many widgets (max {MAX_WIDGETS})"));
    }
    let mut parsed = vec![];
    for it in items {
        let iw: ImportWidget = serde_json::from_value(it.clone()).map_err(|e| format!("Bad widget entry: {e}"))?;
        let (dw, dh) = default_size(&iw.kind).ok_or_else(|| format!("Unknown widget '{}'", iw.kind))?;
        parsed.push(sanitize(Widget {
            id: 0,
            profile_id: 0,
            kind: iw.kind,
            x: iw.x,
            y: iw.y,
            w: iw.w.unwrap_or(dw),
            h: iw.h.unwrap_or(dh),
            opacity: iw.opacity.unwrap_or(1.0),
            level: iw.level.unwrap_or_else(|| "top".into()),
            click_through: iw.click_through.unwrap_or(false),
            visible: iw.visible.unwrap_or(true),
            config: iw.config.unwrap_or_else(|| json!({})),
        })?);
    }
    let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("Imported");
    let id = create_profile(db, &format!("{name} (imported)"), None)?;
    for mut w in parsed {
        w.profile_id = id;
        insert(db, &w).map_err(|e| e.to_string())?;
    }
    let theme = v.get("theme").and_then(|t| t.as_str()).map(|s| s.to_string());
    Ok((id, theme))
}

// ---------------------------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------------------------

pub fn label(id: i64) -> String {
    format!("widget-{id}")
}

pub fn id_from_label(l: &str) -> Option<i64> {
    l.strip_prefix("widget-")?.parse().ok()
}

fn apply_flags(app: &AppHandle, w: &Widget) {
    let Some(win) = app.get_webview_window(&label(w.id)) else { return };
    let st = state(app);
    let edit = st.widgets.edit_mode.load(Ordering::Relaxed);
    let _ = win.set_always_on_top(w.level == "top");
    let _ = win.set_always_on_bottom(w.level == "desktop");
    let _ = win.set_ignore_cursor_events(w.click_through && !edit);
}

fn create(app: &AppHandle, w: &Widget) -> tauri::Result<()> {
    let b = WebviewWindowBuilder::new(app, label(w.id), WebviewUrl::App(format!("widget.html?id={}", w.id).into()));
    #[cfg(windows)]
    let b = b.additional_browser_args(BROWSER_ARGS);
    b.title("Desktop Chaos Widget")
        .inner_size(w.w, w.h)
        .position(w.x, w.y)
        .transparent(true)
        .decorations(false)
        .skip_taskbar(true)
        .resizable(true)
        .shadow(false)
        .focused(false)
        .visible(true)
        .always_on_top(w.level == "top")
        .always_on_bottom(w.level == "desktop")
        .visible_on_all_workspaces(true)
        .build()?;
    apply_flags(app, w);
    Ok(())
}

/// Visible widgets that fit on a current monitor; the rest are nudged back on screen.
fn on_screen(app: &AppHandle, w: &mut Widget) -> bool {
    let mons = crate::overlay::monitors(app);
    if mons.is_empty() {
        return false;
    }
    let inside = mons.iter().any(|m| {
        let (x, y, mw, mh) = (m.x as f64 / m.scale, m.y as f64 / m.scale, m.width as f64 / m.scale, m.height as f64 / m.scale);
        w.x + 40.0 > x && w.x < x + mw - 40.0 && w.y + 20.0 > y && w.y < y + mh - 20.0
    });
    if !inside {
        let m = mons.iter().find(|m| m.primary).unwrap_or(&mons[0]);
        w.x = m.x as f64 / m.scale + 60.0;
        w.y = m.y as f64 / m.scale + 60.0;
        return true;
    }
    false
}

/// Opens, updates or closes widget windows to match the active layout.
pub fn sync(app: &AppHandle) {
    let st = state(app);
    let (hidden, profile, refresh, safe) = {
        let s = st.settings.read().unwrap();
        (s.widgets_hidden, s.active_profile, s.widget_refresh_ms, s.streamer_safe)
    };
    let list = list(&st.db, profile).unwrap_or_default();
    let wanted: Vec<Widget> = if hidden { vec![] } else { list.into_iter().filter(|w| w.visible).collect() };
    let labels: HashSet<String> = wanted.iter().map(|w| label(w.id)).collect();
    for (l, win) in app.webview_windows() {
        if id_from_label(&l).is_some() && !labels.contains(&l) {
            let _ = win.destroy();
        }
    }
    let mut procs = false;
    for mut w in wanted.clone() {
        procs |= w.kind == "processes";
        if app.get_webview_window(&label(w.id)).is_none() {
            if on_screen(app, &mut w) {
                let _ = save(&st.db, &w);
            }
            if let Err(e) = create(app, &w) {
                log::error!("could not open widget {}: {e}", w.id);
            }
        } else {
            apply_flags(app, &w);
        }
    }
    let sensor_kinds = ["cpu", "gpu", "ram", "network", "disk", "battery", "board", "processes", "clock"];
    let watching = st.widgets.screen_watching.load(Ordering::Relaxed);
    st.sensors.wanted.store(watching || wanted.iter().any(|w| sensor_kinds.contains(&w.kind.as_str())), Ordering::Relaxed);
    st.sensors.want_processes.store(procs || watching, Ordering::Relaxed);
    st.sensors.refresh_ms.store(refresh, Ordering::Relaxed);
    st.sensors.streamer_safe.store(safe, Ordering::Relaxed);
    let _ = app.emit("widgets://changed", ());
}

/// Remembers where a widget window was dragged or resized to; written to disk in batches.
pub fn note_geometry(app: &AppHandle, id: i64) {
    let Some(win) = app.get_webview_window(&label(id)) else { return };
    let (Ok(pos), Ok(size), Ok(scale)) = (win.outer_position(), win.inner_size(), win.scale_factor()) else { return };
    let p: LogicalPosition<f64> = pos.to_logical(scale);
    let s: LogicalSize<f64> = size.to_logical(scale);
    state(app).widgets.pending_geom.lock().unwrap().insert(id, (p.x, p.y, s.width, s.height));
}

pub fn spawn_geometry_flush(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(600)).await;
            let st = state(&app);
            let pending: Vec<_> = st.widgets.pending_geom.lock().unwrap().drain().collect();
            for (id, (x, y, w, h)) in pending {
                if let Some(mut wd) = get(&st.db, id) {
                    wd.x = x;
                    wd.y = y;
                    wd.w = w;
                    wd.h = h;
                    if let Ok(wd) = sanitize(wd) {
                        let _ = save(&st.db, &wd);
                        let _ = app.emit("widgets://geometry", &wd);
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn widget(kind: &str) -> Widget {
        Widget { id: 0, profile_id: 1, kind: kind.into(), x: 10.0, y: 20.0, w: 450.0, h: 220.0, opacity: 1.0, level: "top".into(), click_through: false, visible: true, config: json!({}) }
    }

    #[test]
    fn crud_and_profiles() {
        let db = Db::open_in_memory().unwrap();
        let id = insert(&db, &widget("cpu")).unwrap();
        let mut w = get(&db, id).unwrap();
        w.opacity = 0.5;
        save(&db, &w).unwrap();
        assert_eq!(get(&db, id).unwrap().opacity, 0.5);
        let p2 = create_profile(&db, "Streaming", Some(1)).unwrap();
        assert_eq!(list(&db, p2).unwrap().len(), 1);
        assert_eq!(profiles(&db).unwrap().len(), 2);
        delete_profile(&db, p2).unwrap();
        assert!(delete_profile(&db, 1).is_err(), "last layout cannot be deleted");
        delete(&db, id).unwrap();
        assert!(get(&db, id).is_none());
    }

    #[test]
    fn export_import_round_trip() {
        let db = Db::open_in_memory().unwrap();
        insert(&db, &widget("cpu")).unwrap();
        let mut t = widget("text");
        t.config = json!({ "text": "hello" });
        t.h = 100.0;
        t.w = 360.0;
        insert(&db, &t).unwrap();
        let file = export(&db, 1, "cyberpunk").unwrap();
        let (pid, theme) = import(&db, &file).unwrap();
        assert_eq!(theme.as_deref(), Some("cyberpunk"));
        let back = list(&db, pid).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(back[1].config["text"], "hello");
    }

    #[test]
    fn import_rejects_bad_files() {
        let db = Db::open_in_memory().unwrap();
        assert!(import(&db, &json!({ "widgets": [] })).is_err());
        assert!(import(&db, &json!({ "type": "widget-layout", "widgets": [{ "kind": "keylogger", "x": 0, "y": 0 }] })).is_err());
        let many: Vec<Value> = (0..100).map(|_| json!({ "kind": "clock", "x": 0, "y": 0 })).collect();
        assert!(import(&db, &json!({ "type": "widget-layout", "widgets": many })).is_err());
        let huge = json!({ "type": "widget-layout", "widgets": [{ "kind": "text", "x": 0, "y": 0, "config": { "text": "x".repeat(20000) } }] });
        assert!(import(&db, &huge).is_err());
    }

    #[test]
    fn sanitize_clamps() {
        let mut w = widget("cpu");
        w.opacity = 0.0;
        w.w = 1e9;
        w.x = f64::NAN;
        w.level = "kernel".into();
        let s = sanitize(w).unwrap();
        assert_eq!(s.opacity, 0.15);
        assert_eq!(s.w, 1350.0);
        assert_eq!(s.x, 100.0);
        assert_eq!(s.level, "top");
    }
}
