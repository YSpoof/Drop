package bridge

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"dropnative/desktop/internal/dialog"
	"dropnative/desktop/internal/watcher"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow loopback from any local/remote origin
	},
}

// HandlerFunc is the signature for an RPC method handler.
type HandlerFunc func(params json.RawMessage) (any, error)

// Server coordinates the WebSocket bridge and RPC dispatch.
type Server struct {
	token          string
	handlers       map[string]HandlerFunc
	mu             sync.RWMutex
	clients        map[*clientConn]struct{}
	watcherManager *watcher.Manager
}

type clientConn struct {
	ws *websocket.Conn
	mu sync.Mutex
}

func (c *clientConn) writeJSON(v any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ws.WriteJSON(v)
}

// NewServer creates a new bridge server with default FS handlers registered.
func NewServer(token string) *Server {
	s := &Server{
		token:          token,
		handlers:       make(map[string]HandlerFunc),
		clients:        make(map[*clientConn]struct{}),
		watcherManager: watcher.NewManager(),
	}
	s.registerFSHandlers()
	s.registerDialogHandlers()
	s.registerWatchHandlers()
	return s
}

func (s *Server) registerWatchHandlers() {
	s.Register("watch.start", func(params json.RawMessage) (any, error) {
		var p struct {
			WatcherID  string `json:"watcherId"`
			FolderPath string `json:"folderPath"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		if p.WatcherID == "" || p.FolderPath == "" {
			return nil, fmt.Errorf("missing watcherId or folderPath")
		}

		err := s.watcherManager.Start(p.WatcherID, p.FolderPath, func(ev watcher.Event) {
			s.Broadcast("watch.event", ev)
		})
		return nil, err
	})

	s.Register("watch.stop", func(params json.RawMessage) (any, error) {
		var p struct {
			WatcherID string `json:"watcherId"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		return nil, s.watcherManager.Stop(p.WatcherID)
	})
}

func (s *Server) registerDialogHandlers() {
	s.Register("dialog.pickFiles", func(params json.RawMessage) (any, error) {
		var p struct {
			Title       string `json:"title"`
			DefaultPath string `json:"defaultPath"`
		}
		if len(params) > 0 {
			_ = json.Unmarshal(params, &p)
		}
		if p.Title == "" {
			p.Title = "Select Files"
		}
		return dialog.PickFiles(p.Title, p.DefaultPath)
	})

	s.Register("dialog.pickFolder", func(params json.RawMessage) (any, error) {
		var p struct {
			Title       string `json:"title"`
			DefaultPath string `json:"defaultPath"`
		}
		if len(params) > 0 {
			_ = json.Unmarshal(params, &p)
		}
		if p.Title == "" {
			p.Title = "Select Folder"
		}
		return dialog.PickFolder(p.Title, p.DefaultPath)
	})
}

// Register registers a new method handler.
func (s *Server) Register(method string, handler HandlerFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handlers[method] = handler
}

func (s *Server) registerFSHandlers() {
	s.Register("fs.getDownloadsPath", func(_ json.RawMessage) (any, error) {
		return GetDownloadsPath()
	})

	s.Register("fs.stat", func(params json.RawMessage) (any, error) {
		var p struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		return Stat(p.Path)
	})

	s.Register("fs.readDir", func(params json.RawMessage) (any, error) {
		var p struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		return ReadDir(p.Path)
	})

	s.Register("fs.mkdir", func(params json.RawMessage) (any, error) {
		var p struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		return nil, Mkdir(p.Path)
	})

	s.Register("fs.remove", func(params json.RawMessage) (any, error) {
		var p struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		return nil, Remove(p.Path)
	})

	s.Register("fs.move", func(params json.RawMessage) (any, error) {
		var p struct {
			From string `json:"from"`
			To   string `json:"to"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		return nil, Move(p.From, p.To)
	})
}

// Broadcast sends a push event notification to all connected clients.
func (s *Server) Broadcast(event string, data any) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	msg := Notification{Event: event, Data: data}
	for client := range s.clients {
		_ = client.writeJSON(msg)
	}
}

// ServeHTTP handles the WebSocket handshake and message dispatch.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	tokenBytes := []byte(s.token)
	got := []byte(r.URL.Query().Get("token"))
	if len(got) == 0 {
		got = []byte(r.Header.Get("X-Drop-Token"))
	}

	if len(got) != len(tokenBytes) || subtle.ConstantTimeCompare(got, tokenBytes) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	client := &clientConn{ws: ws}
	s.mu.Lock()
	s.clients[client] = struct{}{}
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.clients, client)
		s.mu.Unlock()
		_ = ws.Close()
	}()

	for {
		_, msgBytes, err := ws.ReadMessage()
		if err != nil {
			break
		}

		var req Request
		if err := json.Unmarshal(msgBytes, &req); err != nil {
			_ = client.writeJSON(Response{Error: "invalid request: " + err.Error()})
			continue
		}

		s.mu.RLock()
		handler, exists := s.handlers[req.Method]
		s.mu.RUnlock()

		if !exists {
			_ = client.writeJSON(Response{
				ID:    req.ID,
				Error: fmt.Sprintf("method not found: %s", req.Method),
			})
			continue
		}

		result, err := handler(req.Params)
		resp := Response{ID: req.ID, Result: result}
		if err != nil {
			resp.Error = err.Error()
		}

		if err := client.writeJSON(resp); err != nil {
			break
		}
	}
}
