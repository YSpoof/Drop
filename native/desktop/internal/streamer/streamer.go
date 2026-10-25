package streamer

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
)

const (
	TokenHeader = "X-Drop-Token"
)

// NewToken generates a cryptographically secure random token (64 hex characters).
func NewToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

// CORSMiddleware enables CORS and Private Network Access headers for loopback requests.
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "X-Drop-Token, Range, Content-Type")
		w.Header().Set("Access-Control-Allow-Private-Network", "true")
		w.Header().Set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// AuthMiddleware verifies the process security token either from the X-Drop-Token header or ?token= query param.
func AuthMiddleware(token string, next http.Handler) http.Handler {
	tokenBytes := []byte(token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := []byte(r.Header.Get(TokenHeader))
		if len(got) == 0 {
			got = []byte(r.URL.Query().Get("token"))
		}

		if len(got) != len(tokenBytes) || subtle.ConstantTimeCompare(got, tokenBytes) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// HandleRead serves a file slice using HTTP Range headers or full file content.
func HandleRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}
	http.ServeFile(w, r, path)
}

// HandleWrite accepts a binary chunk stream and writes/appends it to disk.
func HandleWrite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}

	flags := os.O_WRONLY | os.O_CREATE | os.O_TRUNC
	if r.URL.Query().Get("append") == "1" {
		flags = os.O_WRONLY | os.O_CREATE | os.O_APPEND
	}

	file, err := os.OpenFile(path, flags, 0o644)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer file.Close()

	if _, err = io.Copy(file, r.Body); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// RegisterRoutes attaches the /read and /write endpoints to the given mux.
func RegisterRoutes(mux *http.ServeMux, token string) {
	mux.Handle("/read", AuthMiddleware(token, http.HandlerFunc(HandleRead)))
	mux.Handle("/write", AuthMiddleware(token, http.HandlerFunc(HandleWrite)))
}
