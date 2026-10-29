package bridge

import "encoding/json"

// Request represents an RPC request sent by the client.
type Request struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params,omitempty"`
}

// Response represents an RPC response sent back to the client.
type Response struct {
	ID     string `json:"id"`
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

// Notification represents a push event from host to client.
type Notification struct {
	Event string `json:"event"`
	Data  any    `json:"data"`
}

// StatResult represents file/directory metadata.
type StatResult struct {
	Exists     bool   `json:"exists"`
	Path       string `json:"path"`
	Size       int64  `json:"size"`
	IsDir      bool   `json:"isDirectory"`
	ModifiedAt int64  `json:"modifiedAt"` // Milliseconds since epoch
}

// DirEntry represents an entry inside a directory.
type DirEntry struct {
	Entry      string `json:"entry"`      // File or directory name
	Path       string `json:"path"`       // Absolute path
	Type       string `json:"type"`       // "FILE" or "DIRECTORY"
	Size       int64  `json:"size"`       // Size in bytes
	ModifiedAt int64  `json:"modifiedAt"` // Milliseconds since epoch
}
