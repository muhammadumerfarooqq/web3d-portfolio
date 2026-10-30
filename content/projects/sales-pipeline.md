---
slug: sales-pipeline
title: Sales Pipeline — Axisero Output Tracker
tagline: Proof-linked lead tracking that 25+ employees use every day
anchor: project-sales-pipeline
categories: [Full-Stack]
stack: [Next.js, TypeScript, PostgreSQL (Neon), Vercel, Tailwind CSS, Recharts]
role: Designed and shipped the feature end to end
context: Axisero (work)
year: 2026
status: live
featured: false
order: 4
links:
  live: ""
  repo: ""
  video: ""
images: []
highlights:
  - Used daily by 25+ Axisero employees
  - CEO-approved; deployed with zero merge conflicts
  - Fixed a live production login bug during rollout
---
## The problem
Business developers self-reported their outreach numbers, and there was no way to verify the activity. Leadership wanted named leads with verifiable proof.

## What I built
A Sales Pipeline inside Axisero's internal Output Tracker app: leads and "touches" that each require a proof link, automatic status progression (New → Contacted → Replied → Interested → Handed Off), an admin take-over queue, board and table views, and funnel and per-person analytics. Records are never hard-deleted — only archived.

## How it shipped
I built it on a dedicated feature branch with preview deployments, then merged it to production with zero conflicts. During rollout I found and fixed a live login bug caused by a broken production environment variable.

## Result
CEO-approved and used daily by 25+ employees, without affecting the rest of the app.
