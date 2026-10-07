# Tasks

## 1. Persistence and due math

- [x] 1.1 Add `visitCount` and `donationReminderAnchor` to `state.Config` JSON and ensure `SaveConfig` / `FlushStats` preserve both fields the same way `TransferStats` is preserved — verify load/save round-trip keeps the values
- [x] 1.2 Add CLI constant `DonationReminderInterval = 25` and PIX key constant matching `siteData.donationPixKey` (`cee3846a-a1ab-4e81-83ac-c5edb016fd71`) — verify the PIX string equals the web value
- [x] 1.3 Implement record-visit + is-due + dismiss helpers on settings/store (`visitCount++`, due when `visitCount >= anchor + 25`, dismiss sets anchor to current visitCount) — verify unit tests cover first due at 25, no stack while due, and dismiss → next due at N+25

## 2. Count every process start

- [x] 2.1 Call the record-visit helper once from `run` after settings load (both quick and interactive) — verify a second call in the same process is not needed and `-q` still increments when exercised via the helper/settings path
- [x] 2.2 Confirm quick mode never invokes the donation prompt — verify `runQuick` has no call to the reminder UI

## 3. Reminder prompt UI

- [x] 3.1 Add pt-BR strings for title `Gostou do Drop?`, free-app + PIX body, PIX copy hint, **Fechar**, and copy success/failure feedback in `text` — verify strings match web wording intent
- [x] 3.2 Implement standalone donation reminder TUI (copy PIX via existing clipboard helper, **Fechar** dismisses) — verify copy success/failure feedback and that Fechar triggers dismiss persistence
- [x] 3.3 From `runInteractive`, when the mode menu will run (no `-s`/`-c`) and the reminder is due, show the prompt before `RunForm`; skip when role flags skip the menu — verify due + mode-menu path shows it and `-s`/`-c` interactive path does not

## 4. Configurações PIX block

- [x] 4.1 Extend `RunConfigMenu` to show the PIX key and a copy control with the same clipboard success/failure feedback, without clearing a due reminder — verify opening/copying from settings does not call dismiss
