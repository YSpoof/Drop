//! Byte sizes and width-aware truncation.

use std::borrow::Cow;

use unicode_width::UnicodeWidthChar;

const ESC: char = '\x1b';
const ELLIPSIS: char = '…';
const UNITS: &[u8] = b"KMGTPE";

/// Binary units with one decimal (`1.5 KiB`), up to EiB.
pub fn format_bytes(bytes: u64) -> String {
    const UNIT: u64 = 1024;
    if bytes < UNIT {
        return format!("{bytes} B");
    }
    let (mut div, mut exp) = (UNIT, 0);
    let mut n = bytes / UNIT;
    while n >= UNIT {
        div *= UNIT;
        exp += 1;
        n /= UNIT;
    }
    format!("{:.1} {}iB", bytes as f64 / div as f64, UNITS[exp] as char)
}

/// Terminal cells `s` occupies. Escape sequences and control characters take none.
pub fn width(s: &str) -> usize {
    tokens(s).map(|(_, cells)| cells).sum()
}

/// Shortens `s` to at most `max` cells, ending in `…` when cut.
/// Wide characters are never split, combining marks stay with their base,
/// and escape sequences are kept whole (also those after the cut, so styles still reset).
pub fn truncate(s: &str, max: usize) -> Cow<'_, str> {
    if width(s) <= max {
        return Cow::Borrowed(s);
    }
    if max == 0 {
        return Cow::Borrowed("");
    }
    let budget = max - 1;
    let mut out = String::with_capacity(s.len());
    let (mut used, mut cut) = (0, false);
    for (token, cells) in tokens(s) {
        let is_escape = token.starts_with(ESC);
        match (cut, used + cells > budget) {
            (false, false) => {
                out.push_str(token);
                used += cells;
            }
            (false, true) => {
                cut = true;
                out.push(ELLIPSIS);
            }
            (true, _) if is_escape => out.push_str(token),
            (true, _) => {}
        }
    }
    Cow::Owned(out)
}

/// Splits `s` into escape sequences and single characters, each with its cell width.
fn tokens(s: &str) -> impl Iterator<Item = (&str, usize)> {
    let mut rest = s;
    std::iter::from_fn(move || {
        let c = rest.chars().next()?;
        let (len, cells) = match c {
            ESC => (escape_len(rest), 0),
            _ => (c.len_utf8(), c.width().unwrap_or(0)),
        };
        let (token, tail) = rest.split_at(len);
        rest = tail;
        Some((token, cells))
    })
}

/// Byte length of the escape sequence at the start of `s` (which starts with ESC).
/// CSI ends at its final byte, OSC at BEL or ST; an unterminated sequence takes the rest.
fn escape_len(s: &str) -> usize {
    let bytes = s.as_bytes();
    match bytes.get(1) {
        Some(b'[') => bytes[2..]
            .iter()
            .position(|b| (0x40..=0x7e).contains(b))
            .map_or(s.len(), |i| i + 3),
        Some(b']') => (2..bytes.len())
            .find_map(|i| match (bytes[i], bytes.get(i + 1)) {
                (0x07, _) => Some(i + 1),
                (0x1b, Some(b'\\')) => Some(i + 2),
                _ => None,
            })
            .unwrap_or(s.len()),
        Some(_) => 1 + s[1..].chars().next().map_or(0, char::len_utf8),
        None => 1,
    }
}

#[cfg(test)]
#[path = "format_tests.rs"]
mod tests;
