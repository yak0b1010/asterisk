#asterisk
# Asterisk Management Appliance

A professional IP-telephony management appliance built on **Asterisk**, packaged as a
single-command Docker deployment. It provides a centralized web interface to deploy,
configure, monitor, and administer a full VoIP system without editing Asterisk
configuration files by hand.

## Architecture

    Web UI (React)  →  Backend API (FastAPI)  →  PostgreSQL  →  Asterisk  →  SIP Clients
                                                                              ↑
                                                                    Flutter mobile softphone

## Features

- **Web admin dashboard** — Asterisk status, extensions, registered phones, active calls, CPU/RAM/disk
- **User & extension management** — CRUD, SIP passwords, live registration status
- **Dialplan management** — numbering plan (100–199 Admin, 200–299 Finance, 300–399 IT, 400–499 Customer Service, 500–599 Management)
- **Telephony services** — voicemail, call transfer, conference rooms, music on hold
- **Call center** — queues, agents, distribution strategies, live queue statistics
- **IVR builder** — interactive voice menus with configurable digit destinations
- **Monitoring** — live supervision of Asterisk, extensions, calls, and system resources
- **CDR & statistics** — call detail records with filters and export
- **Security** — JWT authentication, role-based access, bcrypt passwords, audit log
- **Backup & restore** — one-click backup of configuration, database, and voicemail
- **Mobile softphone** — Flutter app registering to Asterisk over WebSocket

## Tech Stack

| Layer | Technology |
|---|---|
| Telephony engine | Asterisk  LTS (PJSIP, Realtime ODBC, AMI) |
| Backend | Python , FastAPI, SQLAlchemy, panoramask |
| Database | PostgreSQL 16 |
| Frontend | React, Vite, Tailwind CSS |
| Mobile | Flutter, sip_ua, flutter_webrtc |
| Deployment | Docker, Docker Compose |

## Quick Start

    git clone <repo-url>
    cd appliance
    docker compose up -d
    # → open http://localhost
    # → login: admin / admin

## Project Structure

    appliance/
    ├── asterisk/          # Asterisk Docker image + config templates
    ├── backend/           # FastAPI application
    │   └── app/
    │       ├── api/       # HTTP routes
    │       ├── core/      # security, config
    │       ├── db/        # models, schema, session
    │       └── services/  # AMI client, config generator
    ├── frontend/          # React admin UI
    ├── softphone/         # Flutter mobile app
    └── docker-compose.yml

## Team

4 students — ASR2, Département d'Informatique, Université Kasdi Merbah Ouargla.

| Member | Role |
|---|---|
| — | Telephony / Asterisk |
| — | Backend / API / DB |
| — | Web Frontend |
| — | Mobile Softphone |

## License

Academic project — Université Kasdi Merbah Ouargla, 2026–2027.
