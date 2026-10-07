package main

import (
	"context"
	"errors"
	"testing"
)

func TestExitFromRunCancelIsSilentSuccess(t *testing.T) {
	if code := exitFromRun(nil); code != 0 {
		t.Fatalf("nil → exit 0, got %d", code)
	}
	if code := exitFromRun(context.Canceled); code != 0 {
		t.Fatalf("context.Canceled → exit 0, got %d", code)
	}
}

func TestExitFromRunWrappedCancel(t *testing.T) {
	err := errors.Join(errors.New("wrap"), context.Canceled)
	if code := exitFromRun(err); code != 0 {
		t.Fatalf("wrapped Canceled → exit 0, got %d", code)
	}
}

func TestExitFromRunRealError(t *testing.T) {
	if code := exitFromRun(errors.New("boom")); code != 1 {
		t.Fatalf("real error → exit 1, got %d", code)
	}
}
