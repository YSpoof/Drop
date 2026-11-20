use super::*;

#[test]
fn peer_id_is_32_lowercase_hex_chars_and_random() {
    let id = peer_id();
    assert_eq!(id.len(), 32);
    assert!(
        id.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    );
    assert_ne!(id, peer_id());
}

#[test]
fn custom_name_wins_over_hostname() {
    assert_eq!(display_name("  Laptop ", Some("host".into())), "Laptop");
}

#[test]
fn empty_name_falls_back_to_hostname_then_default() {
    assert_eq!(display_name("", Some("host".into())), "host");
    assert_eq!(display_name(" ", None), DEFAULT_NAME);
}

#[test]
fn device_uses_hostname_when_unnamed() {
    let device = Device::new("");
    let expected = hostname().unwrap_or_else(|| DEFAULT_NAME.into());
    assert_eq!(device.display_name, expected);
}
