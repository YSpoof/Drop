use std::ffi::OsString;

use super::*;

fn touch(path: &Path) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, b"").unwrap();
}

#[test]
fn arguments_run_app_mode_with_profile_and_fixed_size() {
    let url = "https://drop.lzart.com.br/?dropPort=54321&dropToken=secret";
    let args = arguments(url, Path::new("/tmp/test-profile"));

    assert_eq!(args[0], format!("--app={url}"));
    assert!(args.contains(&"--user-data-dir=/tmp/test-profile".to_string()));
    assert!(args.contains(&"--window-size=1024,768".to_string()));
    assert!(args.contains(&"--disable-features=LocalNetworkAccessChecks".to_string()));
}

#[test]
fn profile_dir_is_created_private() {
    let config = tempfile::tempdir().unwrap();
    let dir = profile_dir(config.path()).unwrap();

    assert_eq!(dir, config.path().join("Drop").join("Chrome"));
    assert!(dir.is_dir());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode();
        assert_eq!(mode & 0o077, 0, "profile directory too broad: {mode:o}");
    }
}

#[test]
fn find_on_this_system_returns_a_path_or_names_searched_paths() {
    match find(&candidates()) {
        Ok(path) => assert!(path.is_file()),
        Err(err) => assert!(err.contains("searched:"), "{err}"),
    }
}

#[test]
fn linux_lookup_follows_fixed_order() {
    let root = tempfile::tempdir().unwrap();
    let list = linux_candidates(root.path());
    let names: Vec<_> = list
        .iter()
        .map(|p| p.strip_prefix(root.path()).unwrap())
        .collect();
    let expected: Vec<_> = LINUX
        .iter()
        .map(|p| Path::new(p.trim_start_matches('/')))
        .collect();
    assert_eq!(names, expected);

    touch(&list[6]);
    assert_eq!(find(&list).unwrap(), list[6]);
    touch(&list[4]);
    assert_eq!(find(&list).unwrap(), list[4]);
    touch(&list[0]);
    assert_eq!(find(&list).unwrap(), list[0]);
}

#[test]
fn lookup_ignores_directories() {
    let root = tempfile::tempdir().unwrap();
    let list = linux_candidates(root.path());
    std::fs::create_dir_all(&list[0]).unwrap();
    touch(&list[2]);
    assert_eq!(find(&list).unwrap(), list[2]);
}

#[test]
fn lookup_without_browser_names_every_searched_path() {
    let root = tempfile::tempdir().unwrap();
    let list = linux_candidates(root.path());
    let err = find(&list).unwrap_err();
    for path in &list {
        assert!(err.contains(&path.display().to_string()), "{err}");
    }
}

#[test]
fn windows_lookup_prefers_chrome_then_chromium_then_edge() {
    let root = tempfile::tempdir().unwrap();
    let dir = |name: &str| root.path().join(name);
    let var = |key: &str| -> Option<OsString> {
        match key {
            "ProgramFiles" => Some(dir("pf").into()),
            "ProgramFiles(x86)" => Some(dir("pf86").into()),
            "LocalAppData" => Some(dir("local").into()),
            _ => None,
        }
    };
    let path = |base: &str, tail: &str| tail.split('/').fold(dir(base), |p, part| p.join(part));
    let list = windows_candidates(var);
    assert_eq!(
        list,
        [
            path("pf", "Google/Chrome/Application/chrome.exe"),
            path("pf86", "Google/Chrome/Application/chrome.exe"),
            path("local", "Google/Chrome/Application/chrome.exe"),
            path("pf", "Chromium/Application/chrome.exe"),
            path("pf86", "Chromium/Application/chrome.exe"),
            path("local", "Chromium/Application/chrome.exe"),
            path("pf86", "Microsoft/Edge/Application/msedge.exe"),
            path("pf", "Microsoft/Edge/Application/msedge.exe"),
        ]
    );

    touch(&list[7]);
    assert_eq!(find(&list).unwrap(), list[7]);
    touch(&list[3]);
    assert_eq!(find(&list).unwrap(), list[3]);
    touch(&list[2]);
    assert_eq!(find(&list).unwrap(), list[2]);
}

#[test]
fn windows_lookup_skips_unset_roots() {
    let list = windows_candidates(|key| (key == "ProgramFiles").then(|| OsString::from("C:")));
    assert_eq!(list.len(), 3);
    assert!(list[2].ends_with("msedge.exe"));
}
