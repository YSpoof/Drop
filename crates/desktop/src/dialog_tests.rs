use serde_json::json;

use super::*;

#[test]
fn default_titles_apply_when_missing_or_empty() {
    assert_eq!(
        Options::from_params(Value::Null).title(FILES_TITLE),
        "Select Files"
    );
    assert_eq!(
        Options::from_params(json!({ "title": "" })).title(FOLDER_TITLE),
        "Select Folder"
    );
}

#[test]
fn given_title_and_default_path_are_kept() {
    let options =
        Options::from_params(json!({ "title": "Escolher pasta", "defaultPath": "/home/user" }));
    assert_eq!(options.title(FOLDER_TITLE), "Escolher pasta");
    assert_eq!(options.default_path.as_deref(), Some("/home/user"));
}

#[test]
fn malformed_params_fall_back_to_defaults() {
    assert_eq!(
        Options::from_params(json!({ "title": 5 })),
        Options::default()
    );
    assert_eq!(
        Options::from_params(json!({ "defaultPath": null })),
        Options::default()
    );
}

#[test]
fn picked_paths_pass_through() {
    let files = vec![
        PathBuf::from("/home/user/file1.png"),
        PathBuf::from("/home/user/file2.txt"),
    ];
    assert_eq!(
        file_paths(Some(files)),
        ["/home/user/file1.png", "/home/user/file2.txt"]
    );
    assert_eq!(
        folder_path(Some(PathBuf::from("/home/user/Downloads"))),
        "/home/user/Downloads"
    );
}

#[test]
fn cancel_returns_empty_values() {
    assert!(file_paths(None).is_empty());
    assert_eq!(folder_path(None), "");
}
