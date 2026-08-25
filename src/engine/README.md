# Theophany Build Engine

This module is the application-facing contract for the autonomous builder.

Planned flow: voice/text request -> intent -> plan -> execution -> validation -> repair -> deployment.

Provider credentials and privileged operations must remain server-side; the browser must never contain GitHub, Vercel, Supabase, or model secrets.