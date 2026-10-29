package chrome

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestArguments(t *testing.T) {
	url := "https://drop.lzart.com.br/?dropPort=54321&dropToken=secret"
	profileDir := "/tmp/test-profile"
	width, height := 1024, 768

	args := Arguments(url, profileDir, width, height)

	hasApp := false
	hasProfile := false
	hasWindowSize := false
	hasNetworkAccessOverride := false

	for _, arg := range args {
		if strings.HasPrefix(arg, "--app=") && strings.Contains(arg, url) {
			hasApp = true
		}
		if strings.HasPrefix(arg, "--user-data-dir=") && strings.Contains(arg, profileDir) {
			hasProfile = true
		}
		if arg == "--window-size=1024,768" {
			hasWindowSize = true
		}
		if arg == "--disable-features=LocalNetworkAccessChecks" {
			hasNetworkAccessOverride = true
		}
	}

	if !hasApp {
		t.Errorf("expected --app flag containing url %q", url)
	}
	if !hasProfile {
		t.Errorf("expected --user-data-dir flag containing %q", profileDir)
	}
	if !hasWindowSize {
		t.Errorf("expected --window-size=1024,768")
	}
	if !hasNetworkAccessOverride {
		t.Error("expected Local Network Access feature override")
	}
}

func TestPersistentProfileDir(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("uses XDG_CONFIG_HOME")
	}

	configDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", configDir)

	profileDir, err := PersistentProfileDir()
	if err != nil {
		t.Fatalf("PersistentProfileDir returned an error: %v", err)
	}
	if want := filepath.Join(configDir, "Drop", "Chrome"); profileDir != want {
		t.Fatalf("expected profile directory %q, got %q", want, profileDir)
	}

	info, err := os.Stat(profileDir)
	if err != nil {
		t.Fatalf("profile directory was not created: %v", err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("profile directory permissions are too broad: %o", info.Mode().Perm())
	}
}

func TestFind(t *testing.T) {
	// If Chrome is installed on the host, Find() should succeed.
	// Otherwise, it returns an explicit error stating Chrome is required.
	path, err := Find()
	if err != nil {
		t.Logf("Find returned error (expected if no Chrome installed in test environment): %v", err)
	} else {
		t.Logf("Found Chrome at: %s", path)
	}
}
