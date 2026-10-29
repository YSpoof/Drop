package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func testFrontendFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html": {
			Data: []byte("<!doctype html><title>drop</title>"),
		},
		"_app/immutable/nodes/1.abc123.js": {
			Data: []byte("export const component = () => {};"),
		},
		"_app/immutable/assets/app.css": {
			Data: []byte("body{}"),
		},
		"share": {
			Mode: fs.ModeDir,
		},
		"share/index.html": {
			Data: []byte("<!doctype html><title>share</title>"),
		},
	}
}

// newTestHandler mirrors the mux registration in main.
func newTestHandler(frontendFS fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /", newFrontendHandler(frontendFS))
	return mux
}

func serve(handler http.Handler, method, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestFrontendHandlerServesAssetsWithImmutableCaching(t *testing.T) {
	rec := serve(newTestHandler(testFrontendFS()), http.MethodGet, "/_app/immutable/nodes/1.abc123.js")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "javascript") {
		t.Errorf("Content-Type = %q, want a javascript type", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}
}

func TestFrontendHandlerMissingAssetReturns404(t *testing.T) {
	rec := serve(newTestHandler(testFrontendFS()), http.MethodGet, "/_app/immutable/nodes/9.stale.js")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if got := rec.Header().Get("Content-Type"); strings.Contains(got, "text/html") {
		t.Errorf("missing asset answered with HTML (%q)", got)
	}
	if body := rec.Body.String(); strings.Contains(body, "<!doctype html>") {
		t.Errorf("missing asset was answered with the SPA shell: %q", body)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
}

func TestFrontendHandlerMissingStaticFileReturns404(t *testing.T) {
	handler := newTestHandler(testFrontendFS())

	for _, target := range []string{"/service-worker.js", "/manifest.json", "/favicon.svg", "/robots.txt"} {
		rec := serve(handler, http.MethodGet, target)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want %d", target, rec.Code, http.StatusNotFound)
		}
	}
}

func TestFrontendHandlerSPAFallback(t *testing.T) {
	handler := newTestHandler(testFrontendFS())

	for _, target := range []string{"/", "/join/", "/web-share-catcher/"} {
		rec := serve(handler, http.MethodGet, target)
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want %d", target, rec.Code, http.StatusOK)
		}
		if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "text/html") {
			t.Errorf("%s: Content-Type = %q, want text/html", target, got)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
			t.Errorf("%s: Cache-Control = %q, want no-cache", target, got)
		}
	}
}

func TestFrontendHandlerServesPrerenderedRouteDirectory(t *testing.T) {
	rec := serve(newTestHandler(testFrontendFS()), http.MethodGet, "/share/")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); !strings.Contains(body, "<title>share</title>") {
		t.Errorf("served wrong file: %q", body)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", got)
	}
}

func TestFrontendHandlerSupportsHead(t *testing.T) {
	handler := newTestHandler(testFrontendFS())

	for _, target := range []string{"/", "/_app/immutable/nodes/1.abc123.js"} {
		rec := serve(handler, http.MethodHead, target)
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want %d", target, rec.Code, http.StatusOK)
		}
		if rec.Body.Len() != 0 {
			t.Errorf("%s: HEAD returned a body", target)
		}
	}
}

func TestFrontendHandlerRejectsNonGet(t *testing.T) {
	rec := serve(newTestHandler(testFrontendFS()), http.MethodPost, "/")

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
	if got := rec.Header().Get("Allow"); !strings.Contains(got, http.MethodGet) {
		t.Errorf("Allow = %q, want GET", got)
	}
}

func TestFrontendHandlerDoesNotEscapeRoot(t *testing.T) {
	rec := serve(newTestHandler(testFrontendFS()), http.MethodGet, "/../../etc/passwd")

	if body := rec.Body.String(); strings.Contains(body, "root:") {
		t.Errorf("path traversal escaped the filesystem: %q", body)
	}
}
