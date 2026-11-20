use super::*;
use tokio::io::AsyncWriteExt;

async fn write_partial(dir: &Path, hash: &str, data: &[u8]) {
    fs::write(dir.join(drop_name(hash)), data).await.unwrap();
}

#[test]
fn drop_name_replaces_windows_invalid_characters() {
    assert_eq!(drop_name("a/b|1|2"), "a_b_1_2.drop");
    assert_eq!(drop_name(r#"<>:"\?*"#), "_______.drop");
}

#[tokio::test]
async fn finalize_nested_path_creates_parents() {
    let dest = tempfile::tempdir().unwrap();
    write_partial(dest.path(), "abc123nested", b"payload").await;

    let chosen = finalize(dest.path(), "abc123nested", "photos/nested/a.jpg")
        .await
        .unwrap();

    assert_eq!(chosen, "photos/nested/a.jpg");
    let final_path = dest.path().join("photos").join("nested").join("a.jpg");
    assert_eq!(fs::read(final_path).await.unwrap(), b"payload");
    assert!(
        !fs::try_exists(dest.path().join(drop_name("abc123nested")))
            .await
            .unwrap()
    );
}

#[test]
fn sanitize_rejects_traversal() {
    for name in ["photos/../evil.jpg", "../outside.jpg", r"a\..\b"] {
        let err = sanitize_relative_path(name).unwrap_err();
        assert!(
            err.to_string().contains("invalid download path"),
            "{name}: {err}"
        );
    }
}

#[test]
fn sanitize_strips_absolute_and_empty_segments() {
    assert_eq!(sanitize_relative_path("/etc/passwd").unwrap(), "etc/passwd");
    assert_eq!(
        sanitize_relative_path(r"\\srv\.\a\\b.txt").unwrap(),
        "srv/a/b.txt"
    );
    assert_eq!(sanitize_relative_path("/./").unwrap(), "download");
}

#[cfg(windows)]
#[test]
fn sanitize_rejects_drive_prefix() {
    assert!(sanitize_relative_path("C:/Windows/x.dll").is_err());
    assert!(sanitize_relative_path("dir/D:x").is_err());
}

#[tokio::test]
async fn finalize_picks_go_style_names_on_collision() {
    let dest = tempfile::tempdir().unwrap();
    fs::write(dest.path().join("a.txt"), b"old").await.unwrap();
    fs::write(dest.path().join("a (1).txt"), b"old")
        .await
        .unwrap();
    fs::write(dest.path().join(".bashrc"), b"old")
        .await
        .unwrap();

    write_partial(dest.path(), "h1", b"new").await;
    assert_eq!(
        finalize(dest.path(), "h1", "a.txt").await.unwrap(),
        "a (2).txt"
    );
    write_partial(dest.path(), "h2", b"new").await;
    assert_eq!(
        finalize(dest.path(), "h2", ".bashrc").await.unwrap(),
        ".bashrc (1)"
    );
    assert_eq!(
        fs::read(dest.path().join("a (2).txt")).await.unwrap(),
        b"new"
    );
}

#[tokio::test]
async fn finalize_requires_hash_and_partial() {
    let dest = tempfile::tempdir().unwrap();
    assert!(finalize(dest.path(), "", "a.txt").await.is_err());
    assert!(finalize(dest.path(), "missing", "a.txt").await.is_err());
    assert!(!fs::try_exists(dest.path().join("a.txt")).await.unwrap());
}

#[tokio::test]
async fn resume_offset_only_for_a_strictly_partial_file() {
    let dest = tempfile::tempdir().unwrap();
    assert_eq!(resume_offset(dest.path(), "h", 10).await.unwrap(), 0);
    write_partial(dest.path(), "h", b"12345").await;
    assert_eq!(resume_offset(dest.path(), "h", 10).await.unwrap(), 5);
    assert_eq!(resume_offset(dest.path(), "h", 5).await.unwrap(), 0);
    assert_eq!(resume_offset(dest.path(), "", 10).await.unwrap(), 0);
    write_partial(dest.path(), "h", b"").await;
    assert_eq!(resume_offset(dest.path(), "h", 10).await.unwrap(), 0);
}

#[tokio::test]
async fn open_truncates_to_offset_and_appends() {
    let dest = tempfile::tempdir().unwrap();
    let dir = dest.path().join("new");
    write_partial(dest.path(), "h", b"ignored").await;

    let mut file = open(&dir, "h", 0).await.unwrap();
    file.write_all(b"abcdef").await.unwrap();
    file.flush().await.unwrap();
    drop(file);

    let mut file = open(&dir, "h", 3).await.unwrap();
    file.write_all(b"XY").await.unwrap();
    file.flush().await.unwrap();
    drop(file);
    assert_eq!(fs::read(dir.join(drop_name("h"))).await.unwrap(), b"abcXY");

    drop(open(&dir, "h", 0).await.unwrap());
    assert_eq!(fs::read(dir.join(drop_name("h"))).await.unwrap(), b"");
    assert!(open(&dir, "", 0).await.is_err());
}

#[tokio::test]
async fn discard_removes_one_or_all_partials() {
    let dest = tempfile::tempdir().unwrap();
    write_partial(dest.path(), "a", b"1").await;
    write_partial(dest.path(), "b", b"2").await;
    fs::write(dest.path().join("keep.txt"), b"k").await.unwrap();
    fs::create_dir(dest.path().join("dir.drop")).await.unwrap();

    discard(dest.path(), "a").await;
    discard(dest.path(), "a").await;
    assert!(
        !fs::try_exists(dest.path().join(drop_name("a")))
            .await
            .unwrap()
    );
    assert!(
        fs::try_exists(dest.path().join(drop_name("b")))
            .await
            .unwrap()
    );

    discard_all(dest.path()).await.unwrap();
    assert!(
        !fs::try_exists(dest.path().join(drop_name("b")))
            .await
            .unwrap()
    );
    assert!(fs::try_exists(dest.path().join("keep.txt")).await.unwrap());
    assert!(fs::try_exists(dest.path().join("dir.drop")).await.unwrap());
    discard_all(&dest.path().join("missing")).await.unwrap();
}
