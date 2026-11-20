use super::*;

#[test]
fn share_url_default_host() {
    let got = share_url("wss://drop.lzart.com.br/ws", "peer-abc", "1234");
    assert_eq!(
        got,
        "https://drop.lzart.com.br/share/?hostid=peer-abc&code=1234"
    );
}

#[test]
fn share_url_escapes_query() {
    let got = share_url("wss://drop.lzart.com.br/ws", "a b&c", "1234");
    assert_eq!(
        got,
        "https://drop.lzart.com.br/share/?hostid=a+b%26c&code=1234"
    );
}

#[test]
fn origin_default() {
    assert_eq!(
        share_origin("https://drop.lzart.com.br/ws"),
        "https://drop.lzart.com.br"
    );
    assert_eq!(share_origin(""), "https://drop.lzart.com.br");
}

#[test]
fn origin_localhost() {
    assert_eq!(
        share_origin("ws://localhost:8080/ws"),
        "http://localhost:8080"
    );
    assert_eq!(share_origin("ws://127.0.0.1/ws"), "http://127.0.0.1");
}

#[test]
fn origin_ipv6_loopback_is_bracketed() {
    assert_eq!(share_origin("ws://[::1]:8080/ws"), "http://[::1]:8080");
    assert_eq!(share_origin("http://[::1]/ws"), "http://[::1]");
}

#[test]
fn origin_custom_host_keeps_port() {
    assert_eq!(
        share_origin("wss://drop.example.com:8443/ws"),
        "https://drop.example.com:8443"
    );
    assert_eq!(
        share_origin("wss://[2001:db8::1]/ws"),
        "https://[2001:db8::1]"
    );
}

#[test]
fn origin_unparsable_falls_back() {
    assert_eq!(
        share_origin("ws://exa mple/ws"),
        "https://drop.lzart.com.br"
    );
}
