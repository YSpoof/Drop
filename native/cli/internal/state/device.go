package state

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"sync"
)

// DeviceState maintains thread-safe information about the local device and peer identity.
type DeviceState struct {
	mu          sync.RWMutex
	peerID      string
	hostname    string
	displayName string
}

// NewDeviceState initializes the device state with a unique peer ID and local hostname.
// If customDisplayName is empty, it attempts to use a persisted name from settings,
// falling back to the hostname.
func NewDeviceState(customDisplayName string, settings ...*Settings) *DeviceState {
	hostname, err := os.Hostname()
	if err != nil || hostname == "" {
		hostname = "dropcli-node"
	}

	peerID := generatePeerID()

	displayName := customDisplayName
	if displayName == "" {
		// Try to load from settings if provided
		if len(settings) > 0 && settings[0] != nil {
			if persistedName := settings[0].GetDeviceName(); persistedName != "" {
				displayName = persistedName
			}
		}
	}
	if displayName == "" {
		displayName = hostname
	}

	return &DeviceState{
		peerID:      peerID,
		hostname:    hostname,
		displayName: displayName,
	}
}

// generatePeerID creates a random 16-byte hex string for WebRTC peer identity.
func generatePeerID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "dropcli-" + hex.EncodeToString([]byte(os.Getenv("USER")))
	}
	return hex.EncodeToString(b)
}

// GetPeerID returns the unique local peer identifier.
func (d *DeviceState) GetPeerID() string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.peerID
}

// GetHostname returns the local machine hostname.
func (d *DeviceState) GetHostname() string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.hostname
}

// GetDisplayName returns the configured display name.
func (d *DeviceState) GetDisplayName() string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.displayName
}

// SetDisplayName updates the local display name.
func (d *DeviceState) SetDisplayName(name string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if name != "" {
		d.displayName = name
	}
}
