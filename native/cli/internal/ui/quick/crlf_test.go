package quick

import (
	"bytes"
	"strings"
	"testing"

	"dropcli/internal/ui/text"
)

func TestToCRLFConvertsBareNewlines(t *testing.T) {
	in := "PIN atribuído: 1234\n"
	got := toCRLF(in)
	want := "PIN atribuído: 1234\r\n"
	if got != want {
		t.Fatalf("toCRLF(%q) = %q, want %q", in, got, want)
	}
}

func TestToCRLFIdempotentOnCRLF(t *testing.T) {
	in := "já ok\r\n"
	got := toCRLF(in)
	if got != in {
		t.Fatalf("toCRLF should not double CR, got %q", got)
	}
}

func TestCrlfIfRawNoopWhenInactive(t *testing.T) {
	setHostRawActive(false)
	t.Cleanup(func() { setHostRawActive(false) })

	in := text.PINCopiedLine
	if !strings.HasSuffix(in, "\n") || strings.HasSuffix(in, "\r\n") {
		t.Fatalf("fixture expected bare \\n suffix, got %q", in)
	}
	got := crlfIfRaw(in)
	if got != in {
		t.Fatalf("inactive raw must pass through, got %q want %q", got, in)
	}
}

func TestWriteHostWaitAppliesCRLFWhenRawActive(t *testing.T) {
	setHostRawActive(true)
	t.Cleanup(func() { setHostRawActive(false) })

	var buf bytes.Buffer
	n, err := writeHostWait(&buf, text.PressCopyHint)
	if err != nil {
		t.Fatal(err)
	}
	got := buf.String()
	if n != len(got) {
		t.Fatalf("wrote %d bytes, string len %d", n, len(got))
	}
	if !strings.Contains(got, "\r\n") {
		t.Fatalf("expected CRLF while raw active, got %q", got)
	}
	if strings.Contains(got, "\n") && !strings.Contains(got, "\r\n") {
		t.Fatalf("bare newline leaked: %q", got)
	}
	// Original text constants stay bare \\n
	if strings.Contains(text.PressCopyHint, "\r\n") {
		t.Fatal("text constants must stay bare \\n")
	}
}

func TestWriteHostWaitPassthroughWhenRawInactive(t *testing.T) {
	setHostRawActive(false)
	t.Cleanup(func() { setHostRawActive(false) })

	var buf bytes.Buffer
	if _, err := writeHostWait(&buf, text.AssignedPIN); err != nil {
		t.Fatal(err)
	}
	// format verb left intact — writeHostWait used with preformatted string below
	var buf2 bytes.Buffer
	line := "PIN atribuído: 9999\n"
	if _, err := writeHostWait(&buf2, line); err != nil {
		t.Fatal(err)
	}
	if buf2.String() != line {
		t.Fatalf("inactive: got %q want %q", buf2.String(), line)
	}
}

func TestFprintfHostWaitCRLFWhenRaw(t *testing.T) {
	setHostRawActive(true)
	t.Cleanup(func() { setHostRawActive(false) })

	var buf bytes.Buffer
	if _, err := fprintfHostWait(&buf, text.AssignedPIN, "4242"); err != nil {
		t.Fatal(err)
	}
	got := buf.String()
	want := toCRLF("PIN atribuído: 4242\n")
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
