package state

import (
	"os"
	"path/filepath"
	"testing"
)

func newTestStore(path string) *Store {
	return &Store{
		configPath: path,
		tmpPath:    path + ".tmp",
	}
}

func testSettings(t *testing.T) *Settings {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	path := filepath.Join(t.TempDir(), ".dropConfig")
	s := NewSettings()
	s.WithStore(newTestStore(path))
	return s
}

func TestDonationConstants(t *testing.T) {
	if DonationReminderInterval != 25 {
		t.Fatalf("DonationReminderInterval = %d, want 25", DonationReminderInterval)
	}
	const wantPIX = "cee3846a-a1ab-4e81-83ac-c5edb016fd71"
	if DonationPixKey != wantPIX {
		t.Fatalf("DonationPixKey = %q, want %q", DonationPixKey, wantPIX)
	}
}

func TestSaveConfigPreservesVisitFields(t *testing.T) {
	s := testSettings(t)

	store := s.store
	if err := store.Save(&Config{
		DeviceName:             "dev",
		VisitCount:             10,
		DonationReminderAnchor: 5,
		TransferStats: TransferStats{
			UploadBytes: 7,
		},
	}); err != nil {
		t.Fatalf("seed Save: %v", err)
	}

	s.SetDeviceName("renamed")
	if err := s.SaveConfig(); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	loaded, err := s.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if loaded.VisitCount != 10 {
		t.Fatalf("VisitCount wiped: got %d want 10", loaded.VisitCount)
	}
	if loaded.DonationReminderAnchor != 5 {
		t.Fatalf("DonationReminderAnchor wiped: got %d want 5", loaded.DonationReminderAnchor)
	}
	if loaded.TransferStats.UploadBytes != 7 {
		t.Fatalf("TransferStats wiped: got %+v", loaded.TransferStats)
	}
	if loaded.DeviceName != "renamed" {
		t.Fatalf("DeviceName = %q, want renamed", loaded.DeviceName)
	}
}

func TestFlushStatsPreservesVisitFields(t *testing.T) {
	s := testSettings(t)

	if err := s.store.Save(&Config{
		VisitCount:             12,
		DonationReminderAnchor: 0,
	}); err != nil {
		t.Fatalf("seed Save: %v", err)
	}

	stats := &TransferStats{DownloadFiles: 3}
	if err := s.FlushStats(stats); err != nil {
		t.Fatalf("FlushStats: %v", err)
	}

	loaded, err := s.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if loaded.VisitCount != 12 || loaded.DonationReminderAnchor != 0 {
		t.Fatalf("visit fields wiped: count=%d anchor=%d", loaded.VisitCount, loaded.DonationReminderAnchor)
	}
	if loaded.TransferStats != *stats {
		t.Fatalf("stats = %+v, want %+v", loaded.TransferStats, *stats)
	}
}

func TestRecordVisitFirstDueAt25(t *testing.T) {
	s := testSettings(t)

	for i := 1; i <= 24; i++ {
		due, err := s.RecordVisit()
		if err != nil {
			t.Fatalf("RecordVisit #%d: %v", i, err)
		}
		if due {
			t.Fatalf("due at visit %d, want not due until 25", i)
		}
	}

	due, err := s.RecordVisit()
	if err != nil {
		t.Fatalf("RecordVisit #25: %v", err)
	}
	if !due {
		t.Fatal("expected due at visit 25")
	}

	cfg, err := s.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.VisitCount != 25 {
		t.Fatalf("VisitCount = %d, want 25", cfg.VisitCount)
	}
}

func TestRecordVisitNoStackWhileDue(t *testing.T) {
	s := testSettings(t)

	if err := s.store.Save(&Config{VisitCount: 24, DonationReminderAnchor: 0}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	due, err := s.RecordVisit()
	if err != nil || !due {
		t.Fatalf("want due after visit 25, due=%v err=%v", due, err)
	}

	due2, err := s.RecordVisit()
	if err != nil {
		t.Fatalf("RecordVisit while due: %v", err)
	}
	if !due2 {
		t.Fatal("expected still due after extra visit")
	}

	cfg, err := s.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.VisitCount != 26 {
		t.Fatalf("VisitCount = %d, want 26", cfg.VisitCount)
	}
	if cfg.DonationReminderAnchor != 0 {
		t.Fatalf("anchor changed while due: %d", cfg.DonationReminderAnchor)
	}
}

func TestDismissStartsNextInterval(t *testing.T) {
	s := testSettings(t)

	if err := s.store.Save(&Config{VisitCount: 25, DonationReminderAnchor: 0}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := s.DismissDonationReminder(); err != nil {
		t.Fatalf("Dismiss: %v", err)
	}

	due, err := s.IsDonationReminderDue()
	if err != nil {
		t.Fatalf("IsDue: %v", err)
	}
	if due {
		t.Fatal("expected not due immediately after dismiss")
	}

	cfg, err := s.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.DonationReminderAnchor != 25 {
		t.Fatalf("anchor = %d, want 25", cfg.DonationReminderAnchor)
	}

	// Visits 26..49 not due; 50 is due (25 + 25).
	for i := 26; i <= 49; i++ {
		due, err := s.RecordVisit()
		if err != nil {
			t.Fatalf("RecordVisit #%d: %v", i, err)
		}
		if due {
			t.Fatalf("due at visit %d, want next due at 50", i)
		}
	}

	due, err = s.RecordVisit()
	if err != nil {
		t.Fatalf("RecordVisit #50: %v", err)
	}
	if !due {
		t.Fatal("expected due at visit 50 (N+25)")
	}
}

func TestVisitRoundTrip(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	_ = os.Unsetenv(EnvDropWSURL)

	path := filepath.Join(home, ConfigFile)
	s := NewSettings()
	s.WithStore(newTestStore(path))

	if _, err := s.RecordVisit(); err != nil {
		t.Fatalf("RecordVisit: %v", err)
	}
	if _, err := s.RecordVisit(); err != nil {
		t.Fatalf("RecordVisit: %v", err)
	}

	s2 := NewSettings()
	s2.WithStore(newTestStore(path))
	cfg, err := s2.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.VisitCount != 2 {
		t.Fatalf("VisitCount = %d, want 2 after reload", cfg.VisitCount)
	}
}
