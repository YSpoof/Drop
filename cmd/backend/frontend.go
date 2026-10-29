package main

import (
	"io/fs"
	"net/http"
	pathpkg "path"
	"strconv"
	"strings"
)

// newFrontendHandler serves the embedded SvelteKit build the same way
// kcalTracker does: real files go through http.FileServer, client-side routes
// get index.html, and paths that look like a missing file get a 404.
//
// The 404 matters: answering a missing module with the SPA shell makes browsers
// fail with a misleading "MIME type text/html" error.
func newFrontendHandler(frontendFS fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(frontendFS))
	index, err := fs.ReadFile(frontendFS, "index.html")
	if err != nil {
		panic("frontend: embedded index.html is missing: " + err.Error())
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(pathpkg.Clean(r.URL.Path), "/")
		if name == "" || name == "." {
			serveIndex(w, r, index)
			return
		}

		info, err := fs.Stat(frontendFS, name)
		if err == nil {
			cacheName := name
			if info.IsDir() {
				if !hasIndexFile(frontendFS, name) {
					// Never expose a directory listing; treat it as a route.
					serveIndex(w, r, index)
					return
				}
				cacheName = strings.TrimSuffix(name, "/") + "/index.html"
			}

			w.Header().Set("X-Content-Type-Options", "nosniff")
			if cacheControl := cacheControlFor(cacheName); cacheControl != "" {
				w.Header().Set("Cache-Control", cacheControl)
			}
			fileServer.ServeHTTP(w, r)
			return
		}

		if isAssetPath(name) {
			w.Header().Set("Cache-Control", "no-store")
			http.NotFound(w, r)
			return
		}

		serveIndex(w, r, index)
	})
}

func hasIndexFile(frontendFS fs.FS, dir string) bool {
	_, err := fs.Stat(frontendFS, strings.TrimSuffix(dir, "/")+"/index.html")
	return err == nil
}

// serveIndex answers SPA routes (and /) with the preloaded shell.
func serveIndex(w http.ResponseWriter, r *http.Request, index []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", strconv.Itoa(len(index)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(index)
	}
}

// isAssetPath reports whether a path addresses a concrete file (as opposed to a
// SPA route). Such paths must never be answered with index.html.
func isAssetPath(name string) bool {
	return strings.Contains(pathpkg.Base(name), ".")
}

// cacheControlFor mirrors the headers SvelteKit's adapter-node sends. The
// immutable header is essential: without it, a browser that loaded an older
// build re-fetches those hashed chunks after a deploy, and they no longer exist
// on the server.
func cacheControlFor(name string) string {
	switch {
	case strings.HasPrefix(name, "_app/immutable/"):
		// Content-addressed files can be cached forever.
		return "public, max-age=31536000, immutable"
	case name == "index.html", name == "service-worker.js",
		strings.HasSuffix(name, "/index.html"):
		// Must always be revalidated so a new deploy is picked up.
		return "no-cache"
	default:
		return ""
	}
}
