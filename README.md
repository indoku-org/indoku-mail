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

## Deploy (Vercel)

Set the env vars above in the Vercel project, then point `mail.indoku.org` at it
(CNAME, DNS only). Sessions are stateless (encrypted httpOnly cookie), so no storage is needed.
