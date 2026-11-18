---
slug: face-recognition-attendance
title: AI Face-Recognition Attendance System
tagline: Proxy-proof attendance with ArcFace embeddings and blink liveness
anchor: project-face-recognition-attendance
categories: [Computer Vision, AI & RAG]
stack: [Python, FastAPI, Docker, InsightFace (ArcFace), ONNX Runtime, OpenCV, MediaPipe, SQLite, Gradio]
role: Solo — designed and built end to end
context: Independent
year: 2026
status: completed
featured: true
order: 5
links:
  live: ""
  repo: https://github.com/muhammadumerfarooqq/attendance-system
  video: ""
images: [/images/projects/face-recognition-attendance-1600.webp]
image_alt: "Illustration: a face inside camera scan brackets with landmark points, a 0.8 match score and a green check mark"
highlights:
  - 160× separation between genuine (~0.8) and impostor (~0.005) match scores
  - Blink-liveness anti-spoofing and multi-face rejection
  - Dockerized FastAPI REST API with 5 endpoints
---
## The problem
Manual and card-based attendance is slow and easy to fake with proxies — designed here for a university classroom of around 45 students.

## What I built
A face-recognition attendance system using 512-dimensional ArcFace embeddings. Instead of guessing a match threshold, I measured it: genuine matches scored around 0.8 and impostors around 0.005 — a 160× separation — and set the threshold from that data.

Anti-spoofing: a blink-liveness check (eye-aspect-ratio over consecutive frames) and rejection of frames with multiple faces. It runs as a Dockerized FastAPI REST API with 5 endpoints, with a Gradio interface on top of the same recognition core.

## Status
Complete and runs locally in Docker. There's no public live demo: the ResNet-50 model needs more memory than free hosting tiers allow.
