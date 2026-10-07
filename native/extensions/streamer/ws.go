package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
)

type wsConn struct {
	conn net.Conn
	br   *bufio.Reader
}

func dialExtension(nlPort int, extensionID, connectToken string) (*wsConn, error) {
	conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", nlPort))
	if err != nil {
		return nil, err
	}

	keyBytes := make([]byte, 16)
	if _, err = rand.Read(keyBytes); err != nil {
		conn.Close()
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)
	query := url.Values{}
	query.Set("extensionId", extensionID)
	query.Set("connectToken", connectToken)
	req := fmt.Sprintf(
		"GET /?%s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n",
		query.Encode(),
		nlPort,
		key,
	)
	if _, err = io.WriteString(conn, req); err != nil {
		conn.Close()
		return nil, err
	}

	br := bufio.NewReader(conn)
	status, err := br.ReadString('\n')
	if err != nil {
		conn.Close()
		return nil, err
	}
	if !strings.Contains(status, "101") {
		conn.Close()
		return nil, fmt.Errorf("websocket upgrade: %s", strings.TrimSpace(status))
	}
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			conn.Close()
			return nil, err
		}
		if line == "\r\n" || line == "\n" {
			break
		}
	}
	return &wsConn{conn: conn, br: br}, nil
}

func (c *wsConn) writeText(payload []byte) error {
	header := []byte{0x81}
	length := len(payload)
	switch {
	case length < 126:
		header = append(header, byte(length)|0x80)
	case length <= 65535:
		header = append(header, 126|0x80, byte(length>>8), byte(length))
	default:
		var ext [8]byte
		binary.BigEndian.PutUint64(ext[:], uint64(length))
		header = append(header, 127|0x80)
		header = append(header, ext[:]...)
	}

	mask := make([]byte, 4)
	if _, err := rand.Read(mask); err != nil {
		return err
	}
	header = append(header, mask...)
	masked := make([]byte, length)
	for i, b := range payload {
		masked[i] = b ^ mask[i%4]
	}
	if _, err := c.conn.Write(header); err != nil {
		return err
	}
	_, err := c.conn.Write(masked)
	return err
}

func (c *wsConn) readText() ([]byte, error) {
	for {
		header := make([]byte, 2)
		if _, err := io.ReadFull(c.br, header); err != nil {
			return nil, err
		}
		opcode := header[0] & 0x0f
		length := int(header[1] & 0x7f)
		switch length {
		case 126:
			ext := make([]byte, 2)
			if _, err := io.ReadFull(c.br, ext); err != nil {
				return nil, err
			}
			length = int(binary.BigEndian.Uint16(ext))
		case 127:
			ext := make([]byte, 8)
			if _, err := io.ReadFull(c.br, ext); err != nil {
				return nil, err
			}
			length = int(binary.BigEndian.Uint64(ext))
		}
		payload := make([]byte, length)
		if _, err := io.ReadFull(c.br, payload); err != nil {
			return nil, err
		}
		switch opcode {
		case 0x1:
			return payload, nil
		case 0x8:
			return nil, io.EOF
		case 0x9:
			if err := c.writeControl(0xA, payload); err != nil {
				return nil, err
			}
		case 0xA:
			continue
		default:
			return nil, fmt.Errorf("unsupported websocket opcode %d", opcode)
		}
	}
}

func (c *wsConn) writeControl(opcode byte, payload []byte) error {
	header := []byte{0x80 | opcode, byte(len(payload)) | 0x80}
	mask := make([]byte, 4)
	if _, err := rand.Read(mask); err != nil {
		return err
	}
	header = append(header, mask...)
	masked := make([]byte, len(payload))
	for i, b := range payload {
		masked[i] = b ^ mask[i%4]
	}
	if _, err := c.conn.Write(header); err != nil {
		return err
	}
	_, err := c.conn.Write(masked)
	return err
}
