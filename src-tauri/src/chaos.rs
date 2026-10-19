//! Chaos Mode: presets and the scheduler that turns a preset into a stream of effects.
//! The scheduler is pure (seeded RNG, explicit clock) so it is tested without windows.

use crate::fx::{is_effect, FxTrigger, EFFECTS};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ChaosConfig {
    pub preset: String,
    pub effects: Vec<String>,
    pub duration_secs: u32,
    pub intensity: f64,
    /// Average effects per second across all monitors.
    pub rate: f64,
    pub sound: bool,
    pub countdown: bool,
    /// "fade", "bomb" or "keep".
    pub cleanup: String,
}

impl Default for ChaosConfig {
    fn default() -> Self {
        preset("gamer-rage").unwrap().config
    }
}

impl ChaosConfig {
    pub fn sanitized(mut self) -> Self {
        self.effects.retain(|e| is_effect(e) && e != "bomb");
        self.effects.dedup();
        if self.effects.is_empty() {
            self.effects = vec!["hammer".into(), "paintball".into()];
        }
        self.duration_secs = self.duration_secs.clamp(5, 600);
        self.intensity = if self.intensity.is_finite() { self.intensity.clamp(0.05, 1.0) } else { 0.6 };
        self.rate = if self.rate.is_finite() { self.rate.clamp(0.2, 6.0) } else { 1.0 };
        if !["fade", "bomb", "keep"].contains(&self.cleanup.as_str()) {
            self.cleanup = "fade".into();
        }
        self
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChaosPreset {
    pub id: &'static str,
    pub name: &'static str,
    pub blurb: &'static str,
    pub config: ChaosConfig,
}

fn cfg(id: &str, effects: &[&str], duration: u32, intensity: f64, rate: f64, cleanup: &str) -> ChaosConfig {
    ChaosConfig {
        preset: id.into(),
        effects: effects.iter().map(|s| s.to_string()).collect(),
        duration_secs: duration,
        intensity,
        rate,
        sound: true,
        countdown: true,
        cleanup: cleanup.into(),
    }
}

pub fn presets() -> Vec<ChaosPreset> {
    let all: Vec<&str> = EFFECTS.iter().copied().filter(|e| *e != "bomb").collect();
    vec![
        ChaosPreset {
            id: "mild",
            name: "Mild Chaos",
            blurb: "A few cracks, some paint, a little snow. Office-safe-ish.",
            config: cfg("mild", &["hammer", "paintball", "snow", "gravity", "glass"], 30, 0.35, 0.6, "fade"),
        },
        ChaosPreset {
            id: "gamer-rage",
            name: "Gamer Rage",
            blurb: "That last match was rigged. Hammer, bullets and a laser.",
            config: cfg("gamer-rage", &["hammer", "machinegun", "glass", "paintball", "meteor", "laser", "earthquake"], 45, 0.65, 1.4, "fade"),
        },
        ChaosPreset {
            id: "apocalypse",
            name: "Apocalypse",
            blurb: "Meteors, fire, lightning and a black hole to finish the job.",
            config: cfg("apocalypse", &["meteor", "flamethrower", "lightning", "earthquake", "blackhole", "glass", "machinegun", "water"], 60, 0.85, 2.0, "fade"),
        },
        ChaosPreset {
            id: "total",
            name: "Total Destruction",
            blurb: "Everything at once, then the reset bomb.",
            config: cfg("total", &all, 60, 1.0, 3.0, "bomb"),
        },
        ChaosPreset {
            id: "random",
            name: "Random Madness",
            blurb: "Random weapons, random strength, random timing. Every run is different.",
            config: cfg("random", &all, 45, 0.7, 1.5, "fade"),
        },
    ]
}

pub fn preset(id: &str) -> Option<ChaosPreset> {
    presets().into_iter().find(|p| p.id == id)
}

/// SplitMix64: tiny and deterministic.
#[derive(Debug, Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
    pub fn f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.f64()
    }
    pub fn pick<'a, T>(&mut self, list: &'a [T]) -> &'a T {
        &list[(self.next_u64() % list.len() as u64) as usize]
    }
}

/// Minimum seconds between two of the same heavy effect, so a run stays readable.
fn cooldown(effect: &str) -> f64 {
    match effect {
        "blackhole" => 7.0,
        "monster" => 14.0,
        "earthquake" => 6.0,
        "snow" => 18.0,
        "flamethrower" | "water" | "laser" => 2.5,
        "meteor" => 0.8,
        _ => 0.0,
    }
}

/// How long a continuous effect runs when chaos fires it.
fn duration(effect: &str, rng: &mut Rng) -> Option<f64> {
    match effect {
        "machinegun" => Some(rng.range(1.0, 2.5)),
        "flamethrower" | "water" | "laser" => Some(rng.range(1.5, 3.5)),
        "snow" => Some(rng.range(10.0, 20.0)),
        "earthquake" => Some(rng.range(2.5, 4.5)),
        "blackhole" => Some(rng.range(4.0, 7.0)),
        _ => None,
    }
}

pub struct Scheduler {
    pub cfg: ChaosConfig,
    rng: Rng,
    next_at: f64,
    last: HashMap<String, f64>,
    pub fired: u32,
}

impl Scheduler {
    pub fn new(cfg: ChaosConfig, seed: u64) -> Self {
        let mut rng = Rng::new(seed);
        let mut cfg = cfg.sanitized();
        if cfg.preset == "random" {
            // Random Madness picks its own arsenal and pace each run.
            let mut pool = cfg.effects.clone();
            let keep = 3 + (rng.next_u64() % 6) as usize;
            while pool.len() > keep {
                let i = (rng.next_u64() % pool.len() as u64) as usize;
                pool.remove(i);
            }
            cfg.effects = pool;
            cfg.rate = rng.range(0.6, 3.0);
        }
        Self { cfg, rng, next_at: 0.0, last: HashMap::new(), fired: 0 }
    }

    /// Effects due at `t` seconds into the run, spread over `monitors`.
    pub fn due(&mut self, t: f64, monitors: &[usize], global_intensity: f64) -> Vec<FxTrigger> {
        let mut out = vec![];
        if monitors.is_empty() {
            return out;
        }
        // Ramp up over the first few seconds instead of opening with everything at once.
        let ramp = (t / 6.0).clamp(0.35, 1.0);
        while self.next_at <= t {
            let gap = (1.0 / (self.cfg.rate * ramp)) * self.rng.range(0.5, 1.5);
            self.next_at += gap;
            let candidates: Vec<String> = self
                .cfg
                .effects
                .iter()
                .filter(|e| self.last.get(*e).map(|at| t - at >= cooldown(e)).unwrap_or(true))
                .cloned()
                .collect();
            if candidates.is_empty() {
                continue;
            }
            let effect = self.rng.pick(&candidates).clone();
            self.last.insert(effect.clone(), t);
            let base = if self.cfg.preset == "random" { self.rng.range(0.3, 1.0) } else { self.cfg.intensity };
            let intensity = (base * self.rng.range(0.8, 1.1) * global_intensity.max(0.05)).clamp(0.05, 1.0);
            out.push(FxTrigger {
                monitor: Some(*self.rng.pick(monitors)),
                x: None,
                y: None,
                intensity,
                duration: duration(&effect, &mut self.rng),
                seed: (self.rng.next_u64() & 0xffff_ffff) as u32,
                source: "chaos".into(),
                effect,
            });
            self.fired += 1;
        }
        out
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChaosStatus {
    pub running: bool,
    pub preset: Option<String>,
    pub phase: String,
    pub remaining_secs: f64,
    pub duration_secs: f64,
    pub events_fired: u32,
}

impl Default for ChaosStatus {
    fn default() -> Self {
        Self { running: false, preset: None, phase: "idle".into(), remaining_secs: 0.0, duration_secs: 0.0, events_fired: 0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(cfg: ChaosConfig, secs: f64) -> Vec<(f64, FxTrigger)> {
        let mut s = Scheduler::new(cfg, 42);
        let mut out = vec![];
        let mut t = 0.0;
        while t < secs {
            for e in s.due(t, &[0, 1], 1.0) {
                out.push((t, e));
            }
            t += 0.05;
        }
        out
    }

    #[test]
    fn every_preset_is_valid() {
        for p in presets() {
            assert_eq!(p.config.clone().sanitized(), p.config, "{} changes when sanitized", p.id);
            assert!(!p.config.effects.contains(&"bomb".to_string()), "{} lists the bomb as a regular effect", p.id);
        }
        assert_eq!(presets().len(), 5);
    }

    #[test]
    fn rate_is_roughly_respected() {
        let cfg = preset("apocalypse").unwrap().config; // 2/s
        let events = run(cfg, 60.0);
        // Ramp-up and cooldowns pull it a little below 120.
        assert!(events.len() > 70 && events.len() < 140, "{} events", events.len());
    }

    #[test]
    fn only_configured_effects_and_monitors_are_used() {
        let cfg = preset("mild").unwrap().config;
        for (_, e) in run(cfg.clone(), 30.0) {
            assert!(cfg.effects.contains(&e.effect));
            assert!(matches!(e.monitor, Some(0) | Some(1)));
            assert!(e.intensity > 0.0 && e.intensity <= 1.0);
            assert_eq!(e.source, "chaos");
        }
    }

    #[test]
    fn cooldowns_space_out_heavy_effects() {
        let mut cfg = preset("apocalypse").unwrap().config;
        cfg.effects = vec!["blackhole".into(), "hammer".into()];
        cfg.rate = 6.0;
        let holes: Vec<f64> = run(cfg, 40.0).into_iter().filter(|(_, e)| e.effect == "blackhole").map(|(t, _)| t).collect();
        assert!(holes.len() >= 3);
        for w in holes.windows(2) {
            assert!(w[1] - w[0] >= 7.0 - 1e-9);
        }
    }

    #[test]
    fn same_seed_same_run() {
        let a: Vec<String> = run(preset("random").unwrap().config, 20.0).into_iter().map(|(_, e)| e.effect).collect();
        let b: Vec<String> = run(preset("random").unwrap().config, 20.0).into_iter().map(|(_, e)| e.effect).collect();
        assert_eq!(a, b);
    }

    #[test]
    fn no_monitors_means_nothing_fires() {
        let mut s = Scheduler::new(ChaosConfig::default(), 1);
        assert!(s.due(10.0, &[], 1.0).is_empty());
    }

    #[test]
    fn sanitize_drops_unknown_effects_and_bomb() {
        let mut c = ChaosConfig::default();
        c.effects = vec!["bomb".into(), "nuke".into()];
        c.rate = f64::NAN;
        let c = c.sanitized();
        assert_eq!(c.effects, vec!["hammer", "paintball"]);
        assert_eq!(c.rate, 1.0);
    }
}
