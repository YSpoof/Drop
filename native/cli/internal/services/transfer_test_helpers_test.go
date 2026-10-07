package services

import (
	"encoding/json"

	"dropcli/internal/webrtc"
)

func webrtcMeta(fileID, name string, size int64, hash string) webrtc.MetaMessage {
	return webrtc.MetaMessage{
		Type:   webrtc.CtrlMeta,
		FileID: fileID,
		Name:   name,
		Size:   size,
		Hash:   hash,
	}
}

func decodeType(data []byte) (string, error) {
	var base struct {
		Type string `json:"type"`
	}
	err := json.Unmarshal(data, &base)
	return base.Type, err
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
