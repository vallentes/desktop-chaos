use crate::{chaos, commands, control, state, widgets, windows_util::show_main};
use serde_json::json;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Wry};

pub struct TrayHandles {
    stop: MenuItem<Wry>,
    arm: MenuItem<Wry>,
    widgets: CheckMenuItem<Wry>,
    update: MenuItem<Wry>,
}

fn pretty(s: &str) -> String {
    let ctrl = if cfg!(target_os = "macos") { "Cmd" } else { "Ctrl" };
    s.replace("CommandOrControl", ctrl).replace("Control", "Ctrl")
}

fn stop_label(app: &AppHandle) -> String {
    let sc = state(app).settings.read().unwrap().stop_shortcut.clone();
    if sc.is_empty() {
        "Stop everything".into()
    } else {
        format!("Stop everything ({})", pretty(&sc))
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<TrayHandles> {
    let st = state(app);
    let s = st.settings.read().unwrap().clone();
    let open = MenuItem::with_id(app, "open", "Open Desktop Chaos", true, None::<&str>)?;
    let arm = MenuItem::with_id(app, "arm", "Pick up last tool", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", stop_label(app), true, None::<&str>)?;
    let clear = MenuItem::with_id(app, "clear", "Clear the screen", true, None::<&str>)?;
    let mut preset_items = vec![];
    for p in chaos::presets() {
        preset_items.push(MenuItem::with_id(app, format!("chaos:{}", p.id), p.name, true, None::<&str>)?);
    }
    let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = preset_items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<Wry>).collect();
    let chaos_menu = Submenu::with_items(app, "Start Chaos Mode", true, &refs)?;
    let widgets_item = CheckMenuItem::with_id(app, "widgets", "Show widgets", true, !s.widgets_hidden, None::<&str>)?;
    let coffee = MenuItem::with_id(app, "coffee", "Buy me a coffee", true, None::<&str>)?;
    let revolut = MenuItem::with_id(app, "revolut", "Tip via Revolut", true, None::<&str>)?;
    let update = MenuItem::with_id(app, "update", "Check for updates", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Desktop Chaos", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &arm,
            &chaos_menu,
            &clear,
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &widgets_item,
            &PredefinedMenuItem::separator(app)?,
            &coffee,
            &revolut,
            &update,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("app icon"))
        .tooltip("Desktop Chaos")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            // Handled off the main thread: these create and talk to windows, which wait on it.
            let id = event.id().as_ref().to_string();
            let app = app.clone();
            tauri::async_runtime::spawn(async move { on_menu(&app, &id) });
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle(), None);
            }
        })
        .build(app)?;

    Ok(TrayHandles { stop, arm, widgets: widgets_item, update })
}

fn on_menu(app: &AppHandle, id: &str) {
            match id {
                "open" => show_main(app, None),
                "arm" => control::toggle_arm(app),
                "stop" => control::stop_everything(app),
                "clear" => control::clear(app, false),
                "widgets" => {
                    let hidden = !state(app).settings.read().unwrap().widgets_hidden;
                    let _ = commands::apply_settings_patch(app, json!({ "widgetsHidden": hidden }));
                    widgets::sync(app);
                }
                "coffee" => {
                    let _ = commands::open_link(app, Some("coffee"));
                }
                "revolut" => {
                    let _ = commands::open_link(app, Some("revolut"));
                }
                "update" => {
                    let has = state(app).update.lock().unwrap().is_some();
                    if has {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = crate::updater::install_update(app).await {
                                log::warn!("{e}");
                            }
                        });
                    } else {
                        show_main(app, Some("settings"));
                        let _ = app.emit("update://check-requested", ());
                    }
                }
                "quit" => {
                    control::stop_everything(app);
                    app.exit(0);
                }
                other => {
                    if let Some(p) = other.strip_prefix("chaos:").and_then(chaos::preset) {
                        let mut cfg = p.config;
                        let saved = state(app).settings.read().unwrap().chaos.clone();
                        cfg.sound = saved.sound;
                        if let Err(e) = control::start_chaos(app, cfg) {
                            log::warn!("{e}");
                            show_main(app, Some("chaos"));
                        }
                    }
                }
            }
}

pub fn refresh(app: &AppHandle) {
    let st = state(app);
    let guard = st.tray.lock().unwrap();
    let Some(t) = guard.as_ref() else { return };
    let _ = t.stop.set_text(stop_label(app));
    let armed = st.fx.armed();
    let _ = t.arm.set_text(if armed.is_some() { "Put the tool away".to_string() } else { "Pick up last tool".to_string() });
    let _ = t.widgets.set_checked(!st.settings.read().unwrap().widgets_hidden);
    let label = match st.update.lock().unwrap().as_ref() {
        Some(u) => format!("Update to {}", u.version),
        None => "Check for updates".to_string(),
    };
    let _ = t.update.set_text(label);
}
