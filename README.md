<a href="https://excalidraw.com/" target="_blank" rel="noopener">
  <picture>
    <source media="(prefers-color-scheme: dark)" alt="Excalidraw" srcset="https://excalidraw.nyc3.cdn.digitaloceanspaces.com/github/excalidraw_github_cover_2_dark.png" />
    <img alt="Excalidraw" src="https://excalidraw.nyc3.cdn.digitaloceanspaces.com/github/excalidraw_github_cover_2.png" />
  </picture>
</a>

<h4 align="center">
  <a href="https://excalidraw.com">Excalidraw Editor</a> |
  <a href="https://docs.excalidraw.com">Documentation</a>
</h4>

<div align="center">
  <h2>
    An open source virtual hand-drawn style whiteboard. </br>
    Collaborative and end-to-end encrypted. </br>
  <br />
  </h2>
</div>

<br />
<p align="center">
  <a href="https://github.com/excalidraw/excalidraw/blob/master/LICENSE">
    <img alt="Excalidraw is released under the MIT license." src="https://img.shields.io/badge/license-MIT-blue.svg"  /></a>
  <a href="https://www.npmjs.com/package/@excalidraw/excalidraw">
    <img alt="npm downloads/month" src="https://img.shields.io/npm/dm/@excalidraw/excalidraw"  /></a>
  <a href="https://docs.excalidraw.com/docs/introduction/contributing">
    <img alt="PRs welcome!" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat"  /></a>
  <a href="https://discord.gg/UexuTaE">
    <img alt="Chat on Discord" src="https://img.shields.io/discord/723672430744174682?color=738ad6&label=Chat%20on%20Discord&logo=discord&logoColor=ffffff&widget=false"/></a>
  <a href="https://deepwiki.com/excalidraw/excalidraw">
    <img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" /></a>
  <a href="https://twitter.com/excalidraw">
    <img alt="Follow Excalidraw on Twitter" src="https://img.shields.io/twitter/follow/excalidraw.svg?label=follow+@excalidraw&style=social&logo=twitter"/></a>
</p>

<div align="center">
  <figure>
    <a href="https://excalidraw.com" target="_blank" rel="noopener">
      <img src="https://excalidraw.nyc3.cdn.digitaloceanspaces.com/github%2Fproduct_showcase.png" alt="Product showcase" />
    </a>
    <figcaption>
      <p align="center">
        Create beautiful hand-drawn like diagrams, wireframes, or whatever you like.
      </p>
    </figcaption>
  </figure>
</div>

## Features

The Excalidraw editor (npm package) supports:

- 💯&nbsp;Free & open-source.
- 🎨&nbsp;Infinite, canvas-based whiteboard.
- ✍️&nbsp;Hand-drawn like style.
- 🌓&nbsp;Dark mode.
- 🏗️&nbsp;Customizable.
- 📷&nbsp;Image support.
- 😀&nbsp;Shape libraries support.
- 🌐&nbsp;Localization (i18n) support.
- 🖼️&nbsp;Export to PNG, SVG & clipboard.
- 💾&nbsp;Open format - export drawings as an `.excalidraw` json file.
- ⚒️&nbsp;Wide range of tools - rectangle, circle, diamond, arrow, line, free-draw, eraser...
- ➡️&nbsp;Arrow-binding & labeled arrows.
- 🔙&nbsp;Undo / Redo.
- 🔍&nbsp;Zoom and panning support.

## Excalidraw.com

The app hosted at [excalidraw.com](https://excalidraw.com) is a minimal showcase of what you can build with Excalidraw. Its [source code](https://github.com/excalidraw/excalidraw/tree/master/excalidraw-app) is part of this repository as well, and the app features:

- 📡&nbsp;PWA support (works offline).
- 🤼&nbsp;Real-time collaboration.
- 🔒&nbsp;End-to-end encryption.
- 💾&nbsp;Local-first support (autosaves to the browser or to a MySQL database).
- 🔑&nbsp;Sign in without email/password: the account is a 12-word login key.
- 🔗&nbsp;Shareable links (export to a readonly link you can share with others).

We'll be adding these features as drop-in plugins for the npm package in the future.

## Quick start

**Note:** following instructions are for installing the Excalidraw [npm package](https://www.npmjs.com/package/@excalidraw/excalidraw) when integrating Excalidraw into your own app. To run the repository locally for development, please refer to our [Development Guide](https://docs.excalidraw.com/docs/introduction/development).

Use `npm` or `yarn` to install the package.

```bash
npm install react react-dom @excalidraw/excalidraw
# or
yarn add react react-dom @excalidraw/excalidraw
```

Check out our [documentation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation) for more details!

## Persistência em MySQL

Este fork guarda a cena (elementos + appState), as imagens e a biblioteca em um **MySQL**, em vez do storage do navegador.

- A API de persistência vive em [`server/`](server/index.mjs) e é a única coisa que fala com o banco: o navegador chama `/api/*` no próprio origin.
- O app usa o MySQL como storage principal e mantém uma cópia no navegador como cache/fallback: se a API estiver fora do ar as edições continuam localmente e são reenviadas quando o banco volta.
- `VITE_APP_STORAGE=browser` restaura o comportamento antigo (só o navegador); os testes usam esse modo.

Banco local (usuário `root`, sem senha — os padrões já batem com ele):

```bash
yarn start        # sobe a API (server/, porta 3017) + o dev server (com proxy de /api)
```

O endereço do app é o do dev server (`VITE_APP_PORT`, padrão 3001 — um `.env.development.local` pode trocar). A API é um detalhe interno: o navegador só chama `/api` no próprio origin, e o proxy aponta para `VITE_APP_API_PROXY_TARGET` (3017). Para subir os dois separadamente: `yarn start:api` e `yarn start:app`.

Configuração, tudo opcional: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `API_HOST`, `API_PORT`, `ALLOW_ACCOUNT_CREATION`. Em desenvolvimento elas saem do `.env.development` (o `yarn start` passa o arquivo para o processo da API; o dev server do Vite lê o mesmo arquivo para as `VITE_APP_*`). O schema (`server/schema.sql`) é aplicado sozinho na primeira conexão — inclusive criando o banco, então não há nada para preparar antes do primeiro `yarn start`.

Para rodar tudo em um container único — MySQL, API e nginx dentro da mesma imagem (veja [Dockerfile](Dockerfile) e [docker/entrypoint.sh](docker/entrypoint.sh)):

```bash
docker compose up --build     # http://localhost:3000
```

O único estado que precisa sobreviver ao container é o datadir do MySQL, montado em um volume (`mysql-data:/var/lib/mysql` no compose).

## Conta e chave de login

Não existe email nem senha: a conta **é** uma chave de login — uma seed phrase (BIP39) de **12 palavras** gerada no navegador. Tudo é derivado dela localmente, com HKDF-SHA256; a frase nunca é enviada ao servidor:

```
frase (12 palavras)
  └── seed (BIP39)
        └── HKDF-SHA256
              ├── accountId   → identificador opaco da conta
              ├── authSecret  → credencial enviada como Bearer (o servidor guarda só o sha256)
              ├── contentKey  → AES-GCM 256 que cifra cena, imagens e biblioteca
              └── indexKey    → HMAC-SHA256 dos índices cegos (ids de imagens)
```

O que isso significa na prática:

- **Cifra de ponta a ponta.** Cena, imagens e biblioteca vão para o banco como envelopes AES-GCM (`{ v, iv, ct }`); os ids das imagens entram como índices cegos (HMAC do id real). O servidor guarda e devolve os dados sem saber o que são — e o `aad` de cada envelope amarra o conteúdo ao dono, então um banco adulterado não consegue trocar o envelope de uma conta pelo de outra.
- **A chave aparece uma vez.** Na criação, a frase é mostrada para anotar (com confirmação obrigatória e botão de copiar). A partir daí o servidor guarda `key_revealed_at`: a frase só é mostrada de novo para quem está logado, pelo menu → _Ver minha chave de login_.
- **Manter conectado.** A opção (ligada por padrão) guarda a frase apenas no `localStorage` daquele navegador, o que dá login automático nas próximas visitas. Desligada, a sessão vale só para a aba atual e o próximo load pede a chave de novo.
- **Sair** apaga a cópia local da cena daquela conta no navegador e esquece a sessão; os dados no banco continuam lá, acessíveis por quem tem a frase.
- **Instância de um usuário só.** `ALLOW_ACCOUNT_CREATION=false` (no `.env.development`, ou no ambiente do container) fecha a criação de contas: a chave ainda pode ser criada enquanto o banco não tem nenhuma conta, e depois disso `POST /api/accounts` responde 403 — quem já tem chave continua entrando normalmente. A tela de entrada pergunta ao servidor (`GET /api/health` → `accountCreationOpen`) e, quando fechada, mostra só o _Entrar com a chave_.
- **Quem perde a frase perde os dados**: não há recuperação, nem no servidor.
- `VITE_APP_STORAGE=browser` desliga as contas e volta ao storage do navegador (é o modo usado pelos testes).

## Colaboração em tempo real

Várias pessoas editando a mesma cena ao vivo. São dois processos independentes:

- **servidor de salas** ([`collab-server/`](collab-server/index.mjs)): relay socket.io em 3002. `yarn start` já sobe junto; sozinho é `yarn start:collab`.
- **criar a sala**: pelo botão de compartilhar no topo direito do editor (ou menu → _Live collaboration_ no celular). O diálogo inicia a sessão, mostra o link com botão de copiar e encerra pelo _Stop session_. Quem recebe o link entra na mesma sala.
- **cliente**: o app conecta em `VITE_APP_WS_SERVER_URL` e entra na sala pelo link `#room=<roomId>,<roomKey>` — é a URL que o botão coloca na barra de endereços e copia.

O que passa pela rede é **cifrado de ponta a ponta** (AES-GCM com a chave que vive só no hash do link) e o servidor é cego: ele não decifra nem guarda nada — quem persiste a cena é a API/MySQL. Edição e cursor são empurrados na hora (medido na máquina local: cena inteira para quem entra em ~10 ms, edição ~2 ms, cursor ~2 ms), com um re-sync completo da cena a cada 20 s (`SYNC_FULL_SCENE_INTERVAL_MS`) como rede de segurança. Não há polling.

### Redis (opcional)

Não é preciso Redis para um servidor de salas. Por padrão ele usa o adapter em memória do socket.io, que atende uma instância — o suficiente para um servidor único e para o desenvolvimento.

Redis entra **só quando você roda mais de uma instância** (redundância/escala): como cada instância só conhece as próprias conexões, sem um backplane uma edição feita na instância A não chega em quem está na instância B. Com `REDIS_URL` o adapter Redis passa a reemitir os eventos entre as instâncias (e o balanceador precisa de sessões sticky, exigência do transporte de polling do socket.io).

```bash
# uma instância (padrão): sem Redis
REDIS_URL= node collab-server/index.mjs

# várias instâncias compartilhando as salas
redis-server --daemonize yes
COLLAB_PORT=3002 REDIS_URL=redis://127.0.0.1:6379 node collab-server/index.mjs
COLLAB_PORT=3003 REDIS_URL=redis://127.0.0.1:6379 node collab-server/index.mjs
```

O `docker compose` já traz o serviço `redis` e liga o adapter no container `collab`, então ali basta escalar: `docker compose up --scale collab=3` (com um balanceador na frente, sticky).

### Estado atual e limites

- A sala é criada pelo diálogo do `RoomDialog` (botão de compartilhar no topo direito / item de menu). Só entrar na sala continua sendo pelo link: não há convite por usuário nem lista de salas.
- Enquanto a sessão está aberta, a cena **não é salva na conta** (`LocalData.pauseSave("collaboration")`): quem guarda a cena da sala é o Firebase do upstream, e a gravação no MySQL volta quando a sessão é encerrada.
- A cena de uma sala é **restaurada pelo Firebase** do upstream (`loadFromFirebase`) e as imagens da sala vão para lá também (`saveFilesToFirebase`), se `VITE_APP_FIREBASE_CONFIG` estiver configurado. Se o Firebase falhar ou não estiver configurado, os próprios participantes sincronizam a cena pelo socket — a edição ao vivo não depende dele.
- Em produção, `VITE_APP_WS_SERVER_URL` precisa de um endereço alcançável pelo **navegador** (o app é servido no seu domínio, a colaboração em outro); o compose publica o servidor de salas em `localhost:3002`.

## Contributing

- Missing something or found a bug? [Report here](https://github.com/excalidraw/excalidraw/issues).
- Want to contribute? Check out our [contribution guide](https://docs.excalidraw.com/docs/introduction/contributing) or let us know on [Discord](https://discord.gg/UexuTaE).
- Want to help with translations? See the [translation guide](https://docs.excalidraw.com/docs/introduction/contributing#translating).

## Integrations

- [VScode extension](https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor)
- [npm package](https://www.npmjs.com/package/@excalidraw/excalidraw)

## Who's integrating Excalidraw

[Google Cloud](https://googlecloudcheatsheet.withgoogle.com/architecture) • [Meta](https://meta.com/) • [CodeSandbox](https://codesandbox.io/) • [Obsidian Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) • [Replit](https://replit.com/) • [Slite](https://slite.com/) • [Notion](https://notion.so/) • [HackerRank](https://www.hackerrank.com/) • and many others

## Sponsors & support

If you like the project, you can become a sponsor at [Open Collective](https://opencollective.com/excalidraw).

## Thank you for supporting Excalidraw

[<img src="https://opencollective.com/excalidraw/tiers/sponsors/0/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/0/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/1/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/1/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/2/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/2/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/3/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/3/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/4/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/4/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/5/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/5/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/6/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/6/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/7/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/7/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/8/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/8/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/9/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/9/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/10/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/10/website)

<a href="https://opencollective.com/excalidraw#category-CONTRIBUTE" target="_blank"><img src="https://opencollective.com/excalidraw/tiers/backers.svg?avatarHeight=32"/></a>

Last but not least, we're thankful to these companies for offering their services for free:

[![Vercel](./.github/assets/vercel.svg)](https://vercel.com) [![Sentry](./.github/assets/sentry.svg)](https://sentry.io) [![Crowdin](./.github/assets/crowdin.svg)](https://crowdin.com)
