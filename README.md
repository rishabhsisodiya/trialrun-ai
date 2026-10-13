# TrialRun AI

Mock technical interviews that run on your own machine, on the Claude Code plan you
already have. No API key.

You pick an interview and a tech stack. An AI interviewer asks the questions, follows up
on your answers, watches how you work, and gives you a scored report with an answer sheet
at the end.

## What you can practise

| Interview | What it is |
|---|---|
| **Karat-style** | A hard 60 minutes: short intro, rapid knowledge questions, then progressive coding problems. Optional system design round and an AI assistant in the coding round. |
| **AI interview** | One task in a real repo. You direct a coding agent to solve it while the interviewer questions your decisions. |
| **Custom** | Any mix of rounds, in your order, with your own time for each. |

Round types: introduction, technical MCQ, knowledge discussion, coding, debugging, code
review, system design, AI-agent task, and behavioural.

Every interview takes a tech stack (five presets, or type your own), a coding language
(JavaScript, TypeScript or Python) and a level (junior, mid-level or senior). The level
sets how hard the questions are and the bar you are scored against.

## What you get at the end

- A score from 1 to 5 for each competency, with the reason and the evidence it was based on.
- Strengths, gaps, and what to practise next, for every round.
- An answer sheet, written when you first open it:
  - model answers next to what you said, for discussion rounds;
  - for coding, your time and space complexity against the best solution, the tests you
    failed, and the reference code.

Scores are one model's reading of your interview. The evidence is shown so you can judge
whether you agree.

## Requirements

- **Node.js 24.** That is the version it is developed and tested on. TypeScript coding rounds
  rely on Node running TypeScript directly, which older versions may not do.
- **[Claude Code](https://claude.com/claude-code)**, installed and signed in. Run `claude`
  once in a terminal to check.
- **Python 3**, only if you choose Python for coding rounds or get a Python task.
- macOS or Linux. It has only been run on macOS.

## Getting started

```bash
git clone https://github.com/rishabhsisodiya/trialrun-ai.git
cd trialrun-ai
npm install
npm start
```

Then open http://localhost:4477. The home page shows whether Claude Code is ready.

Other commands:

```bash
npm run dev        # development, with reload, at http://localhost:5173
npm test           # unit tests; no model calls
npm run test:live  # one real call on your Claude plan
npm run typecheck
```

## How it works

TrialRun AI is a local web app: a small server on your machine and a page in your browser.
Nothing is hosted.

- **The interviewer is Claude Code, run by the server.** Questions, follow-ups and scoring
  are requests to the `claude` command you are signed into. Those requests run with every
  tool switched off, so the model can only return text.
- **Coding rounds run your code locally.** Each generated problem ships with tests and a
  reference solution. Before you see a problem, the reference is run against the tests, and
  a problem whose tests disagree with its own solution is thrown away.
- **The AI interview gives you a real repo.** It is copied to a workspace folder. You can
  work on the page, with a file editor and a built-in assistant, or in your own editor with
  your own coding agent. Either way the interviewer reads the agent's session to see what
  you asked for and what it did.
- **Timers are strict.** When a round's time is up it locks. Time you spend waiting for the
  interviewer is given back.

### Your data

Everything is stored as files under `~/.trialrun-ai/`: your interviews, reports and task
workspaces. Deleting an interview on the home page removes its files.

| Setting | Default | Purpose |
|---|---|---|
| `TRIALRUN_HOME` | `~/.trialrun-ai` | Where interviews are stored |
| `TRIALRUN_PORT` | `4477` | Port the server listens on |

### Plan usage

Every question, follow-up, score and assistant request uses your Claude plan. A full
interview makes roughly ten to thirty requests. The built-in assistant in the AI interview is a full
coding-agent run each time, so that round uses the most.

If you hit a usage limit mid-round, the round pauses with the clock stopped, and you resume
when your plan allows.

## Safety

- The server listens on `127.0.0.1` only and refuses requests that do not come from a page
  on your own machine.
- TrialRun AI never reads or stores your Claude login. It only runs the installed `claude`
  command.
- Code in coding rounds runs as you, in a temporary folder, with a time limit. **This is
  not a sandbox.** Generated tests and reference solutions run there too.
- The built-in assistant in the AI interview is the one place the model is given tools. It
  may read and change files inside that interview's workspace folder and run the task's
  test command. Network commands and writes outside the folder are refused.

## Limitations

- **Claude Code is the only engine that has been run.** Support for the Codex CLI is
  written but untested, and Codex has no built-in assistant in the AI interview.
- **The Karat-style preset is unofficial.** It is based on what candidates have reported
  about the format, and it is not affiliated with or endorsed by Karat.
- **Four tasks in the AI interview**, two in JavaScript and two in Python. You will see
  repeats.
- **Text only.** There is no voice interviewer. You can use your system's dictation in any
  answer box to practise answering aloud.
- **Scores are not calibrated** against human interviewers. Treat them as feedback, not a
  prediction.

## Adding a task to the AI interview

Tasks live in `tasks/<id>/`:

```
tasks/<id>/
  task.json     title, language, roles, the test command, and a rubric
  repo/         the starting code
    TASK.md     the brief the candidate sees
```

The rubric in `task.json` says what a strong solution and a strong process look like. It
is never shown before the report. Ship some failing tests that describe part of the task,
and write a solution yourself to check they can pass.

## Project layout

```
server/src/
  engines/      Claude Code and Codex, behind one interface
  rounds/       one handler per round type
  interviews/   the interview lifecycle, timers and scoring
  runner/       runs candidate code against tests
  watcher/      reads coding-agent sessions and workspace changes
web/src/        the React app
shared/         types shared by the server and the page
tasks/          repos for the AI interview
```
