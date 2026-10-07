package quick

import (
	"fmt"
	"io"
	"os"
	"sync"
	"sync/atomic"

	"dropcli/internal/adapters/fs"
	"dropcli/internal/adapters/signaling"
	"dropcli/internal/ports"
	"dropcli/internal/services"
	"dropcli/internal/state"
	"dropcli/internal/webrtc"
)

type Runner struct {
	repo          ports.FileRepository
	signalingPort ports.SignalingPort
	settings      *state.Settings
	deviceState   *state.DeviceState
	peerState     *state.PeerState
	transferState *state.TransferState
	downloadSvc   *services.DownloadService
	transferSvc   *services.TransferService
	webrtcSession *webrtc.Session
	sessionConfig webrtc.SessionConfig

	Stdout io.Writer
	Stderr io.Writer

	mu                  sync.Mutex
	sessionGate         sync.Mutex
	sessionActive       bool
	everReady           bool
	lastConnectedPeerID string
	waitingReconnect    bool

	// inboxUI is true while the receive-inbox tea program owns the TTY.
	// Console status lines must not write to stdout/stderr in that window.
	inboxUI atomic.Bool
}

// RunnerOption configures a Runner instance.
type RunnerOption func(*Runner)

// WithRepository configures the file repository.
func WithRepository(repo ports.FileRepository) RunnerOption {
	return func(r *Runner) {
		r.repo = repo
	}
}

// WithSignalingPort configures the signaling port.
func WithSignalingPort(sp ports.SignalingPort) RunnerOption {
	return func(r *Runner) {
		r.signalingPort = sp
	}
}

// WithDeviceState configures custom device state.
func WithDeviceState(ds *state.DeviceState) RunnerOption {
	return func(r *Runner) {
		r.deviceState = ds
	}
}

// WithSettings configures custom settings.
func WithSettings(s *state.Settings) RunnerOption {
	return func(r *Runner) {
		r.settings = s
	}
}

// NewRunner creates a concrete Runner with sensible defaults.
func NewRunner(opts ...RunnerOption) *Runner {
	r := &Runner{
		settings:      state.NewSettings(),
		peerState:     state.NewPeerState(),
		transferState: state.NewTransferState(),
		sessionConfig: webrtc.DefaultSessionConfig(),
		Stdout:        os.Stdout,
		Stderr:        os.Stderr,
	}

	for _, opt := range opts {
		opt(r)
	}

	if r.repo == nil {
		r.repo = fs.NewRepository()
	}
	if r.deviceState == nil {
		r.deviceState = state.NewDeviceState("")
	}
	if r.signalingPort == nil {
		r.signalingPort = signaling.NewClient()
	}

	r.downloadSvc = services.NewDownloadService(r.repo, r.transferState, r.settings)
	r.transferSvc = services.NewTransferService(r.repo, r.transferState, r.downloadSvc)

	return r
}

// GetSettings returns the settings instance.
func (r *Runner) GetSettings() *state.Settings {
	return r.settings
}

// GetPeerState returns the peer state instance.
func (r *Runner) GetPeerState() *state.PeerState {
	return r.peerState
}

// GetTransferState returns the transfer state instance.
func (r *Runner) GetTransferState() *state.TransferState {
	return r.transferState
}

// GetDownloadService returns the download service instance.
func (r *Runner) GetDownloadService() *services.DownloadService {
	return r.downloadSvc
}

// GetTransferService returns the transfer service instance.
func (r *Runner) GetTransferService() *services.TransferService {
	return r.transferSvc
}

// IsWaitingReconnect reports whether the runner is in wait-to-reconnect.
func (r *Runner) IsWaitingReconnect() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.waitingReconnect
}

func (r *Runner) setInboxUI(v bool) { r.inboxUI.Store(v) }

func (r *Runner) inboxUIActive() bool { return r.inboxUI.Load() }

// consoleFprint writes to w unless the inbox tea UI owns the terminal.
func (r *Runner) consoleFprint(w io.Writer, s string) {
	if r.inboxUIActive() {
		return
	}
	fmt.Fprint(w, s)
}

// consoleFprintf formats and writes unless the inbox tea UI owns the terminal.
func (r *Runner) consoleFprintf(w io.Writer, format string, args ...any) {
	if r.inboxUIActive() {
		return
	}
	fmt.Fprintf(w, format, args...)
}
