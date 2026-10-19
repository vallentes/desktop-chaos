//! Local server for streamers. Bound to 127.0.0.1 only, Host header checked (blocks DNS
//! rebinding), off unless the OBS overlay or the control API is switched on.
//!
//!  GET  /obs              OBS browser source page (no token: it only displays)
//!  GET  /api/events       Server-Sent Events feed the OBS page listens to
//!  GET  /api/obs-config   settings the OBS page needs
//!  GET  /api/ws?token=..  WebSocket control API (token required, API switch must be on)
//!  POST /api/command      same commands over HTTP, `Authorization: Bearer <token>`

use crate::api::{self, Bucket};
use crate::fx::FxEvent;
use crate::overlay::overlay_config;
use crate::{state, AppState};
use axum::{
    extract::{
        ws::{rejection::WebSocketUpgradeRejection, Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Path, Query, Request, State,
    },
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Redirect, Response,
    },
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{convert::Infallible, sync::Arc, sync::Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tokio_stream::wrappers::BroadcastStream;

const DEV_ORIGIN: &str = "http://localhost:1430";

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
    pub obs_url: String,
    pub api_url: String,
    pub token: String,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct Server {
    running: Mutex<Option<(u16, oneshot::Sender<()>)>>,
    error: Mutex<Option<String>>,
}

#[derive(Clone)]
pub struct Ctx {
    pub app: Option<AppHandle>,
    pub st: Arc<AppState>,
    pub port: u16,
}

pub fn token(st: &AppState) -> String {
    if let Some(t) = st.db.get("api_token").filter(|t| t.len() >= 32) {
        return t;
    }
    let t = api::new_token();
    let _ = st.db.set("api_token", &t);
    t
}

pub fn regenerate_token(st: &AppState) -> String {
    let t = api::new_token();
    let _ = st.db.set("api_token", &t);
    t
}

pub fn status(app: &AppHandle) -> ServerStatus {
    let st = state(app);
    let port = st.settings.read().unwrap().server_port;
    let running = st.server.running.lock().unwrap().as_ref().map(|r| r.0);
    let p = running.unwrap_or(port);
    let error = st.server.error.lock().unwrap().clone();
    let s = ServerStatus {
        running: running.is_some(),
        port: p,
        obs_url: format!("http://127.0.0.1:{p}/obs"),
        api_url: format!("ws://127.0.0.1:{p}/api/ws"),
        token: token(&st),
        error,
    };
    s
}

impl Server {
    fn stop(&self) {
        if let Some((_, tx)) = self.running.lock().unwrap().take() {
            let _ = tx.send(());
        }
    }
}

/// Starts, restarts or stops the server to match the settings.
pub fn apply(app: &AppHandle) {
    let st = state(app);
    let (wanted, port) = {
        let s = st.settings.read().unwrap();
        (s.obs_enabled || s.api_enabled, s.server_port)
    };
    let current = st.server.running.lock().unwrap().as_ref().map(|r| r.0);
    if wanted && current == Some(port) {
        emit_status(app);
        return;
    }
    st.server.stop();
    *st.server.error.lock().unwrap() = None;
    if !wanted {
        emit_status(app);
        return;
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let st = state(&app2);
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => {
                let (tx, rx) = oneshot::channel();
                *st.server.running.lock().unwrap() = Some((port, tx));
                emit_status(&app2);
                log::info!("streamer server on 127.0.0.1:{port}");
                let ctx = Ctx { app: Some(app2.clone()), st: st.clone(), port };
                let r = axum::serve(listener, router(ctx))
                    .with_graceful_shutdown(async {
                        rx.await.ok();
                    })
                    .await;
                if let Err(e) = r {
                    log::error!("streamer server stopped: {e}");
                }
            }
            Err(e) => {
                *st.server.error.lock().unwrap() = Some(format!("Port {port} is in use or blocked ({e}). Pick another port."));
                emit_status(&app2);
            }
        }
    });
}

fn emit_status(app: &AppHandle) {
    let _ = app.emit("server://status", status(app));
}

pub fn router(ctx: Ctx) -> Router {
    Router::new()
        .route("/", get(|| async { Redirect::to("/obs") }))
        .route("/obs", get(page))
        .route("/assets/*path", get(asset))
        .route("/api/obs-config", get(obs_config))
        .route("/api/events", get(events))
        .route("/api/ws", get(ws))
        .route("/api/command", post(command))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(middleware::from_fn_with_state(ctx.clone(), guard))
        .with_state(ctx)
}

/// Rejects requests whose Host is not our loopback address and adds safe headers.
async fn guard(State(ctx): State<Ctx>, req: Request, next: Next) -> Response {
    let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or_default();
    let ok = [format!("127.0.0.1:{}", ctx.port), format!("localhost:{}", ctx.port)];
    if !ok.iter().any(|h| h == host) {
        return (StatusCode::FORBIDDEN, "forbidden host").into_response();
    }
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    if cfg!(debug_assertions) {
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static(DEV_ORIGIN));
    }
    res
}

fn obs_on(ctx: &Ctx) -> bool {
    ctx.st.settings.read().unwrap().obs_enabled
}

fn api_on(ctx: &Ctx) -> bool {
    ctx.st.settings.read().unwrap().api_enabled
}

fn serve_asset(ctx: &Ctx, path: &str) -> Response {
    let Some(app) = &ctx.app else { return (StatusCode::NOT_FOUND, "not found").into_response() };
    match app.asset_resolver().get(path.to_string()) {
        Some(a) => {
            let mime = HeaderValue::from_str(a.mime_type()).unwrap_or(HeaderValue::from_static("application/octet-stream"));
            ([(header::CONTENT_TYPE, mime)], a.bytes().to_vec()).into_response()
        }
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

async fn page(State(ctx): State<Ctx>) -> Response {
    if !obs_on(&ctx) {
        return (StatusCode::NOT_FOUND, "The OBS overlay is switched off in Desktop Chaos > Streamer.").into_response();
    }
    if cfg!(debug_assertions) {
        return Redirect::temporary(&format!("{DEV_ORIGIN}/overlay.html?obs=1&api=http://127.0.0.1:{}", ctx.port)).into_response();
    }
    serve_asset(&ctx, "overlay.html")
}

async fn asset(State(ctx): State<Ctx>, Path(path): Path<String>) -> Response {
    if path.contains("..") {
        return (StatusCode::BAD_REQUEST, "bad path").into_response();
    }
    serve_asset(&ctx, &format!("assets/{path}"))
}

async fn obs_config(State(ctx): State<Ctx>) -> Response {
    let Some(app) = &ctx.app else { return StatusCode::NOT_FOUND.into_response() };
    let mirror = ctx.st.settings.read().unwrap().obs_mirror_monitor;
    Json(json!({ "config": overlay_config(app), "armed": null, "mirror": mirror })).into_response()
}

async fn events(State(ctx): State<Ctx>) -> Response {
    if !obs_on(&ctx) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let stream = BroadcastStream::new(ctx.st.fx.bus.subscribe()).filter_map(|m| async move {
        match m {
            Ok(ev @ (FxEvent::Trigger { .. } | FxEvent::Clear { .. } | FxEvent::Countdown { .. } | FxEvent::Config { .. })) => {
                Event::default().event("fx").json_data(ev).ok().map(Ok::<_, Infallible>)
            }
            _ => None,
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

#[derive(Deserialize)]
struct WsQuery {
    token: Option<String>,
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    headers.get(header::AUTHORIZATION)?.to_str().ok()?.strip_prefix("Bearer ").map(|s| s.trim().to_string())
}

fn authorized(ctx: &Ctx, given: Option<String>) -> Result<(), Response> {
    if !api_on(ctx) {
        return Err((StatusCode::NOT_FOUND, "The control API is switched off in Desktop Chaos > Streamer.").into_response());
    }
    match given {
        Some(t) if api::token_matches(&t, &token(&ctx.st)) => Ok(()),
        _ => Err((StatusCode::UNAUTHORIZED, "missing or wrong token").into_response()),
    }
}

async fn ws(State(ctx): State<Ctx>, Query(q): Query<WsQuery>, headers: HeaderMap, up: Result<WebSocketUpgrade, WebSocketUpgradeRejection>) -> Response {
    // Check the token before anything else, so a bad client learns nothing more.
    if let Err(r) = authorized(&ctx, q.token.or_else(|| bearer(&headers))) {
        return r;
    }
    let up = match up {
        Ok(u) => u,
        Err(e) => return e.into_response(),
    };
    up.max_message_size(16 * 1024).on_upgrade(move |socket| ws_session(socket, ctx))
}

async fn ws_session(mut socket: WebSocket, ctx: Ctx) {
    let mut bucket = Bucket::new(20.0, 40.0);
    let _ = socket.send(Message::Text(json!({ "type": "hello", "app": "Desktop Chaos" }).to_string())).await;
    while let Some(Ok(msg)) = socket.recv().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };
        // The API can be switched off while a client is connected.
        if !api_on(&ctx) {
            let _ = socket.send(Message::Text(json!({ "ok": false, "error": "The control API was switched off" }).to_string())).await;
            break;
        }
        let reply = if !bucket.take() {
            json!({ "ok": false, "error": "Too many commands, slow down" })
        } else {
            match api::parse(&text) {
                Ok((id, cmd)) => run(&ctx, cmd).map_or_else(|e| json!({ "id": id, "ok": false, "error": e }), |r| json!({ "id": id, "ok": true, "result": r })),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        };
        if socket.send(Message::Text(reply.to_string())).await.is_err() {
            break;
        }
    }
}

fn run(ctx: &Ctx, cmd: api::Command) -> Result<serde_json::Value, String> {
    let app = ctx.app.as_ref().ok_or("app not running")?;
    api::dispatch(app, cmd)
}

static HTTP_BUCKET: Mutex<Option<Bucket>> = Mutex::new(None);

async fn command(State(ctx): State<Ctx>, headers: HeaderMap, body: String) -> Response {
    if let Err(r) = authorized(&ctx, bearer(&headers)) {
        return r;
    }
    let allowed = HTTP_BUCKET.lock().unwrap().get_or_insert_with(|| Bucket::new(20.0, 40.0)).take();
    if !allowed {
        return (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "ok": false, "error": "Too many commands, slow down" }))).into_response();
    }
    match api::parse(&body) {
        Ok((id, cmd)) => match run(&ctx, cmd) {
            Ok(r) => Json(json!({ "id": id, "ok": true, "result": r })).into_response(),
            Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "id": id, "ok": false, "error": e }))).into_response(),
        },
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "ok": false, "error": e }))).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use tower::ServiceExt;

    fn ctx(obs: bool, api_on: bool) -> Ctx {
        let st = Arc::new(AppState::for_tests());
        {
            let mut s = st.settings.write().unwrap();
            s.obs_enabled = obs;
            s.api_enabled = api_on;
        }
        Ctx { app: None, st, port: 47474 }
    }

    async fn call(c: Ctx, req: axum::http::Request<Body>) -> StatusCode {
        router(c).oneshot(req).await.unwrap().status()
    }

    fn req(method: &str, uri: &str, host: &str) -> axum::http::request::Builder {
        axum::http::Request::builder().method(method).uri(uri).header("host", host)
    }

    #[tokio::test]
    async fn foreign_hosts_are_refused() {
        let s = call(ctx(true, true), req("GET", "/obs", "evil.example:47474").body(Body::empty()).unwrap()).await;
        assert_eq!(s, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn command_needs_the_api_switch_and_the_token() {
        let body = r#"{"cmd":"get_status"}"#;
        let off = call(ctx(true, false), req("POST", "/api/command", "127.0.0.1:47474").header("authorization", "Bearer x").body(Body::from(body)).unwrap()).await;
        assert_eq!(off, StatusCode::NOT_FOUND);
        let c = ctx(false, true);
        let wrong = call(c.clone(), req("POST", "/api/command", "127.0.0.1:47474").header("authorization", "Bearer nope").body(Body::from(body)).unwrap()).await;
        assert_eq!(wrong, StatusCode::UNAUTHORIZED);
        let none = call(c.clone(), req("POST", "/api/command", "localhost:47474").body(Body::from(body)).unwrap()).await;
        assert_eq!(none, StatusCode::UNAUTHORIZED);
        // Right token: authorized, but there is no running app in tests, so dispatch reports an error.
        let t = token(&c.st);
        let ok = call(c, req("POST", "/api/command", "127.0.0.1:47474").header("authorization", format!("Bearer {t}")).body(Body::from(body)).unwrap()).await;
        assert_eq!(ok, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn ws_refuses_without_token() {
        let c = ctx(false, true);
        let s = call(
            c,
            req("GET", "/api/ws", "127.0.0.1:47474")
                .header("connection", "upgrade")
                .header("upgrade", "websocket")
                .header("sec-websocket-version", "13")
                .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn obs_routes_follow_the_obs_switch() {
        assert_eq!(call(ctx(false, true), req("GET", "/obs", "127.0.0.1:47474").body(Body::empty()).unwrap()).await, StatusCode::NOT_FOUND);
        assert_eq!(call(ctx(false, true), req("GET", "/api/events", "127.0.0.1:47474").body(Body::empty()).unwrap()).await, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn oversized_bodies_are_refused() {
        let c = ctx(false, true);
        let t = token(&c.st);
        let big = format!(r#"{{"cmd":"get_status","pad":"{}"}}"#, "x".repeat(40_000));
        let s = call(c, req("POST", "/api/command", "127.0.0.1:47474").header("authorization", format!("Bearer {t}")).body(Body::from(big)).unwrap()).await;
        assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[test]
    fn token_is_stable_until_regenerated() {
        let st = AppState::for_tests();
        let a = token(&st);
        assert_eq!(a, token(&st));
        let b = regenerate_token(&st);
        assert_ne!(a, b);
        assert_eq!(b, token(&st));
    }
}
