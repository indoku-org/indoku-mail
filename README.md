# Indoku Mail

A lightweight Gmail-style webmail for `@indoku.org` accounts, served at `mail.indoku.org`.
Talks to the cPanel mail server over IMAP (read/list/delete) and SMTP (send). No database.

**Stack:** Astro (SSR) · React · `@indoku/ui` · imapflow · nodemailer · mailparser · sanitize-html · Vercel

## Setup

```bash
cp .env.example .env   # fill in SESSION_SECRET
npm install
npm run dev
```

## Environment variables

| Name | Description |
| --- | --- |
| `IMAP_HOST` / `IMAP_PORT` | IMAP server (TLS, 993). Hostname must match the server's certificate. |
| `SMTP_HOST` / `SMTP_PORT` | SMTP server (TLS, 465). |
| `SESSION_SECRET` | 32+ chars. Encrypts the session cookie (AES-256-GCM). |
| `IDLE_SECONDS` | Optional (10–55, default 25). How long one realtime (IMAP IDLE) stream stays open before the browser reconnects. Keep it below your Vercel function time limit. |

## Deploy (Vercel)

Set the env vars above in the Vercel project, then point `mail.indoku.org` at it
(CNAME, DNS only). Sessions are stateless (encrypted httpOnly cookie), so no storage is needed.

## Features

Multiple accounts (`/u/<n>/…`, up to 5) · folders, search, paging · read/reply/reply-all/forward · rich-text compose with autosaved drafts ·
send and receive attachments (inline images included) · contact autocomplete (learned from Sent/Inbox) · select several messages
(archive, spam, read/unread, delete) · star from the list · empty Trash/Junk · per-browser signature · realtime new-mail updates and
desktop notifications.

Notes: signature and contact cache live in the browser (localStorage) because the server is stateless. Notifications work while a
Mail tab is open; closed-tab push would need a persistent server and a push subscription store.
