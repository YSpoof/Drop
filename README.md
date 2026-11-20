# 💧 Drop

[**Drop**](https://drop.lzart.com.br) é um aplicativo de compartilhamento de arquivos P2P, inspirado na simplicidade do [SnapDrop](https://github.com/SnapDrop/snapdrop/), mas desenvolvido com recursos adicionais para tornar a transferência de arquivos mais prática, eficiente e flexível.

As transferências acontecem diretamente entre os dispositivos utilizando **WebRTC**, enquanto um servidor **WebSocket** é utilizado apenas para sinalização da conexão.

---

## ✨ Recursos

### 🚀 Transferências P2P

- Comunicação direta entre os dispositivos utilizando WebRTC.
- O servidor **não armazena seus arquivos**.
- Menor latência, maior velocidade e privacidade.
- Comunicação full-duplex (envie e receba ao mesmo tempo).

---

### 📂 Arquivos de qualquer tamanho

Diferente de muitas implementações que carregam o arquivo inteiro em memória antes do recebimento, o Drop realiza a transferência em **streaming**.

Isso significa:

- sem necessidade de buffer completo em memória;
- uso reduzido de RAM;
- suporte a arquivos muito grandes.

---

### 📁 Envio de pastas

Além de arquivos individuais, é possível enviar **pastas completas**, preservando sua estrutura de diretórios.

Ideal para compartilhar projetos, coleções de fotos, documentos e backups.

---

### 🔗 Códigos e links de conexão

A tela inicial oferece dois caminhos: **Gerar um código** e **Possuo um código**.

Ao gerar, uma sessão é criada e o servidor sorteia um **PIN de 4 dígitos**. Quem gerou recebe um link pronto para compartilhar e o próprio código, ambos copiáveis, e fica aguardando o outro dispositivo.

Do outro lado, é possível:

- abrir o link recebido; ou
- tocar em **Possuo um código** e digitar o PIN de 4 dígitos.

E pronto, a conexão será estabelecida e você poderá transferir arquivos de forma bidirecional.

---

### 📥 Download seletivo

Nem sempre é desejável baixar tudo o que está sendo enviado.

Por isso o Drop permite ativar/desativar o download automático.

Quando essa opção está desabilitada, o destinatário pode:

- visualizar os arquivos disponíveis;
- escolher apenas os arquivos desejados;
- ignorar os demais.

---

### 💻 Versão desktop (Windows e Linux)

No Windows e no Linux, o botão **Instalar Aplicativo** na barra oferece duas opções: a versão desktop ou a PWA.

A versão desktop traz recursos extras:

- transferências retomáveis;
- pasta de download personalizada;
- detecção automática de itens novos nas pastas;
- envio/recebimento mais estáveis.

[Baixar para Windows](https://drop.lzart.com.br/downloads/Drop-win_x64.exe)

[Baixar para Linux](https://drop.lzart.com.br/downloads/Drop-linux_x64)

A versão desktop abre o Drop em uma janela do Chrome, Chromium ou Edge (no Windows) instalado no sistema. Para apontar para outro endereço, defina `DROP_URL` (padrão `https://drop.lzart.com.br`).

---

### ⌨️ Linha de comando (Windows e Linux)

O `dropcli` envia e recebe arquivos pelo terminal, conectando-se a navegadores, à versão desktop ou a outro `dropcli`.

[Baixar para Windows](https://drop.lzart.com.br/downloads/Drop-cli-win_x64.exe)

[Baixar para Linux](https://drop.lzart.com.br/downloads/Drop-cli-linux_x64)

Sem argumentos, abre o menu interativo (**Gerar um código**, **Possuo um código**, **Configurações**). Opções (somente na forma longa, antes ou depois dos caminhos):

- `--host` — gera um código e aguarda a conexão
- `--code <pin>` — conecta-se a um código de 4 dígitos
- `--quick` — modo rápido, com saída em linhas (requer `--host` ou `--code`)
- `--out <pasta>` — pasta de download apenas desta execução
- `--help` — mostra a ajuda

Exemplo: `./Drop-cli-linux_x64 --quick --host ./arquivo.zip ./pasta`

---

### 📱 Progressive Web App (PWA)

Em qualquer dispositivo, o Drop também pode ser instalado como PWA, garantindo acesso mais fácil e funcionamento em tela cheia e os mesmos recursos da versão WEB.

---

### 🤖 Compartilhamento pelo Android

Quando instalado no Android, o Drop pode aparecer no menu **Compartilhar** do sistema.

Assim é possível:

- compartilhar arquivos diretamente de outros aplicativos;
- adicionar esses arquivos à fila de envio;
- enviá-los assim que um destinatário estiver conectado.

---

### 📦 Fila de envio

Não é necessário esperar alguém conectar para começar a selecionar arquivos.

Você pode:

- adicionar arquivos antecipadamente;
- organizar tudo que será enviado;
- iniciar a transferência assim que um dispositivo estiver disponível.

---

## 🔒 Privacidade

O servidor utilizado pelo Drop é responsável **apenas pela sinalização da conexão**.

Os arquivos trafegam diretamente entre os dispositivos através do WebRTC.

O servidor **não armazena** e **não vê** os arquivos enviados.

---

## ⚙️ Tecnologias

- [WebRTC](https://developer.mozilla.org/en-US/docs/Glossary/WebRTC)
- [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [Progressive Web App (PWA)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [Rust](https://www.rust-lang.org/) (backend, versão desktop e linha de comando)
- [Streaming de arquivos](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)
- [SvelteKit](https://svelte.dev/docs/kit/introduction)

---

## 🚀 Como usar

1. Abra o Drop em ambos os dispositivos.
2. Em um deles, toque em **Gerar um código** e compartilhe o link ou o código de 4 dígitos. No outro, abra o link recebido ou toque em **Possuo um código** e digite o PIN.
3. Arraste arquivos ou pastas para a janela.
4. Caso prefira, adicione os arquivos à fila antes mesmo da conexão.
5. O destinatário poderá aceitar tudo ou selecionar apenas os arquivos desejados.
6. A transferência acontecerá diretamente entre os dispositivos.

---

## 📈 Ideias / Melhorias futuras

- Compartilhamento em grupo

> Atuamente o WS fica aberto até apenas uma conexão ser feita

- Servidor atuar como intermediario

> Seria legal se desse para o servidor guardar os arquivos temporáriamente mediante uma configuração no .env para habilitar essa feature com uma senha de acesso

- Documentar/Refatorar algumas partes do código

> Algumas coisas estão bem complexas, se desse para simplificar seria o ideal.

---

## 🛠️ Desenvolvimento

Use o `Makefile` na raiz:

- `make build` — roda `build-cli`, `build-desktop` e `build-backend`, nessa ordem
- `make build-backend` — compila o frontend (adapter-static) e o backend em Rust, que embute o frontend e os binários em `downloads/` (`bin/backend`)
- `make build-cli` — gera `Drop-cli-linux_x64` e `Drop-cli-win_x64.exe` em `downloads/` (altere com `CLI_OUT=…`)
- `make build-desktop` — gera `Drop-linux_x64` e `Drop-win_x64.exe` em `dist/` (altere com `DESKTOP_OUT=…`)
- `make dev` — sobe o backend na porta 8080 e o Vite dev server na 4321
- `make dev-desktop` — sobe backend, Vite e a janela desktop com `DROP_URL=http://localhost:4321`
- `make preview-desktop` — abre o binário desktop gerado em `dist/`
- `make test` — roda `cargo test --workspace` e os testes Playwright
- `make clean` — remove artefatos de build

Os binários de cliente (Linux musl e Windows) exigem os alvos `x86_64-unknown-linux-musl` e `x86_64-pc-windows-gnu` do Rust e o `mingw-w64-gcc`.

## 📜 Licença

Este projeto é distribuído sob a licença MIT.
