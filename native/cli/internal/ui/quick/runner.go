package quick

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"dropcli/internal/adapters/fs"
	"dropcli/internal/adapters/signaling"
	"dropcli/internal/adapters/watcher"
	"dropcli/internal/ports"
	"dropcli/internal/services"
	"dropcli/internal/state"
	"dropcli/internal/ui/text"
	"dropcli/internal/ui/tui"
	"dropcli/internal/webrtc"

	tea "github.com/charmbracelet/bubbletea"
	pionwebrtc "github.com/pion/webrtc/v4"
)

const resumeAfterDisconnect = 2 * time.Second

// QuickConfig encapsulates command-line options for quick mode execution.
type QuickConfig struct {
	Quick        bool
	Host         bool
	ConnectPIN   string
	Paths        []string // raw positional args
	SendFiles    []string // validated regular files from Paths
	WatchDirs    []string // validated directories from Paths
	OutputDir    string
	AutoDownload bool
	ReceiveInbox bool // interactive session inbox UI (not used with -q)
}

// NewFlagSet builds and configures a FlagSet with standard DropCli flags.
func NewFlagSet(cfg *QuickConfig) *flag.FlagSet {
	fs := flag.NewFlagSet("dropcli", flag.ContinueOnError)

	fs.BoolVar(&cfg.Quick, "q", false, text.FlagQuick)
	fs.BoolVar(&cfg.Host, "s", false, text.FlagHost)
	fs.StringVar(&cfg.ConnectPIN, "c", "", text.FlagConnect)
	fs.StringVar(&cfg.OutputDir, "o", "", text.FlagOutput)

	fs.Usage = func() {
		out := fs.Output()
		fmt.Fprint(out, text.UsageHeader+"\n")
		fmt.Fprint(out, text.UsageSynopsis)
		fmt.Fprint(out, text.UsageInteractive)
		fmt.Fprint(out, text.UsageInteractiveEx)
		fmt.Fprint(out, text.UsageQuick)
		fmt.Fprint(out, text.UsageQuickHost)
		fmt.Fprint(out, text.UsageQuickJoin)
		fmt.Fprint(out, text.UsageFlags)
		fs.PrintDefaults()
	}

	return fs
}

// ParseArgs parses command line arguments into QuickConfig using standard flags.
func ParseArgs(args []string) (*QuickConfig, *flag.FlagSet, error) {
	cfg := &QuickConfig{AutoDownload: true}
	fs := NewFlagSet(cfg)
	if err := fs.Parse(args); err != nil {
		return nil, fs, err
	}
	cfg.Paths = fs.Args()
	return cfg, fs, nil
}

// Validate checks QuickConfig constraints.
func (c *QuickConfig) Validate() error {
	return c.ValidateWithRepo(nil)
}

// ValidateWithRepo checks QuickConfig constraints using the given repository for filesystem checks.
func (c *QuickConfig) ValidateWithRepo(repo ports.FileRepository) error {
	if len(c.Paths) > 0 {
		if err := c.classifyPaths(repo); err != nil {
			return err
		}
	}
	if !c.Quick {
		return nil
	}
	if !c.Host && c.ConnectPIN == "" {
		return errors.New(text.ErrQuickNeedsHostOrConnect)
	}
	if c.Host && c.ConnectPIN != "" {
		return errors.New(text.ErrHostAndConnect)
	}
	if c.ConnectPIN != "" {
		if err := tui.ValidatePIN(c.ConnectPIN); err != nil {
			return fmt.Errorf(text.ErrInvalidPIN, err)
		}
	}
	return nil
}

// classifyPaths splits Paths into SendFiles and WatchDirs. Rejects missing/invalid paths.
func (c *QuickConfig) classifyPaths(_ ports.FileRepository) error {
	c.SendFiles = nil
	c.WatchDirs = nil
	for _, p := range c.Paths {
		fi, err := os.Stat(p)
		if err != nil {
			return fmt.Errorf(text.ErrPathMissing, err)
		}
		switch {
		case fi.IsDir():
			c.WatchDirs = append(c.WatchDirs, p)
		case fi.Mode().IsRegular():
			c.SendFiles = append(c.SendFiles, p)
		default:
			return fmt.Errorf(text.ErrPathUnsupported, p)
		}
	}
	return nil
}

// Runner coordinates the headless execution lifecycle in quick mode.
type Runner struct {
	repo          ports.FileRepository
	signalingPort ports.SignalingPort
	watcherPort   ports.WatcherPort
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

// WithWatcherPort configures the directory watcher port.
func WithWatcherPort(wp ports.WatcherPort) RunnerOption {
	return func(r *Runner) {
		r.watcherPort = wp
	}
}

// WithSessionConfig configures WebRTC ICE parameters.
func WithSessionConfig(cfg webrtc.SessionConfig) RunnerOption {
	return func(r *Runner) {
		r.sessionConfig = cfg
	}
}

// WithOutput sets the output writers.
func WithOutput(stdout, stderr io.Writer) RunnerOption {
	return func(r *Runner) {
		if stdout != nil {
			r.Stdout = stdout
		}
		if stderr != nil {
			r.Stderr = stderr
		}
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

// tryBeginSession returns true if a new WebRTC session may start.
func (r *Runner) tryBeginSession() bool {
	r.sessionGate.Lock()
	defer r.sessionGate.Unlock()
	if r.sessionActive {
		return false
	}
	r.sessionActive = true
	return true
}

// resetSessionGate allows a subsequent peer pairing to create a new session.
func (r *Runner) resetSessionGate() {
	r.sessionGate.Lock()
	r.sessionActive = false
	r.sessionGate.Unlock()
}

// SignalErrorIsFatal reports whether a HandleSignal failure should end the process.
// Post-ready / closed-PC failures are recoverable disconnects.
func SignalErrorIsFatal(everReady bool, sessionNilOrClosed bool) bool {
	if sessionNilOrClosed {
		return false
	}
	return !everReady
}

// Run executes the headless quick mode lifecycle.
func (r *Runner) Run(ctx context.Context, cfg *QuickConfig) error {
	if err := cfg.ValidateWithRepo(r.repo); err != nil {
		return err
	}

	if cfg.OutputDir != "" {
		r.settings.SetDownloadDir(cfg.OutputDir)
	}
	if err := r.repo.EnsureDir(r.settings.GetDownloadDir()); err != nil {
		return fmt.Errorf(text.ErrEnsureDownloadDir, err)
	}

	r.settings.SetAutoDownload(cfg.AutoDownload)

	if cfg.Host {
		r.peerState.SetRole(state.RoleHost)
	} else {
		r.peerState.SetRole(state.RoleJoiner)
		r.peerState.SetPIN(cfg.ConnectPIN)
	}

	readyCh := make(chan struct{}, 1)
	sessionStartedCh := make(chan struct{}, 1)
	disconnectCh := make(chan struct{}, 1)
	byeCh := make(chan struct{}, 1)
	errCh := make(chan error, 4)

	notifyDisconnect := func() {
		select {
		case disconnectCh <- struct{}{}:
		default:
		}
	}

	startSession := func(remotePeer ports.SignalingPeerInfo) {
		if !r.tryBeginSession() {
			return
		}
		r.peerState.SetRemotePeer(state.NewRemotePeer(remotePeer.ID, remotePeer.DisplayName))

		webrtcHandler := &quickWebRTCHandler{
			r:                r,
			remotePeerID:     remotePeer.ID,
			readyCh:          readyCh,
			errCh:            errCh,
			notifyDisconnect: notifyDisconnect,
		}

		r.mu.Lock()
		r.webrtcSession = webrtc.NewSession(webrtcHandler, r.sessionConfig)
		r.mu.Unlock()

		select {
		case sessionStartedCh <- struct{}{}:
		default:
		}

		if err := r.webrtcSession.Start(r.deviceState.GetPeerID(), remotePeer.ID); err != nil {
			r.resetSessionGate()
			select {
			case errCh <- fmt.Errorf(text.ErrWebRTCStart, err):
			default:
			}
		}
	}

	sigHandler := &quickSignalingHandler{
		r:                r,
		cfg:              cfg,
		startSession:     startSession,
		errCh:            errCh,
		notifyDisconnect: notifyDisconnect,
	}

	r.signalingPort.SetHandler(sigHandler)

	if err := r.signalingPort.Connect(ctx, r.settings.GetWSURL()); err != nil {
		return fmt.Errorf(text.ErrConnectSignaling, err)
	}
	defer r.signalingPort.Close()
	defer func() {
		r.mu.Lock()
		sess := r.webrtcSession
		r.mu.Unlock()
		if sess != nil {
			_ = sess.Close()
		}
	}()

	// Wait for peer pairing (no timeout — host may wait indefinitely for a joiner).
	// Host TTY: c/C copy PIN / share link while waiting.
	hostKeysCtx, hostKeysCancel := context.WithCancel(ctx)
	defer hostKeysCancel()
	if cfg.Host {
		go r.hostCopyKeys(hostKeysCtx)
	}
	select {
	case <-ctx.Done():
		hostKeysCancel()
		r.discardAllDrops()
		return ctx.Err()
	case err := <-errCh:
		hostKeysCancel()
		return err
	case <-sessionStartedCh:
		hostKeysCancel()
	}

	// Wait for first WebRTC ready after pairing
	if err := r.waitReady(ctx, readyCh, errCh, disconnectCh, 15*time.Second, false); err != nil {
		return err
	}
	r.onSessionReady()

	r.transferSvc.SetOnBye(func() {
		select {
		case byeCh <- struct{}{}:
		default:
		}
	})

	hasSend := len(cfg.SendFiles) > 0
	hasWatch := len(cfg.WatchDirs) > 0

	if cfg.ReceiveInbox {
		if hasSend || hasWatch {
			go func() {
				_ = r.runOutbound(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh)
			}()
		}
		return r.runReceiveInbox(ctx, errCh, byeCh, disconnectCh, readyCh, sessionStartedCh)
	}

	if hasWatch {
		return r.runWatchLoop(ctx, cfg, readyCh, errCh, disconnectCh, byeCh, sessionStartedCh)
	}

	if hasSend {
		return r.runSendFilesLoop(ctx, cfg, readyCh, errCh, disconnectCh, byeCh, sessionStartedCh)
	}

	return r.runReceiveWait(ctx, errCh, byeCh, disconnectCh, readyCh, sessionStartedCh)
}

// runOutbound sends one-shot files and/or watches dirs (used under interactive inbox).
func (r *Runner) runOutbound(
	ctx context.Context,
	cfg *QuickConfig,
	readyCh <-chan struct{},
	errCh <-chan error,
	disconnectCh <-chan struct{},
	sessionStartedCh <-chan struct{},
) error {
	if len(cfg.WatchDirs) > 0 {
		return r.runWatchLoop(ctx, cfg, readyCh, errCh, disconnectCh, nil, sessionStartedCh)
	}
	if len(cfg.SendFiles) > 0 {
		return r.runSendFilesLoop(ctx, cfg, readyCh, errCh, disconnectCh, nil, sessionStartedCh)
	}
	return nil
}

func (r *Runner) waitReady(
	ctx context.Context,
	readyCh <-chan struct{},
	errCh <-chan error,
	disconnectCh <-chan struct{},
	timeout time.Duration,
	reconnectWait bool,
) error {
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-errCh:
			if reconnectWait {
				fmt.Fprintf(r.Stderr, text.ReconnectAttemptError, err)
				continue
			}
			return err
		case <-disconnectCh:
			if reconnectWait {
				continue
			}
			return errors.New(text.ErrWebRTCDisconnectedBeforeReady)
		case <-readyCh:
			return nil
		case <-timer.C:
			if reconnectWait {
				// Keep waiting forever while reconnecting.
				timer.Reset(timeout)
				continue
			}
			return errors.New(text.ErrWebRTCTimeout)
		}
	}
}

func (r *Runner) onSessionReady() {
	r.mu.Lock()
	r.everReady = true
	r.waitingReconnect = false
	peerID := ""
	if remote, ok := r.peerState.GetRemotePeer(); ok {
		peerID = remote.GetID()
	}
	prev := r.lastConnectedPeerID
	if prev != "" && peerID != "" && prev != peerID {
		_ = r.downloadSvc.DropIncomplete("")
	}
	if peerID != "" {
		r.lastConnectedPeerID = peerID
	}
	r.mu.Unlock()

	r.transferSvc.ResetPeerAbort()
	r.peerState.SetStatus(state.StatusConnected)
}

func (r *Runner) enterWaitReconnect(disconnectCh <-chan struct{}) {
	r.mu.Lock()
	r.waitingReconnect = true
	r.mu.Unlock()

	r.peerState.SetStatus(state.StatusWaitingReconnect)
	fmt.Fprint(r.Stdout, text.WaitingReconnect)

	r.transferSvc.AbortPeerLoss()

	r.mu.Lock()
	sess := r.webrtcSession
	r.webrtcSession = nil
	r.mu.Unlock()
	if sess != nil && !sess.IsClosed() {
		_ = sess.Close()
	}
	r.resetSessionGate()

	// Drain extra disconnect signals.
	for {
		select {
		case <-disconnectCh:
		default:
			return
		}
	}
}

func (r *Runner) waitForReconnect(
	ctx context.Context,
	cfg *QuickConfig,
	readyCh <-chan struct{},
	errCh <-chan error,
	disconnectCh <-chan struct{},
	sessionStartedCh <-chan struct{},
) error {
	r.enterWaitReconnect(disconnectCh)

	select {
	case <-ctx.Done():
		r.discardAllDrops()
		return ctx.Err()
	case <-time.After(resumeAfterDisconnect):
	}

	// Joiner may need to re-announce / re-join after peer leave.
	if !cfg.Host {
		_ = r.signalingPort.SendAnnounce(r.deviceState.GetPeerID(), false, r.deviceState.GetDisplayName())
		_ = r.signalingPort.SendJoinCode(r.deviceState.GetPeerID(), cfg.ConnectPIN)
	}

	for {
		select {
		case <-ctx.Done():
			r.discardAllDrops()
			return ctx.Err()
		case err := <-errCh:
			fmt.Fprintf(r.Stderr, text.ReconnectWait, err)
		case <-sessionStartedCh:
			if err := r.waitReady(ctx, readyCh, errCh, disconnectCh, 15*time.Second, true); err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
					r.discardAllDrops()
					return err
				}
				fmt.Fprintf(r.Stderr, text.ReconnectReadyFailed, err)
				r.enterWaitReconnect(disconnectCh)
				continue
			}
			r.onSessionReady()
			return nil
		case <-disconnectCh:
			// Still waiting.
		}
	}
}

func (r *Runner) discardAllDrops() {
	_ = r.downloadSvc.DropIncomplete("")
}

func (r *Runner) runSendFilesLoop(
	ctx context.Context,
	cfg *QuickConfig,
	readyCh <-chan struct{},
	errCh <-chan error,
	disconnectCh <-chan struct{},
	_ <-chan struct{},
	sessionStartedCh <-chan struct{},
) error {
	for _, file := range cfg.SendFiles {
		fmt.Fprintf(r.Stdout, text.TransferringFile, file)
		r.transferSvc.EnqueueSend(file, filepath.Base(file))
	}

	for {
		err := r.transferSvc.DrainSendQueue(ctx)
		if err == nil {
			for _, file := range cfg.SendFiles {
				fmt.Fprintf(r.Stdout, text.TransferComplete, file)
			}
			time.Sleep(150 * time.Millisecond)
			return nil
		}
		if errors.Is(err, services.ErrPeerAbort) || errors.Is(err, context.Canceled) {
			if ctx.Err() != nil {
				r.discardAllDrops()
				return ctx.Err()
			}
			if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
				return err
			}
			continue
		}
		// Also watch for disconnect racing with send completion.
		select {
		case <-disconnectCh:
			if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
				return err
			}
			continue
		default:
		}
		first := ""
		if len(cfg.SendFiles) > 0 {
			first = cfg.SendFiles[0]
		}
		return fmt.Errorf(text.ErrSendFile, first, err)
	}
}

func (r *Runner) runWatchLoop(
	ctx context.Context,
	cfg *QuickConfig,
	readyCh <-chan struct{},
	errCh <-chan error,
	disconnectCh <-chan struct{},
	_ <-chan struct{},
	sessionStartedCh <-chan struct{},
) error {
	// One-shot file positionals first; completion must not end the watch session.
	if len(cfg.SendFiles) > 0 {
		for _, file := range cfg.SendFiles {
			fmt.Fprintf(r.Stdout, text.TransferringFile, file)
			r.transferSvc.EnqueueSend(file, filepath.Base(file))
		}
		for {
			err := r.transferSvc.DrainSendQueue(ctx)
			if err == nil {
				for _, file := range cfg.SendFiles {
					fmt.Fprintf(r.Stdout, text.TransferComplete, file)
				}
				break
			}
			if errors.Is(err, services.ErrPeerAbort) || errors.Is(err, context.Canceled) {
				if ctx.Err() != nil {
					r.discardAllDrops()
					return ctx.Err()
				}
				if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
					return err
				}
				continue
			}
			select {
			case <-disconnectCh:
				if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
					return err
				}
				continue
			default:
			}
			first := cfg.SendFiles[0]
			return fmt.Errorf(text.ErrSendFile, first, err)
		}
	}

	wp := r.watcherPort
	if wp == nil {
		var err error
		wp, err = watcher.New()
		if err != nil {
			return fmt.Errorf(text.ErrCreateWatcher, err)
		}
	}
	watcherSvc := services.NewFolderWatcherService(wp, r.repo)
	defer watcherSvc.Close()

	for _, dir := range cfg.WatchDirs {
		if err := watcherSvc.Watch(dir); err != nil {
			return fmt.Errorf(text.ErrWatchDir, dir, err)
		}
		fmt.Fprintf(r.Stdout, text.WatchingDir, dir)
	}

	for {
		select {
		case <-ctx.Done():
			r.discardAllDrops()
			return ctx.Err()
		case err := <-errCh:
			return err
		case <-disconnectCh:
			if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
				return err
			}
		case <-watcherSvc.Notify():
			for {
				path, ok := watcherSvc.Dequeue()
				if !ok {
					break
				}
				announce := watcherSvc.AnnounceName(path)
				fmt.Fprintf(r.Stdout, text.BroadcastingFile, path, announce)
				r.transferSvc.EnqueueSend(path, announce)
			}
			if err := r.transferSvc.DrainSendQueue(ctx); err != nil {
				if errors.Is(err, services.ErrPeerAbort) {
					if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
						return err
					}
					continue
				}
				fmt.Fprintf(r.Stderr, text.FailedSendQueued, err)
			}
		}
	}
}

func (r *Runner) runReceiveWait(
	ctx context.Context,
	errCh <-chan error,
	byeCh <-chan struct{},
	disconnectCh <-chan struct{},
	readyCh <-chan struct{},
	sessionStartedCh <-chan struct{},
) error {
	fmt.Fprint(r.Stdout, text.ConnectedWaitingFiles)

	var batchMu sync.Mutex
	receivedSinceBatch := 0
	r.downloadSvc.SetOnComplete(func(name string, size int64) {
		batchMu.Lock()
		receivedSinceBatch++
		batchMu.Unlock()
		fmt.Fprintf(r.Stdout, text.ReceivedFile, name, tui.FormatBytes(size))
	})
	r.transferSvc.SetOnBatchDone(func() {
		batchMu.Lock()
		n := receivedSinceBatch
		receivedSinceBatch = 0
		batchMu.Unlock()
		if n == 0 {
			return
		}
		fmt.Fprintf(r.Stdout, text.BatchComplete, n)
	})

	cfg := &QuickConfig{Host: r.peerState.GetRole() == state.RoleHost, ConnectPIN: r.peerState.GetPIN()}

	for {
		select {
		case <-ctx.Done():
			_ = r.transferSvc.SendControl(webrtc.ByeMessage{Type: webrtc.CtrlBye})
			r.discardAllDrops()
			return ctx.Err()
		case err := <-errCh:
			return err
		case <-byeCh:
			fmt.Fprint(r.Stdout, text.PeerClosedSession)
			return nil
		case <-disconnectCh:
			if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
				return err
			}
			fmt.Fprint(r.Stdout, text.ReconnectedWaitingFiles)
		}
	}
}

type runnerInboxActions struct {
	transfer *services.TransferService
	download *services.DownloadService
}

func (a runnerInboxActions) SendPullBatch(fileIDs []string) error {
	return a.transfer.SendPullBatch(fileIDs)
}

func (a runnerInboxActions) DismissPendingBatch(fileIDs []string) error {
	return a.transfer.DismissPendingBatch(fileIDs)
}

func (a runnerInboxActions) PendingOffers() []services.PendingOffer {
	return a.download.PendingOffers()
}

func (r *Runner) runReceiveInbox(
	ctx context.Context,
	errCh <-chan error,
	byeCh <-chan struct{},
	disconnectCh <-chan struct{},
	readyCh <-chan struct{},
	sessionStartedCh <-chan struct{},
) error {
	actions := runnerInboxActions{transfer: r.transferSvc, download: r.downloadSvc}
	model := tui.NewInboxModel(
		r.peerState,
		r.transferState,
		actions,
		r.deviceState.GetPeerID(),
		r.settings.GetWSURL(),
	)
	p := tea.NewProgram(model, tea.WithContext(ctx), tea.WithOutput(r.Stdout), tea.WithInput(os.Stdin))

	r.downloadSvc.SetOnPendingChange(func() {
		p.Send(tui.InboxRefresh())
	})
	r.downloadSvc.SetOnComplete(func(name string, size int64) {
		p.Send(tui.InboxRefresh())
	})

	cfg := &QuickConfig{Host: r.peerState.GetRole() == state.RoleHost, ConnectPIN: r.peerState.GetPIN()}

	go func() {
		for {
			select {
			case <-ctx.Done():
				p.Send(tea.Quit())
				return
			case err := <-errCh:
				if err != nil {
					p.Send(tui.InboxError(err))
				}
				return
			case <-byeCh:
				p.Send(tui.InboxBye())
				return
			case <-disconnectCh:
				_ = r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh)
				p.Send(tui.InboxRefresh())
			}
		}
	}()

	final, err := p.Run()
	if err != nil {
		r.discardAllDrops()
		return err
	}
	if m, ok := final.(tui.InboxModel); ok {
		if m.Err() != nil {
			r.discardAllDrops()
			return m.Err()
		}
		if m.PeerBye() {
			fmt.Fprint(r.Stdout, text.PeerClosedSession)
			return nil
		}
	}
	// User quit / cancel — discard incomplete partials.
	r.discardAllDrops()
	if ctx.Err() != nil {
		_ = r.transferSvc.SendControl(webrtc.ByeMessage{Type: webrtc.CtrlBye})
		return ctx.Err()
	}
	_ = r.transferSvc.SendControl(webrtc.ByeMessage{Type: webrtc.CtrlBye})
	return nil
}

type quickSignalingHandler struct {
	r                *Runner
	cfg              *QuickConfig
	startSession     func(remotePeer ports.SignalingPeerInfo)
	errCh            chan error
	notifyDisconnect func()
}

func (h *quickSignalingHandler) OnConnected() {
	if h.cfg.Host {
		_ = h.r.signalingPort.SendAnnounce(h.r.deviceState.GetPeerID(), true, h.r.deviceState.GetDisplayName())
	} else {
		_ = h.r.signalingPort.SendAnnounce(h.r.deviceState.GetPeerID(), false, h.r.deviceState.GetDisplayName())
		_ = h.r.signalingPort.SendJoinCode(h.r.deviceState.GetPeerID(), h.cfg.ConnectPIN)
	}
}

func (h *quickSignalingHandler) OnCodeAssigned(code string) {
	h.r.peerState.SetPIN(code)
	fmt.Fprintf(h.r.Stdout, text.AssignedPIN, code)
	if h.cfg.Host {
		fmt.Fprint(h.r.Stdout, text.PressCopyHint)
	}
}

func (h *quickSignalingHandler) OnPeerJoining(peer ports.SignalingPeerInfo) {
	fmt.Fprintf(h.r.Stdout, text.PeerJoined, peer.DisplayName)
	h.startSession(peer)
}

func (h *quickSignalingHandler) OnJoinAccepted(peer ports.SignalingPeerInfo) {
	fmt.Fprintf(h.r.Stdout, text.JoinAccepted, peer.DisplayName)
	h.startSession(peer)
}

func (h *quickSignalingHandler) OnJoinRejected(reason string) {
	h.r.peerState.SetStatus(state.StatusFailed)
	select {
	case h.errCh <- fmt.Errorf(text.ErrJoinRejected, reason):
	default:
	}
}

func (h *quickSignalingHandler) OnSignal(fromPeerID string, signalData []byte) {
	h.r.mu.Lock()
	sess := h.r.webrtcSession
	everReady := h.r.everReady
	h.r.mu.Unlock()

	if sess == nil || sess.IsClosed() {
		// Stale signals while no active session — ignore (not fatal).
		return
	}
	if err := sess.HandleSignal(signalData); err != nil {
		closed := sess.IsClosed() || isClosedPCError(err)
		if !SignalErrorIsFatal(everReady, closed) {
			h.notifyDisconnect()
			return
		}
		select {
		case h.errCh <- fmt.Errorf(text.ErrWebRTCSignal, err):
		default:
		}
	}
}

func (h *quickSignalingHandler) OnDisconnected(err error) {
	h.r.peerState.SetStatus(state.StatusDisconnected)
}

func (h *quickSignalingHandler) OnError(err error) {
	select {
	case h.errCh <- fmt.Errorf(text.ErrSignaling, err):
	default:
	}
}

type quickWebRTCHandler struct {
	r                *Runner
	remotePeerID     string
	readyCh          chan struct{}
	errCh            chan error
	notifyDisconnect func()
}

func (w *quickWebRTCHandler) OnSignal(data []byte) {
	_ = w.r.signalingPort.SendSignal(w.r.deviceState.GetPeerID(), w.remotePeerID, data)
}

func (w *quickWebRTCHandler) OnReady(ctrl *pionwebrtc.DataChannel, files *pionwebrtc.DataChannel) {
	w.r.peerState.SetStatus(state.StatusConnected)
	w.r.transferSvc.BindChannels(ctrl, files)

	ctrl.OnClose(func() {
		w.r.mu.Lock()
		everReady := w.r.everReady
		w.r.mu.Unlock()
		if everReady {
			w.notifyDisconnect()
		}
	})

	w.r.mu.Lock()
	sess := w.r.webrtcSession
	w.r.mu.Unlock()

	if sess != nil {
		if pc := sess.GetPeerConnection(); pc != nil {
			chunkSize := webrtc.GetMaxChunkSize(pc)
			w.r.transferSvc.SetChunkSize(chunkSize)
		}
	}

	manual := !w.r.settings.GetAutoDownload()
	if err := w.r.transferSvc.SendDownloadMode(manual); err != nil {
		fmt.Fprintf(w.r.Stderr, text.FailedAnnounceMode, err)
	} else {
		fmt.Fprintf(w.r.Stderr, text.AnnouncedDownloadMode, manual)
	}

	select {
	case w.readyCh <- struct{}{}:
	default:
	}
}

func (w *quickWebRTCHandler) OnStateChange(s pionwebrtc.PeerConnectionState) {
	switch s {
	case pionwebrtc.PeerConnectionStateConnected:
		w.r.peerState.SetStatus(state.StatusConnected)
	case pionwebrtc.PeerConnectionStateDisconnected:
		w.r.peerState.SetStatus(state.StatusDisconnected)
	case pionwebrtc.PeerConnectionStateFailed, pionwebrtc.PeerConnectionStateClosed:
		w.r.mu.Lock()
		everReady := w.r.everReady
		w.r.mu.Unlock()
		if everReady {
			w.r.peerState.SetStatus(state.StatusWaitingReconnect)
			w.notifyDisconnect()
			return
		}
		w.r.peerState.SetStatus(state.StatusFailed)
		select {
		case w.errCh <- errors.New(text.ErrWebRTCPeerFailed):
		default:
		}
	}
}

func (w *quickWebRTCHandler) OnClose() {
	w.r.mu.Lock()
	everReady := w.r.everReady
	waiting := w.r.waitingReconnect
	w.r.mu.Unlock()
	if everReady && !waiting {
		w.notifyDisconnect()
		return
	}
	w.r.peerState.SetStatus(state.StatusDisconnected)
}

func isClosedPCError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "closed") ||
		strings.Contains(msg, "invalid state") ||
		(strings.Contains(msg, "connection") && strings.Contains(msg, "close"))
}
