package signaling

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"dropcli/internal/ports"

	"github.com/gorilla/websocket"
)

const (
	defaultPingInterval = 15 * time.Second
	defaultPongWait     = 10 * time.Second
)

// Client implements ports.SignalingPort using Gorilla WebSocket.
type Client struct {
	mu           sync.Mutex
	conn         *websocket.Conn
	handler      ports.SignalingEventHandler
	pingInterval time.Duration
	pongWait     time.Duration

	done      chan struct{}
	closeOnce sync.Once
	ctx       context.Context
	cancel    context.CancelFunc
}

// NewClient returns a new unstarted Client.
func NewClient() *Client {
	return &Client{
		pingInterval: defaultPingInterval,
		pongWait:     defaultPongWait,
	}
}

// SetPingInterval allows setting custom heartbeat intervals (useful for testing).
func (c *Client) SetPingInterval(interval, wait time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pingInterval = interval
	c.pongWait = wait
}

// SetHandler sets the event handler for signaling messages.
func (c *Client) SetHandler(handler ports.SignalingEventHandler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.handler = handler
}

func (c *Client) getHandler() ports.SignalingEventHandler {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.handler
}

// Connect dials the signaling WebSocket server and initiates the read & heartbeat loops.
func (c *Client) Connect(ctx context.Context, wsURL string) error {
	c.mu.Lock()
	if c.conn != nil {
		c.mu.Unlock()
		return errors.New("signaling client is already connected")
	}

	c.ctx, c.cancel = context.WithCancel(ctx)
	c.done = make(chan struct{})
	c.closeOnce = sync.Once{}

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
		Proxy:            http.ProxyFromEnvironment,
	}

	conn, _, err := dialer.DialContext(c.ctx, wsURL, nil)
	if err != nil {
		c.cancel()
		c.mu.Unlock()
		return fmt.Errorf("websocket dial failed: %w", err)
	}

	c.conn = conn
	c.mu.Unlock()

	if h := c.getHandler(); h != nil {
		h.OnConnected()
	}

	go c.readLoop()
	go c.heartbeatLoop()

	return nil
}

// Close closes the WebSocket connection and stops background routines.
func (c *Client) Close() error {
	var err error
	c.closeOnce.Do(func() {
		c.mu.Lock()
		if c.cancel != nil {
			c.cancel()
		}
		if c.conn != nil {
			err = c.conn.Close()
		}
		if c.done != nil {
			close(c.done)
		}
		c.mu.Unlock()
	})
	return err
}

func (c *Client) writeJSON(v any) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return errors.New("websocket not connected")
	}

	c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return c.conn.WriteJSON(v)
}

// SendAnnounce sends an announcement message declaring the local peer identity and role.
func (c *Client) SendAnnounce(peerID string, host bool, displayName string) error {
	msg := AnnounceMessage{
		Type:        TypeAnnounce,
		PeerID:      peerID,
		Host:        host,
		DisplayName: displayName,
	}
	return c.writeJSON(msg)
}

// SendJoinCode sends a pairing request for a specific PIN.
func (c *Client) SendJoinCode(peerID string, code string) error {
	msg := JoinCodeMessage{
		Type:   TypeJoinCode,
		PeerID: peerID,
		Code:   code,
	}
	return c.writeJSON(msg)
}

// SendSignal forwards an SDP offer/answer or ICE candidate.
func (c *Client) SendSignal(fromPeerID string, targetPeerID string, signalData []byte) error {
	msg := SignalMessage{
		Type:         TypeSignal,
		FromPeerID:   fromPeerID,
		TargetPeerID: targetPeerID,
		Payload:      json.RawMessage(signalData),
	}
	return c.writeJSON(msg)
}

// SendPing sends a heartbeat ping.
func (c *Client) SendPing() error {
	return c.writeJSON(PingMessage{Type: TypePing})
}

func (c *Client) readLoop() {
	defer func() {
		c.Close()
	}()

	pongChan := make(chan struct{}, 1)

	for {
		select {
		case <-c.ctx.Done():
			return
		default:
		}

		_, data, err := c.conn.ReadMessage()
		if err != nil {
			if h := c.getHandler(); h != nil {
				h.OnDisconnected(err)
			}
			return
		}

		var base BaseMessage
		if err := json.Unmarshal(data, &base); err != nil {
			continue
		}

		h := c.getHandler()

		switch base.Type {
		case TypeCodeAssigned:
			var msg CodeAssignedMessage
			if err := json.Unmarshal(data, &msg); err == nil && h != nil {
				h.OnCodeAssigned(msg.Code)
			}
		case TypePeerJoining:
			var msg PeerJoiningMessage
			if err := json.Unmarshal(data, &msg); err == nil && msg.Requester != nil && h != nil {
				h.OnPeerJoining(ports.SignalingPeerInfo{
					ID:          msg.Requester.PeerID,
					DisplayName: msg.Requester.DisplayName,
					Lan:         msg.Lan,
				})
			}
		case TypeJoinAccepted:
			var msg JoinAcceptedMessage
			if err := json.Unmarshal(data, &msg); err == nil && msg.Host != nil && h != nil {
				h.OnJoinAccepted(ports.SignalingPeerInfo{
					ID:          msg.Host.PeerID,
					DisplayName: msg.Host.DisplayName,
					Lan:         msg.Lan,
				})
			}
		case TypeJoinRejected:
			var msg JoinRejectedMessage
			if err := json.Unmarshal(data, &msg); err == nil && h != nil {
				h.OnJoinRejected("Pairing failed")
			}
		case TypeSignal:
			var msg SignalMessage
			if err := json.Unmarshal(data, &msg); err == nil && h != nil {
				h.OnSignal(msg.FromPeerID, []byte(msg.Payload))
			}
		case TypePing:
			// Server sent ping, answer with pong
			_ = c.writeJSON(PongMessage{Type: TypePong})
		case TypePong:
			select {
			case pongChan <- struct{}{}:
			default:
			}
		}
	}
}

func (c *Client) heartbeatLoop() {
	ticker := time.NewTicker(c.pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-c.ctx.Done():
			return
		case <-c.done:
			return
		case <-ticker.C:
			if err := c.SendPing(); err != nil {
				if h := c.getHandler(); h != nil {
					h.OnError(fmt.Errorf("heartbeat ping failed: %w", err))
				}
				c.Close()
				return
			}
		}
	}
}
