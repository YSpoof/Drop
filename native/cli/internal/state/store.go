package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Store manages the persistent configuration file (.dropConfig) in the user's home directory.
// It provides atomic read/write operations with error handling for missing or corrupt files.
type Store struct {
	mu        sync.Mutex
	configPath string
	tmpPath    string
	isTest     bool
}

// NewStore creates a new Store instance with the default config file location.
func NewStore() (*Store, error) {
	home, err := getHomeDir()
	if err != nil {
		return nil, err
	}
	configPath := filepath.Join(home, ConfigFile)
	s := &Store{
		configPath: configPath,
		tmpPath:    configPath + ".tmp",
	}
	return s, nil
}

// NewTestStore creates a store for testing, avoiding real home directory.
func NewTestStore(path string) *Store {
	return &Store{
		configPath: path,
		tmpPath:    path + ".tmp",
		isTest:     true,
	}
}

// Load reads the config from disk, returning an empty config on error/missing.
// This matches the spec's requirement: "When the CLI starts and ~/.dropConfig does not exist,
// the CLI uses existing in-memory defaults and does not create the file until a value changes."
func (s *Store) Load() (*Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Missing config file - return empty config
			return &Config{}, nil
		}
		// Other error - return empty config but don't fail
		return &Config{}, nil
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		// Corrupt config file - preserve it and return empty config
		// This matches the spec: "When the CLI starts and ~/.dropConfig exists but cannot be parsed as JSON,
		// the CLI ignores the file, uses in-memory defaults, and does not overwrite the corrupt file until a value is explicitly changed."
		return &Config{}, nil
	}

	return &cfg, nil
}

// Save writes the config to disk atomically using temp file + rename.
// This ensures no corruption from interrupted writes.
func (s *Store) Save(cfg *Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}

	// Write to temp file
	if err := os.WriteFile(s.tmpPath, data, 0644); err != nil {
		return err
	}

	// Atomic rename
	if err := os.Rename(s.tmpPath, s.configPath); err != nil {
		// Clean up temp file if rename fails
		os.Remove(s.tmpPath)
		return err
	}

	return nil
}

// Exists returns whether the config file exists.
func (s *Store) Exists() bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := os.Stat(s.configPath)
	return !os.IsNotExist(err)
}

// Delete removes the config file.
func (s *Store) Delete() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Clean up temp file first
	os.Remove(s.tmpPath)
	return os.Remove(s.configPath)
}

// ConfigFile returns the path to the config file.
func (s *Store) ConfigFile() string {
	return s.configPath
}