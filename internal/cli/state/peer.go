package state

import (
	"sync"
)

// RemotePeerImpl is a concrete implementation of the RemotePeer interface.
type RemotePeerImpl struct {
	id           string
	displayName string
}

func (r *RemotePeerImpl) GetID() string {
	return r.id
}

func (r *RemotePeerImpl) GetDisplayName() string {
	return r.displayName
}

// PeerState manages the connection state with the remote peer.
type PeerState struct {
	mu     sync.Mutex
	status ConnectionStatus
	role   Role
	pin    string
	remote RemotePeer
	viaLan bool
}

// NewPeerState creates a new PeerState in idle status.
func NewPeerState() *PeerState {
	return &PeerState{
		status: StatusIdle,
	}
}

// GetStatus returns the current connection status.
func (p *PeerState) GetStatus() ConnectionStatus {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.status
}

// SetStatus updates the connection status.
func (p *PeerState) SetStatus(status ConnectionStatus) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.status = status
}

// GetRole returns the current role (host/joiner).
func (p *PeerState) GetRole() Role {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.role
}

// SetRole updates the role.
func (p *PeerState) SetRole(role Role) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.role = role
}

// GetPIN returns the PIN for joiner mode.
func (p *PeerState) GetPIN() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.pin
}

// SetPIN updates the PIN for joiner mode.
func (p *PeerState) SetPIN(pin string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.pin = pin
}

// GetRemotePeer returns the connected remote peer info.
func (p *PeerState) GetRemotePeer() (RemotePeer, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.remote == nil {
		return nil, false
	}
	return p.remote, true
}

// SetRemotePeer sets the connected remote peer info.
func (p *PeerState) SetRemotePeer(remote RemotePeer) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.remote = remote
}

// GetViaLan reports whether the current pairing was accepted as LAN.
func (p *PeerState) GetViaLan() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.viaLan
}

// SetViaLan records whether the current pairing is LAN (signaling lan flag).
func (p *PeerState) SetViaLan(viaLan bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.viaLan = viaLan
}

// Clear resets the peer state to idle.
func (p *PeerState) Clear() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.status = StatusIdle
	p.role = RoleNone
	p.pin = ""
	p.remote = nil
	p.viaLan = false
}

// RemotePeer interface defines the remote peer information.
type RemotePeer interface {
	GetID() string
	GetDisplayName() string
}

// NewRemotePeer creates a new RemotePeer with the given ID and display name.
func NewRemotePeer(id, displayName string) RemotePeer {
	return &RemotePeerImpl{
		id:           id,
		displayName: displayName,
	}
}