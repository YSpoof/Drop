package quick

import (
	"context"
	"os"
	"testing"
	"time"

	"golang.org/x/term"
)

func stubHostTTY(t *testing.T) {
	t.Helper()
	prevTerm := hostIsTerminal
	prevRaw := hostMakeRaw
	prevRestore := hostRestore
	hostIsTerminal = func(int) bool { return true }
	hostMakeRaw = func(int) (*term.State, error) { return &term.State{}, nil }
	hostRestore = func(int, *term.State) error { return nil }
	t.Cleanup(func() {
		hostIsTerminal = prevTerm
		hostMakeRaw = prevRaw
		hostRestore = prevRestore
	})
}

func TestHostCopyKeysDisabledOnNonTTY(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	defer w.Close()

	if hostCopyKeysEnabled(r) {
		t.Fatal("expected non-TTY pipe to disable host copy keys")
	}
}

func TestHostCopyKeysDoneOnCancelNonTTY(t *testing.T) {
	in, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	defer w.Close()

	runner := NewRunner()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := runner.hostCopyKeysFrom(ctx, in, nil)
	select {
	case <-done:
		// Non-TTY path exits immediately; done closes after return.
	case <-time.After(2 * time.Second):
		t.Fatal("done not signaled on non-TTY path")
	}
	if hostRawIsActive() {
		t.Fatal("raw must stay inactive on non-TTY path")
	}
}

func TestHostCopyKeysDoneAfterCancelRestoresTTY(t *testing.T) {
	stubHostTTY(t)

	in, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	defer w.Close()

	setHostRawActive(false)
	t.Cleanup(func() { setHostRawActive(false) })

	runner := NewRunner()
	ctx, cancel := context.WithCancel(context.Background())
	done := runner.hostCopyKeysFrom(ctx, in, nil)

	deadline := time.Now().Add(2 * time.Second)
	for !hostRawIsActive() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !hostRawIsActive() {
		cancel()
		<-done
		t.Fatal("expected stubbed MakeRaw to activate")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("done not signaled quickly after cancel (Read wake broken)")
	}
	if hostRawIsActive() {
		t.Fatal("done must fire only after final restore (raw still active)")
	}
}

func TestHostCopyKeysDoneAfterConfirmExitRestoresOnce(t *testing.T) {
	stubHostTTY(t)

	in, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	defer w.Close()

	setHostRawActive(false)
	t.Cleanup(func() { setHostRawActive(false) })

	prev := hostConfirmExit
	hostConfirmExit = func() (bool, error) { return true, nil }
	t.Cleanup(func() { hostConfirmExit = prev })

	runner := NewRunner()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	confirmed := false
	done := runner.hostCopyKeysFrom(ctx, in, func() { confirmed = true })

	deadline := time.Now().Add(2 * time.Second)
	for !hostRawIsActive() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !hostRawIsActive() {
		cancel()
		<-done
		t.Fatal("expected stubbed MakeRaw to activate")
	}

	if _, err := w.Write([]byte{3}); err != nil {
		t.Fatal(err)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("done not signaled after confirm exit")
	}
	if !confirmed {
		t.Fatal("confirm exit must invoke onConfirm")
	}
	if hostRawIsActive() {
		t.Fatal("done must fire only after final restore (raw still active)")
	}
}

func TestHostCopyKeysDoneAfterConfirmDismissThenCancel(t *testing.T) {
	stubHostTTY(t)

	in, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	defer w.Close()

	setHostRawActive(false)
	t.Cleanup(func() { setHostRawActive(false) })

	dismissed := make(chan struct{})
	prev := hostConfirmExit
	hostConfirmExit = func() (bool, error) {
		close(dismissed)
		return false, nil
	}
	t.Cleanup(func() { hostConfirmExit = prev })

	runner := NewRunner()
	ctx, cancel := context.WithCancel(context.Background())

	confirmed := false
	done := runner.hostCopyKeysFrom(ctx, in, func() { confirmed = true })

	deadline := time.Now().Add(2 * time.Second)
	for !hostRawIsActive() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !hostRawIsActive() {
		cancel()
		<-done
		t.Fatal("expected stubbed MakeRaw to activate")
	}

	if _, err := w.Write([]byte{3}); err != nil {
		t.Fatal(err)
	}

	select {
	case <-dismissed:
	case <-time.After(2 * time.Second):
		cancel()
		<-done
		t.Fatal("confirm overlay not reached")
	}

	deadline = time.Now().Add(2 * time.Second)
	for !hostRawIsActive() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !hostRawIsActive() {
		cancel()
		<-done
		t.Fatal("expected raw re-enter after confirm dismiss")
	}
	if confirmed {
		t.Fatal("dismiss must not invoke onConfirm")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("done not signaled after dismiss+cancel")
	}
	if hostRawIsActive() {
		t.Fatal("done must fire only after final restore (raw still active)")
	}
}
