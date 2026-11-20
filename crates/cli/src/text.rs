//! Hardcoded pt-BR user-facing strings.
//!
//! Labels shared with Drop web/desktop must match the Svelte UI (source of truth).
//! Flag names, identifiers, protocol fields and brand tokens (Drop, DropCli) stay English.
//! Operator lines carry no trailing newline; the line writer adds it.

use std::fmt::Display;

// Shared web/desktop labels.
pub const HOST_SESSION: &str = "Gerar um código";
pub const JOIN_SESSION: &str = "Possuo um código";
pub const DISPLAY_NAME: &str = "Nome de exibição";
pub const DOWNLOAD_DIR: &str = "Pasta para downloads";
pub const DOWNLOAD: &str = "Baixar";
pub const REMOVE: &str = "Remover";
pub const SETTINGS: &str = "Configurações";

// Interactive forms.
pub const MODE_PROMPT: &str = "O que você deseja fazer?";
pub const ENTER_PIN: &str = "Digite o PIN da sessão (4 dígitos)";
pub const RESET_TRANSFER_STATS: &str = "Zerar estatísticas de transferência";
pub const ERR_PIN_DIGITS: &str = "PIN deve ter exatamente 4 dígitos";
pub const ERR_PATH_NOT_DIR: &str = "caminho existe, mas não é um diretório";
pub const ERR_DIR_MISSING: &str = "pasta não existe";
pub const MENU_HELP: &str = "↑/↓ mover  enter confirmar  ctrl+c sair";
pub const PIN_HELP: &str = "enter confirmar  esc voltar  ctrl+c sair";
pub const SAVE: &str = "Salvar";
pub const SETTINGS_HELP: &str = "↑/↓ mover  enter confirmar  esc voltar sem salvar";
pub const DISPLAY_NAME_EMPTY: &str = "vazio: usar o nome do computador";
pub const DOWNLOAD_DIR_EMPTY: &str = "vazio: usar a pasta atual";
pub const TRANSFER_STATS: &str = "Estatísticas de transferência";
pub const RESET_STATS_CONFIRM: &str = "Pressione enter novamente para zerar, esc para cancelar";
pub const STATS_RESET_DONE: &str = "Estatísticas zeradas";

pub fn stats_sent(files: u64, bytes: impl Display) -> String {
    format!("Enviados: {files} arquivo(s), {bytes}")
}
pub fn stats_received(files: u64, bytes: impl Display) -> String {
    format!("Recebidos: {files} arquivo(s), {bytes}")
}
pub fn err_save_settings(err: impl Display) -> String {
    format!("falha ao salvar configurações: {err}")
}

// Donation reminder and the PIX block in Configurações.
pub const DONATION_TITLE: &str = "Gostou do Drop?";
pub const DONATION_BODY: &str = "O Drop é gratuito. Um PIX ajuda a manter o projeto.";
pub const DONATION_PIX_HINT: &str = "Chave PIX aleatória — selecione para copiar:";
pub const DONATION_COPY_PIX: &str = "Copiar chave PIX";
pub const DONATION_CLOSE: &str = "Fechar";
pub const DONATION_PIX_LABEL: &str = "Chave PIX";
pub const PIX_COPIED: &str = "Chave PIX copiada";
pub const DONATION_HELP: &str = "←/→ mover  enter confirmar";

pub fn copy_pix_failed(err: impl Display) -> String {
    format!("Falha ao copiar chave PIX: {err}")
}
pub fn err_dismiss_donation(err: impl Display) -> String {
    format!("falha ao dispensar lembrete de doação: {err}")
}

// Connection and role status.
pub const ROLE_HOST: &str = "Host";
pub const ROLE_JOIN: &str = "Entrar";
pub const STATUS_CONNECTING: &str = "Conectando...";
pub const STATUS_CONNECTED: &str = "Conectado";
pub const STATUS_DISCONNECTED: &str = "Desconectado";
pub const STATUS_WAITING_RECONNECT: &str = "Aguardando reconexão";
pub const LABEL_LAN: &str = "LAN";
pub const PEER_LOST: &str = "conexão perdida";

pub fn connected_to(peer: impl Display) -> String {
    format!("Peer: {peer}")
}
pub fn pin_label(pin: impl Display) -> String {
    format!("PIN: {pin}")
}

// Inbox chrome.
pub const INBOX_TITLE: &str = "DropCli — Caixa de entrada";
pub const PENDING_OFFERS: &str = "Ofertas pendentes";
pub const PENDING_NONE: &str = "Nenhuma oferta — aguardando o peer anunciar arquivos";
pub const TRANSFERS: &str = "Transferências";
pub const TRANSFERS_NONE: &str = "Nenhuma transferência ainda";
pub const INBOX_HELP: &str = "↑/↓ mover  enter pasta  esc voltar  espaço marcar  a todos  d baixar  r remover  f buscar  c PIN  C link  q sair";
pub const INBOX_SEARCH_HELP: &str =
    "digite para filtrar  ↑/↓ resultados  enter confirmar  esc cancelar";
pub const NOTHING_SELECTED: &str = "Nada selecionado";

pub fn search_prompt(query: impl Display) -> String {
    format!("Buscar: {query}")
}
pub fn scroll_hint(from: usize, to: usize, total: usize) -> String {
    format!("{from}–{to} / {total}")
}
pub fn download_failed(err: impl Display) -> String {
    format!("Falha ao baixar: {err}")
}
pub fn downloading_named(name: impl Display) -> String {
    format!("Baixando {name}…")
}
pub fn remove_failed(err: impl Display) -> String {
    format!("Falha ao remover: {err}")
}
pub fn removed_named(name: impl Display) -> String {
    format!("Removido {name}")
}
pub fn n_files(count: usize) -> String {
    format!("{count} arquivos")
}

// Copy feedback (inbox status line and quick-mode lines).
pub const PIN_COPIED: &str = "PIN copiado";
pub const SHARE_LINK_COPIED: &str = "Link de compartilhamento copiado";

pub fn copy_pin_failed(err: impl Display) -> String {
    format!("Falha ao copiar PIN: {err}")
}
pub fn copy_link_failed(err: impl Display) -> String {
    format!("Falha ao copiar link: {err}")
}

// Usage (flag names stay English).
pub const USAGE: &str = "\
Uso do dropcli:
  dropcli [flags] [caminhos…]

Modo interativo:
  dropcli [--host|--code <pin>] [--out <pasta-downloads>] [caminhos…]

Modo rápido:
  dropcli --quick --host [caminhos…] [--out <pasta-saída>]
  dropcli --quick --code <pin> [caminhos…] [--out <pasta-saída>]

Flags:
  --quick         Modo rápido não interativo
  --host          Gerar um código (anfitrião da sessão)
  --code <pin>    Entrar em uma sessão com PIN de 4 dígitos
  --out <pasta>   Diretório de destino para arquivos baixados
  --help          Mostrar esta ajuda";

// Argument validation.
pub const ERR_ARGS: &str = "argumentos inválidos";
pub const ERR_QUICK_NEEDS_ROLE: &str = "modo rápido requer --host ou --code";
pub const ERR_HOST_AND_CODE: &str = "não é possível usar --host e --code ao mesmo tempo";

pub fn invalid_arg(arg: impl Display) -> String {
    format!("argumento inválido: {arg}")
}
pub fn invalid_pin() -> String {
    format!("PIN inválido: {ERR_PIN_DIGITS}")
}
pub fn path_missing(path: impl Display, err: impl Display) -> String {
    format!("caminho não existe: {path}: {err}")
}
pub fn path_unsupported(path: impl Display) -> String {
    format!("caminho não é arquivo nem diretório: {path}")
}

// Quick-mode operator lines.
pub const PRESS_COPY_HINT: &str = "Pressione c para copiar o PIN, C para copiar o link";
pub const PRESS_COPY_PIN_HINT: &str = "Pressione c para copiar o PIN";
pub const WAITING_PEER: &str = "Aguardando o peer entrar...";
pub const WAITING_RECONNECT: &str = "Aguardando reconexão...";
pub const CONNECTED_WAITING_FILES: &str = "Conectado. Aguardando arquivos...";
pub const PEER_CLOSED_SESSION: &str = "Peer encerrou a sessão.";
pub const RECONNECTED_WAITING_FILES: &str = "Reconectado. Aguardando arquivos...";
pub const ERR_PREFIX: &str = "erro:";

pub fn assigned_pin(pin: impl Display) -> String {
    format!("PIN atribuído: {pin}")
}
pub fn peer_joined(name: impl Display) -> String {
    format!("Peer entrou: {name}")
}
pub fn join_accepted(name: impl Display) -> String {
    format!("Entrada aceita por: {name}")
}
pub fn transferring_file(name: impl Display) -> String {
    format!("Transferindo arquivo: {name}")
}
pub fn transfer_complete(name: impl Display) -> String {
    format!("Transferência concluída: {name}")
}
pub fn watching_dir(dir: impl Display) -> String {
    format!("Observando diretório {dir}. Pressione Ctrl+C para sair.")
}
pub fn received_file(name: impl Display, size: impl Display) -> String {
    format!("Recebido: {name} ({size})")
}
pub fn transfer_failed(name: impl Display, reason: Option<&str>) -> String {
    match reason {
        Some(reason) => format!("Transferência falhou: {name}: {reason}"),
        None => format!("Transferência falhou: {name}"),
    }
}
pub fn batch_complete(count: usize) -> String {
    format!("Lote concluído ({count} arquivo(s)). Ainda aguardando arquivos...")
}
pub fn reconnect_ready_failed(err: impl Display) -> String {
    format!("falha ao reconectar: {err}")
}

// Confirm-to-exit overlay.
pub const CONFIRM_EXIT_TITLE: &str = "Sair da sessão?";
pub const CONFIRM_EXIT_HINT: &str = "Pressione Ctrl+C novamente para sair";
pub const CONFIRM_CONTINUE_HINT: &str = "Pressione ESC para continuar";

// Errors shown to the operator.
pub const ERR_WEBRTC_TIMEOUT: &str = "tempo esgotado na conexão webrtc";
pub const ERR_WEBRTC_PEER_FAILED: &str = "conexão webrtc com o peer falhou";
pub const ERR_SIGNALING_TIMEOUT: &str = "tempo esgotado ao conectar";
pub const ERR_SIGNALING_CLOSED: &str = "conexão de sinalização encerrada";
pub const ERR_CLIPBOARD_UNAVAILABLE: &str =
    "nenhuma ferramenta de área de transferência encontrada";
pub const ERR_NOT_A_TERMINAL: &str = "o modo interativo requer um terminal; use --quick";

pub fn err_load_config(err: impl Display) -> String {
    format!("falha ao carregar configurações: {err}")
}
pub fn err_join_rejected(reason: impl Display) -> String {
    format!("entrada rejeitada: {reason}")
}
pub fn err_ensure_download_dir(err: impl Display) -> String {
    format!("falha ao garantir pasta de downloads: {err}")
}
pub fn err_webrtc_start(err: impl Display) -> String {
    format!("falha ao iniciar webrtc: {err}")
}
pub fn err_connect_signaling(err: impl Display) -> String {
    format!("falha ao conectar ao servidor de sinalização: {err}")
}
pub fn err_send_file(name: impl Display, err: impl Display) -> String {
    format!("falha ao enviar arquivo {name}: {err}")
}
pub fn err_watch_dir(dir: impl Display, err: impl Display) -> String {
    format!("falha ao observar diretório {dir}: {err}")
}
pub fn err_tui(err: impl Display) -> String {
    format!("formulário TUI falhou: {err}")
}
pub fn err_reset_stats(err: impl Display) -> String {
    format!("falha ao zerar estatísticas: {err}")
}

// Transfer failure reasons.

/// The written length differs from `meta.size`.
pub const SIZE_MISMATCH: &str = "tamanho divergente";
/// The receiver never acknowledged a file.
pub const ACK_TIMED_OUT: &str = "tempo esgotado aguardando confirmação";
/// The receiver never answered `start` with `resume`.
pub const RESUME_TIMED_OUT: &str = "tempo esgotado aguardando o destinatário";
