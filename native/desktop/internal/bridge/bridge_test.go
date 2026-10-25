package bridge

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestBridgeFSOperations(t *testing.T) {
	token := "test-secret-token"
	server := NewServer(token)

	ts := httptest.NewServer(server)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http")

	// 1. Connection without token should fail
	_, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatal("expected connection without token to fail")
	}

	// 2. Connection with token should succeed
	ws, _, err := websocket.DefaultDialer.Dial(wsURL+"?token="+token, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer ws.Close()

	tmpDir, err := os.MkdirTemp("", "bridge-fs-test-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	callRPC := func(method string, params any) (*Response, error) {
		pBytes, err := json.Marshal(params)
		if err != nil {
			return nil, err
		}
		req := Request{
			ID:     "123",
			Method: method,
			Params: pBytes,
		}
		if err := ws.WriteJSON(req); err != nil {
			return nil, err
		}
		var resp Response
		if err := ws.ReadJSON(&resp); err != nil {
			return nil, err
		}
		return &resp, nil
	}

	// 3. Test fs.getDownloadsPath
	{
		resp, err := callRPC("fs.getDownloadsPath", nil)
		if err != nil {
			t.Fatal(err)
		}
		if resp.Error != "" {
			t.Fatalf("rpc error: %s", resp.Error)
		}
		pathStr, ok := resp.Result.(string)
		if !ok || pathStr == "" {
			t.Fatalf("expected non-empty downloads path string, got %v", resp.Result)
		}
	}

	// 4. Test fs.mkdir
	subDir := filepath.Join(tmpDir, "nested", "subfolder")
	{
		resp, err := callRPC("fs.mkdir", map[string]string{"path": subDir})
		if err != nil {
			t.Fatal(err)
		}
		if resp.Error != "" {
			t.Fatalf("mkdir error: %s", resp.Error)
		}
		if stat, err := os.Stat(subDir); err != nil || !stat.IsDir() {
			t.Fatalf("directory was not created: %v", err)
		}
	}

	// Create a dummy file inside subDir
	testFile := filepath.Join(subDir, "hello.txt")
	if err := os.WriteFile(testFile, []byte("Hello Drop!"), 0o644); err != nil {
		t.Fatal(err)
	}

	// 5. Test fs.stat
	{
		resp, err := callRPC("fs.stat", map[string]string{"path": testFile})
		if err != nil {
			t.Fatal(err)
		}
		if resp.Error != "" {
			t.Fatalf("stat error: %s", resp.Error)
		}
		resMap := resp.Result.(map[string]any)
		if resMap["exists"] != true || resMap["size"].(float64) != 11 {
			t.Fatalf("unexpected stat result: %v", resMap)
		}
	}

	// 6. Test fs.readDir
	{
		resp, err := callRPC("fs.readDir", map[string]string{"path": subDir})
		if err != nil {
			t.Fatal(err)
		}
		if resp.Error != "" {
			t.Fatalf("readDir error: %s", resp.Error)
		}
		entries := resp.Result.([]any)
		if len(entries) != 1 {
			t.Fatalf("expected 1 entry, got %d", len(entries))
		}
		entry := entries[0].(map[string]any)
		if entry["entry"] != "hello.txt" || entry["type"] != "FILE" {
			t.Fatalf("unexpected dir entry: %v", entry)
		}
	}

	// 7. Test fs.move
	movedFile := filepath.Join(tmpDir, "moved.txt")
	{
		resp, err := callRPC("fs.move", map[string]string{"from": testFile, "to": movedFile})
		if err != nil {
			t.Fatal(err)
		}
		if resp.Error != "" {
			t.Fatalf("move error: %s", resp.Error)
		}
		if _, err := os.Stat(testFile); !os.IsNotExist(err) {
			t.Fatalf("old file still exists after move")
		}
		if _, err := os.Stat(movedFile); err != nil {
			t.Fatalf("moved file does not exist: %v", err)
		}
	}

	// 8. Test fs.remove
	{
		resp, err := callRPC("fs.remove", map[string]string{"path": movedFile})
		if err != nil {
			t.Fatal(err)
		}
		if resp.Error != "" {
			t.Fatalf("remove error: %s", resp.Error)
		}
		if _, err := os.Stat(movedFile); !os.IsNotExist(err) {
			t.Fatalf("file still exists after remove")
		}
	}

}
