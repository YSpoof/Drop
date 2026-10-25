package webrtc

import (
	"encoding/json"
	"fmt"
)

// Transfer protocol constants.
const (
	SendWindowSize  int64 = 8 * 1024 * 1024 // 8 MiB flow control window
	CreditBatchSize int64 = 1024 * 1024     // 1 MiB credit frequency
)

// Control message types.
const (
	CtrlMeta            = "meta"
	CtrlStart           = "start"
	CtrlResume          = "resume"
	CtrlCredit          = "credit"
	CtrlDone            = "done"
	CtrlAck             = "ack"
	CtrlBatchDone       = "batch-done"
	CtrlBye             = "bye"
	CtrlCancel          = "cancel"
	CtrlDownloadMode    = "download-mode"
	CtrlPull            = "pull"
	CtrlPullBatch       = "pull-batch"
	CtrlDownloadAborted = "download-aborted"
)

// BaseControlMessage contains the message discriminator.
type BaseControlMessage struct {
	Type string `json:"type"`
}

// MetaMessage announces metadata for a file to be sent.
type MetaMessage struct {
	Type   string `json:"type"`
	FileID string `json:"fileId"`
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Mime   string `json:"mime,omitempty"`
	Hash   string `json:"hash,omitempty"`
}

// FileIdentity returns the Drop-compatible file identity string used as meta/resume hash.
func FileIdentity(name string, size int64, mtimeMs int64) string {
	return fmt.Sprintf("%s|%d|%d", name, size, mtimeMs)
}

// StartMessage notifies the receiver that transmission is starting with chunk parameters.
type StartMessage struct {
	Type      string `json:"type"`
	FileID    string `json:"fileId"`
	ChunkSize uint32 `json:"chunkSize"`
	Offset    int64  `json:"offset,omitempty"`
}

// ResumeMessage requests transmission starting at a resume offset (Drop wire shape).
type ResumeMessage struct {
	Type        string `json:"type"`
	FileID      string `json:"fileId"`
	Hash        string `json:"hash"`
	BytesOffset int64  `json:"bytesOffset"`
}

// CreditMessage grants flow control credit back to the sender.
// BytesWritten is the cumulative accepted offset (Drop wire shape).
type CreditMessage struct {
	Type         string `json:"type"`
	FileID       string `json:"fileId"`
	BytesWritten int64  `json:"bytesWritten"`
}

// DoneMessage indicates the sender has sent the final chunk of a file.
type DoneMessage struct {
	Type   string `json:"type"`
	FileID string `json:"fileId"`
}

// AckMessage confirms the receiver has fully written and verified the file.
type AckMessage struct {
	Type   string `json:"type"`
	FileID string `json:"fileId"`
}

// BatchDoneMessage notifies that all queued files in a batch have finished.
type BatchDoneMessage struct {
	Type string `json:"type"`
}

// ByeMessage requests clean session termination.
type ByeMessage struct {
	Type string `json:"type"`
}

// CancelMessage cancels an active or queued transfer.
type CancelMessage struct {
	Type   string `json:"type"`
	FileID string `json:"fileId"`
	Reason string `json:"reason,omitempty"`
}

// DownloadModeMessage configures auto-download or manual prompt mode.
// Manual true means the peer requires pull/confirmation; false means auto-download.
type DownloadModeMessage struct {
	Type   string `json:"type"`
	Manual bool   `json:"manual"`
}

// PullMessage requests the sender to begin transfer for a pending announced file.
type PullMessage struct {
	Type   string `json:"type"`
	FileID string `json:"fileId"`
}

// PullBatchMessage requests the sender to begin transfer for multiple pending files.
type PullBatchMessage struct {
	Type    string   `json:"type"`
	FileIDs []string `json:"fileIds"`
}

// DownloadAbortedMessage notifies the peer that a pending or in-flight receive was dismissed.
type DownloadAbortedMessage struct {
	Type   string `json:"type"`
	FileID string `json:"fileId"`
}

// EncodeControlMessage marshals any control message to JSON bytes.
func EncodeControlMessage(v any) ([]byte, error) {
	return json.Marshal(v)
}

// DecodeBaseControlMessage extracts the type string of a control message.
func DecodeBaseControlMessage(data []byte) (string, error) {
	var base BaseControlMessage
	if err := json.Unmarshal(data, &base); err != nil {
		return "", err
	}
	return base.Type, nil
}
