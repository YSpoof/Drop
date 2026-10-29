package streamer

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"

	"drop/internal/httpx"
	"os"
	"path/filepath"
	"testing"
)

func TestNewToken(t *testing.T) {
	t1, err := NewToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(t1) != 64 {
		t.Fatalf("expected 64 hex characters, got %d", len(t1))
	}
	t2, _ := NewToken()
	if t1 == t2 {
		t.Fatalf("tokens must be unique")
	}
}

func TestStreamerReadAndWrite(t *testing.T) {
	token, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	RegisterRoutes(mux, token)
	handler := httpx.CORSMiddleware(mux)
	server := httptest.NewServer(handler)
	defer server.Close()

	tmpDir, err := os.MkdirTemp("", "streamer-test-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	targetFile := filepath.Join(tmpDir, "test.bin")
	payload1 := []byte("Hello, ")
	payload2 := []byte("World!")

	// 1. Unauthorized write attempt
	{
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/write?path="+targetFile, bytes.NewReader(payload1))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized without token, got %d", resp.StatusCode)
		}
	}

	// 2. Initial write (create/truncate)
	{
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/write?path="+targetFile, bytes.NewReader(payload1))
		req.Header.Set(TokenHeader, token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
		}
	}

	// 3. Append write
	{
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/write?path="+targetFile+"&append=1", bytes.NewReader(payload2))
		req.Header.Set(TokenHeader, token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
		}
	}

	// Verify file content on disk
	diskContent, err := os.ReadFile(targetFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(diskContent) != "Hello, World!" {
		t.Fatalf("unexpected content: %q", string(diskContent))
	}

	// 4. Full Read
	{
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/read?path="+targetFile, nil)
		req.Header.Set(TokenHeader, token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
		}
		body, _ := io.ReadAll(resp.Body)
		if string(body) != "Hello, World!" {
			t.Fatalf("expected 'Hello, World!', got %q", string(body))
		}
	}

	// 5. Range Read (bytes 7-11 => "World")
	{
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/read?path="+targetFile, nil)
		req.Header.Set(TokenHeader, token)
		req.Header.Set("Range", "bytes=7-11")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusPartialContent {
			t.Fatalf("expected 206 Partial Content, got %d", resp.StatusCode)
		}
		body, _ := io.ReadAll(resp.Body)
		if string(body) != "World" {
			t.Fatalf("expected 'World', got %q", string(body))
		}
	}

	// 6. CORS Options preflight check
	{
		req, _ := http.NewRequest(http.MethodOptions, server.URL+"/read?path="+targetFile, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("expected 204 No Content for OPTIONS, got %d", resp.StatusCode)
		}
		if pna := resp.Header.Get("Access-Control-Allow-Private-Network"); pna != "true" {
			t.Fatalf("expected Access-Control-Allow-Private-Network: true, got %q", pna)
		}
	}
}
