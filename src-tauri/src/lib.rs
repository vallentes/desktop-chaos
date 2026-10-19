pub mod api;
pub mod chaos;
pub mod commands;
pub mod control;
pub mod db;
pub mod fx;
pub mod overlay;
pub mod sensors;
pub mod server;
pub mod settings;
pub mod shortcuts;
pub mod tray;
pub mod updater;
pub mod widgets;
pub mod windows_util;

use crate::settings::Settings;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

pub fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub struct AppState {
    pub db: Arc<db::Db>,
    pub settings: RwLock<Settings>,
    pub fx: fx::Fx,
    pub overlays: overlay::Overlays,
    pub chaos: control::Chaos,
    pub server: server::Server,
    pub shortcuts: shortcuts::Shortcuts,
    pub sensors: Arc<sensors::Sensors>,
    pub widgets: widgets::Widgets,
    pub tray: Mutex<Option<tray::TrayHandles>>,
    pub update: Mutex<Option<updater::UpdateInfo>>,
}

impl AppState {
    fn new(db: Arc<db::Db>) -> Self {
        let settings = Settings::load(&db);
        Self {
            db,
            settings: RwLock::new(settings),
            fx: fx::Fx::default(),
            overlays: overlay::Overlays::default(),
            chaos: control::Chaos::default(),
            server: server::Server::default(),
            shortcuts: shortcuts::Shortcuts::default(),
            sensors: Arc::new(sensors::Sensors::default()),
            widgets: widgets::Widgets::default(),
            tray: Mutex::new(None),
            update: Mutex::new(None),
        }
    }

    #[cfg(test)]
    pub fn for_tests() -> Self {
        Self::new(Arc::new(db::Db::open_in_memory().unwrap()))
    }
}

pub fn state(app: &AppHandle) -> Arc<AppState> {
    app.state::<Arc<AppState>>().inner().clone()
}

fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let db = Arc::new(db::Db::open(&dir.join("desktop-chaos.db"))?);
    let st = Arc::new(AppState::new(db));
    app.manage(st.clone());
    let settings = st.settings.read().unwrap().clone();

    *st.tray.lock().unwrap() = Some(tray::build(app)?);

    let al = app.autolaunch();
    if al.is_enabled().unwrap_or(false) != settings.launch_at_startup {
        let _ = if settings.launch_at_startup { al.enable() } else { al.disable() };
    }

    shortcuts::apply(app);
    server::apply(app);
    sensors::spawn(app.clone(), st.sensors.clone());
    widgets::sync(app);
    widgets::spawn_geometry_flush(app.clone());
    updater::spawn_checks(app.clone());
    spawn_monitor_watch(app.clone());

    let autostarted = std::env::args().any(|a| a == "--autostart");
    if !settings.onboarded || !autostarted {
        windows_util::show_main(app, None);
    }
    Ok(())
}

/// Rebuilds overlays when displays are plugged in, removed or rescaled.
fn spawn_monitor_watch(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            state(&app).overlays.check_layout(&app);
            tokio::time::sleep(Duration::from_secs(4)).await;
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows_util::show_main(app, None);
        }))
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(shortcuts::handler).build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            setup(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            if label == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    let app = window.app_handle();
                    state(app).widgets.screen_watching.store(false, std::sync::atomic::Ordering::Relaxed);
                    widgets::sync(app);
                }
            } else if let Some(id) = widgets::id_from_label(label) {
                if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
                    widgets::note_geometry(window.app_handle(), id);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap,
            commands::update_settings,
            commands::get_monitors,
            commands::fire_effect,
            commands::arm_tool,
            commands::disarm_tool,
            commands::clear_effects,
            commands::stop_everything,
            commands::start_chaos,
            commands::stop_chaos,
            commands::overlay_ready,
            commands::overlay_idle,
            commands::overlay_report,
            commands::server_status,
            commands::regenerate_token,
            commands::widgets_state,
            commands::add_widget,
            commands::update_widget,
            commands::remove_widget,
            commands::widget_bootstrap,
            commands::set_widget_edit_mode,
            commands::watch_sensors,
            commands::latest_snapshot,
            commands::create_profile,
            commands::rename_profile,
            commands::delete_profile,
            commands::export_profile,
            commands::import_profile,
            commands::open_support_link,
            commands::open_data_folder,
            commands::show_main,
            commands::quit_app,
            updater::check_for_update,
            updater::install_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Desktop Chaos")
        .run(|_app, event| {
            // Overlays and widgets come and go; only an explicit Quit exits.
            if let RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
