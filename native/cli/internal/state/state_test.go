package state

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDeviceState(t *testing.T) {
	d := NewDeviceState("custom-node")
	if d.GetDisplayName() != "custom-node" {
		t.Fatalf("expected custom-node, got %s", d.GetDisplayName())
	}
	if d.GetPeerID() == "" {
		t.Fatal("expected non-empty peer ID")
	}
	if d.GetHostname() == "" {
		t.Fatal("expected non-empty hostname")
	}

	d.SetDisplayName("renamed-node")
	if d.GetDisplayName() != "renamed-node" {
		t.Fatalf("expected renamed-node, got %s", d.GetDisplayName())
	}

	// Test default display name
	d2 := NewDeviceState("")
	if d2.GetDisplayName() != d2.GetHostname() {
		t.Fatalf("expected display name %s to match hostname", d2.GetDisplayName())
	}
}

func TestPeerState(t *testing.T) {
	p := NewPeerState()
	if p.GetStatus() != StatusIdle {
		t.Fatalf("expected StatusIdle, got %v", p.GetStatus())
	}

	p.SetRole(RoleHost)
	if p.GetRole() != RoleHost {
		t.Fatalf("expected RoleHost, got %v", p.GetRole())
	}

	p.SetPIN("1234")
	if p.GetPIN() != "1234" {
		t.Fatalf("expected 1234, got %s", p.GetPIN())
	}

	p.SetStatus(StatusConnecting)
	if p.GetStatus() != StatusConnecting {
		t.Fatalf("expected StatusConnecting, got %v", p.GetStatus())
	}

	remotePeer := &RemotePeerImpl{id: "remote-1", displayName: "PeerOne"}
	p.SetRemotePeer(remotePeer)
	remote, ok := p.GetRemotePeer()
	if !ok || remote.GetID() != "remote-1" || remote.GetDisplayName() != "PeerOne" {
		t.Fatalf("unexpected remote peer: %+v", remote)
	}

	if p.GetViaLan() {
		t.Fatal("viaLan must default false")
	}
	p.SetViaLan(true)
	if !p.GetViaLan() {
		t.Fatal("expected viaLan true after SetViaLan(true)")
	}
	p.SetViaLan(false)
	if p.GetViaLan() {
		t.Fatal("expected viaLan false after SetViaLan(false)")
	}
	p.SetViaLan(true)

	p.Clear()
	if p.GetStatus() != StatusIdle {
		t.Fatalf("expected StatusIdle after clear, got %v", p.GetStatus())
	}
	if p.GetPIN() != "" {
		t.Fatalf("expected empty PIN after clear, got %s", p.GetPIN())
	}
	if _, ok := p.GetRemotePeer(); ok {
		t.Fatal("expected no remote peer after clear")
	}
	if p.GetViaLan() {
		t.Fatal("expected viaLan cleared after Clear")
	}
}

func TestTransferState(t *testing.T) {
	ts := NewTransferState()
	if !ts.AllCompleted() {
		t.Fatal("expected empty transfer state to report AllCompleted() as true")
	}

	item1 := &FileTransfer{
		ID:        "file-1",
		Name:      "test.txt",
		Size:      1000,
		Direction: DirectionSend,
		Status:    TransferPending,
	}
	ts.AddTransfer(item1)

	if ts.AllCompleted() {
		t.Fatal("expected AllCompleted() to be false with pending transfer")
	}

	active, ok := ts.GetActive()
	if ok || active != nil {
		t.Fatal("expected no active transfer yet")
	}

	ts.UpdateProgress("file-1", 500, 250.0)
	tr, ok := ts.GetTransfer("file-1")
	if !ok || tr.TransferredBytes != 500 || tr.Status != TransferActive {
		t.Fatalf("unexpected transfer state after update: %+v", tr)
	}

	active, ok = ts.GetActive()
	if !ok || active.ID != "file-1" {
		t.Fatalf("expected active transfer file-1, got %+v", active)
	}

	ts.SetStatus("file-1", TransferCompleted)
	if !ts.AllCompleted() {
		t.Fatal("expected AllCompleted() to be true when all items completed")
	}

	all := ts.GetAll()
	if len(all) != 1 || all[0].Status != TransferCompleted {
		t.Fatalf("unexpected all transfers: %+v", all)
	}
}

func TestTransferStateReplaceReceiveByHash(t *testing.T) {
	ts := NewTransferState()
	hash := "abc123identity"

	ts.AddTransfer(&FileTransfer{
		ID:        "other",
		Name:      "keep.txt",
		Direction: DirectionReceive,
		Status:    TransferCompleted,
		Hash:      "other-hash",
	})
	ts.AddTransfer(&FileTransfer{
		ID:        "file-old",
		Name:      "resume.bin",
		Direction: DirectionReceive,
		Status:    TransferFailed,
		Hash:      hash,
		Error:     "conexão perdida",
	})
	ts.AddTransfer(&FileTransfer{
		ID:        "tail",
		Name:      "after.txt",
		Direction: DirectionSend,
		Status:    TransferPending,
	})

	ts.AddTransfer(&FileTransfer{
		ID:        "file-new",
		Name:      "resume.bin",
		Direction: DirectionReceive,
		Status:    TransferPending,
		Hash:      hash,
	})

	all := ts.GetAll()
	if len(all) != 3 {
		t.Fatalf("expected 3 rows after replace, got %d: %+v", len(all), all)
	}
	if all[0].ID != "other" || all[1].ID != "file-new" || all[2].ID != "tail" {
		t.Fatalf("unexpected order after replace: %+v", all)
	}
	if _, ok := ts.GetTransfer("file-old"); ok {
		t.Fatal("expected old failed row removed")
	}
	got, ok := ts.GetTransfer("file-new")
	if !ok || got.Hash != hash || got.Status != TransferPending {
		t.Fatalf("unexpected new transfer: %+v", got)
	}
}

func TestNormalizeWebSocketURL(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"https://drop.lzart.com.br/ws", "wss://drop.lzart.com.br/ws"},
		{"http://localhost:5173/ws", "ws://localhost:5173/ws"},
		{"wss://custom.domain/ws", "wss://custom.domain/ws"},
		{"ws://127.0.0.1:8080/ws", "ws://127.0.0.1:8080/ws"},
		{"drop.lzart.com.br/ws", "wss://drop.lzart.com.br/ws"},
		{"", "wss://drop.lzart.com.br/ws"},
	}

	for _, tc := range tests {
		got := NormalizeWebSocketURL(tc.input)
		if got != tc.expected {
			t.Errorf("NormalizeWebSocketURL(%q) = %q; want %q", tc.input, got, tc.expected)
		}
	}
}

func TestSettings(t *testing.T) {
	// Test default settings
	t.Setenv("HOME", t.TempDir())
	os.Unsetenv(EnvDropWSURL)
	s := NewSettings()
	if s.GetWSURL() != "wss://drop.lzart.com.br/ws" {
		t.Fatalf("expected default wss://drop.lzart.com.br/ws, got %s", s.GetWSURL())
	}
	if !s.GetAutoDownload() {
		t.Fatal("expected session AutoDownload to default to true")
	}

	cwd, _ := os.Getwd()
	absCwd, _ := filepath.Abs(cwd)
	if s.GetDownloadDir() != absCwd {
		t.Fatalf("expected download dir %s, got %s", absCwd, s.GetDownloadDir())
	}

	// Test env override
	os.Setenv(EnvDropWSURL, "http://localhost:8080/ws")
	defer os.Unsetenv(EnvDropWSURL)
	s2 := NewSettings()
	if s2.GetWSURL() != "ws://localhost:8080/ws" {
		t.Fatalf("expected ws://localhost:8080/ws, got %s", s2.GetWSURL())
	}

	// Test output directory override
	customDir := "/tmp/drop-downloads"
	s.SetDownloadDir(customDir)
	if s.GetDownloadDir() != customDir {
		t.Fatalf("expected %s, got %s", customDir, s.GetDownloadDir())
	}

	// Session-scoped only; must not affect persisted config.
	s.SetAutoDownload(false)
	if s.GetAutoDownload() {
		t.Fatal("expected AutoDownload to be false")
	}

	stats := &TransferStats{
		UploadBytes:   42,
		DownloadBytes: 99,
		UploadFiles:   1,
		DownloadFiles: 2,
	}
	if err := s.FlushStats(stats); err != nil {
		t.Fatalf("FlushStats failed: %v", err)
	}
	s.SetDeviceName("after-stats")
	if err := s.SaveConfig(); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}
	loaded, err := s.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}
	if loaded.TransferStats != *stats {
		t.Fatalf("SaveConfig wiped TransferStats: got %+v want %+v", loaded.TransferStats, *stats)
	}
	if loaded.DeviceName != "after-stats" {
		t.Fatalf("expected device name after-stats, got %s", loaded.DeviceName)
	}
}
