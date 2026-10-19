//! Streamer control API: command parsing, validation and dispatch. Transport lives in server.rs.

use crate::chaos::{preset, ChaosConfig};
use crate::fx::{is_effect, random_u32, FxTrigger, EFFECTS};
use crate::{control, state};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "cmd", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    TriggerEffect {
        effect: String,
        #[serde(default)]
        monitor: Option<usize>,
        #[serde(default)]
        x: Option<f64>,
        #[serde(default)]
        y: Option<f64>,
        #[serde(default)]
        intensity: Option<f64>,
        #[serde(default)]
        duration: Option<f64>,
    },
    ClearEffects {
        #[serde(default)]
        fade: Option<bool>,
    },
    StartChaos {
        #[serde(default)]
        preset: Option<String>,
        #[serde(default)]
        duration: Option<u32>,
        #[serde(default)]
        intensity: Option<f64>,
        #[serde(default)]
        effects: Option<Vec<String>>,
    },
    StopChaos {},
    SetIntensity {
        value: f64,
    },
    GetStatus {},
}

/// `{"id": 1, "cmd": "...", ...}`. The id is echoed back so clients can match replies.
pub fn parse(text: &str) -> Result<(Value, Command), String> {
    let mut v: Value = serde_json::from_str(text).map_err(|e| format!("Not valid JSON: {e}"))?;
    let id = v.as_object_mut().and_then(|o| o.remove("id")).unwrap_or(Value::Null);
    let cmd = serde_json::from_value::<Command>(v).map_err(|e| format!("Bad command: {e}"))?;
    Ok((id, cmd))
}

pub fn build_trigger(effect: &str, monitor: Option<usize>, x: Option<f64>, y: Option<f64>, intensity: Option<f64>, duration: Option<f64>, default_intensity: f64) -> Result<FxTrigger, String> {
    if !is_effect(effect) {
        return Err(format!("Unknown effect '{effect}'. Known: {}", EFFECTS.join(", ")));
    }
    for (name, v) in [("x", x), ("y", y), ("intensity", intensity)] {
        if let Some(v) = v {
            if !v.is_finite() || !(0.0..=1.0).contains(&v) {
                return Err(format!("{name} must be between 0 and 1"));
            }
        }
    }
    if let Some(d) = duration {
        if !d.is_finite() || !(0.2..=120.0).contains(&d) {
            return Err("duration must be between 0.2 and 120 seconds".into());
        }
    }
    Ok(FxTrigger { effect: effect.into(), monitor, x, y, intensity: intensity.unwrap_or(default_intensity), duration, seed: random_u32(), source: "api".into() })
}

pub fn chaos_config(base: &ChaosConfig, preset_id: Option<&str>, duration: Option<u32>, intensity: Option<f64>, effects: Option<Vec<String>>) -> Result<ChaosConfig, String> {
    let mut cfg = match preset_id {
        Some(id) => preset(id).ok_or_else(|| format!("Unknown preset '{id}'. Known: mild, gamer-rage, apocalypse, total, random"))?.config,
        None => base.clone(),
    };
    if let Some(d) = duration {
        cfg.duration_secs = d;
    }
    if let Some(i) = intensity {
        if !i.is_finite() || !(0.0..=1.0).contains(&i) {
            return Err("intensity must be between 0 and 1".into());
        }
        cfg.intensity = i;
    }
    if let Some(list) = effects {
        if let Some(bad) = list.iter().find(|e| !is_effect(e)) {
            return Err(format!("Unknown effect '{bad}'"));
        }
        cfg.preset = "custom".into();
        cfg.effects = list;
    }
    Ok(cfg.sanitized())
}

pub fn dispatch(app: &AppHandle, cmd: Command) -> Result<Value, String> {
    let st = state(app);
    match cmd {
        Command::TriggerEffect { effect, monitor, x, y, intensity, duration } => {
            let default = st.settings.read().unwrap().intensity;
            control::trigger(app, build_trigger(&effect, monitor, x, y, intensity, duration, default)?)?;
            Ok(json!({ "triggered": effect }))
        }
        Command::ClearEffects { fade } => {
            control::clear(app, fade.unwrap_or(false));
            Ok(json!({ "cleared": true }))
        }
        Command::StartChaos { preset, duration, intensity, effects } => {
            let base = st.settings.read().unwrap().chaos.clone();
            let cfg = chaos_config(&base, preset.as_deref(), duration, intensity, effects)?;
            Ok(serde_json::to_value(control::start_chaos(app, cfg)?).unwrap())
        }
        Command::StopChaos {} => {
            control::stop_chaos(app, true);
            Ok(json!({ "stopped": true }))
        }
        Command::SetIntensity { value } => Ok(json!({ "intensity": control::set_intensity(app, value)? })),
        Command::GetStatus {} => Ok(status(app)),
    }
}

pub fn status(app: &AppHandle) -> Value {
    let st = state(app);
    let s = st.settings.read().unwrap();
    json!({
        "app": "Desktop Chaos",
        "version": app.package_info().version.to_string(),
        "chaos": control::chaos_status(app),
        "armed": st.fx.armed(),
        "intensity": s.intensity,
        "desktopEffects": s.desktop_effects,
        "effects": EFFECTS,
        "presets": crate::chaos::presets().iter().map(|p| p.id).collect::<Vec<_>>(),
        "monitors": crate::overlay::enabled_monitors(app),
    })
}

/// Constant-time comparison so the token cannot be guessed byte by byte from timing.
pub fn token_matches(given: &str, expected: &str) -> bool {
    let a = given.as_bytes();
    let b = expected.as_bytes();
    if a.len() != b.len() || b.is_empty() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn new_token() -> String {
    let mut b = [0u8; 24];
    getrandom::getrandom(&mut b).expect("system random");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Simple token bucket: `rate` commands per second, bursts up to `burst`.
pub struct Bucket {
    tokens: f64,
    rate: f64,
    burst: f64,
    last: std::time::Instant,
}

impl Bucket {
    pub fn new(rate: f64, burst: f64) -> Self {
        Self { tokens: burst, rate, burst, last: std::time::Instant::now() }
    }
    pub fn take(&mut self) -> bool {
        let now = std::time::Instant::now();
        self.tokens = (self.tokens + now.duration_since(self.last).as_secs_f64() * self.rate).min(self.burst);
        self.last = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_command() {
        let (id, c) = parse(r#"{"id":7,"cmd":"trigger_effect","effect":"meteor","x":0.5,"y":0.25}"#).unwrap();
        assert_eq!(id, json!(7));
        assert!(matches!(c, Command::TriggerEffect { ref effect, x: Some(_), .. } if effect == "meteor"));
        assert_eq!(parse(r#"{"cmd":"clear_effects"}"#).unwrap().1, Command::ClearEffects { fade: None });
        assert!(matches!(parse(r#"{"cmd":"start_chaos","preset":"apocalypse"}"#).unwrap().1, Command::StartChaos { .. }));
        assert_eq!(parse(r#"{"cmd":"stop_chaos"}"#).unwrap().1, Command::StopChaos {});
        assert_eq!(parse(r#"{"cmd":"set_intensity","value":0.4}"#).unwrap().1, Command::SetIntensity { value: 0.4 });
        assert_eq!(parse(r#"{"cmd":"get_status"}"#).unwrap().1, Command::GetStatus {});
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse("nope").is_err());
        assert!(parse(r#"{"cmd":"format_c_drive"}"#).is_err());
        assert!(parse(r#"{"cmd":"stop_chaos","extra":1}"#).is_err());
        assert!(parse(r#"{"cmd":"set_intensity"}"#).is_err());
    }

    #[test]
    fn validates_triggers() {
        assert!(build_trigger("meteor", None, Some(0.5), Some(0.5), Some(1.0), None, 0.7).is_ok());
        assert!(build_trigger("nuke", None, None, None, None, None, 0.7).is_err());
        assert!(build_trigger("meteor", None, Some(1.5), None, None, None, 0.7).is_err());
        assert!(build_trigger("meteor", None, None, None, Some(f64::NAN), None, 0.7).is_err());
        assert!(build_trigger("snow", None, None, None, None, Some(9999.0), 0.7).is_err());
        let t = build_trigger("hammer", Some(1), None, None, None, None, 0.3).unwrap();
        assert_eq!(t.intensity, 0.3);
        assert_eq!(t.source, "api");
    }

    #[test]
    fn chaos_overrides() {
        let base = ChaosConfig::default();
        let c = chaos_config(&base, Some("mild"), Some(20), Some(0.9), None).unwrap();
        assert_eq!((c.preset.as_str(), c.duration_secs, c.intensity), ("mild", 20, 0.9));
        assert!(chaos_config(&base, Some("nope"), None, None, None).is_err());
        assert!(chaos_config(&base, None, None, None, Some(vec!["laser".into(), "zzz".into()])).is_err());
        let c = chaos_config(&base, None, None, None, Some(vec!["laser".into()])).unwrap();
        assert_eq!(c.effects, vec!["laser"]);
    }

    #[test]
    fn token_comparison() {
        let t = new_token();
        assert_eq!(t.len(), 48);
        assert!(token_matches(&t, &t));
        assert!(!token_matches("", ""));
        assert!(!token_matches(&t[..47], &t));
        assert!(!token_matches(&"0".repeat(48), &t));
        assert_ne!(new_token(), t);
    }

    #[test]
    fn bucket_limits_bursts() {
        let mut b = Bucket::new(1.0, 3.0);
        assert!(b.take() && b.take() && b.take());
        assert!(!b.take());
    }
}
