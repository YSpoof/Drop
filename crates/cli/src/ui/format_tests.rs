use super::*;

const KIB: u64 = 1024;

#[test]
fn bytes_below_one_kib_are_plain() {
    assert_eq!(format_bytes(0), "0 B");
    assert_eq!(format_bytes(1023), "1023 B");
}

#[test]
fn bytes_use_binary_units_with_one_decimal() {
    assert_eq!(format_bytes(KIB), "1.0 KiB");
    assert_eq!(format_bytes(1536), "1.5 KiB");
    assert_eq!(format_bytes(KIB.pow(2)), "1.0 MiB");
    assert_eq!(format_bytes(5 * KIB.pow(3) / 2), "2.5 GiB");
}

#[test]
fn bytes_are_safe_at_one_tib_and_above() {
    assert_eq!(format_bytes(KIB.pow(4)), "1.0 TiB");
    assert_eq!(format_bytes(3 * KIB.pow(4)), "3.0 TiB");
    assert_eq!(format_bytes(KIB.pow(5)), "1.0 PiB");
    assert_eq!(format_bytes(KIB.pow(6)), "1.0 EiB");
    assert_eq!(format_bytes(u64::MAX), "16.0 EiB");
}

#[test]
fn width_ignores_escapes_and_counts_wide_chars() {
    assert_eq!(width("abc"), 3);
    assert_eq!(width("日本"), 4);
    assert_eq!(width("\x1b[31mhi\x1b[0m"), 2);
    assert_eq!(width("e\u{301}"), 1);
}

#[test]
fn truncate_keeps_fitting_text() {
    assert_eq!(truncate("hello", 5), "hello");
    assert_eq!(truncate("", 0), "");
}

#[test]
fn truncate_adds_ellipsis_within_width() {
    assert_eq!(truncate("hello world", 5), "hell…");
    assert_eq!(truncate("hello", 1), "…");
    assert_eq!(truncate("hello", 0), "");
}

#[test]
fn truncate_never_splits_wide_chars() {
    let cut = truncate("日本語テキスト", 4);
    assert_eq!(cut, "日…");
    assert!(width(&cut) <= 4);
    assert_eq!(truncate("日本語テキスト", 5), "日本…");
}

#[test]
fn truncate_keeps_combining_marks_with_their_base() {
    assert_eq!(truncate("e\u{301}e\u{301}e\u{301}", 2), "e\u{301}…");
}

#[test]
fn truncate_never_cuts_escape_sequences() {
    assert_eq!(truncate("\x1b[31mhello\x1b[0m", 3), "\x1b[31mhe…\x1b[0m");
    let link = "\x1b]8;;https://x\x07name\x1b]8;;\x1b\\";
    assert_eq!(truncate(link, 3), "\x1b]8;;https://x\x07na…\x1b]8;;\x1b\\");
}

#[test]
fn truncate_keeps_unterminated_escape_whole() {
    assert_eq!(truncate("abcd\x1b[31", 3), "ab…\x1b[31");
}
