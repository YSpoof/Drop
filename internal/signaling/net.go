package signaling

func IsPrivateOctet(a, b int) bool {
	if a == 10 {
		return true
	}
	if a == 172 && b >= 16 && b <= 31 {
		return true
	}
	if a == 192 && b == 168 {
		return true
	}
	return false
}

func IsPublicIpv4(ip string) bool {
	parts := splitIpv4(ip)
	if parts == nil {
		return false
	}
	a, b := parts[0], parts[1]
	if a == 0 || a == 127 || a >= 224 {
		return false
	}
	if a == 169 && b == 254 {
		return false
	}
	return !IsPrivateOctet(a, b)
}

func splitIpv4(ip string) []int {
	var parts []int
	current := 0
	hasDigit := false
	count := 0
	for i := 0; i <= len(ip); i++ {
		c := byte(0)
		if i < len(ip) {
			c = ip[i]
		}
		if c >= '0' && c <= '9' {
			current = current*10 + int(c-'0')
			hasDigit = true
			if current > 255 {
				return nil
			}
			continue
		}
		if hasDigit {
			parts = append(parts, current)
			current = 0
			hasDigit = false
			count++
			if count > 4 {
				return nil
			}
		}
		if i == len(ip) {
			break
		}
		if c != '.' {
			return nil
		}
	}
	if count != 4 {
		return nil
	}
	return parts
}