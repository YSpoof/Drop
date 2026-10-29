package state

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStore(t *testing.T) {
	// Create a temporary directory for testing
	tmpDir := t.TempDir()
	// Set HOME environment variable to our temp dir for the test
	origHome := os.Getenv("HOME")
	err := os.Setenv("HOME", tmpDir)
	if err != nil {
		t.Fatalf("Failed to set HOME: %v", err)
	}
	defer func() { _ = os.Setenv("HOME", origHome) }()

	s, err := NewStore()
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}

	// Test that file doesn't exist initially
	if s.Exists() {
		t.Fatalf("Expected store file not to exist initially")
	}

	// Test loading from missing file returns empty config
	cfg, err := s.Load()
	if err != nil {
		t.Fatalf("Load failed on missing file: %v", err)
	}
	if !cfg.IsEmpty() {
		t.Fatalf("Expected empty config from missing file, got %+v", cfg)
	}

	// Test saving a config
	testCfg := &Config{
		DeviceName:  "test-device",
		DownloadDir: "/tmp/test",
		TransferStats: TransferStats{
			UploadBytes:   1000,
			DownloadBytes: 2000,
			UploadFiles:   5,
			DownloadFiles: 10,
		},
	}
	if err := s.Save(testCfg); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Verify file now exists
	if !s.Exists() {
		t.Fatalf("Expected store file to exist after Save")
	}

	// Load the saved config and verify it matches
	loadedCfg, err := s.Load()
	if err != nil {
		t.Fatalf("Load failed after Save: %v", err)
	}
	if loadedCfg.DeviceName != testCfg.DeviceName {
		t.Fatalf("Expected DeviceName %s, got %s", testCfg.DeviceName, loadedCfg.DeviceName)
	}
	if loadedCfg.DownloadDir != testCfg.DownloadDir {
		t.Fatalf("Expected DownloadDir %s, got %s", testCfg.DownloadDir, loadedCfg.DownloadDir)
	}
	if loadedCfg.TransferStats.UploadBytes != testCfg.TransferStats.UploadBytes {
		t.Fatalf("Expected UploadBytes %d, got %d", testCfg.TransferStats.UploadBytes, loadedCfg.TransferStats.UploadBytes)
	}
	if loadedCfg.TransferStats.DownloadBytes != testCfg.TransferStats.DownloadBytes {
		t.Fatalf("Expected DownloadBytes %d, got %d", testCfg.TransferStats.DownloadBytes, loadedCfg.TransferStats.DownloadBytes)
	}
	if loadedCfg.TransferStats.UploadFiles != testCfg.TransferStats.UploadFiles {
		t.Fatalf("Expected UploadFiles %d, got %d", testCfg.TransferStats.UploadFiles, loadedCfg.TransferStats.UploadFiles)
	}
	if loadedCfg.TransferStats.DownloadFiles != testCfg.TransferStats.DownloadFiles {
		t.Fatalf("Expected DownloadFiles %d, got %d", testCfg.TransferStats.DownloadFiles, loadedCfg.TransferStats.DownloadFiles)
	}

	// Test deleting the file
	if err := s.Delete(); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if s.Exists() {
		t.Fatalf("Expected store file not to exist after Delete")
	}

	// Test loading after delete returns empty config
	cfgAfterDelete, err := s.Load()
	if err != nil {
		t.Fatalf("Load failed after Delete: %v", err)
	}
	if !cfgAfterDelete.IsEmpty() {
		t.Fatalf("Expected empty config after Delete, got %+v", cfgAfterDelete)
	}

	// Test corrupt file handling
	corruptPath := filepath.Join(tmpDir, ".dropConfig")
	if err := os.WriteFile(corruptPath, []byte("{ invalid json"), 0644); err != nil {
		t.Fatalf("Failed to write corrupt file: %v", err)
	}
	// Point store to corrupt file
	s.configPath = corruptPath
	s.tmpPath = corruptPath + ".tmp"

	cfgCorrupt, err := s.Load()
	if err != nil {
		t.Fatalf("Load failed on corrupt file: %v", err)
	}
	if !cfgCorrupt.IsEmpty() {
		t.Fatalf("Expected empty config from corrupt file, got %+v", cfgCorrupt)
	}

	// Verify corrupt file still exists (should not be overwritten)
	if _, err := os.Stat(corruptPath); os.IsNotExist(err) {
		t.Fatalf("Corrupt file should not be deleted")
	}
}