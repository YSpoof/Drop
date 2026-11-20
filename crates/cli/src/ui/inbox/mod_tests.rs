use crossterm::event::KeyCode;

use super::*;
use crate::state::{Offer, RemotePeer, Shared};
use crate::ui::confirm::Confirm;
use crate::ui::testing::{ctrl_c, key, render_text, shift};
use crate::ui::{Exit, Step, dispatch};

/// An inbox over a live state, with the command channel's receiving end.
pub(super) struct Fixture {
    pub state: Shared,
    pub commands: mpsc::Receiver<Command>,
    pub inbox: Inbox,
}

impl Fixture {
    pub fn new(state: SessionState) -> Self {
        let state = Shared::new(state);
        let (tx, commands) = mpsc::channel(16);
        let inbox = Inbox::new(state.subscribe(), tx);
        Self {
            state,
            commands,
            inbox,
        }
    }

    pub fn press(&mut self, code: KeyCode) -> Outcome<()> {
        self.inbox.handle_key(key(code))
    }

    pub fn typed(&mut self, keys: &str) {
        for c in keys.chars() {
            assert_eq!(self.press(KeyCode::Char(c)), Outcome::Continue);
        }
    }

    pub fn sent(&mut self) -> Vec<Command> {
        std::iter::from_fn(|| self.commands.try_recv().ok()).collect()
    }

    pub fn render(&self, width: u16, height: u16) -> String {
        render_text(width, height, |frame| {
            self.inbox.render(frame, frame.area())
        })
    }
}

pub(super) fn offer(id: &str, name: &str, size: u64) -> Offer {
    Offer {
        file_id: id.into(),
        name: name.into(),
        size,
    }
}

/// `photos/a.jpg` (a), `photos/nested/b.jpg` (b), `readme.txt` (c).
pub(super) fn nested() -> SessionState {
    SessionState {
        phase: Phase::Connected,
        offers: vec![
            offer("a", "photos/a.jpg", 10),
            offer("b", "photos/nested/b.jpg", 20),
            offer("c", "readme.txt", 5),
        ],
        ..SessionState::default()
    }
}

fn host() -> SessionState {
    SessionState {
        host: true,
        pin: Some("4242".into()),
        peer_id: "peer-1".into(),
        signaling_url: "wss://drop.lzart.com.br/ws".into(),
        ..nested()
    }
}

fn sorted(command: &Command) -> Vec<String> {
    let (Command::Pull(ids) | Command::Dismiss(ids)) = command else {
        panic!("unexpected {command:?}");
    };
    let mut ids = ids.clone();
    ids.sort();
    ids
}

#[test]
fn enter_opens_folders_and_never_downloads() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Enter);
    assert_eq!(f.inbox.cwd, ["photos"]);
    // `..`, `nested/`, `a.jpg`: Enter on the file changes nothing.
    f.inbox.cursor = 2;
    f.press(KeyCode::Enter);
    assert_eq!(f.inbox.cwd, ["photos"]);
    assert!(f.sent().is_empty());
}

#[test]
fn enter_on_dotdot_goes_up() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Enter);
    f.press(KeyCode::Enter);
    assert!(f.inbox.cwd.is_empty());
}

#[test]
fn esc_goes_up_and_is_a_no_op_at_the_root() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Enter);
    assert_eq!(f.press(KeyCode::Esc), Outcome::Continue);
    assert!(f.inbox.cwd.is_empty());
    assert_eq!(f.press(KeyCode::Esc), Outcome::Continue);
    assert!(f.inbox.cwd.is_empty());
}

#[test]
fn d_pulls_every_file_under_the_cursor_folder() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Char('d'));
    let sent = f.sent();
    assert!(matches!(sent[..], [Command::Pull(_)]), "{sent:?}");
    assert_eq!(sorted(&sent[0]), ["a", "b"]);
    assert_eq!(f.inbox.status, text::downloading_named("photos/"));
}

#[test]
fn space_selects_folder_descendants_and_r_dismisses_them() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Char(' '));
    assert!(f.inbox.selected.contains("a") && f.inbox.selected.contains("b"));
    assert!(!f.inbox.selected.contains("c"));
    f.inbox.cursor = 1;
    f.press(KeyCode::Char('r'));
    let sent = f.sent();
    assert!(matches!(sent[..], [Command::Dismiss(_)]), "{sent:?}");
    assert_eq!(sorted(&sent[0]), ["a", "b"]);
    assert_eq!(f.inbox.status, text::removed_named(text::n_files(2)));
    assert!(f.inbox.selected.is_empty());
}

#[test]
fn x_dismisses_the_cursor_file() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Down);
    f.press(KeyCode::Char('x'));
    assert_eq!(f.sent(), [Command::Dismiss(vec!["c".into()])]);
    assert_eq!(f.inbox.status, text::removed_named("readme.txt"));
}

#[test]
fn pulled_offers_leave_the_list_at_once() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Down);
    f.press(KeyCode::Char('d'));
    assert_eq!(tree::rows(&f.inbox.view.offers, &[]).len(), 1);
    assert_eq!(f.inbox.cursor, 0);
}

#[test]
fn space_on_dotdot_changes_nothing() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Enter);
    f.press(KeyCode::Char(' '));
    assert!(f.inbox.selected.is_empty());
}

#[test]
fn a_toggles_every_row_of_the_level() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Char('a'));
    assert_eq!(f.inbox.selected.len(), 3);
    f.press(KeyCode::Char('a'));
    assert!(f.inbox.selected.is_empty());
}

#[test]
fn nothing_to_act_on_says_so() {
    let mut f = Fixture::new(SessionState::default());
    f.press(KeyCode::Char('d'));
    assert_eq!(f.inbox.status, text::NOTHING_SELECTED);
    assert!(f.sent().is_empty());
}

#[test]
fn closed_session_reports_the_failure() {
    let mut f = Fixture::new(nested());
    f.commands.close();
    f.press(KeyCode::Char('d'));
    assert!(f.inbox.status.starts_with(&text::download_failed("")));
    assert_eq!(f.inbox.view.offers.len(), 3);
}

#[test]
fn j_and_k_do_not_move() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Char('j'));
    assert_eq!(f.inbox.cursor, 0);
    f.press(KeyCode::Char('k'));
    assert_eq!(f.inbox.cursor, 0);
    f.press(KeyCode::Down);
    assert_eq!(f.inbox.cursor, 1);
    f.press(KeyCode::Down);
    assert_eq!(f.inbox.cursor, 1);
    f.press(KeyCode::Up);
    assert_eq!(f.inbox.cursor, 0);
}

#[test]
fn q_finishes_the_inbox() {
    let mut f = Fixture::new(nested());
    assert_eq!(f.press(KeyCode::Char('q')), Outcome::Done(()));
}

#[test]
fn c_copies_the_pin_and_shift_c_the_share_link() {
    let mut f = Fixture::new(host());
    assert_eq!(
        f.press(KeyCode::Char('c')),
        Outcome::Copy(CopyRequest {
            kind: CopyKind::Pin,
            content: "4242".into(),
        })
    );
    assert_eq!(
        f.inbox.handle_key(shift('C')),
        Outcome::Copy(CopyRequest {
            kind: CopyKind::Link,
            content: "https://drop.lzart.com.br/share/?hostid=peer-1&code=4242".into(),
        })
    );
}

#[test]
fn share_link_is_host_only() {
    let mut f = Fixture::new(SessionState {
        host: false,
        ..host()
    });
    assert_eq!(f.inbox.handle_key(shift('C')), Outcome::Continue);
}

#[test]
fn copy_keys_do_nothing_without_a_pin() {
    let mut f = Fixture::new(nested());
    assert_eq!(f.press(KeyCode::Char('c')), Outcome::Continue);
    assert_eq!(f.inbox.handle_key(shift('C')), Outcome::Continue);
    assert!(f.inbox.status.is_empty());
}

#[test]
fn copy_result_goes_to_the_status_line() {
    let mut f = Fixture::new(host());
    f.inbox.on_copied(CopyKind::Pin, Ok(()));
    assert!(f.render(80, 24).contains(text::PIN_COPIED));
    f.inbox
        .on_copied(CopyKind::Link, Err(io::Error::other("x")));
    assert!(f.render(80, 24).contains(&text::copy_link_failed("x")));
}

#[test]
fn first_ctrl_c_opens_the_overlay() {
    let mut f = Fixture::new(nested());
    let mut confirm = Confirm::default();
    assert_eq!(
        dispatch(&mut f.inbox, &mut confirm, ctrl_c()),
        Step::Continue
    );
    assert!(confirm.visible());
}

#[test]
fn esc_closes_the_overlay_and_keeps_the_inbox() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Enter);
    let mut confirm = Confirm::shown();
    assert_eq!(
        dispatch(&mut f.inbox, &mut confirm, key(KeyCode::Esc)),
        Step::Continue
    );
    assert!(!confirm.visible());
    assert_eq!(f.inbox.cwd, ["photos"], "Esc went to the overlay only");
}

#[test]
fn second_ctrl_c_cancels() {
    let mut f = Fixture::new(nested());
    let mut confirm = Confirm::shown();
    assert_eq!(
        dispatch(&mut f.inbox, &mut confirm, ctrl_c()),
        Step::Exit(Exit::Cancelled)
    );
}

#[test]
fn tick_follows_the_session_state() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Enter);
    f.press(KeyCode::Char(' '));
    f.state.send_modify(|s| {
        s.offers.retain(|o| o.file_id == "c");
        s.status = text::WAITING_RECONNECT.into();
    });
    assert_eq!(f.inbox.tick(), Outcome::Continue);
    assert!(f.inbox.cwd.is_empty(), "the emptied folder is left");
    assert!(f.inbox.selected.is_empty(), "gone offers are unselected");
    assert!(f.render(80, 24).contains(text::WAITING_RECONNECT));
    f.state.send_modify(|s| s.phase = Phase::Ended);
    assert_eq!(f.inbox.tick(), Outcome::Done(()));
}

#[test]
fn new_offers_appear_on_tick() {
    let mut f = Fixture::new(SessionState::default());
    f.state
        .send_modify(|s| s.offers.push(offer("z", "zeta.bin", 1)));
    f.inbox.tick();
    assert!(f.render(80, 24).contains("zeta.bin"));
}

#[test]
fn header_shows_peer_pin_and_lan_badge() {
    let mut f = Fixture::new(SessionState {
        peer: Some(RemotePeer {
            id: "r1".into(),
            name: "Alice".into(),
            lan: true,
        }),
        ..host()
    });
    let view = f.render(80, 24);
    for want in [text::STATUS_CONNECTED, "Alice", "4242", text::LABEL_LAN] {
        assert!(view.contains(want), "missing {want:?} in:\n{view}");
    }
    f.state
        .send_modify(|s| s.peer.as_mut().unwrap().lan = false);
    f.inbox.tick();
    let view = f.render(80, 24);
    assert!(!view.contains(text::LABEL_LAN), "{view}");
    assert!(!view.contains("WAN"), "{view}");
}

#[test]
fn help_lists_the_keys() {
    for want in ["enter", "esc", "d baixar", "f buscar"] {
        assert!(text::INBOX_HELP.contains(want), "{want}");
    }
    let lower = text::INBOX_HELP.to_lowercase();
    for unwanted in ["enter baixar", " j ", " k ", "?"] {
        assert!(!lower.contains(unwanted), "{unwanted}");
    }
}
