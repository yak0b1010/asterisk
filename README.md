# Asterisk Management Appliance

<!--toc:start-->

- [Asterisk Management Appliance](#asterisk-management-appliance)
  - [Architecture](#architecture)
  - [Features](#features)
  - [Tech Stack](#tech-stack)
  - [Quick Start](#quick-start)
  - [Project Structure](#project-structure)
  - [Team](#team)
  - [License](#license)

<!--toc:end-->

A professional IP-telephony management appliance built on **Asterisk**, packaged as a
single-command Docker deployment. It provides a centralized web interface to deploy,
configure, monitor, and administer a full VoIP system without editing Asterisk
configuration files by hand.

## Architecture

```
    Web UI (React)  →  Backend API (Go)  →  PostgreSQL  →  Asterisk  →  SIP Clients
                                                                              ↑
                                                                    Flutter mobile softphone
```

## Features

- **Web admin dashboard** — Asterisk status, extensions, registered phones, active calls, CPU/RAM/disk
- **User & extension management** — CRUD, SIP passwords, live registration status
- **Dialplan management** — numbering plan (e.g. 100–199 Admin, 200–299 Finance, 300–399 IT, 400–499 Customer Service, 500–599 Management)
- **Telephony services** — voicemail, call transfer, conference rooms.
- **Call center** — queues, agents, distribution strategies, live queue statistics
- **IVR builder** — interactive voice menus with configurable digit destinations
- **Monitoring** — live supervision of Asterisk, extensions, calls, and system resources
- **CDR & statistics** — call detail records with filters and export
- **Security** — JWT authentication, role-based access, bcrypt passwords, audit log
- **Backup & restore** — one-click backup of configuration, database, and voicemail
- **Mobile softphone** — Flutter app registering to Asterisk over WebSocket

## Tech Stack

<<<<<<< Updated upstream
| Layer | Technology |
|---|---|
| Telephony engine | Asterisk  LTS (PJSIP, Realtime ODBC, AMI) |
| Backend | go, GoRM
| Database | PostgreSQL |
| Frontend | React, Vite, Tailwind CSS |
| Mobile | Flutter, sip_ua, flutter_webrtc |
| Deployment | Docker, Docker Compose |
=======
| Layer            | Technology                               |
| ---------------- | ---------------------------------------- |
| Telephony engine | Asterisk LTS (PJSIP, Realtime ODBC, AMI) |
| Backend          | Go, GoRM                                 |
| Database         | PostgreSQL 18                            |
| Frontend         | React, Vite, Tailwind CSS                |
| Mobile           | Flutter, sip_ua, flutter_webrtc          |
| Deployment       | Docker, Docker Compose                   |
>>>>>>> Stashed changes

## Quick Start

Assuming project is in clean state.

```sh
    git clone https://github.com/yak0b1010/asterisk.git
    cd asterisk
    docker compose up -d
    # → open http://localhost:8080
    # → login: e.g. admin / admin
```

## Project Structure

```txt
    appliance/             # Root directory
    ├── asterisk/          # Asterisk Docker image + config templates
    ├── backend/           # FastAPI application
    ├── frontend/          # React Dashboard UI
    ├── softphone/         # Flutter mobile app
    └── docker-compose.yml # Cluster deployment
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
