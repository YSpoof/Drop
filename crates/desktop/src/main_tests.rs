use super::*;

#[test]
fn launch_url_adds_port_and_token() {
    let url = launch_url(DEFAULT_URL, 54321, "secret").unwrap();
    assert_eq!(
        url,
        "https://drop.lzart.com.br/?dropPort=54321&dropToken=secret"
    );
}

#[test]
fn launch_url_keeps_other_params_and_replaces_stale_credentials() {
    let url = launch_url(
        "http://localhost:4321/app?a=1&dropPort=1&b=x%20y&dropToken=old",
        9,
        "t",
    )
    .unwrap();
    assert_eq!(
        url,
        "http://localhost:4321/app?a=1&b=x+y&dropPort=9&dropToken=t"
    );
}

#[test]
fn launch_url_rejects_relative_url() {
    assert!(launch_url("drop.lzart.com.br", 1, "t").is_err());
}
