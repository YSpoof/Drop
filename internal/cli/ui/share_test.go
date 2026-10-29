package ui

import "testing"

func TestShareURLDefaultHost(t *testing.T) {
	got := ShareURL("wss://drop.lzart.com.br/ws", "peer-abc", "1234")
	want := "https://drop.lzart.com.br/share/?hostid=peer-abc&code=1234"
	if got != want {
		t.Fatalf("ShareURL = %q, want %q", got, want)
	}
}

func TestShareOriginDefault(t *testing.T) {
	got := ShareOrigin("https://drop.lzart.com.br/ws")
	if got != "https://drop.lzart.com.br" {
		t.Fatalf("ShareOrigin = %q", got)
	}
}

func TestShareOriginLocalhost(t *testing.T) {
	got := ShareOrigin("ws://localhost:8080/ws")
	if got != "http://localhost:8080" {
		t.Fatalf("ShareOrigin = %q, want http://localhost:8080", got)
	}
}
