# AgentForge V1 — Documentation Guide

## What is AgentForge?

AgentForge is a microservice-based AI application builder focused on generating and validating constrained Next.js frontend projects.

## V1 components

- Next.js web application
- Auth service
- Project service
- AI Orchestrator service
- Execution service
- MongoDB, Redis, and restricted Kubernetes Jobs

## Documentation order

1. Read 01_PRD for product scope.
2. Read 02_SDD and 03_TDD for architecture and implementation rules.
3. Read 05_OPENAPI_SPEC before changing a public endpoint.
4. Read 06_SECURITY_THREAT_MODEL before touching auth, providers, or execution.
5. Treat 15_PHASE as the official delivery roadmap.

## Local start status

The current repository is an initial scaffold. Follow the roadmap rather than treating the existing raw Kubernetes Pod endpoint as a production execution feature.
