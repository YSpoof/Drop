package main

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// buildSHA is the commit the binary was built from. The Dockerfile injects it
// with -ldflags "-X main.buildSHA=<sha>"; local builds report "dev".
var buildSHA = "dev"

type healthResponse struct {
	OK  bool   `json:"ok"`
	SHA string `json:"sha"`
}

// healthHandler reports that this process is serving requests and which commit
// it was built from, so a deploy can be verified without inspecting the image.
// The response is never cached: a stale "ok" is worse than no answer.
func healthHandler(w http.ResponseWriter, r *http.Request) {
	body, err := json.Marshal(healthResponse{OK: true, SHA: buildSHA})
	if err != nil {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(body)
	}
}
