/**
 * Sample seed data for local testing only. Clearly marked as sample data so it
 * is never confused with real candidate information. Used by prisma/seed.ts.
 */

export const SAMPLE_RESUME = `Jordan Avery
Senior Software Engineer

Summary
Senior backend-leaning full-stack engineer with 9 years building and operating
high-traffic web services. Strong in distributed systems, API design, and
reliability. Comfortable owning features end to end and mentoring mid-level engineers.

Experience

Staff Software Engineer — Northwind Payments (2021–Present)
- Led redesign of the payment ledger service handling 4M transactions/day in Go and PostgreSQL.
- Cut p99 latency from 850ms to 180ms by introducing read replicas and a Redis cache layer.
- Owned on-call rotation; reduced Sev1 incidents by 40% by adding circuit breakers and better alerting.
- Mentored 4 engineers; ran weekly architecture reviews.

Senior Software Engineer — Brightloop SaaS (2017–2021)
- Built multi-tenant REST and GraphQL APIs in Node.js/TypeScript serving 200k MAU.
- Migrated a monolith to event-driven services using Kafka, improving deploy frequency 3x.
- Implemented RBAC and audit logging; passed SOC 2 Type II security review.

Software Engineer — Cobalt Analytics (2015–2017)
- Built data pipelines in Python and Airflow processing 2TB/day.
- Created a React dashboard for internal analytics used by 30+ stakeholders.

Skills
Languages: Go, TypeScript, JavaScript, Python, SQL
Backend: PostgreSQL, Redis, Kafka, gRPC, REST, GraphQL
Cloud/Infra: AWS (ECS, RDS, S3, Lambda), Docker, Terraform, GitHub Actions
Frontend: React, Next.js, Tailwind
Practices: TDD, observability (Prometheus/Grafana), incident response

Education
B.S. Computer Science — State University (2015)`;

export const SAMPLE_JD = `Company: Meridian Health Cloud
Role: Senior Backend Engineer (Platform)

About the role
We are building the platform layer that powers our healthcare data products. You
will design and operate reliable, secure services that other teams build on.

Responsibilities
- Design and own backend services in Go (or similar) with a focus on reliability and scale.
- Improve latency, throughput, and observability of high-traffic APIs.
- Partner with product and frontend teams to ship features end to end.
- Contribute to on-call and incident response; drive postmortems.
- Mentor engineers and raise the engineering bar through reviews.

Must-have skills
- 6+ years building backend services in production.
- Strong with Go or another statically typed language.
- Deep experience with PostgreSQL and caching (Redis).
- Experience operating services on AWS with Docker.
- Solid understanding of distributed systems tradeoffs.

Preferred
- Event-driven architecture experience (Kafka).
- Healthcare or other regulated/security-sensitive domain.
- Infrastructure as code (Terraform).

Domain: Healthcare data platform
We care about security, reliability, and clear ownership.`;
