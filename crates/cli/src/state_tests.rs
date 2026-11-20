use super::*;

fn row(id: &str, hash: &str, direction: Direction) -> Transfer {
    Transfer::new(id, "a.bin", 10, hash, direction)
}

#[test]
fn resumed_receive_replaces_failed_row_in_place() {
    let mut state = SessionState::default();
    state.add_transfer(row("first", "x", Direction::Download));
    state.add_transfer(row("old", "h", Direction::Download));
    state.add_transfer(row("last", "y", Direction::Download));
    state.interrupt();

    state.add_transfer(row("new", "h", Direction::Download));

    let ids: Vec<_> = state.transfers.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, ["first", "new", "last"]);
    assert_eq!(state.transfers[1].status, TransferStatus::Pending);
}

#[test]
fn completed_receive_of_same_identity_is_kept() {
    let mut state = SessionState::default();
    state.add_transfer(row("done", "h", Direction::Download));
    state.transfers[0].status = TransferStatus::Completed;
    state.add_transfer(row("again", "h", Direction::Download));
    assert_eq!(state.transfers.len(), 2);
}

#[test]
fn sends_are_never_merged_by_identity() {
    let mut state = SessionState::default();
    state.add_transfer(row("a", "h", Direction::Upload));
    state.add_transfer(row("b", "h", Direction::Upload));
    assert_eq!(state.transfers.len(), 2);
}

#[test]
fn interrupt_fails_receives_requeues_sends_and_clears_offers() {
    let mut state = SessionState::default();
    state.offers.push(Offer {
        file_id: "o".into(),
        name: "o.bin".into(),
        size: 1,
    });
    state.add_transfer(row("r", "h1", Direction::Download));
    state.add_transfer(row("s", "h2", Direction::Upload));
    state.transfers[1].status = TransferStatus::Active;

    state.interrupt();

    assert!(state.offers.is_empty());
    assert_eq!(state.transfers[0].status, TransferStatus::Failed);
    assert_eq!(
        state.transfers[0].reason.as_deref(),
        Some("conexão perdida")
    );
    assert_eq!(state.transfers[1].status, TransferStatus::Pending);
    assert_eq!(
        state.transfers[1].reason.as_deref(),
        Some("conexão perdida")
    );
}

#[tokio::test]
async fn updates_wake_subscribers() {
    let shared = Shared::new(SessionState::default());
    let mut rx = shared.subscribe();
    set_status(&shared, "ok");
    rx.changed().await.unwrap();
    assert_eq!(rx.borrow().status, "ok");
}
