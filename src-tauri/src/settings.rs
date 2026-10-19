use crate::chaos::ChaosConfig;
use crate::db::Db;
use crate::fx::EFFECTS;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DEFAULT_STOP_SHORTCUT: &str = "CommandOrControl+Alt+Backspace";
pub const DEFAULT_ARM_SHORTCUT: &str = "CommandOrControl+Alt+H";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomTheme {
    pub bg: String,
    pub fg: String,
    pub accent: String,
    pub accent2: String,
    pub radius: f64,
    pub font: String,
}

impl Default for CustomTheme {
    fn default() -> Self {
        Self { bg: "#0d0f14".into(), fg: "#e8ecf2".into(), accent: "#ff6a20".into(), accent2: "#22d3ee".into(), radius: 4.0, font: "inter".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub onboarded: bool,
    pub launch_at_startup: bool,
    pub sound: bool,
    pub volume: f64,
    pub reduced_flashing: bool,
    pub quality: String,
    pub particle_budget: u32,
    pub intensity: f64,
    pub desktop_effects: bool,
    pub disabled_monitors: Vec<usize>,
    pub stop_shortcut: String,
    pub arm_shortcut: String,
    pub last_tool: String,
    /// Owned by the UI (src/shared/effects.ts ToolOptions); stored as-is.
    pub tool_options: Value,
    pub chaos: ChaosConfig,
    pub obs_enabled: bool,
    pub api_enabled: bool,
    pub server_port: u16,
    pub obs_mirror_monitor: usize,
    pub obs_mirror_manual: bool,
    pub widgets_locked: bool,
    pub widgets_hidden: bool,
    pub widget_refresh_ms: u32,
    pub widget_theme: String,
    pub custom_theme: CustomTheme,
    pub streamer_safe: bool,
    pub latency_lan: bool,
    pub latency_wan: bool,
    pub latency_wan_host: String,
    pub active_profile: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            onboarded: false,
            launch_at_startup: false,
            sound: true,
            volume: 0.6,
            reduced_flashing: false,
            quality: "auto".into(),
            particle_budget: 3000,
            intensity: 0.8,
            desktop_effects: true,
            disabled_monitors: vec![],
            stop_shortcut: DEFAULT_STOP_SHORTCUT.into(),
            arm_shortcut: DEFAULT_ARM_SHORTCUT.into(),
            last_tool: "hammer".into(),
            tool_options: Value::Object(Default::default()),
            chaos: ChaosConfig::default(),
            obs_enabled: false,
            api_enabled: false,
            server_port: 47474,
            obs_mirror_monitor: 0,
            obs_mirror_manual: true,
            widgets_locked: false,
            widgets_hidden: false,
            widget_refresh_ms: 1000,
            widget_theme: "gaming".into(),
            custom_theme: CustomTheme::default(),
            streamer_safe: false,
            latency_lan: true,
            latency_wan: false,
            latency_wan_host: "1.1.1.1".into(),
            active_profile: 1,
        }
    }
}

const QUALITIES: &[&str] = &["auto", "low", "medium", "high"];
const THEMES: &[&str] = &["gaming", "dark", "white", "cyberpunk", "rgb", "professional", "custom"];

impl Settings {
    pub fn load(db: &Db) -> Self {
        db.get("settings").and_then(|s| serde_json::from_str::<Settings>(&s).ok()).unwrap_or_default().sanitized()
    }

    pub fn save(&self, db: &Db) -> rusqlite::Result<()> {
        db.set("settings", &serde_json::to_string(self).expect("settings serialize"))
    }

    /// Clamps everything a hand-edited database or a bad patch could break.
    pub fn sanitized(mut self) -> Self {
        let d = Settings::default();
        self.volume = clamp(self.volume, 0.0, 1.0, d.volume);
        self.intensity = clamp(self.intensity, 0.05, 1.0, d.intensity);
        self.particle_budget = self.particle_budget.clamp(300, 6000);
        if !QUALITIES.contains(&self.quality.as_str()) {
            self.quality = d.quality;
        }
        if !EFFECTS.contains(&self.last_tool.as_str()) {
            self.last_tool = d.last_tool;
        }
        if self.server_port < 1024 {
            self.server_port = d.server_port;
        }
        self.widget_refresh_ms = self.widget_refresh_ms.clamp(250, 10_000);
        if !THEMES.contains(&self.widget_theme.as_str()) {
            self.widget_theme = d.widget_theme;
        }
        if !self.tool_options.is_object() {
            self.tool_options = d.tool_options;
        }
        self.custom_theme.radius = clamp(self.custom_theme.radius, 0.0, 24.0, 4.0);
        if !valid_host(&self.latency_wan_host) {
            self.latency_wan_host = d.latency_wan_host;
        }
        self.chaos = self.chaos.sanitized();
        self
    }

    /// Applies a camelCase JSON patch (from the UI) and returns the new, sanitized settings.
    pub fn patched(&self, patch: &Value) -> Result<Settings, String> {
        let mut base = serde_json::to_value(self).map_err(|e| e.to_string())?;
        merge(&mut base, patch);
        let s: Settings = serde_json::from_value(base).map_err(|e| format!("Invalid settings: {e}"))?;
        Ok(s.sanitized())
    }
}

fn clamp(v: f64, lo: f64, hi: f64, fallback: f64) -> f64 {
    if v.is_finite() {
        v.clamp(lo, hi)
    } else {
        fallback
    }
}

/// Hostname or IP for the WAN latency probe: letters, digits, dots, dashes, colons only.
pub fn valid_host(h: &str) -> bool {
    !h.is_empty() && h.len() <= 253 && h.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'))
}

/// Shallow-recursive merge of `patch` into `base` (objects merge, everything else replaces).
fn merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(b), Value::Object(p)) => {
            for (k, v) in p {
                if k == "toolOptions" {
                    // Tool options are replaced as a unit so removed keys stay removed.
                    b.insert(k.clone(), v.clone());
                    continue;
                }
                merge(b.entry(k.clone()).or_insert(Value::Null), v);
            }
        }
        (b, p) => *b = p.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trips_through_the_database() {
        let db = Db::open_in_memory().unwrap();
        let mut s = Settings::default();
        s.volume = 0.3;
        s.save(&db).unwrap();
        assert_eq!(Settings::load(&db).volume, 0.3);
    }

    #[test]
    fn patches_are_merged_and_clamped() {
        let s = Settings::default();
        let p = s.patched(&json!({ "volume": 7, "intensity": -1, "quality": "ultra", "chaos": { "durationSecs": 99999 } })).unwrap();
        assert_eq!(p.volume, 1.0);
        assert_eq!(p.intensity, 0.05);
        assert_eq!(p.quality, "auto");
        assert!(p.chaos.duration_secs <= 600);
        // Untouched fields survive.
        assert_eq!(p.stop_shortcut, DEFAULT_STOP_SHORTCUT);
    }

    #[test]
    fn rejects_wrong_types() {
        assert!(Settings::default().patched(&json!({ "volume": "loud" })).is_err());
    }

    #[test]
    fn bad_wan_hosts_fall_back() {
        let p = Settings::default().patched(&json!({ "latencyWanHost": "evil.com; rm -rf" })).unwrap();
        assert_eq!(p.latency_wan_host, "1.1.1.1");
        assert!(valid_host("one.one.one.one"));
        assert!(valid_host("2606:4700::1111"));
    }

    #[test]
    fn unknown_fields_in_old_databases_are_ignored() {
        let db = Db::open_in_memory().unwrap();
        db.set("settings", r#"{"volume":0.2,"somethingOld":true}"#).unwrap();
        assert_eq!(Settings::load(&db).volume, 0.2);
    }
}
