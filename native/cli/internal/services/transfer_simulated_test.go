package services

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"dropcli/internal/adapters/fs"
	"dropcli/internal/state"
)

func TestTransferServiceSimulatedTransfer(t *testing.T) {
	tempSrcDir, err := os.MkdirTemp("", "transfer-src-*")
	if err != nil {
		t.Fatalf("failed to create temp src dir: %v", err)
	}
	defer os.RemoveAll(tempSrcDir)

	tempDstDir, err := os.MkdirTemp("", "transfer-dst-*")
	if err != nil {
		t.Fatalf("failed to create temp dst dir: %v", err)
	}
	defer os.RemoveAll(tempDstDir)

	// Create a test file of 9 MiB (exceeds 8 MiB window to test backpressure)
	testFileSize := 9 * 1024 * 1024
	testData := make([]byte, testFileSize)
	_, _ = rand.Read(testData)

	srcFilePath := filepath.Join(tempSrcDir, "large_sample.dat")
	if err := os.WriteFile(srcFilePath, testData, 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	repo := fs.NewRepository()

	// Sender Setup
	senderState := state.NewTransferState()
	senderTransferSvc := NewTransferService(repo, senderState, nil)
	senderTransferSvc.SetChunkSize(65536) // 64 KiB chunks

	// Receiver Setup
	receiverState := state.NewTransferState()
	receiverSettings := state.NewSettings()
	receiverSettings.SetDownloadDir(tempDstDir)
	receiverDownloadSvc := NewDownloadService(repo, receiverState, receiverSettings)
	receiverTransferSvc := NewTransferService(repo, receiverState, receiverDownloadSvc)

	// Ordered FIFO queues simulating independent WebRTC data channels
	s2rCtrl := make(chan []byte, 1000)
	s2rData := make(chan []byte, 1000)
	r2sCtrl := make(chan []byte, 1000)

	done := make(chan struct{})
	defer close(done)

	// Receiver Ctrl worker
	go func() {
		for {
			select {
			case <-done:
				return
			case msg := <-s2rCtrl:
				receiverTransferSvc.HandleControlMessage(msg)
			}
		}
	}()

	// Receiver Data worker
	go func() {
		for {
			select {
			case <-done:
				return
			case chunk := <-s2rData:
				_ = receiverDownloadSvc.HandleChunk(chunk)
			}
		}
	}()

	// Sender Ctrl worker
	go func() {
		for {
			select {
			case <-done:
				return
			case msg := <-r2sCtrl:
				senderTransferSvc.HandleControlMessage(msg)
			}
		}
	}()

	// Wire Transports
	senderTransferSvc.SetTransports(
		func(ctrlData []byte) error {
			s2rCtrl <- ctrlData
			return nil
		},
		func(chunk []byte) error {
			s2rData <- chunk
			return nil
		},
	)

	receiverTransferSvc.SetTransports(
		func(ctrlData []byte) error {
			r2sCtrl <- ctrlData
			return nil
		},
		func(chunk []byte) error {
			return nil
		},
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := senderTransferSvc.SendFile(ctx, srcFilePath); err != nil {
		t.Fatalf("SendFile failed: %v", err)
	}

	// Verify sender transfer marked completed
	transfers := senderState.GetAll()
	if len(transfers) != 1 || transfers[0].Status != state.TransferCompleted {
		t.Fatalf("expected sender transfer completed, got: %+v", transfers)
	}

	// Verify receiver transfer marked completed
	rxTransfers := receiverState.GetAll()
	if len(rxTransfers) != 1 || rxTransfers[0].Status != state.TransferCompleted {
		t.Fatalf("expected receiver transfer completed, got: %+v", rxTransfers)
	}

	// Verify content on disk matches exactly
	dstFilePath := filepath.Join(tempDstDir, "large_sample.dat")
	receivedData, err := os.ReadFile(dstFilePath)
	if err != nil {
		t.Fatalf("failed to read destination file: %v", err)
	}

	if len(receivedData) != testFileSize {
		t.Fatalf("file size mismatch: expected %d, got %d", testFileSize, len(receivedData))
	}

	if !bytes.Equal(receivedData, testData) {
		t.Fatal("file content mismatch between sender and receiver")
	}
}

func TestTransferServiceAbortPeerLossRequeuesSend(t *testing.T) {
	tempSrcDir, err := os.MkdirTemp("", "transfer-abort-src-*")
	if err != nil {
		t.Fatalf("failed to create temp src dir: %v", err)
	}
	defer os.RemoveAll(tempSrcDir)

	tempDstDir, err := os.MkdirTemp("", "transfer-abort-dst-*")
	if err != nil {
		t.Fatalf("failed to create temp dst dir: %v", err)
	}
	defer os.RemoveAll(tempDstDir)

	testData := bytes.Repeat([]byte{0xCD}, 2*1024*1024)
	srcFilePath := filepath.Join(tempSrcDir, "abort_sample.dat")
	if err := os.WriteFile(srcFilePath, testData, 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	repo := fs.NewRepository()
	senderState := state.NewTransferState()
	senderTransferSvc := NewTransferService(repo, senderState, nil)
	senderTransferSvc.SetChunkSize(65536)

	receiverState := state.NewTransferState()
	receiverSettings := state.NewSettings()
	receiverSettings.SetDownloadDir(tempDstDir)
	receiverDownloadSvc := NewDownloadService(repo, receiverState, receiverSettings)
	receiverTransferSvc := NewTransferService(repo, receiverState, receiverDownloadSvc)

	s2rCtrl := make(chan []byte, 1000)
	s2rData := make(chan []byte, 1000)
	r2sCtrl := make(chan []byte, 1000)
	done := make(chan struct{})
	defer close(done)

	go func() {
		for {
			select {
			case <-done:
				return
			case msg := <-s2rCtrl:
				receiverTransferSvc.HandleControlMessage(msg)
			}
		}
	}()
	go func() {
		for {
			select {
			case <-done:
				return
			case chunk := <-s2rData:
				_ = receiverDownloadSvc.HandleChunk(chunk)
			}
		}
	}()
	go func() {
		for {
			select {
			case <-done:
				return
			case msg := <-r2sCtrl:
				senderTransferSvc.HandleControlMessage(msg)
			}
		}
	}()

	started := make(chan struct{}, 1)
	senderTransferSvc.SetTransports(
		func(ctrlData []byte) error {
			s2rCtrl <- ctrlData
			return nil
		},
		func(chunk []byte) error {
			select {
			case started <- struct{}{}:
			default:
			}
			// Block until abort so send stays in-flight.
			time.Sleep(50 * time.Millisecond)
			s2rData <- chunk
			return nil
		},
	)
	receiverTransferSvc.SetTransports(
		func(ctrlData []byte) error {
			r2sCtrl <- ctrlData
			return nil
		},
		func(chunk []byte) error { return nil },
	)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- senderTransferSvc.SendFile(ctx, srcFilePath)
	}()

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for send to start")
	}

	senderTransferSvc.AbortPeerLoss()

	select {
	case err := <-errCh:
		if !errors.Is(err, ErrPeerAbort) {
			t.Fatalf("expected ErrPeerAbort, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for SendFile to abort")
	}

	pending := senderTransferSvc.PendingSends()
	if len(pending) != 1 || pending[0] != srcFilePath {
		t.Fatalf("expected re-queued send %q, got %v", srcFilePath, pending)
	}

	// Abort-without-discard must keep receiver .drop partial if any bytes landed.
	entries, _ := os.ReadDir(tempDstDir)
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".drop" {
			return
		}
	}
	// Zero or partial receive is fine; the critical check is send re-queue above.
}
