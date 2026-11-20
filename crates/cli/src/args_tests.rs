use std::path::PathBuf;

use super::*;

fn run(args: &[&str]) -> Result<Launch, ArgsError> {
    parse(std::iter::once("dropcli").chain(args.iter().copied()))
}

fn is_usage(result: Result<Launch, ArgsError>) -> bool {
    matches!(result, Err(ArgsError::Usage(_)))
}

/// A temp dir holding `a.txt`, `b.txt` and the directory `inbox`.
fn fixture() -> (tempfile::TempDir, String, String, String) {
    let tmp = tempfile::tempdir().unwrap();
    let path = |name: &str| tmp.path().join(name).to_string_lossy().into_owned();
    let (a, b, inbox) = (path("a.txt"), path("b.txt"), path("inbox"));
    std::fs::write(&a, "x").unwrap();
    std::fs::write(&b, "y").unwrap();
    std::fs::create_dir(&inbox).unwrap();
    (tmp, a, b, inbox)
}

#[test]
fn help_returns_help() {
    assert_eq!(run(&["--help"]), Err(ArgsError::Help));
    assert_eq!(run(&["--quick", "--help"]), Err(ArgsError::Help));
}

#[test]
fn usage_is_pt_br_with_long_flags() {
    assert!(text::USAGE.contains("Uso do dropcli"));
    assert!(text::USAGE.contains("dropcli --quick --host"));
    assert!(text::USAGE.contains("--code <pin>"));
    assert!(text::USAGE.contains("--out"));
}

#[test]
fn no_args_is_interactive_without_role() {
    assert_eq!(run(&[]), Ok(Launch::default()));
}

#[test]
fn quick_host() {
    let launch = run(&["--quick", "--host"]).unwrap();
    assert!(launch.quick);
    assert_eq!(launch.role, Some(Role::Host));
}

#[test]
fn quick_code() {
    let launch = run(&["--quick", "--code", "1234"]).unwrap();
    assert!(launch.quick);
    assert_eq!(launch.role, Some(Role::Join("1234".into())));
    assert_eq!(
        run(&["--code=0624"]).unwrap().role,
        Some(Role::Join("0624".into()))
    );
}

#[test]
fn out_dir() {
    let launch = run(&["--quick", "--host", "--out", "/tmp/downloads"]).unwrap();
    assert_eq!(launch.out, Some(PathBuf::from("/tmp/downloads")));
}

#[test]
fn positionals_are_classified_in_order() {
    let (_tmp, a, b, inbox) = fixture();
    let launch = run(&["--quick", "--host", &a, &inbox, &b]).unwrap();
    assert_eq!(launch.files, [PathBuf::from(&a), PathBuf::from(&b)]);
    assert_eq!(launch.dirs, [PathBuf::from(&inbox)]);
}

#[test]
fn flags_after_and_between_paths() {
    let (_tmp, a, b, _) = fixture();
    let launch = run(&["--quick", "--host", &a, "--out", "/tmp/out"]).unwrap();
    assert_eq!(launch.files, [PathBuf::from(&a)]);
    assert_eq!(launch.out, Some(PathBuf::from("/tmp/out")));

    let launch = run(&[&a, "--code", "1234", &b, "--quick"]).unwrap();
    assert!(launch.quick);
    assert_eq!(launch.role, Some(Role::Join("1234".into())));
    assert_eq!(launch.files, [PathBuf::from(&a), PathBuf::from(&b)]);
}

#[test]
fn single_dash_flags_rejected() {
    let cases: [&[&str]; 7] = [
        &["-q", "--host"],
        &["--quick", "-s"],
        &["-c", "1234"],
        &["--host", "-o", "dir"],
        &["-h"],
        &["-help"],
        &["-quick", "--host"],
    ];
    for args in cases {
        assert!(is_usage(run(args)), "expected usage error for {args:?}");
    }
}

#[test]
fn removed_and_unknown_flags_rejected() {
    let cases: [&[&str]; 7] = [
        &["--quick", "--host", "-f", "x"],
        &["--quick", "--host", "-d", "/tmp"],
        &["--quick", "--host", "-url", "wss://x"],
        &["--quick", "--host", "-name", "n"],
        &["--connect", "1234"],
        &["--output", "/tmp"],
        &["--url", "wss://x"],
    ];
    for args in cases {
        assert!(is_usage(run(args)), "expected usage error for {args:?}");
    }
}

#[test]
fn unknown_flag_error_names_the_flag() {
    assert_eq!(run(&["-q"]), Err(ArgsError::Usage(text::invalid_arg("-q"))));
}

#[test]
fn code_without_value_rejected() {
    assert!(is_usage(run(&["--code"])));
}

#[test]
fn quick_requires_role() {
    let err = run(&["--quick"]).unwrap_err();
    assert_eq!(err, ArgsError::Usage(text::ERR_QUICK_NEEDS_ROLE.into()));
    assert!(text::ERR_QUICK_NEEDS_ROLE.contains("--host"));
    assert!(text::ERR_QUICK_NEEDS_ROLE.contains("--code"));
}

#[test]
fn host_and_code_conflict() {
    assert!(is_usage(run(&["--quick", "--host", "--code", "1234"])));
    assert!(is_usage(run(&["--host", "--code", "1234"])));
}

#[test]
fn invalid_pins_rejected() {
    for pin in ["123", "12345", "abcd", "", "12 4", "١٢٣٤"] {
        let result = run(&["--quick", "--code", pin]);
        assert_eq!(
            result,
            Err(ArgsError::Invalid(text::invalid_pin())),
            "pin {pin:?}"
        );
    }
}

#[test]
fn interactive_role_flags_parse() {
    assert_eq!(run(&["--host"]).unwrap().role, Some(Role::Host));
    assert!(!run(&["--code", "1234"]).unwrap().quick);
}

#[test]
fn missing_path_rejected() {
    let result = run(&["--quick", "--host", "/no/such/path-dropcli-test"]);
    assert!(
        matches!(result, Err(ArgsError::Invalid(msg)) if msg.starts_with("caminho não existe"))
    );
}

#[cfg(target_os = "linux")]
#[test]
fn unsupported_path_rejected() {
    let result = run(&["--quick", "--host", "/dev/null"]);
    assert_eq!(
        result,
        Err(ArgsError::Invalid(text::path_unsupported("/dev/null")))
    );
}
