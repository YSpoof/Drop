package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"dropcli/internal/adapters/fs"
	"dropcli/internal/adapters/signaling"
	"dropcli/internal/state"
	"dropcli/internal/ui/quick"
	"dropcli/internal/ui/text"
	"dropcli/internal/ui/tui"
)

func main() {
	// SIGTERM always stops the process. SIGINT is handled inside Runner wait
	// surfaces via the confirm-to-exit overlay (TTY) so a first Ctrl+C does not
	// cancel the run context.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
	defer stop()

	if code := exitFromRun(run(ctx, os.Args[1:])); code != 0 {
		os.Exit(code)
	}
}

// exitFromRun maps run errors to process exit codes.
// Intentional user cancel (context.Canceled) is a clean silent exit 0.
func exitFromRun(err error) int {
	if err == nil || errors.Is(err, context.Canceled) {
		return 0
	}
	fmt.Fprintln(os.Stderr, text.ErrPrefix, err)
	return 1
}

func run(ctx context.Context, args []string) error {
	cfg, _, err := quick.ParseArgs(args)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}

	settings := state.NewSettings()
	if cfg.OutputDir != "" {
		settings.SetDownloadDir(cfg.OutputDir)
	}

	defer func() {
		_ = settings.SaveConfig()
	}()

	if cfg.Quick {
		return runQuick(ctx, cfg, settings)
	}
	return runInteractive(ctx, cfg, settings)
}

// runQuick executes the non-interactive headless mode.
// Quick receive always auto-downloads; no interactive file inbox.
func runQuick(ctx context.Context, cfg *quick.QuickConfig, settings *state.Settings) error {
	cfg.AutoDownload = true

	repo := fs.NewRepository()
	sigClient := signaling.NewClient()
	deviceState := state.NewDeviceState("", settings)

	runner := quick.NewRunner(
		quick.WithRepository(repo),
		quick.WithSignalingPort(sigClient),
		quick.WithSettings(settings),
		quick.WithDeviceState(deviceState),
	)

	return runner.Run(ctx, cfg)
}

// runInteractive starts the TUI form flow then runs the connected session.
// When -s/-c already select a role, skips mode/PIN prompts. Paths are retained for send.
func runInteractive(ctx context.Context, cfg *quick.QuickConfig, settings *state.Settings) error {
	hostname, err := os.Hostname()
	if err != nil || hostname == "" {
		hostname = "dropcli-node"
	}
	deviceName := settings.GetDeviceName()
	if deviceName == "" {
		deviceName = hostname
	}

	host := cfg.Host
	pin := cfg.ConnectPIN
	hasRole := cfg.Host || cfg.ConnectPIN != ""

	if hasRole {
		if pin != "" {
			if err := tui.ValidatePIN(pin); err != nil {
				return fmt.Errorf(text.ErrInvalidPIN, err)
			}
		}
	} else {
		// Form phase: immediate SIGINT cancel (not a session wait surface).
		formCtx, stopForm := signal.NotifyContext(ctx, syscall.SIGINT)
		result, err := tui.RunForm(deviceName, settings.GetDownloadDir())
		stopForm()
		if err != nil {
			if formCtx.Err() != nil {
				return formCtx.Err()
			}
			return fmt.Errorf(text.ErrTUIForm, err)
		}

		if result.DownloadDir != "" {
			settings.SetDownloadDir(result.DownloadDir)
		}
		deviceName = result.DeviceName
		host = result.Mode == tui.ModeHost
		pin = ""
		if result.Mode == tui.ModeJoin {
			pin = result.PIN
		}
	}

	deviceState := state.NewDeviceState(deviceName, settings)

	// Interactive receive always announces manual mode (inbox UI).
	quickCfg := &quick.QuickConfig{
		Quick:        true,
		Host:         host,
		ConnectPIN:   pin,
		Paths:        cfg.Paths,
		OutputDir:    settings.GetDownloadDir(),
		AutoDownload: false,
		ReceiveInbox: true,
	}

	runner := quick.NewRunner(
		quick.WithRepository(fs.NewRepository()),
		quick.WithSettings(settings),
		quick.WithDeviceState(deviceState),
	)

	return runner.Run(ctx, quickCfg)
}
