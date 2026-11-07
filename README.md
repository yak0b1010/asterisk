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
    Web UI (React)  →  Backend API (FastAPI)  →  PostgreSQL
                              │                     │
                              │ AMI                 │ CDR (ODBC)
                              ↓                     ↓
                        Asterisk PBX  ←─────────────┘
                              ↑
                        SIP desk phones / softphone
```

- The **backend** owns users, extensions and audit data in **PostgreSQL**. It
  generates `pjsip_endpoints.conf`, `queues.conf` and `voicemail.conf` from the
  database and asks Asterisk to reload them over **AMI**.
- **Asterisk** runs in **standalone** mode: it reads the generated files from
  `/etc/asterisk/generated` and writes finished calls to the PostgreSQL `cdr`
  table over **ODBC**.
- **SIP clients** (desk phones and the Flutter softphone) talk to Asterisk directly on
  `5060` and exchange media on the RTP range.

## Features

Implemented in the current stack:

- **Web admin dashboard** — Asterisk status, registered extensions, active calls, today's CDR statistics, CPU/RAM/disk
- **User & extension management** — CRUD, SIP passwords, bulk range creation, live registration status
- **Telephony services** — 5 department queues (`010`–`014`), personal + department voicemail, sound on hold
- **CDR & statistics** — finished calls written by Asterisk to PostgreSQL and shown on the dashboard
- **Security** — JWT authentication, role-based access (`admin` / `operator` / `viewer`), bcrypt passwords, audit log

Planned for later steps: dialplan editor, IVR builder, conference rooms, live monitoring,
backup/restore, and the Flutter mobile softphone.

## Tech Stack

| Layer            | Technology                                              |
| ---------------- | ------------------------------------------------------- |
| Telephony engine | Asterisk 22.8-cert4 LTS (PJSIP, AMI, ODBC CDR)          |
| PBX base image   | `andrius/asterisk` on Debian Trixie (digest-pinned)     |
| Backend          | Python 3.12, FastAPI, SQLAlchemy, Uvicorn                |
| Database         | PostgreSQL 18                                           |
| Frontend         | React 19, Vite, Tailwind CSS, TanStack Query            |
| Mobile           | Flutter (later step)                                    |
| Deployment       | Docker (rootful), Docker Compose                        |

## Repository Structure

```txt
appliance/
├── asterisk/            # PBX image, config templates + generated config folder
├── backend/             # FastAPI API, database models and tests
├── frontend/            # React admin UI
├── db/init/             # PostgreSQL schema created on first start (CDR)
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
| Control plane   | `AMI_PORT`, `AMI_PASSWORD`, `ARI_PASSWORD`                                    |
| Database        | `POSTGRES_VERSION`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| Backend auth    | `JWT_SECRET`, `JWT_EXPIRE_MINUTES`, `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`, `SEED_DEMO_DATA` |
| PBX identity    | `PBX_FQDN`, `PBX_PUBLIC_IP`                                                   |

**Change `DB_PASSWORD`, `JWT_SECRET`, `AMI_PASSWORD` and `SEED_ADMIN_PASSWORD` before
using the appliance outside your laptop.**

## Quick Start

Assuming a clean checkout.

```sh
git clone https://github.com/yak0b1010/asterisk.git
cd asterisk
make env

# Full stack (PostgreSQL + Asterisk + Backend + dashboard)
make up
# → dashboard on http://localhost:8080
# → API docs on http://localhost:8080/api/docs (through nginx)
```

Sign in with the seeded administrator:

| Username   | Password   | Role     |
| ---------- | ---------- | -------- |
| `admin`    | `admin`    | admin    |
| `operator` | `operator` | operator |
| `viewer`   | `viewer`   | viewer   |

The operator/viewer accounts and the demo directory are created because
`SEED_DEMO_DATA=true`. Set it to `false` in `.env` for a clean installation
with only the administrator account.

The first start also creates 500 extensions (`100`–`599`, SIP password
`<number>pass`) and writes the matching Asterisk configuration. Change the
passwords from the Extensions page when the phones are provisioned.

## Common Commands

```sh
make env                     # create .env from .env.example
make up / down / logs / ps   # full stack
make build                   # rebuild all images
make test                    # validate Compose + run backend tests
make cli                     # Asterisk CLI inside the running container
make clean                   # stop everything and delete volumes (DESTRUCTIVE)
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
