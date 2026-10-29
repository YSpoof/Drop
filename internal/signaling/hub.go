package signaling

import (
	"crypto/rand"
	"encoding/json"
	"log"
	"math/big"
	"sync"

	"github.com/gorilla/websocket"
)

type storedPeer struct {
	ws          *websocket.Conn
	peerID      string
	displayName string
	code        string
	hasCode     bool
	publicIpv4  string
}

type Hub struct {
	mu    sync.Mutex
	peers map[string]*storedPeer
	codes map[string]string
}

func NewHub() *Hub {
	return &Hub{
		peers: make(map[string]*storedPeer),
		codes: make(map[string]string),
	}
}

func (h *Hub) send(ws *websocket.Conn, v interface{}) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	if err := ws.WriteMessage(websocket.TextMessage, b); err != nil {
		log.Printf("signaling send: %v", err)
	}
}

func (h *Hub) toPeerInfo(p *storedPeer) SignalingPeer {
	return SignalingPeer{PeerID: p.peerID, DisplayName: p.displayName}
}

func (h *Hub) removePeer(peerID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	p, ok := h.peers[peerID]
	if !ok {
		return
	}
	if p.hasCode && h.codes[p.code] == peerID {
		delete(h.codes, p.code)
	}
	delete(h.peers, peerID)
}

func (h *Hub) HandleConnection(ws *websocket.Conn) {
	defer ws.Close()
	var registeredPeerID string

	for {
		_, data, err := ws.ReadMessage()
		if err != nil {
			break
		}
		var msg ClientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case TypeAnnounce:
			if msg.PeerID == "" {
				continue
			}
			registeredPeerID = msg.PeerID

			h.mu.Lock()
			previous := ""
			previousHas := false
			if existing, ok := h.peers[msg.PeerID]; ok {
				previous = existing.code
				previousHas = existing.hasCode
			}
			var reusable string
			reusableHas := false
			if previousHas && h.codes[previous] == msg.PeerID {
				reusable = previous
				reusableHas = true
			}
			var code string
			codeHas := false
			requested := normalizeCode(msg.Code)
			requestedHas := requested != ""

			if msg.Host {
				if requestedHas {
					code = requested
					codeHas = true
				} else if reusableHas {
					code = reusable
					codeHas = true
				} else {
					c, err := generateUniqueCode(h.codes)
					if err != nil {
						h.mu.Unlock()
						continue
					}
					code = c
					codeHas = true
				}
			}

			if previousHas && previous != code {
				if h.codes[previous] == msg.PeerID {
					delete(h.codes, previous)
				}
			}
			if codeHas {
				if owner, ok := h.codes[code]; !ok || owner == msg.PeerID {
					h.codes[code] = msg.PeerID
				}
			}

			publicIpv4 := ""
			if IsPublicIpv4(msg.PublicIpv4) {
				publicIpv4 = msg.PublicIpv4
			}

			h.peers[msg.PeerID] = &storedPeer{
				ws:          ws,
				peerID:      msg.PeerID,
				displayName: msg.DisplayName,
				code:        code,
				hasCode:     codeHas,
				publicIpv4:  publicIpv4,
			}

			assigned := codeHas && !requestedHas && !reusableHas
			h.mu.Unlock()

			if assigned {
				h.send(ws, CodeAssignedMessage{Type: TypeCodeAssigned, Code: code})
			}

		case TypeJoinCode:
			code := normalizeCode(msg.Code)
			h.mu.Lock()
			sender := h.peers[registeredPeerID]
			var owner *storedPeer
			if code != "" {
				if pid, ok := h.codes[code]; ok {
					owner = h.peers[pid]
				}
			}
			if sender == nil || owner == nil || owner.peerID == sender.peerID {
				h.mu.Unlock()
				h.send(ws, JoinRejectedMessage{Type: TypeJoinRejected})
				break
			}
			lan := samePublicIP(sender, owner)
			ownerWS := owner.ws
			requesterInfo := h.toPeerInfo(sender)
			hostInfo := h.toPeerInfo(owner)
			h.mu.Unlock()

			if lan {
				h.send(ownerWS, PeerJoiningMessage{Type: TypePeerJoining, Requester: &requesterInfo, Lan: true})
				h.send(ws, JoinAcceptedMessage{Type: TypeJoinAccepted, Host: &hostInfo, Lan: true})
			} else {
				h.send(ownerWS, PeerJoiningMessage{Type: TypePeerJoining, Requester: &requesterInfo})
				h.send(ws, JoinAcceptedMessage{Type: TypeJoinAccepted, Host: &hostInfo})
			}

		case TypeSignal:
			h.mu.Lock()
			sender := h.peers[registeredPeerID]
			target := h.peers[msg.TargetPeerID]
			h.mu.Unlock()
			if sender == nil || target == nil {
				break
			}
			h.send(target.ws, SignalMessage{
				Type:       TypeSignal,
				FromPeerID: sender.peerID,
				Payload:    msg.Payload,
			})

		case TypePing:
			h.send(ws, PongMessage{Type: TypePong})
		}
	}

	if registeredPeerID != "" {
		h.removePeer(registeredPeerID)
	}
}

func normalizeCode(code string) string {
	// reuse regex-like validation
	if len(code) != SHARE_CODE_DIGITS {
		return ""
	}
	for _, r := range code {
		if r < '0' || r > '9' {
			return ""
		}
	}
	return code
}

var errFailedAllocate = &allocError{}

type allocError struct{}

func (e *allocError) Error() string { return "Failed to allocate share code" }

func generateUniqueCode(codes map[string]string) (string, error) {
	for i := 0; i < 50; i++ {
		code, err := randomCode()
		if err != nil {
			return "", err
		}
		if _, ok := codes[code]; !ok {
			return code, nil
		}
	}
	return "", errFailedAllocate
}

func randomCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(SHARE_CODE_RANGE))
	if err != nil {
		return "", err
	}
	return padInt(int(n.Int64()), SHARE_CODE_DIGITS), nil
}

func padInt(v, width int) string {
	s := ""
	// convert
	digits := []byte{}
	if v == 0 {
		digits = append(digits, '0')
	} else {
		for v > 0 {
			digits = append([]byte{byte('0' + v%10)}, digits...)
			v /= 10
		}
	}
	s = string(digits)
	for len(s) < width {
		s = "0" + s
	}
	return s
}

func samePublicIP(a, b *storedPeer) bool {
	return a.publicIpv4 != "" && a.publicIpv4 == b.publicIpv4
}