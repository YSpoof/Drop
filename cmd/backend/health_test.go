package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestHealthReportsBuildSHA(t *testing.T) {
	previous := buildSHA
	buildSHA = "abc1234"
	t.Cleanup(func() { buildSHA = previous })

	// Register the real routes so the test also proves /health is not swallowed
	// by the SPA fallback.
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", healthHandler)
	mux.Handle("GET /", newFrontendHandler(testFrontendFS()))

	rec := serve(mux, http.MethodGet, "/health")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}

	var body healthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q is not JSON: %v", rec.Body.String(), err)
	}
	if !body.OK {
		t.Errorf("ok = false, want true")
	}
	if body.SHA != "abc1234" {
		t.Errorf("sha = %q, want %q", body.SHA, "abc1234")
	}
}

func TestHealthSupportsHead(t *testing.T) {
	previous := buildSHA
	buildSHA = "abc1234"
	t.Cleanup(func() { buildSHA = previous })

	rec := serve(http.HandlerFunc(healthHandler), http.MethodHead, "/health")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("HEAD returned a body: %q", rec.Body.String())
	}
}
