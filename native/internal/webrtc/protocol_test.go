package webrtc

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProtocolMessagesEncodingDecoding(t *testing.T) {
	// 1. Meta
	meta := MetaMessage{
		Type:   CtrlMeta,
		FileID: "f-123",
		Name:   "document.pdf",
		Size:   1048576,
		Mime:   "application/pdf",
		Hash:   FileIdentity("document.pdf", 1048576, 1700000000000),
	}
	bytes, err := EncodeControlMessage(meta)
	if err != nil {
		t.Fatalf("failed to encode meta: %v", err)
	}
	if !strings.Contains(string(bytes), `"hash":"document.pdf|1048576|1700000000000"`) {
		t.Fatalf("expected hash in JSON, got: %s", bytes)
	}
	typeStr, err := DecodeBaseControlMessage(bytes)
	if err != nil || typeStr != CtrlMeta {
		t.Fatalf("unexpected type: %v, err: %v", typeStr, err)
	}
	var decMeta MetaMessage
	if err := json.Unmarshal(bytes, &decMeta); err != nil || decMeta != meta {
		t.Fatalf("unmarshal mismatch: %+v vs %+v", decMeta, meta)
	}
	if got := FileIdentity("document.pdf", 1048576, 1700000000000); got != meta.Hash {
		t.Fatalf("FileIdentity mismatch: %q vs %q", got, meta.Hash)
	}

	// 2. Start
	start := StartMessage{
		Type:      CtrlStart,
		FileID:    "f-123",
		ChunkSize: 65536,
		Offset:    0,
	}
	bytes, err = EncodeControlMessage(start)
	if err != nil {
		t.Fatalf("failed to encode start: %v", err)
	}
	var decStart StartMessage
	if err := json.Unmarshal(bytes, &decStart); err != nil || decStart != start {
		t.Fatalf("unmarshal mismatch: %+v", decStart)
	}

	// 3. Resume
	resume := ResumeMessage{
		Type:        CtrlResume,
		FileID:      "f-123",
		Hash:        FileIdentity("document.pdf", 1048576, 1700000000000),
		BytesOffset: 262144,
	}
	bytes, err = EncodeControlMessage(resume)
	if err != nil {
		t.Fatalf("failed to encode resume: %v", err)
	}
	if !strings.Contains(string(bytes), `"bytesOffset":262144`) {
		t.Fatalf("expected bytesOffset in JSON, got: %s", bytes)
	}
	var decResume ResumeMessage
	if err := json.Unmarshal(bytes, &decResume); err != nil || decResume != resume {
		t.Fatalf("unmarshal mismatch: %+v", decResume)
	}

	// 4. Credit
	credit := CreditMessage{
		Type:         CtrlCredit,
		FileID:       "f-123",
		BytesWritten: 1048576,
	}
	bytes, err = EncodeControlMessage(credit)
	if err != nil {
		t.Fatalf("failed to encode credit: %v", err)
	}
	if !strings.Contains(string(bytes), `"bytesWritten":1048576`) {
		t.Fatalf("expected bytesWritten in JSON, got: %s", bytes)
	}
	var decCredit CreditMessage
	if err := json.Unmarshal(bytes, &decCredit); err != nil || decCredit != credit {
		t.Fatalf("unmarshal mismatch: %+v", decCredit)
	}

	// 5. Done
	done := DoneMessage{
		Type:   CtrlDone,
		FileID: "f-123",
	}
	bytes, err = EncodeControlMessage(done)
	if err != nil {
		t.Fatalf("failed to encode done: %v", err)
	}
	var decDone DoneMessage
	if err := json.Unmarshal(bytes, &decDone); err != nil || decDone != done {
		t.Fatalf("unmarshal mismatch: %+v", decDone)
	}

	// 6. Ack
	ack := AckMessage{
		Type:   CtrlAck,
		FileID: "f-123",
	}
	bytes, err = EncodeControlMessage(ack)
	if err != nil {
		t.Fatalf("failed to encode ack: %v", err)
	}
	var decAck AckMessage
	if err := json.Unmarshal(bytes, &decAck); err != nil || decAck != ack {
		t.Fatalf("unmarshal mismatch: %+v", decAck)
	}

	// 7. BatchDone
	batchDone := BatchDoneMessage{Type: CtrlBatchDone}
	bytes, err = EncodeControlMessage(batchDone)
	if err != nil {
		t.Fatalf("failed to encode batch-done: %v", err)
	}
	var decBatchDone BatchDoneMessage
	if err := json.Unmarshal(bytes, &decBatchDone); err != nil || decBatchDone != batchDone {
		t.Fatalf("unmarshal mismatch: %+v", decBatchDone)
	}

	// 8. Bye
	bye := ByeMessage{Type: CtrlBye}
	bytes, err = EncodeControlMessage(bye)
	if err != nil {
		t.Fatalf("failed to encode bye: %v", err)
	}
	var decBye ByeMessage
	if err := json.Unmarshal(bytes, &decBye); err != nil || decBye != bye {
		t.Fatalf("unmarshal mismatch: %+v", decBye)
	}

	// 9. Cancel
	cancel := CancelMessage{
		Type:   CtrlCancel,
		FileID: "f-123",
		Reason: "User cancelled",
	}
	bytes, err = EncodeControlMessage(cancel)
	if err != nil {
		t.Fatalf("failed to encode cancel: %v", err)
	}
	var decCancel CancelMessage
	if err := json.Unmarshal(bytes, &decCancel); err != nil || decCancel != cancel {
		t.Fatalf("unmarshal mismatch: %+v", decCancel)
	}

	// 10. DownloadMode
	dlMode := DownloadModeMessage{
		Type:   CtrlDownloadMode,
		Manual: true,
	}
	bytes, err = EncodeControlMessage(dlMode)
	if err != nil {
		t.Fatalf("failed to encode download-mode: %v", err)
	}
	raw := string(bytes)
	if !strings.Contains(raw, `"manual":true`) {
		t.Fatalf("expected manual field in JSON, got: %s", raw)
	}
	if strings.Contains(raw, `"auto"`) {
		t.Fatalf("did not expect auto field in JSON, got: %s", raw)
	}
	var decDlMode DownloadModeMessage
	if err := json.Unmarshal(bytes, &decDlMode); err != nil || decDlMode != dlMode {
		t.Fatalf("unmarshal mismatch: %+v", decDlMode)
	}

	// 11. Pull
	pull := PullMessage{
		Type:   CtrlPull,
		FileID: "f-123",
	}
	bytes, err = EncodeControlMessage(pull)
	if err != nil {
		t.Fatalf("failed to encode pull: %v", err)
	}
	typeStr, err = DecodeBaseControlMessage(bytes)
	if err != nil || typeStr != CtrlPull {
		t.Fatalf("unexpected pull type: %v, err: %v", typeStr, err)
	}
	if !strings.Contains(string(bytes), `"fileId":"f-123"`) {
		t.Fatalf("expected fileId in pull JSON, got: %s", bytes)
	}
	var decPull PullMessage
	if err := json.Unmarshal(bytes, &decPull); err != nil || decPull != pull {
		t.Fatalf("unmarshal mismatch: %+v", decPull)
	}

	// 12. PullBatch
	pullBatch := PullBatchMessage{
		Type:    CtrlPullBatch,
		FileIDs: []string{"f-1", "f-2"},
	}
	bytes, err = EncodeControlMessage(pullBatch)
	if err != nil {
		t.Fatalf("failed to encode pull-batch: %v", err)
	}
	typeStr, err = DecodeBaseControlMessage(bytes)
	if err != nil || typeStr != CtrlPullBatch {
		t.Fatalf("unexpected pull-batch type: %v, err: %v", typeStr, err)
	}
	var decPullBatch PullBatchMessage
	if err := json.Unmarshal(bytes, &decPullBatch); err != nil {
		t.Fatalf("failed to unmarshal pull-batch: %v", err)
	}
	if decPullBatch.Type != pullBatch.Type || len(decPullBatch.FileIDs) != 2 ||
		decPullBatch.FileIDs[0] != "f-1" || decPullBatch.FileIDs[1] != "f-2" {
		t.Fatalf("unmarshal mismatch: %+v", decPullBatch)
	}

	// 13. DownloadAborted
	aborted := DownloadAbortedMessage{
		Type:   CtrlDownloadAborted,
		FileID: "f-123",
	}
	bytes, err = EncodeControlMessage(aborted)
	if err != nil {
		t.Fatalf("failed to encode download-aborted: %v", err)
	}
	typeStr, err = DecodeBaseControlMessage(bytes)
	if err != nil || typeStr != CtrlDownloadAborted {
		t.Fatalf("unexpected download-aborted type: %v, err: %v", typeStr, err)
	}
	var decAborted DownloadAbortedMessage
	if err := json.Unmarshal(bytes, &decAborted); err != nil || decAborted != aborted {
		t.Fatalf("unmarshal mismatch: %+v", decAborted)
	}
}
