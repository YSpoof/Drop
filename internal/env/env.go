package env

import "os"

// Get returns the environment variable value or the provided default.
func Get(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}