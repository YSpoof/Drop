package state

import "errors"

// Donation reminder interval and PIX key — keep in sync with web/desktop:
//
//	DONATION_REMINDER_INTERVAL in src/lib/consts.ts
//	siteData.donationPixKey in src/lib/siteData.ts
const (
	DonationReminderInterval = 25
	DonationPixKey           = "cee3846a-a1ab-4e81-83ac-c5edb016fd71"
)

// RecordVisit increments the CLI visit count once and persists it.
// Returns whether the donation reminder is due after the increment.
func (s *Settings) RecordVisit() (due bool, err error) {
	if s.store == nil {
		return false, errors.New("store not initialized")
	}

	cfg, err := s.store.Load()
	if err != nil {
		cfg = &Config{}
	}

	cfg.VisitCount++
	if err := s.store.Save(cfg); err != nil {
		return false, err
	}

	s.mu.Lock()
	s.loadedCfg = cfg
	s.mu.Unlock()

	return donationReminderDue(cfg), nil
}

// IsDonationReminderDue reports whether the reminder is currently due.
func (s *Settings) IsDonationReminderDue() (bool, error) {
	if s.store == nil {
		return false, errors.New("store not initialized")
	}

	cfg, err := s.store.Load()
	if err != nil {
		return false, nil
	}
	return donationReminderDue(cfg), nil
}

// DismissDonationReminder sets the anchor to the current visit count,
// clearing due state and starting the next interval from this visit.
func (s *Settings) DismissDonationReminder() error {
	if s.store == nil {
		return errors.New("store not initialized")
	}

	cfg, err := s.store.Load()
	if err != nil {
		cfg = &Config{}
	}

	cfg.DonationReminderAnchor = cfg.VisitCount
	if err := s.store.Save(cfg); err != nil {
		return err
	}

	s.mu.Lock()
	s.loadedCfg = cfg
	s.mu.Unlock()
	return nil
}

func donationReminderDue(cfg *Config) bool {
	if cfg == nil {
		return false
	}
	return cfg.VisitCount >= cfg.DonationReminderAnchor+DonationReminderInterval
}
