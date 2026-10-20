//! Global shortcuts: the emergency stop (always) and "arm last tool".

use crate::{control, state};
use std::str::FromStr;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

#[derive(Default)]
pub struct Shortcuts {
    stop: Mutex<Option<Shortcut>>,
    arm: Mutex<Option<Shortcut>>,
    pub errors: Mutex<Vec<String>>,
}

/// Combinations Windows or macOS keep for themselves; they would never reach us.
const RESERVED: &[&str] = &["control+shift+escape", "control+alt+delete", "super+l", "command+q", "command+tab", "alt+tab", "alt+f4"];

pub fn validate(s: &str) -> Result<Shortcut, String> {
    let lower = s.to_lowercase().replace("ctrl", "control").replace("commandorcontrol", "control").replace("cmdorctrl", "control").replace("cmd", "command");
    if RESERVED.iter().any(|r| *r == lower) {
        return Err(format!("{s} is reserved by the operating system. Pick another combination."));
    }
    let sc = Shortcut::from_str(s).map_err(|e| format!("'{s}' is not a valid shortcut: {e}"))?;
    if sc.mods.is_empty() {
        return Err(format!("{s} needs at least one modifier key (Ctrl, Alt, Shift or Cmd)."));
    }
    Ok(sc)
}

pub fn handler(app: &AppHandle, sc: &Shortcut, ev: ShortcutEvent) {
    if ev.state != ShortcutState::Pressed {
        return;
    }
    let st = state(app);
    let stop = st.shortcuts.stop.lock().unwrap().as_ref() == Some(sc);
    let arm = st.shortcuts.arm.lock().unwrap().as_ref() == Some(sc);
    // Off the main thread: both actions talk to overlay windows, which wait on it.
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if stop {
            control::stop_everything(&app);
        } else if arm {
            control::toggle_arm(&app);
        }
    });
}

/// (Re)registers both shortcuts from the settings. Errors are kept for the Settings screen.
pub fn apply(app: &AppHandle) {
    let st = state(app);
    let (stop, arm) = {
        let s = st.settings.read().unwrap();
        (s.stop_shortcut.clone(), s.arm_shortcut.clone())
    };
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut errors = vec![];
    let mut reg = |text: &str, slot: &Mutex<Option<Shortcut>>, what: &str| {
        *slot.lock().unwrap() = None;
        if text.trim().is_empty() {
            return;
        }
        match validate(text) {
            Ok(sc) => match gs.register(sc) {
                Ok(()) => *slot.lock().unwrap() = Some(sc),
                Err(e) => errors.push(format!("{what} shortcut {text} could not be registered (another app may use it): {e}")),
            },
            Err(e) => errors.push(e),
        }
    };
    reg(&stop, &st.shortcuts.stop, "Emergency stop");
    reg(&arm, &st.shortcuts.arm, "Arm tool");
    if !errors.is_empty() {
        log::warn!("{}", errors.join("; "));
    }
    *st.shortcuts.errors.lock().unwrap() = errors;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcuts_are_valid() {
        assert!(validate(crate::settings::DEFAULT_STOP_SHORTCUT).is_ok());
        assert!(validate(crate::settings::DEFAULT_ARM_SHORTCUT).is_ok());
    }

    #[test]
    fn rejects_reserved_and_bare_keys() {
        assert!(validate("Ctrl+Shift+Escape").is_err());
        assert!(validate("Alt+F4").is_err());
        assert!(validate("F12").is_err());
        assert!(validate("Ctrl+Shift+NotAKey").is_err());
        assert!(validate("Ctrl+Shift+F12").is_ok());
    }
}
