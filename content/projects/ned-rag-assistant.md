---
slug: ned-rag-assistant
title: NED Academic Regulations Assistant
tagline: A RAG assistant for university rules — with a real evaluation harness
anchor: project-ned-rag-assistant
categories: [AI & RAG]
stack: [Python, FastAPI, Gradio, ChromaDB, sentence-transformers, Google Gemini, Docker, Render, Weights & Biases]
role: Solo — designed, built, evaluated and deployed
context: Independent
year: 2026
status: live
featured: false
order: 6
links:
  live: ""
  repo: ""
  dashboard: ""
images: [/images/projects/ned-rag-assistant-1600.webp]
image_alt: "Illustration: an owl in a graduation cap reads an open rulebook, with a speech bubble showing a check mark and 1.0"
highlights:
  - Recall@5 = 1.000 with clause-aware chunking
  - Faithfulness 21/21 on answered questions; 2/23 safe abstentions
  - Dockerized and deployed to Render
---
## The problem
NED's academic regulations are long and hard to search. Students need quick, accurate answers — not made-up ones.

## What I built
A retrieval-augmented assistant that answers questions about NED's academic regulations. Documents are split with clause-aware chunking that follows the regulation numbering, embedded with sentence-transformers, stored in ChromaDB, and answered by Google Gemini with a grounding prompt. It also includes a deterministic GPA calculator based on the regulation clauses.

## Evaluation
I built an evaluation harness logged to a public Weights & Biases dashboard. With k=5, recall@5 reached 1.000. Of 23 in-scope questions, 21 were answered — all 21 faithful to the sources — and 2 were conservative abstentions. I also found and fixed a bug in the LLM-as-judge evaluation: refusals were being sent to the judge with nothing to check, which made grading inconsistent.

## Deployment
Dockerized (471.5 MB image) and deployed to Render's free tier.
