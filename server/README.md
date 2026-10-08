# Intacta — Smart Caregiver Portal & Touchless Terminal for Dementia

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![React Version](https://img.shields.io/badge/React-18.x-blue)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15.x-blue)](https://www.postgresql.org/)
[![LangChain](https://img.shields.io/badge/LangChain-v0.2.x-green)](https://www.langchain.com/)

**Intacta** is an AI-assisted dementia care platform designed to address repetitive questioning, spatial disorientation, and anxiety in elderly dementia patients. By leveraging **Validation Therapy principles**, real-time state synchronization, and ambient voice interaction, Intacta creates a comforting bridge between family caregivers and patients.

---

## Table of Contents
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Key Features](#key-features)
- [Project Directory Structure](#project-directory-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Database Setup & Migrations](#database-setup--migrations)
  - [Installation & Running Locally](#installation--running-locally)
- [Validation Therapy Guardrails](#validation-therapy-guardrails)
- [Verification & Testing](#verification--testing)
- [API & WebSocket Documentation](#api--websocket-documentation)
- [License](#license)

---

## System Architecture

```text
                                  ┌───────────────────────────────┐
                                  │   Mobile Caregiver Portal     │
                                  │  (React + Tailwind + Socket)  │
                                  └───────────────┬───────────────┘
                                                  │
                                       HTTP / WebSocket (WSS)
                                                  │
                                                  ▼
                                  ┌───────────────────────────────┐
                                  │      Node.js Express API      │
                                  │   (Auth, Socket.IO Server)    │
                                  └───────┬───────────────┬───────┘
                                          │               │
                     ┌────────────────────┘               └────────────────────┐
                     ▼                                                         ▼
    ┌─────────────────────────────────┐                       ┌─────────────────────────────────┐
    │          PostgreSQL DB          │                       │     LangChain + Gemini 2.5      │
    │ (Context, Routines, Audit Logs) │                       │     (Validation Therapy)      │
    └─────────────────────────────────┘                       └────────────────┬────────────────┘
                                                                               │
                                                                       Audio Stream (TTS)
                                                                               │
                                                                               ▼
                                                              ┌─────────────────────────────────┐
                                                              │   Touchless Patient Terminal    │
                                                              │  (Ambient Tablet Web Display)   │
                                                              └─────────────────────────────────┘