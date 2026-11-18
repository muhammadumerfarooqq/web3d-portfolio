---
slug: knodesk-voice-agent
title: AI Voice Agent — KnoDesk
tagline: Taking KnoDesk from WhatsApp-only to phone calls over Twilio
anchor: project-knodesk-voice-agent
categories: [AI & RAG, Full-Stack]
stack: [Python, Twilio, LLM tool-calling, REST API, PostgreSQL]
role: Built the AI side of the voice agent (agent + response endpoint)
context: Axisero (work)
year: 2026
status: live
featured: false
order: 3
links:
  live: ""
  repo: ""
  video: ""
images: [/images/projects/knodesk-voice-agent-1600.webp]
image_alt: "Illustration: a smiling character in a call-centre headset between golden sound waves, with a speech bubble showing a voice waveform"
highlights:
  - Deployed after a 100% pass rate across real-world call scenarios
  - Extends KnoDesk to voice for the same 10+ businesses
  - Reuses the chatbot's tools — pricing, booking, rescheduling, cancellation, escalation
  - Fixed production bugs that were also breaking the live WhatsApp agent
---
## The problem
KnoDesk only supported customers over WhatsApp. Businesses also needed an AI that could handle phone calls.

## What I built
I built the AI voice agent that answers calls over Twilio. It reuses the existing chatbot's tools and knowledge pipeline, so callers can ask about prices, book, reschedule or cancel appointments, or be escalated to a human. The response endpoint is stateless, so many calls can run at the same time within a tight response-time budget.

## Bugs I found and fixed
While testing, I found and fixed bugs in shared booking code that were also affecting the live WhatsApp agent — including a timezone bug where booking times were interpreted in the server's timezone instead of the business's, and a database query bug that broke cancellations when a reason was given.

## Result
It was deployed after a 100% pass rate across real-world call scenarios, extending KnoDesk to the same 10+ businesses on a new channel.
