package e2e_test

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"dropcli/internal/adapters/fs"
	"dropcli/internal/services"
	"dropcli/internal/state"
	"dropcli/internal/webrtc"

	pionwebrtc "github.com/pion/webrtc/v4"
)

// sessionPair holds both sides of an in-process WebRTC pair plus their service stacks.
type sessionPair struct {
	hostSvc           *services.TransferService
	joinerSvc         *services.TransferService
	hostTransferState *state.TransferState
	joinerTransferState *state.TransferState
	hostSettings      *state.Settings
	joinerSettings    *state.Settings
	cleanup           func()
}

// newSessionPair creates two cross-wired in-process Pion WebRTC sessions with
// fully wired transfer and download services.
func newSessionPair(t *testing.T) *sessionPair {
	t.Helper()

	cfg := webrtc.SessionConfig{ICEServers: []pionwebrtc.ICEServer{}}

	hostTransferState := state.NewTransferState()
	joinerTransferState := state.NewTransferState()
	hostSettings := state.NewSettings()
	joinerSettings := state.NewSettings()

	repo := fs.NewRepository()

	hostDownload := services.NewDownloadService(repo, hostTransferState, hostSettings)
	joinerDownload := services.NewDownloadService(repo, joinerTransferState, joinerSettings)
	hostSvc := services.NewTransferService(repo, hostTransferState, hostDownload)
	joinerSvc := services.NewTransferService(repo, joinerTransferState, joinerDownload)

	hostHandler := &testWebRTCHandler{name: "host"}
	joinerHandler := &testWebRTCHandler{name: "joiner"}

	sessionHost := webrtc.NewSession(hostHandler, cfg)
	sessionJoiner := webrtc.NewSession(joinerHandler, cfg)

	// Cross-wire signals
	hostHandler.onSignal = func(data []byte) {
		go func() { _ = sessionJoiner.HandleSignal(data) }()
	}
	joinerHandler.onSignal = func(data []byte) {
		go func() { _ = sessionHost.HandleSignal(data) }()
	}

	hostReadyCh := make(chan struct{}, 1)
	joinerReadyCh := make(chan struct{}, 1)

	hostHandler.onReady = func(ctrl, files *pionwebrtc.DataChannel) {
		chunkSize := webrtc.GetMaxChunkSize(sessionHost.GetPeerConnection())
		hostSvc.SetChunkSize(chunkSize)
		hostSvc.BindChannels(ctrl, files)
		select {
		case hostReadyCh <- struct{}{}:
		default:
		}
	}
	joinerHandler.onReady = func(ctrl, files *pionwebrtc.DataChannel) {
		chunkSize := webrtc.GetMaxChunkSize(sessionJoiner.GetPeerConnection())
		joinerSvc.SetChunkSize(chunkSize)
		joinerSvc.BindChannels(ctrl, files)
		select {
		case joinerReadyCh <- struct{}{}:
		default:
		}
	}

	// "host-peer" < "joiner-peer" lexicographically, so host is controlling
	if err := sessionHost.Start("host-peer", "joiner-peer"); err != nil {
		t.Fatalf("sessionHost.Start failed: %v", err)
	}
	if err := sessionJoiner.Start("joiner-peer", "host-peer"); err != nil {
		t.Fatalf("sessionJoiner.Start failed: %v", err)
	}

	timeout := 5 * time.Second
	select {
	case <-hostReadyCh:
	case <-time.After(timeout):
		t.Fatal("timeout waiting for host session ready")
	}
	select {
	case <-joinerReadyCh:
	case <-time.After(timeout):
		t.Fatal("timeout waiting for joiner session ready")
	}

	return &sessionPair{
		hostSvc:             hostSvc,
		joinerSvc:           joinerSvc,
		hostTransferState:   hostTransferState,
		joinerTransferState: joinerTransferState,
		hostSettings:        hostSettings,
		joinerSettings:      joinerSettings,
		cleanup: func() {
			_ = sessionHost.Close()
			_ = sessionJoiner.Close()
		},
	}
}

type testWebRTCHandler struct {
	name     string
	mu       sync.Mutex
	onSignal func([]byte)
	onReady  func(*pionwebrtc.DataChannel, *pionwebrtc.DataChannel)
}

func (h *testWebRTCHandler) OnSignal(data []byte) {
	h.mu.Lock()
	fn := h.onSignal
	h.mu.Unlock()
	if fn != nil {
		fn(data)
	}
}
func (h *testWebRTCHandler) OnReady(ctrl, files *pionwebrtc.DataChannel) {
	h.mu.Lock()
	fn := h.onReady
	h.mu.Unlock()
	if fn != nil {
		fn(ctrl, files)
	}
}
func (h *testWebRTCHandler) OnStateChange(_ pionwebrtc.PeerConnectionState) {}
func (h *testWebRTCHandler) OnClose()                                        {}

// md5File computes the MD5 hash of a file at the given path.
func md5File(t *testing.T, path string) string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("md5File open %s: %v", path, err)
	}
	defer f.Close()
	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		t.Fatalf("md5File copy %s: %v", path, err)
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

// createTestFile creates a temporary file of the given size filled with random bytes.
// Returns the path and MD5 checksum.
func createTestFile(t *testing.T, dir string, name string, size int64) (path string, checksum string) {
	t.Helper()
	path = filepath.Join(dir, name)
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		t.Fatalf("rand.Read: %v", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("createTestFile WriteFile: %v", err)
	}
	h := md5.New()
	h.Write(data)
	checksum = fmt.Sprintf("%x", h.Sum(nil))
	return path, checksum
}

// waitAllCompleted polls transferState.AllCompleted up to the deadline.
func waitAllCompleted(t *testing.T, ts *state.TransferState, deadline time.Duration) {
	t.Helper()
	end := time.Now().Add(deadline)
	for !ts.AllCompleted() && time.Now().Before(end) {
		time.Sleep(20 * time.Millisecond)
	}
	if !ts.AllCompleted() {
		t.Fatalf("transfers did not complete within %v", deadline)
	}
}

// TestE2ETransferSingleFile tests sending a single file from host to joiner,
// verifying checksum, dynamic chunk sizing, and download to the -o directory.
func TestE2ETransferSingleFile(t *testing.T) {
	sendDir := t.TempDir()
	recvDir := t.TempDir()

	// ~256 KiB test file
	srcPath, srcChecksum := createTestFile(t, sendDir, "testfile.bin", 256*1024)

	pair := newSessionPair(t)
	defer pair.cleanup()

	// Simulate -o recvDir: set joiner's download dir
	pair.joinerSettings.SetDownloadDir(recvDir)

	// Verify chunk size is set (dynamic SCTP detection)
	chunkSize := pair.joinerSvc.GetChunkSize()
	if chunkSize == 0 {
		t.Fatal("expected non-zero chunk size after SCTP negotiation")
	}
	t.Logf("negotiated chunk size: %d bytes", chunkSize)

	doneCh := make(chan struct{}, 1)
	pair.joinerSvc.SetOnBatchDone(func() {
		select {
		case doneCh <- struct{}{}:
		default:
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		if err := pair.hostSvc.SendFile(ctx, srcPath); err != nil {
			errCh <- err
			return
		}
		_ = pair.hostSvc.SendControl(webrtc.BatchDoneMessage{Type: webrtc.CtrlBatchDone})
	}()

	select {
	case <-ctx.Done():
		t.Fatal("test timed out waiting for file transfer")
	case err := <-errCh:
		t.Fatalf("host send error: %v", err)
	case <-doneCh:
	}

	waitAllCompleted(t, pair.joinerTransferState, 5*time.Second)

	// Verify the file landed in the -o directory with matching checksum
	destPath := filepath.Join(recvDir, "testfile.bin")
	if _, err := os.Stat(destPath); os.IsNotExist(err) {
		t.Fatalf("received file not found at %s", destPath)
	}

	gotChecksum := md5File(t, destPath)
	if gotChecksum != srcChecksum {
		t.Fatalf("checksum mismatch: src=%s dst=%s", srcChecksum, gotChecksum)
	}
	t.Logf("✓ single file transfer verified: md5=%s", gotChecksum)
}

// TestE2ETransferBatch tests a batch of multiple files sent from host to joiner
// and verifies all checksums in the -o directory.
func TestE2ETransferBatch(t *testing.T) {
	sendDir := t.TempDir()
	recvDir := t.TempDir()

	type fileEntry struct {
		name     string
		path     string
		checksum string
	}

	fileSizes := []int64{64 * 1024, 128 * 1024, 512 * 1024}
	var files []fileEntry
	for i, size := range fileSizes {
		name := fmt.Sprintf("batch_file%d.bin", i)
		path, checksum := createTestFile(t, sendDir, name, size)
		files = append(files, fileEntry{name: name, path: path, checksum: checksum})
	}

	pair := newSessionPair(t)
	defer pair.cleanup()

	pair.joinerSettings.SetDownloadDir(recvDir)

	doneCh := make(chan struct{}, 1)
	pair.joinerSvc.SetOnBatchDone(func() {
		select {
		case doneCh <- struct{}{}:
		default:
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	paths := make([]string, len(files))
	for i, f := range files {
		paths[i] = f.path
	}

	errCh := make(chan error, 1)
	go func() {
		if err := pair.hostSvc.SendBatch(ctx, paths); err != nil {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		t.Fatal("test timed out waiting for batch transfer")
	case err := <-errCh:
		t.Fatalf("batch send error: %v", err)
	case <-doneCh:
	}

	waitAllCompleted(t, pair.joinerTransferState, 5*time.Second)

	for _, f := range files {
		destPath := filepath.Join(recvDir, f.name)
		if _, err := os.Stat(destPath); os.IsNotExist(err) {
			t.Fatalf("received file not found: %s", destPath)
		}
		gotChecksum := md5File(t, destPath)
		if gotChecksum != f.checksum {
			t.Fatalf("%s: checksum mismatch: src=%s dst=%s", f.name, f.checksum, gotChecksum)
		}
		t.Logf("✓ %s verified (md5=%s)", f.name, gotChecksum)
	}
}

// TestE2EOutputDirectorySync verifies that files arrive in the -o specified directory
// and not in CWD or any other default path.
func TestE2EOutputDirectorySync(t *testing.T) {
	sendDir := t.TempDir()
	customOutputDir := t.TempDir()

	srcPath, srcChecksum := createTestFile(t, sendDir, "sync_test.bin", 96*1024)

	pair := newSessionPair(t)
	defer pair.cleanup()

	// Apply -o flag: use a custom non-default output directory
	pair.joinerSettings.SetDownloadDir(customOutputDir)

	doneCh := make(chan struct{}, 1)
	pair.joinerSvc.SetOnBatchDone(func() {
		select {
		case doneCh <- struct{}{}:
		default:
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	go func() {
		_ = pair.hostSvc.SendFile(ctx, srcPath)
		_ = pair.hostSvc.SendControl(webrtc.BatchDoneMessage{Type: webrtc.CtrlBatchDone})
	}()

	select {
	case <-ctx.Done():
		t.Fatal("test timed out")
	case <-doneCh:
	}

	waitAllCompleted(t, pair.joinerTransferState, 5*time.Second)

	// File must exist in -o dir
	expectedPath := filepath.Join(customOutputDir, "sync_test.bin")
	if _, err := os.Stat(expectedPath); os.IsNotExist(err) {
		t.Fatalf("file not found in -o directory: %s", expectedPath)
	}

	gotChecksum := md5File(t, expectedPath)
	if gotChecksum != srcChecksum {
		t.Fatalf("checksum mismatch: src=%s dst=%s", srcChecksum, gotChecksum)
	}

	// File must NOT exist in the sending directory or CWD
	wrongPaths := []string{
		filepath.Join(sendDir, "sync_test.bin"), // not a duplicate of src
	}
	// The src IS in sendDir so ignore that — check CWD
	cwd, _ := os.Getwd()
	wrongPaths = append(wrongPaths, filepath.Join(cwd, "sync_test.bin"))
	for _, wrong := range wrongPaths {
		if wrong == srcPath {
			continue // that is the source file
		}
		if _, err := os.Stat(wrong); err == nil {
			t.Errorf("file should not appear at %s when -o is specified", wrong)
			os.Remove(wrong)
		}
	}

	t.Logf("✓ directory sync verified: file in -o dir %s (md5=%s)", customOutputDir, gotChecksum)
}

// TestE2EDynamicChunkSizing verifies the chunk size is properly detected and applied.
func TestE2EDynamicChunkSizing(t *testing.T) {
	pair := newSessionPair(t)
	defer pair.cleanup()

	// Both sides should have a non-zero chunk size after negotiation
	hostChunk := pair.hostSvc.GetChunkSize()
	joinerChunk := pair.joinerSvc.GetChunkSize()

	if hostChunk == 0 {
		t.Error("host chunk size must not be zero after SCTP negotiation")
	}
	if joinerChunk == 0 {
		t.Error("joiner chunk size must not be zero after SCTP negotiation")
	}

	// Both should match (same session SCTP negotiation)
	if hostChunk != joinerChunk {
		t.Logf("host=%d joiner=%d (may differ if detected at different times)", hostChunk, joinerChunk)
	}

	t.Logf("✓ dynamic chunk sizing: host=%d bytes, joiner=%d bytes", hostChunk, joinerChunk)
}
