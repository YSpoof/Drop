package tui

import (
	"os"
	"testing"

	"dropcli/internal/state"
)

func TestValidatePIN_Valid(t *testing.T) {
	validPINs := []string{"0000", "1234", "9999", "0123"}
	for _, pin := range validPINs {
		if err := ValidatePIN(pin); err != nil {
			t.Errorf("expected valid PIN %q, got error: %v", pin, err)
		}
	}
}

func TestValidatePIN_Invalid(t *testing.T) {
	invalidPINs := []string{
		"",      // empty
		"123",   // too short
		"12345", // too long
		"abcd",  // letters
		"12 34", // spaces
		"12-34", // hyphen
		"123a",  // trailing letter
	}
	for _, pin := range invalidPINs {
		if err := ValidatePIN(pin); err == nil {
			t.Errorf("expected invalid PIN %q to fail validation", pin)
		}
	}
}

func TestFormResult_Modes(t *testing.T) {
	if ModeHost != "host" {
		t.Errorf("expected ModeHost to be 'host', got %q", ModeHost)
	}
	if ModeJoin != "join" {
		t.Errorf("expected ModeJoin to be 'join', got %q", ModeJoin)
	}
}

func TestResetStatsConfirmationPath(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	_ = os.Unsetenv(state.EnvDropWSURL)

	settings := state.NewSettings()

	// Set initial stats
	stats := &state.TransferStats{
		UploadBytes:   100,
		DownloadBytes: 200,
		UploadFiles:   1,
		DownloadFiles: 2,
	}
	if err := settings.FlushStats(stats); err != nil {
		t.Fatalf("failed to flush test stats: %v", err)
	}

	// Verify stats are set
	loadedCfg, err := settings.LoadConfig()
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}
	if loadedCfg.TransferStats.IsZero() {
		t.Fatalf("failed to set up test stats: stats are still zero")
	}

	// Verify that calling ResetStats zeroes them
	if err := settings.ResetStats(); err != nil {
		t.Fatalf("ResetStats failed: %v", err)
	}

	resetCfg, err := settings.LoadConfig()
	if err != nil {
		t.Fatalf("failed to load config after reset: %v", err)
	}
	if !resetCfg.TransferStats.IsZero() {
		t.Errorf("expected transfer stats to be zeroed after ResetStats, got %+v", resetCfg.TransferStats)
	}
}

func TestRunConfigMenu_NilSettings(t *testing.T) {
	if err := RunConfigMenu(nil); err == nil {
		t.Error("expected error for nil settings")
	}
}
