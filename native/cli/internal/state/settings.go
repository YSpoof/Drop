package state

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	DefaultRawWSURL = "https://drop.lzart.com.br/ws"
	EnvDropWSURL    = "DROP_WS_URL"
	ConfigFile      = ".dropConfig"
)

// Config stores the persisted configuration for DropCli.
// JSON tags are required for serialization.
// Auto-download is session-scoped only (not persisted); legacy autoDownload JSON is ignored on load.
type Config struct {
	DeviceName    string        `json:"deviceName"`
	DownloadDir   string        `json:"downloadDir"`
	TransferStats TransferStats `json:"transferStats"`
}

// TransferStats tracks lifetime upload and download totals.
type TransferStats struct {
	UploadBytes   int64 `json:"uploadBytes"`
	DownloadBytes int64 `json:"downloadBytes"`
	UploadFiles   int64 `json:"uploadFiles"`
	DownloadFiles int64 `json:"downloadFiles"`
}

// IsEmpty reports whether the config has non-zero values (i.e. has been set).
func (c *Config) IsEmpty() bool {
	return c.DeviceName == "" && c.DownloadDir == "" && c.TransferStats.IsZero()
}

// IsZero reports whether TransferStats are zero.
func (ts *TransferStats) IsZero() bool {
	return ts.UploadBytes == 0 && ts.DownloadBytes == 0 && ts.UploadFiles == 0 && ts.DownloadFiles == 0
}


// NormalizeWebSocketURL ensures the URL uses WebSocket schemes (ws:// or wss://).
func NormalizeWebSocketURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = DefaultRawWSURL
	}
	if strings.HasPrefix(raw, "https://") {
		return "wss://" + strings.TrimPrefix(raw, "https://")
	}
	if strings.HasPrefix(raw, "http://") {
		return "ws://" + strings.TrimPrefix(raw, "http://")
	}
	if !strings.HasPrefix(raw, "ws://") && !strings.HasPrefix(raw, "wss://") {
		return "wss://" + raw
	}
	return raw
}

// getHomeDir returns the user's home directory or an error.
func getHomeDir() (string, error) {
	return os.UserHomeDir()
}

// Connection status constants for the peer state.
type ConnectionStatus string

const (
	StatusIdle             ConnectionStatus = "idle"
	StatusConnecting       ConnectionStatus = "connecting"
	StatusConnected        ConnectionStatus = "connected"
	StatusDisconnected     ConnectionStatus = "disconnected"
	StatusFailed           ConnectionStatus = "failed"
	StatusWaitingReconnect ConnectionStatus = "waiting_reconnect"
)

// Role constants for the peer state.
type Role string

const (
	RoleNone  Role = "none"
	RoleHost  Role = "host"
	RoleJoiner Role = "joiner"
)

// Settings stores configuration for DropCli execution.
type Settings struct {
	mu           sync.RWMutex
	wsURL        string
	deviceName   string
	downloadDir  string
	autoDownload bool

	configPath string
	loadedCfg  *Config

	store   *Store
}

// WithStore allows injecting a custom store for testing.
func (s *Settings) WithStore(store *Store) {
	s.store = store
}

// NewSettings initializes default settings with environment variable and CWD defaults.
func NewSettings() *Settings {
	wsURL := os.Getenv(EnvDropWSURL)
	if wsURL == "" {
		wsURL = DefaultRawWSURL
	}
	normalizedURL := NormalizeWebSocketURL(wsURL)

	cwd, err := os.Getwd()
	if err != nil || cwd == "" {
		cwd = "."
	}
	absCwd, err := filepath.Abs(cwd)
	if err == nil {
		cwd = absCwd
	}

	s := &Settings{
		wsURL:        normalizedURL,
		deviceName:   "",
		downloadDir:  cwd,
		autoDownload: true,
	}
	home, err := getHomeDir()
	if err == nil {
		s.configPath = filepath.Join(home, ConfigFile)
	}

	// Initialize store
	s.store, _ = NewStore()

	// Load persisted config to initialize defaults (auto-download is session-scoped, not loaded).
	if cfg, err := s.LoadConfig(); err == nil {
		s.loadedCfg = cfg
		if cfg.DeviceName != "" {
			s.deviceName = cfg.DeviceName
		}
		if cfg.DownloadDir != "" {
			s.downloadDir = cfg.DownloadDir
		}
	}

	return s
}

// GetWSURL returns the normalized WebSocket URL.
func (s *Settings) GetWSURL() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.wsURL
}

// SetWSURL sets and normalizes the WebSocket URL.
func (s *Settings) SetWSURL(url string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.wsURL = NormalizeWebSocketURL(url)
	// Mark config dirty
	if s.loadedCfg != nil {
		s.loadedCfg.DeviceName = s.deviceName
	}
}

// GetDeviceName returns the configured device display name.
func (s *Settings) GetDeviceName() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.deviceName
}

// SetDeviceName sets the device display name.
func (s *Settings) SetDeviceName(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if name != "" {
		s.deviceName = name
	}
	// Mark config dirty
	if s.loadedCfg != nil {
		s.loadedCfg.DeviceName = s.deviceName
	}
}

// GetDownloadDir returns the directory where downloaded files are saved.
func (s *Settings) GetDownloadDir() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.downloadDir
}

// SetDownloadDir sets the target download directory (e.g. from -o / --output).
func (s *Settings) SetDownloadDir(dir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if dir != "" {
		if abs, err := filepath.Abs(dir); err == nil {
			s.downloadDir = abs
		} else {
			s.downloadDir = dir
		}
	}
	// Mark config dirty
	if s.loadedCfg != nil {
		s.loadedCfg.DownloadDir = s.downloadDir
	}
}

// GetAutoDownload returns whether incoming files should be automatically downloaded.
// Session-scoped only; not persisted to ~/.dropConfig.
func (s *Settings) GetAutoDownload() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.autoDownload
}

// SetAutoDownload updates the session-scoped auto-download flag (not persisted).
func (s *Settings) SetAutoDownload(auto bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.autoDownload = auto
}

// LoadConfig loads the config from disk, returning defaults on error/missing.
func (s *Settings) LoadConfig() (*Config, error) {
	if s.store == nil {
		return &Config{}, nil
	}

	return s.store.Load()
}

// SaveConfig atomically writes the current settings to disk.
// Preserves existing TransferStats so a settings save does not wipe lifetime totals.
func (s *Settings) SaveConfig() error {
	if s.store == nil {
		return errors.New("store not initialized")
	}

	existing, err := s.store.Load()
	if err != nil {
		existing = &Config{}
	}

	s.mu.RLock()
	cfg := &Config{
		DeviceName:    s.deviceName,
		DownloadDir:   s.downloadDir,
		TransferStats: existing.TransferStats,
	}
	s.mu.RUnlock()

	if err := s.store.Save(cfg); err != nil {
		return err
	}

	s.mu.Lock()
	s.loadedCfg = cfg
	s.mu.Unlock()
	return nil
}

// FlushStats writes transfer stats to the config file.
func (s *Settings) FlushStats(stats *TransferStats) error {
	if s.store == nil {
		return errors.New("store not initialized")
	}

	cfg, err := s.store.Load()
	if err != nil {
		return err
	}

	// Update transfer stats in the config
	cfg.TransferStats = *stats

	return s.store.Save(cfg)
}

// ResetStats zeroes the transfer stats and saves them.
func (s *Settings) ResetStats() error {
	stats := &TransferStats{} // Zero values
	return s.FlushStats(stats)
}
