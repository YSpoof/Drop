use super::*;

fn offer(id: &str, name: &str) -> Offer {
    Offer {
        file_id: id.into(),
        name: name.into(),
        size: 1,
    }
}

fn nested() -> Vec<Offer> {
    vec![
        offer("a", "photos/a.jpg"),
        offer("b", "photos/nested/b.jpg"),
        offer("c", "readme.txt"),
    ]
}

fn summary(rows: &[Row]) -> Vec<String> {
    rows.iter()
        .map(|row| match row {
            Row::Up => "..".to_string(),
            Row::Folder { name, .. } => format!("folder:{name}"),
            Row::File { name, .. } => format!("file:{name}"),
        })
        .collect()
}

fn cwd(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| s.to_string()).collect()
}

#[test]
fn nested_offers_show_as_folders_at_the_root() {
    let rows = rows(&nested(), &[]);
    assert_eq!(summary(&rows), ["folder:photos", "file:readme.txt"]);
    assert_eq!(
        rows[0],
        Row::Folder {
            name: "photos".into(),
            path: "photos".into(),
        }
    );
}

#[test]
fn a_folder_lists_dotdot_folders_then_files() {
    let rows = rows(&nested(), &cwd(&["photos"]));
    assert_eq!(summary(&rows), ["..", "folder:nested", "file:a.jpg"]);
    assert_eq!(
        rows[1],
        Row::Folder {
            name: "nested".into(),
            path: "photos/nested".into(),
        }
    );
}

#[test]
fn flat_offers_are_sorted_files() {
    let offers = [offer("2", "z.txt"), offer("1", "solo.bin")];
    assert_eq!(
        summary(&rows(&offers, &[])),
        ["file:solo.bin", "file:z.txt"]
    );
}

#[test]
fn a_folder_hides_a_file_of_the_same_name() {
    let offers = [offer("1", "docs"), offer("2", "docs/a.txt")];
    assert_eq!(summary(&rows(&offers, &[])), ["folder:docs"]);
}

#[test]
fn backslashes_and_stray_slashes_are_normalized() {
    assert_eq!(normalize("\\photos\\a.jpg/"), "photos/a.jpg");
    assert_eq!(segments("a//./b"), ["a", "b"]);
    let offers = [offer("1", "photos\\a.jpg")];
    assert_eq!(summary(&rows(&offers, &[])), ["folder:photos"]);
}

#[test]
fn under_matches_whole_segments() {
    assert!(under("photos/a.jpg", "photos"));
    assert!(under("photos", "photos"));
    assert!(!under("photos2/a.jpg", "photos"));
    assert!(under("x", ""));
    assert!(!under("", ""));
}

#[test]
fn descendants_cover_every_depth() {
    assert_eq!(descendants(&nested(), "photos"), ["a", "b"]);
    assert_eq!(descendants(&nested(), "photos/nested"), ["b"]);
    assert_eq!(descendants(&nested(), ""), ["a", "b", "c"]);
    assert!(descendants(&nested(), "missing").is_empty());
}
