//! Drop backend: serves the frontend, client downloads, and the signaling WebSocket.

mod assets;
mod health;
mod hub;

use std::future::IntoFuture;
use std::io;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::{State, WebSocketUpgrade};
use axum::response::Response;
use axum::routing::get;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::hub::Hub;

const SHUTDOWN_LIMIT: Duration = Duration::from_secs(5);

#[tokio::main]
async fn main() -> io::Result<()> {
    let port = std::env::var("PORT").ok().filter(|port| !port.is_empty());
    let port = port.unwrap_or_else(|| "4321".to_owned());
    // Dual-stack when IPv6 is available, else IPv4 only.
    let listener = match TcpListener::bind(format!("[::]:{port}")).await {
        Ok(listener) => listener,
        Err(_) => TcpListener::bind(format!("0.0.0.0:{port}")).await?,
    };
    eprintln!("backend listening on :{port} (sha={})", health::SHA);

    let (stop, stopped) = oneshot::channel::<()>();
    let server = axum::serve(listener, router()).with_graceful_shutdown(async {
        let _ = stopped.await;
    });
    let mut server = std::pin::pin!(server.into_future());
    tokio::select! {
        result = &mut server => return result,
        () = shutdown_signal() => {}
    }
    let _ = stop.send(());
    let _ = tokio::time::timeout(SHUTDOWN_LIMIT, server).await;
    Ok(())
}

fn router() -> Router {
    Router::new()
        .route("/health", get(health::handler))
        .route("/ws", get(ws))
        .fallback(assets::handler)
        .method_not_allowed_fallback(assets::method_not_allowed)
        .with_state(Arc::new(Hub::default()))
}

/// Accepts the upgrade from any origin.
async fn ws(State(hub): State<Arc<Hub>>, upgrade: WebSocketUpgrade) -> Response {
    upgrade.on_upgrade(move |socket| hub::run(hub, socket))
}

async fn shutdown_signal() {
    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{SignalKind, signal};
        match signal(SignalKind::terminate()) {
            Ok(mut terminate) => {
                terminate.recv().await;
            }
            Err(_) => std::future::pending().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        () = terminate => {}
    }
}
