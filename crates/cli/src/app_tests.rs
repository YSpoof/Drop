use std::path::PathBuf;

use tempfile::TempDir;

use super::*;

fn parsed(args: &[&str]) -> (Result<Launch, ExitCode>, String, String) {
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let args = std::iter::once("dropcli")
        .chain(args.iter().copied())
        .map(OsString::from);
    let result = parse(args, &mut out, &mut err);
    let text = |bytes| String::from_utf8(bytes).unwrap();
    (result, text(out), text(err))
}

fn reported(result: Result<(), Error>) -> (ExitCode, String) {
    let mut err = Vec::new();
    let code = report(result, &mut err);
    (code, String::from_utf8(err).unwrap())
}

#[test]
fn main_help_prints_usage_and_exits_0() {
    let (result, out, err) = parsed(&["--help"]);
    assert_eq!(result.err(), Some(ExitCode::SUCCESS));
    assert!(out.contains(text::USAGE));
    assert!(err.is_empty());
}

#[test]
fn main_rejects_short_flags_with_usage() {
    let (result, out, err) = parsed(&["-q"]);
    assert_eq!(result.err(), Some(ExitCode::FAILURE));
    assert!(out.is_empty());
    assert!(err.starts_with(text::ERR_PREFIX), "{err}");
    assert!(err.contains(text::USAGE));
}

#[test]
fn main_rejects_an_invalid_pin_without_usage() {
    let (result, _, err) = parsed(&["--code", "12a4"]);
    assert_eq!(result.err(), Some(ExitCode::FAILURE));
    assert_eq!(
        err,
        format!("{} {}\n", text::ERR_PREFIX, text::invalid_pin())
    );
}

#[test]
fn main_accepts_role_flags() {
    let (result, _, _) = parsed(&["--quick", "--code", "1234"]);
    let launch = result.unwrap();
    assert!(launch.quick);
    assert_eq!(launch.role, Some(Role::Join("1234".into())));
}

#[test]
fn main_cancel_is_a_silent_success() {
    let (code, err) = reported(Ok(()));
    assert_eq!(code, ExitCode::SUCCESS);
    assert!(err.is_empty());
}

#[test]
fn main_real_errors_print_erro_and_exit_1() {
    let (code, err) = reported(Err(Error::Session(session::Error::SignalingClosed)));
    assert_eq!(code, ExitCode::FAILURE);
    assert_eq!(
        err,
        format!("{} {}\n", text::ERR_PREFIX, text::ERR_SIGNALING_CLOSED)
    );
}

#[test]
fn errors_render_in_pt_br() {
    let io = || io::Error::other("x");
    assert_eq!(Error::Terminal(io()).to_string(), text::err_tui("x"));
    assert_eq!(Error::Config(io()).to_string(), text::err_load_config("x"));
    assert_eq!(
        Error::Donation(io()).to_string(),
        text::err_dismiss_donation("x")
    );
    assert_eq!(Error::NotATerminal.to_string(), text::ERR_NOT_A_TERMINAL);
}

#[test]
fn options_follow_launch_and_store() {
    let dir = TempDir::new().unwrap();
    let mut store = Store::load(dir.path().join(".dropConfig"));
    store.set_device_name("Mesa").unwrap();
    let out = dir.path().join("out");
    let launch = Launch {
        out: Some(out.clone()),
        files: vec![PathBuf::from("a.txt")],
        dirs: vec![PathBuf::from("inbox")],
        ..Launch::default()
    };
    let opts = options(&launch, Role::Host, &store, true);
    assert_eq!(opts.role, Role::Host);
    assert!(opts.manual);
    assert_eq!(opts.download_dir, out);
    assert_eq!(opts.device.display_name, "Mesa");
    assert_eq!(opts.files, launch.files);
    assert_eq!(opts.dirs, launch.dirs);
    assert!(!options(&launch, Role::Host, &store, false).manual);
}

#[test]
fn options_without_out_use_the_persisted_folder() {
    let dir = TempDir::new().unwrap();
    let mut store = Store::load(dir.path().join(".dropConfig"));
    store.set_download_dir(Some(dir.path())).unwrap();
    let opts = options(&Launch::default(), Role::Join("1234".into()), &store, true);
    assert_eq!(opts.download_dir, dir.path());
}
