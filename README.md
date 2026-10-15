# Excalidraw (self-hosted fork)

I made some personal changes to suit for me. Feel free to change anything you like!

A fork of [Excalidraw](https://github.com/excalidraw/excalidraw) focused on self-hosting: your drawings, your accounts and your collaboration all stay on your own infrastructure.

## What changed since the fork

- Drawings are saved to your own MySQL database instead of the browser or the cloud.
- Accounts are a 12-word login key — no email, no password, no third-party sign-in.
- Drawings, images and your shape library are encrypted end-to-end, so the server never sees them.
- Real-time collaboration runs on a self-hosted room server that ships with the repo.
- An optional Redis mode lets collaboration scale across more than one server.
- The whole app runs from a single Docker container.
- Upstream cloud extras (Excalidraw+, AI, share and QR dialogs) were removed.

## Contributing

This fork exists thanks to the [Excalidraw](https://github.com/excalidraw/excalidraw) team and community. If you'd like to support the project, you can contribute to the root repository through their Open Collective page:

➡️ **[Contribute to Excalidraw on Open Collective](https://opencollective.com/excalidraw#category-CONTRIBUTE)**
