// Package text holds hardcoded pt-BR user-facing CLI strings.
//
// Overlapping product labels MUST match Drop web/desktop Svelte UI
// (source of truth), e.g.:
//   - "Gerar um código" / "Possuo um código" — src/routes/+page.svelte
//   - "Nome de exibição" / "Pasta para downloads" — SetupWizard / SettingsModal
//   - "Baixar" / "Remover" — FileTreeView actions
//   - "Copiar código" — ShareStatus.svelte
//   - "Configurações" — SettingsModal / Fab
//
// Flag names, identifiers, protocol fields, and brand tokens (Drop, DropCli)
// stay English / unchanged.
package text

// Shared web/desktop labels.
const (
	HostSession = "Gerar um código"
	JoinSession = "Possuo um código"
	DisplayName = "Nome de exibição"
	DownloadDir = "Pasta para downloads"
	Download    = "Baixar"
	Remove      = "Remover"
	CopyCode    = "Copiar código"
	Settings    = "Configurações"
)

// Interactive form.
const (
	ModePrompt          = "O que você deseja fazer?"
	EnterPIN            = "Digite o PIN da sessão (4 dígitos)"
	ResetTransferStats  = "Zerar estatísticas de transferência"
	ErrPINDigits        = "PIN deve ter exatamente 4 dígitos"
	ErrDownloadDirEmpty = "pasta para downloads não pode ficar vazia"
	ErrPathNotDir       = "caminho existe, mas não é um diretório"
	ErrSettingsNil      = "configurações não podem ser nulas"
)

// Connection / role status (CLI chrome).
const (
	RoleHostLabel          = "Host"
	RoleJoinLabel          = "Entrar"
	StatusIdle             = "Inativo"
	StatusConnecting       = "Conectando..."
	StatusConnected        = "Conectado"
	StatusDisconnected     = "Desconectado"
	StatusFailed           = "Falhou"
	StatusWaitingReconnect = "aguardando reconexão"
	ConnectedTo            = "Conectado a: %s"
	PINLabel               = "PIN: %s"
)

// Inbox chrome.
const (
	InboxTitle       = "DropCli — Caixa de entrada"
	CopyPINHint      = "c copiar PIN  C copiar link de compartilhamento"
	PendingOffers    = "Ofertas pendentes"
	PendingNone      = "  (nenhuma — aguardando o peer anunciar arquivos)"
	Transfers        = "Transferências"
	TransfersNone    = "  (nenhuma ainda)"
	InboxHelp        = "↑/↓ mover  espaço marcar  a todos  d baixar  r remover  c PIN  C link  q sair"
	NothingSelected  = "Nada selecionado"
	DownloadFailed   = "Falha ao baixar: %v"
	DownloadingNamed = "Baixando %s…"
	RemoveFailed     = "Falha ao remover: %v"
	RemovedNamed     = "Removido %s"
	NFiles           = "%d arquivos"
	CopyPINFailed    = "Falha ao copiar PIN: %v"
	PINCopied        = "PIN copiado"
	CopyLinkFailed   = "Falha ao copiar link: %v"
	ShareLinkCopied  = "Link de compartilhamento copiado"
)

// Flag help / usage (flag names stay English).
const (
	FlagQuick          = "Modo rápido não interativo"
	FlagHost           = "Gerar um código (anfitrião da sessão)"
	FlagConnect        = "Entrar em uma sessão com PIN de 4 dígitos"
	FlagOutput         = "Diretório de destino para arquivos baixados"
	UsageHeader        = "Uso do dropcli:"
	UsageSynopsis      = "  dropcli [flags] [caminhos…]\n\n"
	UsageInteractive   = "Modo interativo:\n"
	UsageInteractiveEx = "  dropcli [-s|-c <pin>] [-o <pasta-downloads>] [caminhos…]\n\n"
	UsageQuick         = "Modo rápido:\n"
	UsageQuickHost     = "  dropcli -q -s [caminhos…] [-o <pasta-saída>]\n"
	UsageQuickJoin     = "  dropcli -q -c <pin> [caminhos…] [-o <pasta-saída>]\n\n"
	UsageFlags         = "Flags:\n"
)

// Validation errors (flag names -s/-c remain English).
const (
	ErrQuickNeedsHostOrConnect = "modo rápido requer host (-s) ou connect (-c)"
	ErrHostAndConnect          = "não é possível usar host (-s) e connect (-c) ao mesmo tempo"
	ErrInvalidPIN              = "PIN inválido: %w"
	ErrPathMissing             = "caminho não existe: %w"
	ErrPathUnsupported         = "caminho não é arquivo nem diretório: %s"
)

// Quick-mode operator lines.
const (
	AssignedPIN             = "PIN atribuído: %s\n"
	PressCopyHint           = "Pressione c para copiar o PIN, C para copiar o link\n"
	PeerJoined              = "Peer entrou: %s\n"
	JoinAccepted            = "Entrada aceita por: %s\n"
	WaitingReconnect        = "aguardando reconexão...\n"
	TransferringFile        = "Transferindo arquivo: %s\n"
	TransferComplete        = "Transferência concluída: %s\n"
	WatchingDir             = "Observando diretório %s. Pressione Ctrl+C para sair.\n"
	BroadcastingFile        = "Transmitindo arquivo: %s (%s)\n"
	FailedSendQueued        = "Falha ao enviar arquivos na fila: %v\n"
	ConnectedWaitingFiles   = "Conectado. Aguardando arquivos...\n"
	ReceivedFile            = "Recebido: %s (%s)\n"
	BatchComplete           = "Lote concluído (%d arquivo(s)). Ainda aguardando arquivos...\n"
	PeerClosedSession       = "Peer encerrou a sessão.\n"
	ReconnectedWaitingFiles = "Reconectado. Aguardando arquivos...\n"
	ReconnectAttemptError   = "erro na tentativa de reconexão: %v\n"
	ReconnectWait           = "espera de reconexão: %v\n"
	ReconnectReadyFailed    = "falha ao reconectar: %v\n"
	CopyPINFailedLine       = "Falha ao copiar PIN: %v\n"
	PINCopiedLine           = "PIN copiado\n"
	CopyLinkFailedLine      = "Falha ao copiar link: %v\n"
	ShareLinkCopiedLine     = "Link de compartilhamento copiado\n"
	FailedAnnounceMode      = "Falha ao anunciar download-mode: %v\n"
	AnnouncedDownloadMode   = "Anunciado download-mode manual=%v\n"
	ErrPrefix               = "erro:"
)

// Fatal / returned errors shown to the operator.
const (
	ErrWebRTCDisconnectedBeforeReady = "webrtc desconectou antes de ficar pronto"
	ErrWebRTCTimeout                 = "tempo esgotado na conexão webrtc"
	ErrWebRTCPeerFailed              = "conexão webrtc com o peer falhou"
	ErrJoinRejected                  = "entrada rejeitada: %s"
	ErrEnsureDownloadDir             = "falha ao garantir pasta de downloads: %w"
	ErrWebRTCStart                   = "falha ao iniciar webrtc: %w"
	ErrWebRTCSignal                  = "falha no sinal webrtc: %w"
	ErrSignaling                     = "erro de sinalização: %w"
	ErrConnectSignaling              = "falha ao conectar ao servidor de sinalização: %w"
	ErrSendFile                      = "falha ao enviar arquivo %s: %w"
	ErrCreateWatcher                 = "falha ao criar observador: %w"
	ErrWatchDir                      = "falha ao observar diretório %s: %w"
	ErrTUIForm                       = "formulário TUI falhou: %w"
	ErrModeSelection                 = "seleção de modo falhou: %w"
	ErrPINEntry                      = "entrada de PIN falhou: %w"
	ErrSettingsEntry                 = "entrada de configurações falhou: %w"
	ErrConfigMenu                    = "menu de configurações falhou: %w"
	ErrResetStats                    = "falha ao zerar estatísticas: %w"
)
