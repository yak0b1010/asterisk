# Asterisk Management Appliance

<!--toc:start-->

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Configuration](#configuration)
- [Quick Start](#quick-start)
- [Operating Modes](#operating-modes)
- [Common Commands](#common-commands)
- [Documentation Map](#documentation-map)
- [Team](#team)
- [License](#license)

<!--toc:end-->

## Overview

A professional IP-telephony management appliance built on **Asterisk**, packaged as a
single-command Docker deployment. It provides a centralized web interface to deploy,
configure, monitor, and administer a full VoIP system without editing Asterisk
configuration files by hand.

The project follows one rule everywhere: **one source of truth per concern**. Image
pins, ports, credentials and database settings live in a single root `.env`; the PBX
configuration lives with the PBX; the stack is described once in
`docker-compose.yaml`.

## Architecture

```txt
    Web UI (React)  →  Backend API (Go)  →  PostgreSQL  →  Asterisk  →  SIP Clients
                                                  ↑            ↑              ↑
                                          AMI / ARI ───────────┘              │
                                                                    Flutter mobile softphone
```

- The **backend** observes and controls Asterisk over **AMI / ARI** and writes
  provisioning data into **PostgreSQL**.
- **Asterisk** reads its endpoints, voicemail boxes and queues from PostgreSQL through
  **ODBC realtime**, so the backend never edits configuration files directly.
- **SIP clients** (desk phones and the Flutter softphone) talk to Asterisk directly on
  `5060` and exchange media on the RTP range.

## Features

- **Web admin dashboard** — Asterisk status, extensions, registered phones, active calls, CPU/RAM/disk
- **User & extension management** — CRUD, SIP passwords, live registration status
- **Dialplan management** — numbering plan (e.g. 100–199 Admin, 200–299 Finance, 300–399 IT, 400–499 Customer Service, 500–599 Management)
- **Telephony services** — voicemail, call transfer, conference rooms
- **Call center** — queues, agents, distribution strategies, live queue statistics
- **IVR builder** — interactive voice menus with configurable digit destinations
- **Monitoring** — live supervision of Asterisk, extensions, calls, and system resources
- **CDR & statistics** — call detail records with filters and export
- **Security** — JWT authentication, role-based access, bcrypt passwords, audit log
- **Backup & restore** — one-click backup of configuration, database, and voicemail
- **Mobile softphone** — Flutter app registering to Asterisk over WebSocket

## Tech Stack

| Layer            | Technology                                              |
| ---------------- | ------------------------------------------------------- |
| Telephony engine | Asterisk 22.8-cert4 LTS (PJSIP, Realtime ODBC, AMI/ARI) |
| PBX base image   | `andrius/asterisk` on Debian Trixie (digest-pinned)     |
| Backend          | Go, GoRM                                                |
| Database         | PostgreSQL 18                                           |
| Frontend         | React, Vite, Tailwind CSS                               |
| Mobile           | Flutter, sip_ua, flutter_webrtc                         |
| Deployment       | Docker (rootful), Docker Compose                        |

## Repository Structure

```txt
appliance/
├── asterisk/            # PBX image definition + configuration
├── backend/             # Go API (AMI/ARI + PostgreSQL)
├── dashboard/           # React admin UI
├── softphone/           # Flutter mobile app
├── db/init/             # Realtime SQL schema (mounted by Postgres)
├── docker-compose.yaml  # Full-stack deployment
├── Makefile             # Stack orchestration
├── .env.example         # DotEnv example file
└── .env                 # Secret DotEnv file, copied from `.env.example`
```

## Configuration

Everything configurable is read from the **root `.env`** — Docker Compose, the root
Makefile and the nested PBX Makefile all consume the same file.

```sh
make env
```

| Group           | Keys                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| Base image pin  | `ASTERISK_IMAGE`, `ASTERISK_TAG`, `ASTERISK_DIGEST`                           |
| Appliance image | `ASTERISK_APP_IMAGE`, `ASTERISK_MODE`                                         |
| Ports           | `SIP_PORT`, `RTP_RANGE`, `HTTP_PORT`, `WSS_PORT`, `DASHBOARD_PORT`            |
| Control plane   | `AMI_PASSWORD`, `ARI_PASSWORD`                                                |
| Database        | `POSTGRES_VERSION`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |

## Quick Start

Assuming a clean checkout.

```sh
git clone https://github.com/yak0b1010/asterisk.git
cd asterisk
make env

# Full stack (PostgreSQL + Asterisk + Backend + dashboard)
make up
# → dashboard on http://localhost:8080
```

## Common Commands

```sh
make env                     # create .env from .env.example
make up / down / logs / ps   # full stack
make build                   # rebuild all images
```

## Team

4 students — NAS2, Department of Computer Science, University Kasdi Merbah Ouargla.

| Member | Role                 |
| ------ | -------------------- |
| —      | Telephony / Asterisk |
| —      | Backend / API / DB   |
| —      | Web Frontend         |
| —      | Mobile Softphone     |

## License

Academic project — Université Kasdi Merbah Ouargla, 2026–2027.
