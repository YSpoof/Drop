package signaling

import (
	"encoding/json"
	"testing"
)

func TestNormalizeCode(t *testing.T) {
	if normalizeCode("1234") != "1234" {
		t.Fatal("expected valid code")
	}
	if normalizeCode("12") != "" {
		t.Fatal("expected invalid length")
	}
	if normalizeCode("abcd") != "" {
		t.Fatal("expected invalid chars")
	}
}

func TestCodeAllocationShape(t *testing.T) {
	// ensure generated codes have correct width
	c, err := randomCode()
	if err != nil {
		t.Fatal(err)
	}
	if len(c) != SHARE_CODE_DIGITS {
		t.Fatalf("expected %d digits, got %d", SHARE_CODE_DIGITS, len(c))
	}
	b, _ := json.Marshal(CodeAssignedMessage{Type: TypeCodeAssigned, Code: c})
	if len(b) == 0 {
		t.Fatal("marshal failed")
	}
}