use super::*;
use crate::state::{Phase, Transfer};

fn written(raw: bool, line: &str) -> String {
    let mut out = Vec::new();
    LineWriter::new(&mut out, raw).line(line);
    String::from_utf8(out).unwrap()
}

fn transfer(direction: Direction, status: TransferStatus) -> Transfer {
    let mut t = Transfer::new("t1", "a.txt", 2048, "h", direction);
    t.status = status;
    t
}

#[test]
fn to_crlf_converts_bare_newlines() {
    assert_eq!(to_crlf("PIN atribuído: 1234\n"), "PIN atribuído: 1234\r\n");
    assert_eq!(to_crlf("a\nb"), "a\r\nb");
}

#[test]
fn to_crlf_keeps_existing_crlf() {
    assert_eq!(to_crlf("já ok\r\n"), "já ok\r\n");
    assert!(matches!(to_crlf("sem quebra"), Cow::Borrowed(_)));
}

#[test]
fn raw_mode_lines_end_in_crlf() {
    let got = written(true, text::PRESS_COPY_HINT);
    assert_eq!(got, format!("{}\r\n", text::PRESS_COPY_HINT));
    assert!(
        !got.replace("\r\n", "").contains('\n'),
        "bare newline in {got:?}"
    );
    assert_eq!(written(true, "a\nb"), "a\r\nb\r\n");
}

#[test]
fn cooked_lines_pass_through() {
    let line = text::assigned_pin("9999");
    assert_eq!(written(false, &line), "PIN atribuído: 9999\n");
    assert!(
        !text::PRESS_COPY_HINT.contains('\n'),
        "catalog lines carry no newline"
    );
}

#[test]
fn status_changes_print_once() {
    let mut printer = Printer::new(false);
    let mut s = SessionState {
        status: text::assigned_pin("1234"),
        ..SessionState::default()
    };
    assert_eq!(printer.lines(&s), [text::assigned_pin("1234")]);
    assert!(printer.lines(&s).is_empty());
    s.phase = Phase::Connected;
    assert!(printer.lines(&s).is_empty());
    s.status = text::CONNECTED_WAITING_FILES.into();
    assert_eq!(printer.lines(&s), [text::CONNECTED_WAITING_FILES]);
}

#[test]
fn copy_hint_follows_the_host_pin_once() {
    let mut s = SessionState {
        host: true,
        ..SessionState::default()
    };
    let mut printer = Printer::new(true);
    assert!(printer.lines(&s).is_empty());
    s.pin = Some("1234".into());
    s.status = text::assigned_pin("1234");
    assert_eq!(
        printer.lines(&s),
        [text::assigned_pin("1234"), text::PRESS_COPY_HINT.into()]
    );
    assert!(printer.lines(&s).is_empty());

    let mut off_tty = Printer::new(false);
    assert_eq!(off_tty.lines(&s), [text::assigned_pin("1234")]);
}

#[test]
fn sends_print_start_and_completion() {
    let mut printer = Printer::new(false);
    let mut s = SessionState {
        transfers: vec![transfer(Direction::Upload, TransferStatus::Pending)],
        ..SessionState::default()
    };
    assert!(printer.lines(&s).is_empty());
    s.transfers[0].status = TransferStatus::Active;
    assert_eq!(printer.lines(&s), [text::transferring_file("a.txt")]);
    assert!(printer.lines(&s).is_empty());
    s.transfers[0].status = TransferStatus::Completed;
    assert_eq!(printer.lines(&s), [text::transfer_complete("a.txt")]);
}

#[test]
fn receives_print_the_saved_name_and_size() {
    let mut printer = Printer::new(false);
    let mut t = transfer(Direction::Download, TransferStatus::Active);
    let mut s = SessionState {
        transfers: vec![t.clone()],
        ..SessionState::default()
    };
    assert!(printer.lines(&s).is_empty());
    t.status = TransferStatus::Completed;
    t.saved_as = Some("a (1).txt".into());
    s.transfers = vec![t];
    assert_eq!(
        printer.lines(&s),
        [text::received_file("a (1).txt", "2.0 KiB")]
    );
}

#[test]
fn failures_print_the_reason() {
    let mut printer = Printer::new(false);
    let mut t = transfer(Direction::Download, TransferStatus::Failed);
    t.reason = Some(text::PEER_LOST.into());
    let s = SessionState {
        transfers: vec![t],
        ..SessionState::default()
    };
    assert_eq!(
        printer.lines(&s),
        [text::transfer_failed("a.txt", Some(text::PEER_LOST))]
    );
}
