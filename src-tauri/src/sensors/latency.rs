//! LAN (default gateway) and optional WAN round-trip times. One small ICMP echo every 5 seconds,
//! only while widgets are watching and the probe is switched on. No admin rights needed.

use crate::state;
use std::net::{Ipv4Addr, ToSocketAddrs};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;

#[derive(Default)]
pub struct Latency {
    values: Mutex<(Option<f32>, Option<f32>)>,
}

impl Latency {
    pub fn get(&self) -> (Option<f32>, Option<f32>) {
        *self.values.lock().unwrap()
    }
}

pub(crate) fn gateway() -> Option<Ipv4Addr> {
    netdev::get_default_interface().ok()?.gateway?.ipv4.first().copied()
}

fn resolve(host: &str) -> Option<Ipv4Addr> {
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        return Some(ip);
    }
    (host, 0).to_socket_addrs().ok()?.find_map(|a| match a.ip() {
        std::net::IpAddr::V4(v4) => Some(v4),
        _ => None,
    })
}

pub fn spawn(app: AppHandle, lat: std::sync::Arc<Latency>) {
    std::thread::Builder::new()
        .name("latency".into())
        .spawn(move || loop {
            let st = state(&app);
            let (lan_on, wan_on, host) = {
                let s = st.settings.read().unwrap();
                (s.latency_lan, s.latency_wan, s.latency_wan_host.clone())
            };
            if st.sensors.wanted.load(Ordering::Relaxed) && (lan_on || wan_on) {
                let lan = if lan_on { gateway().and_then(ping) } else { None };
                let wan = if wan_on { resolve(&host).and_then(ping) } else { None };
                *lat.values.lock().unwrap() = (lan, wan);
            } else {
                *lat.values.lock().unwrap() = (None, None);
            }
            std::thread::sleep(Duration::from_secs(5));
        })
        .expect("latency thread");
}

#[cfg(windows)]
pub fn ping(ip: Ipv4Addr) -> Option<f32> {
    use windows::Win32::NetworkManagement::IpHelper::{IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY};
    unsafe {
        let h = IcmpCreateFile().ok()?;
        let data = [0x44u8; 32];
        let mut reply = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + data.len() + 8 + 64];
        let start = std::time::Instant::now();
        let n = IcmpSendEcho(h, u32::from_ne_bytes(ip.octets()), data.as_ptr() as _, data.len() as u16, None, reply.as_mut_ptr() as _, reply.len() as u32, 1000);
        let took = start.elapsed().as_secs_f32() * 1000.0;
        let _ = IcmpCloseHandle(h);
        if n == 0 {
            return None;
        }
        let r = &*(reply.as_ptr() as *const ICMP_ECHO_REPLY);
        if r.Status != 0 {
            return None;
        }
        // RoundTripTime is whole milliseconds; for sub-millisecond LAN hops use our own timing.
        Some(if r.RoundTripTime <= 1 { took.min(1.0) } else { r.RoundTripTime as f32 })
    }
}

#[cfg(target_os = "macos")]
pub fn ping(ip: Ipv4Addr) -> Option<f32> {
    // The system ping tool is unprivileged on macOS.
    let out = std::process::Command::new("/sbin/ping").args(["-c", "1", "-W", "1000", "-n", &ip.to_string()]).output().ok()?;
    parse_ping(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn ping(_ip: Ipv4Addr) -> Option<f32> {
    None
}

#[allow(dead_code)]
pub fn parse_ping(text: &str) -> Option<f32> {
    let i = text.find("time=")?;
    text[i + 5..].split_whitespace().next()?.trim_end_matches("ms").parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ping_output() {
        assert_eq!(parse_ping("64 bytes from 1.1.1.1: icmp_seq=0 ttl=58 time=12.345 ms"), Some(12.345));
        assert_eq!(parse_ping("Request timeout for icmp_seq 0"), None);
    }

    #[test]
    fn resolves_literal_ips() {
        assert_eq!(resolve("1.1.1.1"), Some(Ipv4Addr::new(1, 1, 1, 1)));
    }
}
