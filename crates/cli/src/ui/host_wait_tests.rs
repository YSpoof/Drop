use std::cell::RefCell;
use std::rc::Rc;

use crossterm::event::KeyCode;

use super::*;
use crate::ui::confirm::Confirm;
use crate::ui::testing::{ctrl_c, key, render_text, shift};
use crate::ui::{Exit, Step, dispatch};

const LINK: &str = "https://drop.lzart.com.br/share/?hostid=peer&code=1234";

type Shared = Rc<RefCell<HostWait>>;

fn screen(view: HostWait) -> (Shared, HostWaitScreen<impl FnMut() -> HostWait>) {
    let shared = Rc::new(RefCell::new(view));
    let feed = shared.clone();
    (shared, HostWaitScreen::new(move || feed.borrow().clone()))
}

fn waiting() -> HostWait {
    HostWait {
        pin: Some("1234".into()),
        share_url: Some(LINK.into()),
        status: WaitStatus::WaitingPeer,
    }
}

fn render(screen: &impl Screen) -> String {
    render_text(80, 12, |frame| screen.render(frame, frame.area()))
}

fn copy(kind: CopyKind, content: &str) -> Outcome<()> {
    Outcome::Copy(CopyRequest {
        kind,
        content: content.into(),
    })
}

#[test]
fn c_copies_the_pin() {
    let (_, mut screen) = screen(waiting());
    assert_eq!(
        screen.handle_key(key(KeyCode::Char('c'))),
        copy(CopyKind::Pin, "1234")
    );
}

#[test]
fn shift_c_copies_the_share_link() {
    let (_, mut screen) = screen(waiting());
    assert_eq!(screen.handle_key(shift('C')), copy(CopyKind::Link, LINK));
}

#[test]
fn keys_do_nothing_without_a_pin() {
    let (_, mut screen) = screen(HostWait::default());
    assert_eq!(
        screen.handle_key(key(KeyCode::Char('c'))),
        Outcome::Continue
    );
    assert_eq!(screen.handle_key(shift('C')), Outcome::Continue);
    assert!(!render(&screen).contains(text::PRESS_COPY_PIN_HINT));
}

#[test]
fn link_needs_a_share_url() {
    let (_, mut screen) = screen(HostWait {
        share_url: None,
        ..waiting()
    });
    assert_eq!(screen.handle_key(shift('C')), Outcome::Continue);
    assert_eq!(
        screen.handle_key(key(KeyCode::Char('c'))),
        copy(CopyKind::Pin, "1234")
    );
    let view = render(&screen);
    assert!(view.contains(text::PRESS_COPY_PIN_HINT));
    assert!(!view.contains(text::PRESS_COPY_HINT));
}

#[test]
fn shows_pin_and_copy_hints() {
    let (_, screen) = screen(waiting());
    let view = render(&screen);
    for want in [
        text::HOST_SESSION,
        "1234",
        text::PRESS_COPY_HINT,
        text::WAITING_PEER,
    ] {
        assert!(view.contains(want), "missing {want:?} in:\n{view}");
    }
}

#[test]
fn copy_feedback_reports_success_and_failure() {
    let (_, mut screen) = screen(waiting());
    screen.on_copied(CopyKind::Pin, Ok(()));
    assert!(render(&screen).contains(text::PIN_COPIED));
    screen.on_copied(CopyKind::Link, Ok(()));
    assert!(render(&screen).contains(text::SHARE_LINK_COPIED));
    screen.on_copied(CopyKind::Link, Err(io::Error::other("x")));
    let view = render(&screen);
    assert!(view.contains(&text::copy_link_failed("x")));
    assert!(!view.contains(text::SHARE_LINK_COPIED));
}

#[test]
fn tick_reads_the_feed_and_shows_reconnect_status() {
    let (shared, mut screen) = screen(HostWait::default());
    assert!(render(&screen).contains(text::STATUS_CONNECTING));
    *shared.borrow_mut() = HostWait {
        status: WaitStatus::Reconnecting(Some("conexão perdida".into())),
        ..waiting()
    };
    assert_eq!(screen.tick(), Outcome::Continue);
    let view = render(&screen);
    assert!(view.contains(text::STATUS_WAITING_RECONNECT), "{view}");
    assert!(view.contains("conexão perdida"), "{view}");
    assert!(view.contains("1234"));
}

#[test]
fn ready_peer_finishes_the_screen() {
    let (shared, mut screen) = screen(waiting());
    shared.borrow_mut().status = WaitStatus::Ready;
    assert_eq!(screen.tick(), Outcome::Done(()));
}

#[test]
fn ctrl_c_opens_the_overlay_instead_of_cancelling() {
    let (_, mut screen) = screen(waiting());
    let mut confirm = Confirm::default();
    assert_eq!(
        dispatch(&mut screen, &mut confirm, ctrl_c()),
        Step::Continue
    );
    assert!(confirm.visible());
}

#[test]
fn confirmed_ctrl_c_cancels_the_session() {
    let (_, mut screen) = screen(waiting());
    let mut confirm = Confirm::shown();
    assert_eq!(
        dispatch(&mut screen, &mut confirm, ctrl_c()),
        Step::Exit(Exit::Cancelled)
    );
}

#[test]
fn overlay_swallows_copy_keys_and_esc_resumes_them() {
    let (_, mut screen) = screen(waiting());
    let mut confirm = Confirm::shown();
    assert_eq!(
        dispatch(&mut screen, &mut confirm, key(KeyCode::Char('c'))),
        Step::Continue
    );
    assert_eq!(
        dispatch(&mut screen, &mut confirm, key(KeyCode::Esc)),
        Step::Continue
    );
    assert!(!confirm.visible());
    assert_eq!(
        dispatch(&mut screen, &mut confirm, key(KeyCode::Char('c'))),
        Step::Copy(CopyRequest {
            kind: CopyKind::Pin,
            content: "1234".into(),
        })
    );
}

#[test]
fn view_follows_the_session_state() {
    use crate::state::{Phase, SessionState};
    let mut s = SessionState {
        peer_id: "peer".into(),
        signaling_url: "wss://drop.lzart.com.br/ws".into(),
        host: true,
        ..SessionState::default()
    };
    assert_eq!(HostWait::from(&s), HostWait::default());
    s.phase = Phase::WaitingForPeer;
    s.pin = Some("1234".into());
    assert_eq!(HostWait::from(&s), waiting());
    s.phase = Phase::Connected;
    assert_eq!(HostWait::from(&s).status, WaitStatus::Ready);
    s.phase = Phase::Ended;
    assert_eq!(HostWait::from(&s).status, WaitStatus::Ended);
}

#[test]
fn joiner_view_has_the_pin_but_no_link() {
    use crate::state::{Phase, SessionState};
    let s = SessionState {
        peer_id: "peer".into(),
        pin: Some("1234".into()),
        phase: Phase::WaitingForPeer,
        ..SessionState::default()
    };
    let view = HostWait::from(&s);
    assert_eq!(view.status, WaitStatus::Connecting);
    assert_eq!(view.share_url, None);
    let (_, screen) = screen(view);
    let screen = screen.titled(text::JOIN_SESSION);
    let rendered = render(&screen);
    assert!(rendered.contains(text::JOIN_SESSION), "{rendered}");
    assert!(rendered.contains(text::PRESS_COPY_PIN_HINT), "{rendered}");
}

#[test]
fn ended_session_finishes_the_screen() {
    let (shared, mut screen) = screen(waiting());
    shared.borrow_mut().status = WaitStatus::Ended;
    assert_eq!(screen.tick(), Outcome::Done(()));
}
