use super::*;

fn paths(dir: &tempfile::TempDir) -> (String, String) {
    let from = dir.path().join("a.drop");
    let to = dir.path().join("sub").join("a.txt");
    (lossy(&from), lossy(&to))
}

#[tokio::test]
async fn rename_moves_file_and_creates_parent() {
    let dir = tempfile::tempdir().unwrap();
    let (from, to) = paths(&dir);
    std::fs::write(&from, b"payload").unwrap();

    rename(&from, &to).await.unwrap();

    assert!(!Path::new(&from).exists());
    assert_eq!(std::fs::read(&to).unwrap(), b"payload");
}

#[tokio::test]
async fn rename_never_replaces_an_existing_target() {
    let dir = tempfile::tempdir().unwrap();
    let (from, to) = paths(&dir);
    std::fs::write(&from, b"new").unwrap();
    std::fs::create_dir_all(Path::new(&to).parent().unwrap()).unwrap();
    std::fs::write(&to, b"old").unwrap();

    let err = rename(&from, &to).await.unwrap_err();

    assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
    assert_eq!(err.to_string(), TARGET_EXISTS);
    assert_eq!(std::fs::read(&to).unwrap(), b"old");
    assert_eq!(std::fs::read(&from).unwrap(), b"new");
}

#[tokio::test]
async fn copy_new_refuses_an_existing_target() {
    let dir = tempfile::tempdir().unwrap();
    let (from, to) = paths(&dir);
    std::fs::write(&from, b"new").unwrap();
    std::fs::create_dir_all(Path::new(&to).parent().unwrap()).unwrap();
    std::fs::write(&to, b"old").unwrap();

    let err = copy_new(&from, &to).await.unwrap_err();

    assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
    assert_eq!(std::fs::read(&to).unwrap(), b"old");
}
