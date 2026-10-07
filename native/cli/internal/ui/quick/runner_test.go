package quick_test

import (
	"context"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"dropcli/internal/ui/quick"
)

// ---- ParseArgs / NewFlagSet tests ----

func TestParseFlagsHelp(t *testing.T) {
	var sb strings.Builder
	cfg := &quick.QuickConfig{}
	fs := quick.NewFlagSet(cfg)
	fs.SetOutput(&sb)

	err := fs.Parse([]string{"--help"})
	if err != flag.ErrHelp {
		t.Fatalf("expected ErrHelp, got %v", err)
	}
	out := sb.String()
	if !strings.Contains(out, "dropcli") {
		t.Errorf("usage output should mention 'dropcli', got: %s", out)
	}
	if !strings.Contains(out, "-q -s") {
		t.Errorf("usage should show -q -s synopsis, got: %s", out)
	}
}

func TestParseFlagsHelpShort(t *testing.T) {
	_, _, err := quick.ParseArgs([]string{"-h"})
	if err != flag.ErrHelp {
		t.Fatalf("expected ErrHelp for -h, got %v", err)
	}
}

func TestParseFlagsQuickHost(t *testing.T) {
	cfg, _, err := quick.ParseArgs([]string{"-q", "-s"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.Quick {
		t.Error("expected Quick=true")
	}
	if !cfg.Host {
		t.Error("expected Host=true")
	}
}

func TestParseFlagsQuickConnect(t *testing.T) {
	cfg, _, err := quick.ParseArgs([]string{"-q", "-c", "1234"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.Quick {
		t.Error("expected Quick=true")
	}
	if cfg.ConnectPIN != "1234" {
		t.Errorf("expected ConnectPIN=1234, got %s", cfg.ConnectPIN)
	}
}

func TestParseFlagsOutputDir(t *testing.T) {
	cfg, _, err := quick.ParseArgs([]string{"-q", "-s", "-o", "/tmp/downloads"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.OutputDir != "/tmp/downloads" {
		t.Errorf("expected OutputDir=/tmp/downloads, got %s", cfg.OutputDir)
	}
}

func TestParseFlagsPositionals(t *testing.T) {
	cfg, _, err := quick.ParseArgs([]string{"-q", "-s", "a.txt", "b.txt"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cfg.Paths) != 2 || cfg.Paths[0] != "a.txt" || cfg.Paths[1] != "b.txt" {
		t.Errorf("expected Paths=[a.txt b.txt], got %v", cfg.Paths)
	}
}

func TestParseFlagsRejectsRemovedFlags(t *testing.T) {
	cases := [][]string{
		{"-q", "-s", "-f", "x"},
		{"-q", "-s", "-d", "/tmp"},
		{"-q", "-s", "-url", "wss://x"},
		{"-q", "-s", "-name", "n"},
		{"-q", "-host"},
		{"--quick", "-s"},
	}
	for _, args := range cases {
		_, _, err := quick.ParseArgs(args)
		if err == nil {
			t.Errorf("expected error for removed flags %v", args)
		}
	}
}

// ---- Validate tests ----

func TestValidateNonQuickAlwaysValid(t *testing.T) {
	cfg := &quick.QuickConfig{Quick: false}
	if err := cfg.Validate(); err != nil {
		t.Errorf("expected no error for non-quick mode, got: %v", err)
	}
}

func TestValidateQuickRequiresHostOrConnect(t *testing.T) {
	cfg := &quick.QuickConfig{Quick: true}
	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected error when neither -s nor -c is specified")
	}
	if !strings.Contains(err.Error(), "host") || !strings.Contains(err.Error(), "connect") {
		t.Errorf("error message should mention 'host' and 'connect', got: %v", err)
	}
}

func TestValidateQuickHostAndConnectConflict(t *testing.T) {
	cfg := &quick.QuickConfig{Quick: true, Host: true, ConnectPIN: "1234"}
	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected error when both -s and -c are specified")
	}
}

func TestValidateQuickInvalidPIN(t *testing.T) {
	cases := []struct {
		pin  string
		desc string
	}{
		{"123", "too short"},
		{"12345", "too long"},
		{"abcd", "non-numeric"},
		{"", "empty"},
		{"12 4", "contains space"},
	}
	for _, tc := range cases {
		t.Run(tc.desc, func(t *testing.T) {
			cfg := &quick.QuickConfig{Quick: true, ConnectPIN: tc.pin}
			err := cfg.Validate()
			if err == nil {
				t.Errorf("expected error for invalid PIN %q (%s)", tc.pin, tc.desc)
			}
		})
	}
}

func TestValidateQuickValidPIN(t *testing.T) {
	cfg := &quick.QuickConfig{Quick: true, ConnectPIN: "1234"}
	if err := cfg.Validate(); err != nil {
		t.Errorf("expected no error for valid PIN, got: %v", err)
	}
}

func TestValidateQuickHost(t *testing.T) {
	cfg := &quick.QuickConfig{Quick: true, Host: true}
	if err := cfg.Validate(); err != nil {
		t.Errorf("expected no error for host-only quick mode, got: %v", err)
	}
}

func TestValidateClassifiesPaths(t *testing.T) {
	tmp := t.TempDir()
	filePath := filepath.Join(tmp, "a.txt")
	if err := os.WriteFile(filePath, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dirPath := filepath.Join(tmp, "inbox")
	if err := os.Mkdir(dirPath, 0755); err != nil {
		t.Fatal(err)
	}

	cfg := &quick.QuickConfig{
		Quick: true,
		Host:  true,
		Paths: []string{filePath, dirPath},
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cfg.SendFiles) != 1 || cfg.SendFiles[0] != filePath {
		t.Errorf("expected SendFiles=[%s], got %v", filePath, cfg.SendFiles)
	}
	if len(cfg.WatchDirs) != 1 || cfg.WatchDirs[0] != dirPath {
		t.Errorf("expected WatchDirs=[%s], got %v", dirPath, cfg.WatchDirs)
	}
}

func TestValidateRejectsMissingPath(t *testing.T) {
	cfg := &quick.QuickConfig{
		Quick: true,
		Host:  true,
		Paths: []string{"/no/such/path-dropcli-test"},
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for missing path")
	}
}

// ---- Runner construction tests ----

func TestNewRunnerDefaults(t *testing.T) {
	r := quick.NewRunner()
	if r == nil {
		t.Fatal("expected non-nil runner")
	}
	if r.GetSettings() == nil {
		t.Error("expected settings to be initialized")
	}
	if r.GetPeerState() == nil {
		t.Error("expected peer state to be initialized")
	}
	if r.GetTransferState() == nil {
		t.Error("expected transfer state to be initialized")
	}
	if r.GetDownloadService() == nil {
		t.Error("expected download service to be initialized")
	}
	if r.GetTransferService() == nil {
		t.Error("expected transfer service to be initialized")
	}
}

func TestRunnerSettingsOutputDir(t *testing.T) {
	r := quick.NewRunner()
	// Validate that settings can handle custom output directory
	r.GetSettings().SetDownloadDir("/tmp/testout")
	if got := r.GetSettings().GetDownloadDir(); got != "/tmp/testout" {
		t.Errorf("expected /tmp/testout, got %s", got)
	}
}

// ---- Run validation tests (without network) ----

func TestRunValidatesNonQuickMode(t *testing.T) {
	r := quick.NewRunner()
	cfg := &quick.QuickConfig{Quick: false}
	// Run should still work (non-quick, validate passes). Actually it will block
	// waiting for signaling, so we must cancel immediately.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// Should fail because no signaling — the cancel should propagate
	_ = r.Run(ctx, cfg)
}

func TestRunRejectsQuickWithoutHostOrConnect(t *testing.T) {
	r := quick.NewRunner()
	cfg := &quick.QuickConfig{Quick: true}
	ctx := context.Background()
	err := r.Run(ctx, cfg)
	if err == nil {
		t.Fatal("expected error for quick mode without host or connect")
	}
	if !strings.Contains(err.Error(), "host") {
		t.Errorf("error should mention 'host', got: %v", err)
	}
}

func TestRunRejectsQuickBothHostAndConnect(t *testing.T) {
	r := quick.NewRunner()
	cfg := &quick.QuickConfig{Quick: true, Host: true, ConnectPIN: "1234"}
	err := r.Run(ctx(t), cfg)
	if err == nil {
		t.Fatal("expected error when both host and connect specified")
	}
}

func TestRunRejectsInvalidPIN(t *testing.T) {
	r := quick.NewRunner()
	cfg := &quick.QuickConfig{Quick: true, ConnectPIN: "abc"}
	err := r.Run(ctx(t), cfg)
	if err == nil {
		t.Fatal("expected error for invalid PIN")
	}
}

func ctx(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return ctx
}

func TestSignalErrorIsFatalClosedPCAfterReady(t *testing.T) {
	// Post-ready closed-PC / nil session must not be treated as fatal process exit.
	if quick.SignalErrorIsFatal(true, true) {
		t.Fatal("expected closed session after ready to be non-fatal")
	}
	if quick.SignalErrorIsFatal(true, false) {
		t.Fatal("expected post-ready signal failure to be non-fatal")
	}
	if !quick.SignalErrorIsFatal(false, false) {
		t.Fatal("expected pre-ready open-session signal failure to be fatal")
	}
	if quick.SignalErrorIsFatal(false, true) {
		t.Fatal("expected closed session pre-ready to be non-fatal (stale)")
	}
}
