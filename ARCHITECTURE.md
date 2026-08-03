# Architecture and agent flow

This document explains how the Smart Assignment Tracker is designed and how data
flows through it. It is meant as a learning reference alongside the code.

## High-level structure

The app is split into a React browser client and a Node/Express server. All AI calls
happen on the server so the Gemini API key never reaches the browser.

```
                          +--------------------------------------+
                          |            BROWSER (React)            |
                          |          client/src/App.tsx           |
                          +-------------------+------------------+
                                              |  HTTP fetch, /api/*
                                              |  Vite proxy :4173 -> :3001
                          +-------------------v------------------+
                          |          SERVER (Express)            |
                          |          server/src/index.ts         |
                          +----+-------------+-------------+------+
                               |             |             |
             +-----------------+             |             +-----------------+
             v                               v                               v
        INGEST                        AGENT (Gemini)                  NOTIFY / PROGRESS
        ingest.ts                     agent.ts                     notify.ts / progress.ts
```

## Loop 1: Upload and extract questions

```
User picks a document
      |
      v
POST /api/assignments   (multipart upload)
      |
      v
ingest.ts   convert PDF / DOCX / TXT / MD   ->   markdown text
      |
      v
agent.ts    extractQuestions(markdown)
      |         |
      |         +- prompt: "return ONLY a JSON array of questions"
      |         +- Gemini generateContent  (no tools)
      |         +- withRetry: back off on 429, fail clearly on limit:0
      v
parse JSON  ->  Question[]  (id, prompt, answer="", done=false)
      |
      v
store.ts    save assignment to SQLite (data.sqlite)
      |
      v
respond with assignment + progress   ->   UI renders the question list
```

## Loop 2: Solve one question (the web-search agent step)

```
User clicks "Solve with agent" on a question
      |
      v
POST /api/assignments/:id/questions/:qid/solve
      |
      v
agent.ts    solveQuestion(question, docMarkdown)
      |
      +- prompt = document context  +  the specific question
      |
      +- TRY: Gemini generateContent WITH tools: [{ googleSearch: {} }]
      |        |
      |        v
      |   +------------------------------------------+
      |   |  Gemini decides: do I need to search?    |
      |   |   yes -> runs Google Search server-side  |
      |   |          reads results, writes answer    |
      |   |   no  -> answers from context + knowledge|
      |   +------------------------------------------+
      |
      +- ON 429 (web search quota): retry WITHOUT web search
      |        so the student still gets a document-grounded answer
      |
      +- read answer text
      +- read groundingMetadata.groundingChunks[].web.uri  -> source URLs
      +- report usedWebSearch (true or false)
      |
      v
store.ts    save answer + sources on the question
      |
      v
respond with updated question + progress + usedWebSearch
      |
      v
UI shows the answer, any Sources, and whether web search was used
```

## Supporting flows (not AI)

```
Toggle "done"  ->  PATCH question  ->  progress.ts recomputes  ->  progress bar updates

Scheduler (hourly, in notify.ts):
  notifyEnabled? + email set? + pending work? + 12h since last email?
        +- yes ->  buildSummaryHtml()  ->  nodemailer  ->  Gmail SMTP  ->  student inbox
```

## Design principles

- The server is the agent host; the browser is only the UI. Gemini calls run
  server-side so the API key stays private.
- Structured output over prose. `extractQuestions` forces Gemini to return a JSON
  array, which is what makes the output machine-usable instead of a chat reply. This is
  the core agentic technique in the project.
- Tool use is isolated to the solve step. Only `solveQuestion` enables the
  `googleSearch` tool, which keeps extraction cheap and confines the tighter web-search
  quota to one place.
- Graceful degradation. If the web-search tool is rate-limited, solving retries without
  it rather than failing, and the UI reports which path was used.
- Resilience wraps every model call. `withRetry` handles transient 429s with backoff
  and fails fast with a clear message on hard `limit: 0` quota errors.
- State is stored in a real database. Everything persists to a local SQLite file
  (`server/data.sqlite`) through `store.ts`, which uses better-sqlite3. Each assignment
  is one row; its questions are kept as a JSON column. The store functions have simple
  synchronous signatures, so the rest of the server does not need to know the storage
  engine. An older `data.json`, if present, is imported once on startup.

## Where each piece lives

| Concern | File |
|---------|------|
| API routes | `server/src/index.ts` |
| Document to markdown | `server/src/ingest.ts` |
| Agent: extract and solve | `server/src/agent.ts` |
| Timeline and progress math | `server/src/progress.ts` |
| Email reminders and scheduler | `server/src/notify.ts` |
| SQLite persistence | `server/src/store.ts` |
| User interface | `client/src/App.tsx` |
| Typed API client | `client/src/api.ts` |
