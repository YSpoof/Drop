use super::*;

const MISSING: &str = "drop-test-no-such-clipboard-tool";

#[tokio::test]
async fn no_tool_found_is_unavailable() {
    let err = copy_with(&[(MISSING, &[])], "x").await.unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NotFound);
    assert_eq!(err.to_string(), text::ERR_CLIPBOARD_UNAVAILABLE);
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn falls_through_missing_and_failing_tools() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("clip.txt");
    let script = format!("cat > '{}'", out.display());
    let tools: [(&str, &[&str]); 3] = [(MISSING, &[]), ("false", &[]), ("sh", &["-c", &script])];

    copy_with(&tools, "PIN 1234").await.unwrap();
    assert_eq!(std::fs::read_to_string(&out).unwrap(), "PIN 1234");
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn failures_are_reported() {
    let err = copy_with(&[("false", &[])], "x").await.unwrap_err();
    assert!(err.to_string().starts_with("false: "), "{err}");
}
