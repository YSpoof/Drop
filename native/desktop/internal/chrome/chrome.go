package chrome

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Arguments returns the standard command-line flags for running Chrome in application mode.
func Arguments(url, profileDir string, width, height int) []string {
	args := []string{
		"--app=" + url,
		"--user-data-dir=" + filepath.Clean(profileDir),
		"--disable-background-networking",
		"--disable-background-timer-throttling",
		"--disable-backgrounding-occluded-windows",
		"--disable-breakpad",
		"--disable-default-apps",
		"--disable-dev-shm-usage",
		"--disable-infobars",
		"--disable-extensions",
		"--disable-features=LocalNetworkAccessChecks",
		"--disable-hang-monitor",
		"--disable-popup-blocking",
		"--disable-prompt-on-repost",
		"--disable-renderer-backgrounding",
		"--disable-sync",
		"--disable-translate",
		"--metrics-recording-only",
		"--no-first-run",
		"--no-default-browser-check",
	}

	if width > 0 && height > 0 {
		args = append(args, fmt.Sprintf("--window-size=%d,%d", width, height))
	}

	switch runtime.GOOS {
	case "windows":
		args = append(args, "--disable-windows10-custom-titlebar")
	case "darwin":
		args = append(args, "--use-mock-keychain")
	case "linux":
		args = append(args, "--password-store=basic")
	}

	return args
}

// PersistentProfileDir returns the Chrome profile directory used across launches.
func PersistentProfileDir() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("user config directory: %w", err)
	}

	profileDir := filepath.Join(configDir, "Drop", "Chrome")
	if err := os.MkdirAll(profileDir, 0o700); err != nil {
		return "", fmt.Errorf("create Chrome profile directory: %w", err)
	}
	return profileDir, nil
}

// Find locates a Chrome or Chromium executable on the system.
func Find() (string, error) {
	var candidates []string
	if configured := os.Getenv("CHROME_BIN"); configured != "" {
		candidates = append(candidates, configured)
	}

	switch runtime.GOOS {
	case "windows":
		candidates = append(candidates, "chrome.exe", "chrome")
	case "darwin":
		candidates = append(candidates,
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"google-chrome", "chrome", "chromium")
	default:
		candidates = append(candidates,
			"google-chrome",
			"google-chrome-stable",
			"chrome",
			"chromium",
			"chromium-browser")
	}

	for _, candidate := range candidates {
		if path, err := exec.LookPath(candidate); err == nil {
			return path, nil
		}
	}

	return "", fmt.Errorf("Chrome is required but was not found; install Google Chrome/Chromium or set CHROME_BIN")
}

// Command creates an exec.Cmd configured to launch Chrome with an isolated profile.
func Command(url, profileDir string, width, height int) (*exec.Cmd, error) {
	path, err := Find()
	if err != nil {
		return nil, err
	}
	return exec.Command(path, Arguments(url, profileDir, width, height)...), nil
}
