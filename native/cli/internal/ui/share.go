package ui

import (
	"fmt"
	"net/url"
	"strings"

	"dropcli/internal/state"
)

// ShareOrigin derives the HTTP(S) origin used for Drop share links from a signaling WS URL.
// Default host drop.lzart.com.br uses https. Localhost / loopback uses http with port when present.
func ShareOrigin(wsURL string) string {
	normalized := state.NormalizeWebSocketURL(wsURL)
	u, err := url.Parse(normalized)
	if err != nil || u.Host == "" {
		return "https://drop.lzart.com.br"
	}

	host := u.Hostname()
	port := u.Port()
	isLocal := host == "localhost" || host == "127.0.0.1" || host == "::1"
	scheme := "https"
	if isLocal {
		scheme = "http"
	}

	if port != "" && !(scheme == "https" && port == "443") && !(scheme == "http" && port == "80") {
		return fmt.Sprintf("%s://%s:%s", scheme, host, port)
	}
	return fmt.Sprintf("%s://%s", scheme, host)
}

// ShareURL builds a Drop-compatible share link: {origin}/share/?hostid=&code=
func ShareURL(wsURL, peerID, pin string) string {
	origin := strings.TrimRight(ShareOrigin(wsURL), "/")
	return origin + "/share/?hostid=" + url.QueryEscape(peerID) + "&code=" + url.QueryEscape(pin)
}
