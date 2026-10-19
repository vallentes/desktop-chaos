use tauri::{AppHandle, Emitter, Manager};

/// Must match `additionalBrowserArgs` of the main window in tauri.conf.json (WebView2 shares one
/// environment between windows). Lets overlays play sounds without a click first.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

pub fn show_main(app: &AppHandle, section: Option<&str>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if let Some(s) = section {
            let _ = app.emit_to("main", "ui://navigate", s);
        }
    }
}
