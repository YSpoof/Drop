//! DropCli: terminal peer-to-peer file transfer compatible with Drop web and desktop.

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
compile_error!("dropcli supports only Linux and Windows");

pub mod app;
pub mod args;
pub mod clipboard;
pub mod config;
pub mod device;
pub mod protocol;
pub mod rtc;
pub mod session;
pub mod share;
pub mod signaling;
pub mod state;
pub mod text;
pub mod transfer;
pub mod ui;
